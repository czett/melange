mod mpv_gl;

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::{Arc, mpsc};
use std::time::Duration;

use gtk4::gdk::{Key, RGBA};
use gtk4::glib;
use gtk4::prelude::*;
use gtk4::{Application, ApplicationWindow, EventControllerKey, GLArea, Overlay, PropagationPhase};
use melange_core::{
    AppConfig, AppMode, AudioEngine, Database, GamepadHandle, InputRouter, M3uXmltvProvider,
    NavEvent, OverlayKind, PlayerController, RunMode, ShellCommand, StateManager,
    spawn_server_thread,
};
use tracing::{error, info, warn};
use webkit6::WebView;
use webkit6::prelude::*;

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

    let profiles = db.list_profiles()?;
    let channels = db.list_channels()?;
    let epg_entries = db.list_all_epg()?;

    let audio = Arc::new(AudioEngine::new(&config.sounds_dir));
    let state_manager = StateManager::new(profiles.clone(), channels.clone(), epg_entries, Arc::clone(&audio));
    state_manager.set_providers(config.piped_url.clone(), config.media_dirs.clone());
    if let Some(profile) = profiles.first()
        && let Ok(entries) = db.list_continue_watching(profile.id, 20)
    {
        state_manager.set_continue_watching(entries);
    }

    let (shell_cmd_tx, shell_cmd_rx) = mpsc::channel::<ShellCommand>();
    state_manager.attach_shell_sender(shell_cmd_tx);

    let _server_handle = spawn_server_thread(
        config.port,
        Arc::clone(&state_manager),
        config.ui_dist_dir.clone(),
    )?;

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
    let state_render = Arc::clone(&state_manager);
    gl_area.connect_render(move |area, _gl_ctx| {
        let scale = area.scale_factor();
        let width = area.width() * scale;
        let height = area.height() * scale;
        let mut ctrl = ctrl_render.borrow_mut();
        let was_zapping = ctrl.is_zapping();
        ctrl.backend().render(width, height);
        ctrl.mark_frame_rendered();
        if was_zapping && !ctrl.is_zapping() {
            sync_controller_to_state(&ctrl, &state_render);
        }
        glib::Propagation::Stop
    });

    // Transparent WebKit6 overlay layered directly above the libmpv GLArea.
    let webview = WebView::builder().hexpand(true).vexpand(true).build();
    webview.set_background_color(&RGBA::new(0.0, 0.0, 0.0, 0.0));
    if config.mode == RunMode::Kiosk {
        webview.connect_context_menu(|_, _, _| true);
    }
    let ui_url = format!("http://127.0.0.1:{}", config.port);
    webview.load_uri(&ui_url);

    let root_overlay = Overlay::builder().hexpand(true).vexpand(true).build();
    root_overlay.set_child(Some(&gl_area));
    root_overlay.add_overlay(&webview);

    let key_controller = EventControllerKey::new();
    key_controller.set_propagation_phase(PropagationPhase::Capture);
    let router_keys = Rc::clone(&router);
    key_controller.connect_key_pressed(move |_, key, _, _| {
        if let Some(ev) = map_gtk_key(key) {
            router_keys.dispatch(ev);
            return glib::Propagation::Stop;
        }
        glib::Propagation::Proceed
    });
    window.add_controller(key_controller);

    window.set_child(Some(&root_overlay));
    window.present();

    // Poll NavEvent & ShellCommand queues on GTK main loop without blocking.
    let ctrl_nav = Rc::clone(&controller);
    let state_nav = Arc::clone(&state_manager);
    let win_weak = window.downgrade();
    glib::timeout_add_local(Duration::from_millis(16), move || {
        while let Ok(ev) = nav_rx.try_recv() {
            state_nav.handle_nav_event(ev);
            handle_nav_event(&ctrl_nav, &state_nav, &win_weak, ev);
        }
        while let Ok(cmd) = shell_cmd_rx.try_recv() {
            handle_shell_command(&ctrl_nav, &state_nav, cmd);
        }
        glib::ControlFlow::Continue
    });

    // In --dev mode, automatically load channel 1 so live video starts immediately.
    if config.mode == RunMode::Dev {
        match controller.borrow_mut().load_channel(1) {
            Ok(Some(ch)) => {
                info!(number = ch.number, name = %ch.name, "auto-tuned channel 1");
                sync_controller_to_state(&controller.borrow(), &state_manager);
            }
            Ok(None) => warn!("channel 1 not found in sqlite"),
            Err(err) => error!(error = %err, "failed to auto-tune channel 1"),
        }
    }

    Ok(())
}

fn sync_controller_to_state(ctrl: &PlayerController<MpvPlayer>, state_manager: &StateManager) {
    state_manager.sync_player_state(
        ctrl.current_channel(),
        ctrl.state(),
        ctrl.is_zapping(),
        ctrl.digit_buffer(),
        0.0,
        0.0,
    );
}

fn handle_shell_command(
    controller: &Rc<RefCell<PlayerController<MpvPlayer>>>,
    state_manager: &StateManager,
    cmd: ShellCommand,
) {
    match cmd {
        ShellCommand::SelectChannel { channel_id } => {
            let mut ctrl = controller.borrow_mut();
            let target_number = ctrl
                .channels()
                .iter()
                .find(|c| c.id == channel_id)
                .map(|c| c.number);
            if let Some(number) = target_number {
                match ctrl.load_channel(number) {
                    Ok(Some(ch)) => info!(number = ch.number, name = %ch.name, "tuned channel from UI"),
                    Ok(None) => {}
                    Err(err) => error!(error = %err, "failed to tune channel from UI"),
                }
                sync_controller_to_state(&ctrl, state_manager);
            }
        }
        ShellCommand::SetMode { .. } | ShellCommand::SetOverlay { .. } => {}
        ShellCommand::PlayMedia {
            item,
            start_position_sec,
        } => {
            let mut ctrl = controller.borrow_mut();
            if let Err(err) = ctrl.backend_mut().play_url_at(&item.stream_url, start_position_sec) {
                error!(error = %err, url = %item.stream_url, "failed to play on-demand media");
            }
        }
        ShellCommand::SeekRelative { offset_sec } => {
            let mut ctrl = controller.borrow_mut();
            if let Err(err) = ctrl.backend_mut().seek_relative(offset_sec) {
                error!(error = %err, "failed to seek");
            }
        }
        ShellCommand::TogglePause => {
            let mut ctrl = controller.borrow_mut();
            if let Err(err) = ctrl.toggle_pause() {
                error!(error = %err, "failed to toggle pause");
            }
        }
    }
}

fn handle_nav_event(
    controller: &Rc<RefCell<PlayerController<MpvPlayer>>>,
    state_manager: &StateManager,
    win_weak: &glib::WeakRef<ApplicationWindow>,
    event: NavEvent,
) {
    let mut ctrl = controller.borrow_mut();
    match event {
        NavEvent::ChannelUp => {
            match ctrl.channel_up() {
                Ok(Some(ch)) => info!(number = ch.number, name = %ch.name, "zapped channel up"),
                Ok(None) => {}
                Err(err) => error!(error = %err, "channel up failed"),
            }
            sync_controller_to_state(&ctrl, state_manager);
        }
        NavEvent::ChannelDown => {
            match ctrl.channel_down() {
                Ok(Some(ch)) => info!(number = ch.number, name = %ch.name, "zapped channel down"),
                Ok(None) => {}
                Err(err) => error!(error = %err, "channel down failed"),
            }
            sync_controller_to_state(&ctrl, state_manager);
        }
        NavEvent::Digit(d) => {
            match ctrl.zap_digit(d) {
                Ok(Some(ch)) => info!(number = ch.number, name = %ch.name, "zapped via digit"),
                Ok(None) => {}
                Err(err) => error!(error = %err, "digit zap failed"),
            }
            sync_controller_to_state(&ctrl, state_manager);
        }
        NavEvent::Select => {
            let snap = state_manager.snapshot();
            if !ctrl.digit_buffer().is_empty() {
                if let Err(err) = ctrl.commit_digits() {
                    error!(error = %err, "commit digits failed");
                }
                sync_controller_to_state(&ctrl, state_manager);
            } else if snap.mode == AppMode::LiveTv && snap.overlay == OverlayKind::None {
                if let Err(err) = ctrl.toggle_pause() {
                    error!(error = %err, "toggle pause failed");
                }
                sync_controller_to_state(&ctrl, state_manager);
            }
        }
        NavEvent::Back => {
            let snap = state_manager.snapshot();
            if snap.overlay == OverlayKind::None
                && snap.mode == AppMode::LiveTv
                && let Some(win) = win_weak.upgrade()
                && win.is_fullscreen()
            {
                win.unfullscreen();
            }
        }
        NavEvent::Home
        | NavEvent::ToggleEpg
        | NavEvent::Up
        | NavEvent::Down
        | NavEvent::Left
        | NavEvent::Right => {}
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
