mod mpv_gl;

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::{Arc, mpsc};
use std::time::Duration;

use gtk4::gdk::Key;
use gtk4::glib;
use gtk4::prelude::*;
use gtk4::{Application, ApplicationWindow, EventControllerKey, GLArea};
use melange_core::{
    AppConfig, AudioEngine, Database, GamepadHandle, InputRouter, M3uXmltvProvider, NavEvent,
    PlayerController, RunMode,
};
use tracing::{error, info, warn};

use crate::mpv_gl::MpvPlayer;

const APP_ID: &str = "org.melange.tv";

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let config = match AppConfig::from_env_args() {
        Ok(cfg) => cfg,
        Err(err) => {
            error!(error = %err, "invalid configuration");
            std::process::exit(2);
        }
    };

    let app = Application::builder().application_id(APP_ID).build();
    // Handle CLI flags ourselves via AppConfig instead of GTK's GApplication flag parser.
    app.connect_handle_local_options(|_, _| std::ops::ControlFlow::Continue(()));

    let config_clone = config.clone();
    app.connect_activate(move |app| {
        if let Err(err) = build_ui(app, &config_clone) {
            error!(error = %err, "failed to build melange-shell UI");
        }
    });

    app.run_with_args::<&str>(&[]);
}

fn build_ui(app: &Application, config: &AppConfig) -> Result<(), melange_core::MelangeError> {
    let db = Database::open(&config.db_path)?;
    if config.channels_path.exists() {
        let report =
            M3uXmltvProvider::sync_from_files(&db, &config.channels_path, &config.epg_path)?;
        info!(
            channels = report.channels_upserted,
            epg = report.epg_entries_upserted,
            "synced m3u/xmltv into sqlite"
        );
    } else {
        warn!(path = %config.channels_path.display(), "channels.m3u not found");
    }

    let channels = db.list_channels()?;
    let audio = Arc::new(AudioEngine::new(&config.sounds_dir));
    let (nav_tx, nav_rx) = mpsc::channel::<NavEvent>();
    let router = Rc::new(InputRouter::new(Arc::clone(&audio), nav_tx.clone()));
    let _gamepad = GamepadHandle::spawn(nav_tx, Arc::clone(&audio));

    let mpv_player = MpvPlayer::new()?;
    let controller = Rc::new(RefCell::new(PlayerController::new(channels, mpv_player)));

    let window = ApplicationWindow::builder()
        .application(app)
        .title("melange")
        .default_width(1280)
        .default_height(720)
        .build();

    if config.mode == RunMode::Kiosk {
        window.fullscreen();
        window.set_cursor_from_name(Some("none"));
    }

    let gl_area = GLArea::builder()
        .hexpand(true)
        .vexpand(true)
        .auto_render(false)
        .build();

    let ctrl_realize = Rc::clone(&controller);
    gl_area.connect_realize(move |area| {
        if let Err(err) = ctrl_realize.borrow_mut().backend_mut().init_gl(area) {
            error!(error = %err, "failed to initialize libmpv OpenGL context");
        }
    });

    let ctrl_unrealize = Rc::clone(&controller);
    gl_area.connect_unrealize(move |area| {
        area.make_current();
        ctrl_unrealize.borrow_mut().backend_mut().teardown_gl();
    });

    let ctrl_render = Rc::clone(&controller);
    gl_area.connect_render(move |area, _gl_ctx| {
        let scale = area.scale_factor();
        let width = area.width() * scale;
        let height = area.height() * scale;
        let mut ctrl = ctrl_render.borrow_mut();
        ctrl.backend().render(width, height);
        ctrl.mark_frame_rendered();
        glib::Propagation::Stop
    });

    let key_controller = EventControllerKey::new();
    let router_keys = Rc::clone(&router);
    key_controller.connect_key_pressed(move |_, key, _, _| {
        if let Some(ev) = map_gtk_key(key) {
            router_keys.dispatch(ev);
            return glib::Propagation::Stop;
        }
        glib::Propagation::Proceed
    });
    window.add_controller(key_controller);

    window.set_child(Some(&gl_area));
    window.present();

    // Poll NavEvent queue on GTK main loop without blocking.
    let ctrl_nav = Rc::clone(&controller);
    let win_weak = window.downgrade();
    glib::timeout_add_local(Duration::from_millis(16), move || {
        while let Ok(ev) = nav_rx.try_recv() {
            handle_nav_event(&ctrl_nav, &win_weak, ev);
        }
        glib::ControlFlow::Continue
    });

    // In --dev mode, automatically load channel 1 so live video starts immediately.
    if config.mode == RunMode::Dev {
        match controller.borrow_mut().load_channel(1) {
            Ok(Some(ch)) => info!(number = ch.number, name = %ch.name, "auto-tuned channel 1"),
            Ok(None) => warn!("channel 1 not found in sqlite"),
            Err(err) => error!(error = %err, "failed to auto-tune channel 1"),
        }
    }

    Ok(())
}

fn handle_nav_event(
    controller: &Rc<RefCell<PlayerController<MpvPlayer>>>,
    win_weak: &glib::WeakRef<ApplicationWindow>,
    event: NavEvent,
) {
    let mut ctrl = controller.borrow_mut();
    match event {
        NavEvent::ChannelUp => match ctrl.channel_up() {
            Ok(Some(ch)) => info!(number = ch.number, name = %ch.name, "zapped channel up"),
            Ok(None) => {}
            Err(err) => error!(error = %err, "channel up failed"),
        },
        NavEvent::ChannelDown => match ctrl.channel_down() {
            Ok(Some(ch)) => info!(number = ch.number, name = %ch.name, "zapped channel down"),
            Ok(None) => {}
            Err(err) => error!(error = %err, "channel down failed"),
        },
        NavEvent::Digit(d) => match ctrl.zap_digit(d) {
            Ok(Some(ch)) => info!(number = ch.number, name = %ch.name, "zapped via digit"),
            Ok(None) => {}
            Err(err) => error!(error = %err, "digit zap failed"),
        },
        NavEvent::Select => {
            if !ctrl.digit_buffer().is_empty() {
                if let Err(err) = ctrl.commit_digits() {
                    error!(error = %err, "commit digits failed");
                }
            } else if let Err(err) = ctrl.toggle_pause() {
                error!(error = %err, "toggle pause failed");
            }
        }
        NavEvent::Back => {
            if let Some(win) = win_weak.upgrade()
                && win.is_fullscreen()
            {
                win.unfullscreen();
            }
        }
        NavEvent::Home => info!("home navigation requested"),
        NavEvent::ToggleEpg => info!("epg overlay toggle requested"),
        NavEvent::Up | NavEvent::Down | NavEvent::Left | NavEvent::Right => {
            info!(?event, "directional navigation event");
        }
    }
}

fn map_gtk_key(key: Key) -> Option<NavEvent> {
    match key {
        Key::Up => Some(NavEvent::Up),
        Key::Down => Some(NavEvent::Down),
        Key::Left => Some(NavEvent::Left),
        Key::Right => Some(NavEvent::Right),
        Key::Return | Key::KP_Enter => Some(NavEvent::Select),
        Key::Escape => Some(NavEvent::Back),
        Key::Page_Up => Some(NavEvent::ChannelUp),
        Key::Page_Down => Some(NavEvent::ChannelDown),
        Key::h | Key::H => Some(NavEvent::Home),
        Key::e | Key::E => Some(NavEvent::ToggleEpg),
        Key::_0 | Key::KP_0 => Some(NavEvent::Digit(0)),
        Key::_1 | Key::KP_1 => Some(NavEvent::Digit(1)),
        Key::_2 | Key::KP_2 => Some(NavEvent::Digit(2)),
        Key::_3 | Key::KP_3 => Some(NavEvent::Digit(3)),
        Key::_4 | Key::KP_4 => Some(NavEvent::Digit(4)),
        Key::_5 | Key::KP_5 => Some(NavEvent::Digit(5)),
        Key::_6 | Key::KP_6 => Some(NavEvent::Digit(6)),
        Key::_7 | Key::KP_7 => Some(NavEvent::Digit(7)),
        Key::_8 | Key::KP_8 => Some(NavEvent::Digit(8)),
        Key::_9 | Key::KP_9 => Some(NavEvent::Digit(9)),
        _ => None,
    }
}
