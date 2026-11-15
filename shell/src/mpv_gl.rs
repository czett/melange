use std::ffi::{c_char, c_int, c_void};
use std::sync::Arc;

use gtk4::glib;
use gtk4::prelude::*;
use libloading::Library;
use libmpv2::Mpv;
use libmpv2::events::Event;
use libmpv2::render::{OpenGLInitParams, RenderContext, RenderParam, RenderParamApiType};
use melange_core::{MelangeError, PlayerBackend};
use tracing::{debug, error, warn};

const GL_FRAMEBUFFER_BINDING: u32 = 0x8CA6;

type GetProcAddressFn = unsafe extern "C" fn(name: *const c_char) -> *mut c_void;
type GlxGetProcAddressFn = unsafe extern "C" fn(name: *const u8) -> *mut c_void;
type GlGetIntegervFn = unsafe extern "C" fn(pname: u32, data: *mut c_int);

pub struct GlProcResolver {
    _egl_lib: Option<Library>,
    _gl_lib: Option<Library>,
    egl_get_proc_address: Option<GetProcAddressFn>,
    glx_get_proc_address: Option<GlxGetProcAddressFn>,
    gl_get_integerv: GlGetIntegervFn,
}

unsafe fn lookup_dlsym(name: &std::ffi::CStr) -> *mut c_void {
    unsafe { libc::dlsym(libc::RTLD_DEFAULT, name.as_ptr()) }
}

impl GlProcResolver {
    pub fn load() -> Result<Self, MelangeError> {
        let egl_lib = unsafe { Library::new("libEGL.so.1") }.ok();
        let gl_lib = unsafe { Library::new("libGL.so.1") }.ok();

        let egl_get_proc_address: Option<GetProcAddressFn> = egl_lib
            .as_ref()
            .and_then(|lib| unsafe { lib.get::<GetProcAddressFn>(b"eglGetProcAddress\0").ok() }.map(|s| *s))
            .or_else(|| {
                let ptr = unsafe { lookup_dlsym(c"eglGetProcAddress") };
                (!ptr.is_null()).then(|| unsafe { std::mem::transmute::<*mut c_void, GetProcAddressFn>(ptr) })
            });

        let glx_get_proc_address: Option<GlxGetProcAddressFn> = gl_lib
            .as_ref()
            .and_then(|lib| {
                unsafe { lib.get::<GlxGetProcAddressFn>(b"glXGetProcAddressARB\0").ok() }
                    .or_else(|| unsafe { lib.get::<GlxGetProcAddressFn>(b"glXGetProcAddress\0").ok() })
                    .map(|s| *s)
            })
            .or_else(|| {
                let ptr = unsafe { lookup_dlsym(c"glXGetProcAddressARB") };
                let ptr = if ptr.is_null() {
                    unsafe { lookup_dlsym(c"glXGetProcAddress") }
                } else {
                    ptr
                };
                (!ptr.is_null()).then(|| unsafe { std::mem::transmute::<*mut c_void, GlxGetProcAddressFn>(ptr) })
            });

        let mut resolver = Self {
            _egl_lib: egl_lib,
            _gl_lib: gl_lib,
            egl_get_proc_address,
            glx_get_proc_address,
            gl_get_integerv: dummy_gl_get_integerv,
        };

        let gl_get_integerv_ptr = resolver.get_proc_address("glGetIntegerv");
        if gl_get_integerv_ptr.is_null() {
            return Err(MelangeError::Player(
                "failed to resolve glGetIntegerv via EGL/GLX/dlsym".to_string(),
            ));
        }
        resolver.gl_get_integerv =
            unsafe { std::mem::transmute::<*mut c_void, GlGetIntegervFn>(gl_get_integerv_ptr) };

        Ok(resolver)
    }

    pub fn get_proc_address(&self, name: &str) -> *mut c_void {
        let Ok(cstr) = std::ffi::CString::new(name) else {
            return std::ptr::null_mut();
        };

        if let Some(egl_get_proc) = self.egl_get_proc_address {
            let ptr = unsafe { egl_get_proc(cstr.as_ptr()) };
            if !ptr.is_null() {
                return ptr;
            }
        }

        if let Some(glx_get_proc) = self.glx_get_proc_address {
            let ptr = unsafe { glx_get_proc(cstr.as_ptr().cast::<u8>()) };
            if !ptr.is_null() {
                return ptr;
            }
        }

        unsafe { lookup_dlsym(&cstr) }
    }

    pub fn current_fbo(&self) -> i32 {
        let mut fbo: c_int = 0;
        unsafe {
            (self.gl_get_integerv)(GL_FRAMEBUFFER_BINDING, &mut fbo);
        }
        fbo
    }
}

unsafe extern "C" fn dummy_gl_get_integerv(_pname: u32, _data: *mut c_int) {}

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
            init.set_property(
                "ytdl-format",
                "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
            )?;
            init.set_property("network-timeout", 15)?;
            init.set_property(
                "user-agent",
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
            )?;
            init.set_property("msg-level", "all=warn")?;
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

    pub fn seek_absolute(&mut self, pos_sec: f64) -> Result<(), MelangeError> {
        let pos = format!("{:.2}", pos_sec.max(0.0));
        self.mpv
            .command("seek", &[pos.as_str(), "absolute"])
            .map_err(|e| MelangeError::Player(format!("absolute seek failed: {e}")))
    }

    pub fn playback_progress(&self) -> (f64, f64, bool) {
        let pos: f64 = self.mpv.get_property("time-pos").unwrap_or(0.0);
        let dur: f64 = self.mpv.get_property("duration").unwrap_or(0.0);
        let paused: bool = self.mpv.get_property("pause").unwrap_or(false);
        (pos.max(0.0), dur.max(0.0), paused)
    }

    pub fn poll_events(&mut self) -> Option<String> {
        let mut last_error: Option<String> = None;
        while let Some(ev) = self.mpv.wait_event(0.0) {
            match ev {
                Ok(Event::LogMessage {
                    prefix,
                    level,
                    text,
                    ..
                }) => {
                    let msg = text.trim();
                    if !msg.is_empty() {
                        if matches!(level, "fatal" | "error") {
                            error!(prefix = %prefix, "libmpv: {msg}");
                        } else {
                            warn!(prefix = %prefix, "libmpv: {msg}");
                        }
                    }
                }
                Ok(Event::EndFile(reason)) => {
                    if reason == libmpv2::mpv_end_file_reason::Error {
                        let msg = "libmpv playback ended with error".to_string();
                        error!("{msg}");
                        last_error = Some(msg);
                    }
                }
                Err(err) => {
                    warn!(error = %err, "libmpv event error");
                }
                _ => {}
            }
        }
        last_error
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

    fn stop(&mut self) -> Result<(), MelangeError> {
        debug!("libmpv stop");
        self.mpv
            .command("stop", &[])
            .map_err(|e| MelangeError::Player(format!("stop failed: {e}")))
    }

    fn toggle_mute(&mut self) -> Result<bool, MelangeError> {
        let muted: bool = self.mpv.get_property("mute").unwrap_or(false);
        let next = !muted;
        self.mpv
            .set_property("mute", next)
            .map_err(|e| MelangeError::Player(format!("set mute failed: {e}")))?;
        Ok(next)
    }
}
