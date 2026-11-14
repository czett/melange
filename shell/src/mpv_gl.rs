use std::ffi::{c_char, c_int, c_void};
use std::sync::Arc;

use gtk4::glib;
use gtk4::prelude::*;
use libloading::Library;
use libmpv2::Mpv;
use libmpv2::render::{OpenGLInitParams, RenderContext, RenderParam, RenderParamApiType};
use melange_core::{MelangeError, PlayerBackend};
use tracing::{debug, error};

const GL_FRAMEBUFFER_BINDING: u32 = 0x8CA6;

type EpoxyGetProcAddressFn = unsafe extern "C" fn(name: *const c_char) -> *mut c_void;
type GlGetIntegervFn = unsafe extern "C" fn(pname: u32, data: *mut c_int);

pub struct GlProcResolver {
    _lib: Library,
    get_proc_addr: EpoxyGetProcAddressFn,
    gl_get_integerv: GlGetIntegervFn,
}

impl GlProcResolver {
    pub fn load() -> Result<Self, MelangeError> {
        let lib = unsafe { Library::new("libepoxy.so.0") }
            .map_err(|e| MelangeError::Player(format!("failed to load libepoxy.so.0: {e}")))?;

        let get_proc_addr: EpoxyGetProcAddressFn = unsafe {
            *lib.get(b"epoxy_get_proc_address\0")
                .map_err(|e| MelangeError::Player(format!("missing epoxy_get_proc_address: {e}")))?
        };

        let gl_get_integerv_ptr = unsafe { get_proc_addr(c"glGetIntegerv".as_ptr()) };
        if gl_get_integerv_ptr.is_null() {
            return Err(MelangeError::Player(
                "epoxy_get_proc_address(\"glGetIntegerv\") returned null".to_string(),
            ));
        }
        let gl_get_integerv: GlGetIntegervFn = unsafe { std::mem::transmute(gl_get_integerv_ptr) };

        Ok(Self {
            _lib: lib,
            get_proc_addr,
            gl_get_integerv,
        })
    }

    pub fn get_proc_address(&self, name: &str) -> *mut c_void {
        let Ok(cstr) = std::ffi::CString::new(name) else {
            return std::ptr::null_mut();
        };
        unsafe { (self.get_proc_addr)(cstr.as_ptr()) }
    }

    pub fn current_fbo(&self) -> i32 {
        let mut fbo: c_int = 0;
        unsafe {
            (self.gl_get_integerv)(GL_FRAMEBUFFER_BINDING, &mut fbo);
        }
        fbo
    }
}

fn get_proc_address_cb(resolver: &Arc<GlProcResolver>, name: &str) -> *mut c_void {
    resolver.get_proc_address(name)
}

pub struct MpvPlayer {
    render_ctx: Option<RenderContext<'static>>,
    resolver: Option<Arc<GlProcResolver>>,
    mpv: Box<Mpv>,
}

impl MpvPlayer {
    pub fn new() -> Result<Self, MelangeError> {
        let mpv = Mpv::with_initializer(|init| {
            init.set_property("vo", "libmpv")?;
            init.set_property("hwdec", "auto-safe")?;
            init.set_property("keep-open", "always")?;
            init.set_property("idle", "yes")?;
            init.set_property("ytdl", "yes")?;
            init.set_property("terminal", "no")?;
            Ok(())
        })
        .map_err(|e| MelangeError::Player(format!("failed to initialize libmpv: {e}")))?;

        Ok(Self {
            render_ctx: None,
            resolver: None,
            mpv: Box::new(mpv),
        })
    }

    pub fn init_gl(&mut self, gl_area: &gtk4::GLArea) -> Result<(), MelangeError> {
        if self.render_ctx.is_some() {
            return Ok(());
        }

        gl_area.make_current();
        if let Some(err) = gl_area.error() {
            return Err(MelangeError::Player(format!("GLArea error: {err}")));
        }

        let resolver = Arc::new(GlProcResolver::load()?);

        // SAFETY: `self.mpv` is heap-allocated in a `Box` and `self.render_ctx` is dropped
        // before `self.mpv` in both `teardown_gl()` and struct field drop order.
        let mpv_static: &'static mut Mpv = unsafe { &mut *(&mut *self.mpv as *mut Mpv) };
        let mut render_ctx = mpv_static
            .create_render_context(vec![
                RenderParam::ApiType(RenderParamApiType::OpenGl),
                RenderParam::InitParams(OpenGLInitParams {
                    get_proc_address: get_proc_address_cb,
                    ctx: Arc::clone(&resolver),
                }),
            ])
            .map_err(|e| MelangeError::Player(format!("create_render_context failed: {e}")))?;

        let weak_area = glib::SendWeakRef::from(gl_area.downgrade());
        render_ctx.set_update_callback(move || {
            let weak = weak_area.clone();
            glib::MainContext::default().invoke(move || {
                if let Some(area) = weak.upgrade() {
                    area.queue_render();
                }
            });
        });

        self.resolver = Some(resolver);
        self.render_ctx = Some(render_ctx);
        debug!("libmpv RenderContext initialized on GLArea");
        Ok(())
    }

    pub fn render(&self, width: i32, height: i32) {
        let (Some(render_ctx), Some(resolver)) = (&self.render_ctx, &self.resolver) else {
            return;
        };
        let fbo = resolver.current_fbo();
        if let Err(err) = render_ctx.render::<Arc<GlProcResolver>>(fbo, width, height, true) {
            error!(error = %err, "libmpv render error");
        }
    }

    pub fn teardown_gl(&mut self) {
        self.render_ctx = None;
        self.resolver = None;
    }

    pub fn play_url_at(&mut self, url: &str, start_position_sec: f64) -> Result<(), MelangeError> {
        let start_val = if start_position_sec > 1.0 {
            format!("+{start_position_sec:.1}")
        } else {
            "none".to_string()
        };
        let _ = self.mpv.set_property("start", start_val.as_str());
        self.load_replace(url)
    }

    pub fn seek_relative(&mut self, offset_sec: f64) -> Result<(), MelangeError> {
        let offset = format!("{offset_sec:.1}");
        self.mpv
            .command("seek", &[offset.as_str(), "relative"])
            .map_err(|e| MelangeError::Player(format!("seek failed: {e}")))
    }

    #[allow(dead_code)]
    pub fn playback_progress(&self) -> (f64, f64, bool) {
        let pos: f64 = self.mpv.get_property("time-pos").unwrap_or(0.0);
        let dur: f64 = self.mpv.get_property("duration").unwrap_or(0.0);
        let paused: bool = self.mpv.get_property("pause").unwrap_or(false);
        (pos.max(0.0), dur.max(0.0), paused)
    }
}

impl PlayerBackend for MpvPlayer {
    fn load_replace(&mut self, url: &str) -> Result<(), MelangeError> {
        debug!(url = url, "libmpv loadfile replace");
        self.mpv
            .command("loadfile", &[url, "replace"])
            .map_err(|e| MelangeError::Player(format!("loadfile failed: {e}")))?;
        self.mpv
            .set_property("pause", false)
            .map_err(|e| MelangeError::Player(format!("unpause failed: {e}")))?;
        Ok(())
    }

    fn toggle_pause(&mut self) -> Result<bool, MelangeError> {
        let paused: bool = self
            .mpv
            .get_property("pause")
            .map_err(|e| MelangeError::Player(format!("get pause failed: {e}")))?;
        let next = !paused;
        self.mpv
            .set_property("pause", next)
            .map_err(|e| MelangeError::Player(format!("set pause failed: {e}")))?;
        Ok(next)
    }
}
