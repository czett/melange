mod mpv_gl;

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::{Arc, mpsc};
use std::time::Duration;

use gtk4::gdk::{Key, ModifierType, RGBA};
use gtk4::glib;
use gtk4::prelude::*;
use gtk4::{
    Application, ApplicationWindow, CssProvider, EventControllerKey, GLArea, Overlay,
    PropagationPhase, STYLE_PROVIDER_PRIORITY_APPLICATION,
};
use melange_core::{
    AppConfig, AppMode, AudioEngine, CecHandle, Database, EvdevHandle, GamepadHandle, InputRouter,
    KeyAction, M3uXmltvProvider, NavEvent, OverlayKind, PlayerBackend, PlayerController, RunMode,
    ShellCommand, StateManager, TvheadendProvider, spawn_server_thread,
};
use tracing::{error, info, warn};
use webkit6::WebView;
use webkit6::prelude::*;

use crate::mpv_gl::MpvPlayer;

const APP_ID: &str = "org.melange.tv";

/// Ensure `LC_NUMERIC` is `"C"` as required by `libmpv` (GTK4's `gtk::init()` resets locales).
fn ensure_c_numeric_locale() {
    // SAFETY: `c"C"` is a valid static NUL-terminated C string.
    unsafe {
        libc::setlocale(libc::LC_NUMERIC, c"C".as_ptr());
    }
}

fn main() {
    ensure_c_numeric_locale();

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
        ensure_c_numeric_locale();
        if let Err(err) = build_ui(app, &config_clone) {
            error!(error = %err, "failed to build melange-shell UI");
        }
    });

    app.run_with_args::<&str>(&[]);
}

fn build_ui(app: &Application, config: &AppConfig) -> Result<(), melange_core::MelangeError> {
    let db = Database::open(&config.db_path)?;
    let mut tvh_synced = false;
    if let Some(tvh_url) = &config.tvheadend_url {
        let tvh = TvheadendProvider::new(
            tvh_url,
            config.tvheadend_user.clone(),
            config.tvheadend_pass.clone(),
        );
        match tvh.sync_blocking(&db) {
            Ok(report) => {
                info!(
                    channels = report.channels_upserted,
                    epg = report.epg_entries_upserted,
                    "synced tvheadend into sqlite"
                );
                tvh_synced = true;
            }
            Err(err) => {
                warn!(error = %err, "tvheadend unreachable; falling back to m3u/xmltv");
            }
        }
    }

    if !tvh_synced {
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
    }

    let profiles = db.list_profiles()?;
    let channels = db.list_channels()?;
    let epg_entries = db.list_all_epg()?;

    let audio = Arc::new(AudioEngine::new(&config.sounds_dir));
    let state_manager = StateManager::new(profiles.clone(), channels.clone(), epg_entries, Arc::clone(&audio));
    state_manager.set_providers(config.piped_url.clone(), config.media_dirs.clone());
    state_manager.attach_db_path(config.db_path.clone());
    state_manager.set_wallpapers_dir(config.wallpapers_dir.clone());
    state_manager.set_port(config.port);
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
    state_manager.attach_nav_sender(nav_tx.clone());
    let router = Rc::new(InputRouter::new(Arc::clone(&audio), nav_tx.clone()));
    let _gamepad = GamepadHandle::spawn(nav_tx.clone(), Arc::clone(&audio));
    let _evdev = EvdevHandle::spawn(nav_tx.clone(), Arc::clone(&audio));
    let _cec = CecHandle::spawn(nav_tx, Arc::clone(&audio));

    let mpv_player = MpvPlayer::new()?;
    let controller = Rc::new(RefCell::new(PlayerController::new(channels, mpv_player)));

    let window = ApplicationWindow::builder()
        .application(app)
        .title("melange")
        .default_width(1280)
        .default_height(720)
        .decorated(false)
        .build();
    window.set_decorated(false);

    if let Some(display) = gtk4::gdk::Display::default() {
        let provider = CssProvider::new();
        provider.load_from_string(
            "window, headerbar { background-color: #120303; color: #ffffff; border: none; box-shadow: none; }",
        );
        gtk4::style_context_add_provider_for_display(
            &display,
            &provider,
            STYLE_PROVIDER_PRIORITY_APPLICATION,
        );
    }

    {
        let state_fs = Arc::clone(&state_manager);
        window.connect_fullscreened_notify(move |win| {
            state_fs.set_fullscreen(win.is_fullscreen());
        });
    }

    if config.mode == RunMode::Kiosk {
        window.fullscreen();
        window.set_cursor_from_name(Some("none"));
        state_manager.set_fullscreen(true);
    }

    let gl_area = GLArea::builder()
        .hexpand(true)
        .vexpand(true)
        .auto_render(false)
        .build();

    let ctrl_realize = Rc::clone(&controller);
    gl_area.connect_realize(move |area| {
        area.make_current();
        let res = {
            let mut ctrl = ctrl_realize.borrow_mut();
            ctrl.backend_mut().init_gl(area)
        };
        if let Err(err) = res {
            error!(error = %err, "failed to initialize libmpv OpenGL context");
        }
    });

    let ctrl_unrealize = Rc::clone(&controller);
    gl_area.connect_unrealize(move |area| {
        area.make_current();
        {
            let mut ctrl = ctrl_unrealize.borrow_mut();
            ctrl.backend_mut().teardown_gl();
        }
    });

    let ctrl_render = Rc::clone(&controller);
    let state_render = Arc::clone(&state_manager);
    gl_area.connect_render(move |area, _gl_ctx| {
        let scale = area.scale_factor();
        let width = area.width() * scale;
        let height = area.height() * scale;
        let snapshot = {
            let mut ctrl = ctrl_render.borrow_mut();
            let was_zapping = ctrl.is_zapping();
            ctrl.backend().render(width, height);
            ctrl.mark_frame_rendered();
            (was_zapping && !ctrl.is_zapping()).then(|| ControllerSnapshot::from_controller(&ctrl))
        };
        if let Some(snap) = snapshot {
            snap.apply(&state_render);
        }
        glib::Propagation::Stop
    });

    // Transparent WebKit6 overlay layered directly above the libmpv GLArea.
    let webview_settings = webkit6::Settings::builder()
        .enable_webgl(true)
        .hardware_acceleration_policy(webkit6::HardwareAccelerationPolicy::Always)
        .build();
    let webview = WebView::builder()
        .hexpand(true)
        .vexpand(true)
        .settings(&webview_settings)
        .build();
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
    let window_keys = window.clone();
    let webview_keys = webview.clone();
    let state_keys = Arc::clone(&state_manager);
    key_controller.connect_key_pressed(move |_, key, _, mods| {
        if state_keys.is_key_capture() {
            let _ = webview_keys.grab_focus();
            return glib::Propagation::Proceed;
        }

        let no_accel = !mods.intersects(
            ModifierType::CONTROL_MASK | ModifierType::ALT_MASK | ModifierType::SUPER_MASK,
        );
        let overlay = state_keys.snapshot().overlay;
        if overlay == OverlayKind::SearchKeyboard {
            if let Some(ev) = map_gtk_key_for_search(key) {
                router_keys.dispatch(ev);
                return glib::Propagation::Stop;
            }
            let _ = webview_keys.grab_focus();
            return glib::Propagation::Proceed;
        }

        if no_accel
            && let Some(key_name) = key.name()
            && let Some(action) = state_keys.keymap().resolve_action(key_name.as_str())
        {
            match action {
                KeyAction::ToggleFullscreen => {
                    toggle_window_fullscreen(&window_keys, &state_keys);
                    return glib::Propagation::Stop;
                }
                KeyAction::OpenSettings
                | KeyAction::OpenHome
                | KeyAction::OpenLiveTv
                | KeyAction::OpenMediathek
                | KeyAction::OpenYouTube
                | KeyAction::OpenSearch => {
                    state_keys.handle_key_action(action);
                    return glib::Propagation::Stop;
                }
                other => {
                    router_keys.dispatch(action_to_nav_event(other));
                    return glib::Propagation::Stop;
                }
            }
        }

        if no_accel && let Some(ev) = map_gtk_fallback_key(key) {
            router_keys.dispatch(ev);
            return glib::Propagation::Stop;
        }
        glib::Propagation::Proceed
    });
    window.add_controller(key_controller);

    window.set_child(Some(&root_overlay));
    window.present();
    let _ = webview.grab_focus();

    // Poll NavEvent, ShellCommand, libmpv events & on-demand progress on GTK main loop without blocking.
    let ctrl_nav = Rc::clone(&controller);
    let state_nav = Arc::clone(&state_manager);
    let app_cmd = app.clone();
    let window_cmd = window.clone();
    let webview_cmd = webview.clone();
    let gl_area_cmd = gl_area.clone();
    let db_path_loop = config.db_path.clone();
    let mut tick_count: u64 = 0;
    glib::timeout_add_local(Duration::from_millis(16), move || {
        while let Ok(ev) = nav_rx.try_recv() {
            state_nav.handle_nav_event(ev);
            handle_nav_event(&ctrl_nav, &state_nav, ev);
        }
        while let Ok(cmd) = shell_cmd_rx.try_recv() {
            handle_shell_command(
                &app_cmd,
                &window_cmd,
                &webview_cmd,
                &gl_area_cmd,
                &ctrl_nav,
                &state_nav,
                cmd,
            );
        }

        let mpv_err = {
            let mut ctrl = ctrl_nav.borrow_mut();
            ctrl.backend_mut().poll_events()
        };
        if mpv_err.is_some() {
            state_nav.clear_zapping();
        }

        tick_count = tick_count.wrapping_add(1);
        if tick_count.is_multiple_of(31) {
            let snap = state_nav.snapshot();
            if let Some(ref item) = snap.playback.current_media {
                let (pos, dur, paused) = {
                    let ctrl = ctrl_nav.borrow();
                    ctrl.backend().playback_progress()
                };
                state_nav.update_playback_progress(pos, dur, paused);

                if tick_count.is_multiple_of(310)
                    && pos > 1.0
                    && let Some(profile) = snap.active_profile
                    && let Ok(db) = Database::open(&db_path_loop)
                    && db.upsert_watch_progress(profile.id, item, pos, dur).is_ok()
                    && let Ok(entries) = db.list_continue_watching(profile.id, 20)
                {
                    state_nav.set_continue_watching(entries);
                }
            }
        }
        glib::ControlFlow::Continue
    });

    Ok(())
}

struct ControllerSnapshot {
    channel: Option<melange_core::Channel>,
    state: melange_core::PlaybackState,
    is_zapping: bool,
    digit_buffer: String,
}

impl ControllerSnapshot {
    fn from_controller(ctrl: &PlayerController<MpvPlayer>) -> Self {
        Self {
            channel: ctrl.current_channel().cloned(),
            state: ctrl.state(),
            is_zapping: ctrl.is_zapping(),
            digit_buffer: ctrl.digit_buffer().to_string(),
        }
    }

    fn apply(self, state_manager: &StateManager) {
        state_manager.sync_player_state(
            self.channel.as_ref(),
            self.state,
            self.is_zapping,
            &self.digit_buffer,
            0.0,
            0.0,
        );
    }
}

fn toggle_window_fullscreen(window: &ApplicationWindow, state_manager: &StateManager) {
    let next = !window.is_fullscreen();
    if next {
        window.fullscreen();
    } else {
        window.unfullscreen();
    }
    state_manager.set_fullscreen(next);
}

fn handle_shell_command(
    app: &Application,
    window: &ApplicationWindow,
    webview: &WebView,
    gl_area: &GLArea,
    controller: &Rc<RefCell<PlayerController<MpvPlayer>>>,
    state_manager: &StateManager,
    cmd: ShellCommand,
) {
    match cmd {
        ShellCommand::SelectChannel { channel_id } => {
            let snap = {
                let mut ctrl = controller.borrow_mut();
                let target_number = ctrl
                    .channels()
                    .iter()
                    .find(|c| c.id == channel_id)
                    .map(|c| c.number);
                target_number.map(|number| {
                    match ctrl.load_channel(number) {
                        Ok(Some(ch)) => info!(number = ch.number, name = %ch.name, "tuned channel from UI"),
                        Ok(None) => {}
                        Err(err) => error!(error = %err, "failed to tune channel from UI"),
                    }
                    ControllerSnapshot::from_controller(&ctrl)
                })
            };
            if let Some(snap) = snap {
                snap.apply(state_manager);
            }
        }
        ShellCommand::SetMode { .. } => {}
        ShellCommand::SetOverlay { overlay } => {
            if overlay == OverlayKind::SearchKeyboard {
                let _ = webview.grab_focus();
            }
        }
        ShellCommand::PlayMedia {
            item,
            start_position_sec,
        } => {
            let res = {
                let mut ctrl = controller.borrow_mut();
                ctrl.backend_mut().play_url_at(&item.stream_url, start_position_sec)
            };
            if let Err(err) = res {
                error!(error = %err, url = %item.stream_url, "failed to play on-demand media");
            }
        }
        ShellCommand::SeekRelative { offset_sec } => {
            let res = {
                let mut ctrl = controller.borrow_mut();
                ctrl.backend_mut().seek_relative(offset_sec)
            };
            if let Err(err) = res {
                error!(error = %err, "failed to seek");
            }
        }
        ShellCommand::TogglePause => {
            let snap = state_manager.snapshot();
            if snap.playback.current_media.is_some() {
                let res = {
                    let mut ctrl = controller.borrow_mut();
                    ctrl.backend_mut().toggle_pause()
                };
                match res {
                    Ok(paused) => {
                        let (pos, dur, _) = controller.borrow().backend().playback_progress();
                        state_manager.update_playback_progress(pos, dur, paused);
                    }
                    Err(err) => error!(error = %err, "failed to toggle on-demand pause"),
                }
            } else {
                let res = {
                    let mut ctrl = controller.borrow_mut();
                    ctrl.toggle_pause()
                };
                if let Err(err) = res {
                    error!(error = %err, "failed to toggle pause");
                }
            }
        }
        ShellCommand::ToggleFullscreen => {
            toggle_window_fullscreen(window, state_manager);
        }
        ShellCommand::StopPlayback => {
            let mut ctrl = controller.borrow_mut();
            if let Err(err) = ctrl.stop() {
                error!(error = %err, "failed to stop playback");
            }
            gl_area.queue_render();
        }
        ShellCommand::QuitApp => {
            info!("quitting melange-shell");
            app.quit();
        }
    }
}

fn handle_nav_event(
    controller: &Rc<RefCell<PlayerController<MpvPlayer>>>,
    state_manager: &StateManager,
    event: NavEvent,
) {
    match event {
        NavEvent::ChannelUp => {
            let snap = {
                let mut ctrl = controller.borrow_mut();
                match ctrl.channel_up() {
                    Ok(Some(ch)) => info!(number = ch.number, name = %ch.name, "zapped channel up"),
                    Ok(None) => {}
                    Err(err) => error!(error = %err, "channel up failed"),
                }
                ControllerSnapshot::from_controller(&ctrl)
            };
            snap.apply(state_manager);
        }
        NavEvent::ChannelDown => {
            let snap = {
                let mut ctrl = controller.borrow_mut();
                match ctrl.channel_down() {
                    Ok(Some(ch)) => info!(number = ch.number, name = %ch.name, "zapped channel down"),
                    Ok(None) => {}
                    Err(err) => error!(error = %err, "channel down failed"),
                }
                ControllerSnapshot::from_controller(&ctrl)
            };
            snap.apply(state_manager);
        }
        NavEvent::Digit(d) => {
            let snap = {
                let mut ctrl = controller.borrow_mut();
                match ctrl.zap_digit(d) {
                    Ok(Some(ch)) => info!(number = ch.number, name = %ch.name, "zapped via digit"),
                    Ok(None) => {}
                    Err(err) => error!(error = %err, "digit zap failed"),
                }
                ControllerSnapshot::from_controller(&ctrl)
            };
            snap.apply(state_manager);
        }
        NavEvent::Select => {
            let snap = state_manager.snapshot();
            let updated = {
                let mut ctrl = controller.borrow_mut();
                if !ctrl.digit_buffer().is_empty() {
                    if let Err(err) = ctrl.commit_digits() {
                        error!(error = %err, "commit digits failed");
                    }
                    Some(ControllerSnapshot::from_controller(&ctrl))
                } else if snap.mode == AppMode::LiveTv && snap.overlay == OverlayKind::None {
                    if snap.playback.current_media.is_some() {
                        match ctrl.backend_mut().toggle_pause() {
                            Ok(paused) => {
                                let (pos, dur, _) = ctrl.backend().playback_progress();
                                state_manager.update_playback_progress(pos, dur, paused);
                            }
                            Err(err) => error!(error = %err, "toggle on-demand pause failed"),
                        }
                        None
                    } else {
                        if let Err(err) = ctrl.toggle_pause() {
                            error!(error = %err, "toggle pause failed");
                        }
                        Some(ControllerSnapshot::from_controller(&ctrl))
                    }
                } else {
                    None
                }
            };
            if let Some(s) = updated {
                s.apply(state_manager);
            }
        }
        NavEvent::PlayPause => {
            let snap = state_manager.snapshot();
            if snap.playback.current_media.is_some() {
                let mut ctrl = controller.borrow_mut();
                match ctrl.backend_mut().toggle_pause() {
                    Ok(paused) => {
                        let (pos, dur, _) = ctrl.backend().playback_progress();
                        state_manager.update_playback_progress(pos, dur, paused);
                    }
                    Err(err) => error!(error = %err, "play/pause failed"),
                }
            } else {
                let updated = {
                    let mut ctrl = controller.borrow_mut();
                    if let Err(err) = ctrl.toggle_pause() {
                        error!(error = %err, "play/pause failed");
                    }
                    ControllerSnapshot::from_controller(&ctrl)
                };
                updated.apply(state_manager);
            }
        }
        NavEvent::ToggleMute => {
            let res = {
                let mut ctrl = controller.borrow_mut();
                ctrl.backend_mut().toggle_mute()
            };
            match res {
                Ok(muted) => state_manager.set_muted(muted),
                Err(err) => error!(error = %err, "toggle mute failed"),
            }
        }
        NavEvent::Back
        | NavEvent::Home
        | NavEvent::ToggleEpg
        | NavEvent::ToggleOsd
        | NavEvent::Up
        | NavEvent::Down
        | NavEvent::Left
        | NavEvent::Right => {}
    }
}

fn action_to_nav_event(action: KeyAction) -> NavEvent {
    match action {
        KeyAction::Up => NavEvent::Up,
        KeyAction::Down => NavEvent::Down,
        KeyAction::Left => NavEvent::Left,
        KeyAction::Right => NavEvent::Right,
        KeyAction::Select => NavEvent::Select,
        KeyAction::Back => NavEvent::Back,
        KeyAction::ToggleEpg => NavEvent::ToggleEpg,
        KeyAction::ToggleOsd => NavEvent::ToggleOsd,
        KeyAction::ToggleMute => NavEvent::ToggleMute,
        KeyAction::ChannelUp => NavEvent::ChannelUp,
        KeyAction::ChannelDown => NavEvent::ChannelDown,
        KeyAction::OpenHome => NavEvent::Home,
        KeyAction::ToggleFullscreen
        | KeyAction::OpenSettings
        | KeyAction::OpenLiveTv
        | KeyAction::OpenMediathek
        | KeyAction::OpenYouTube
        | KeyAction::OpenSearch => NavEvent::Select,
    }
}

fn map_gtk_key_for_search(key: Key) -> Option<NavEvent> {
    match key {
        Key::Up => Some(NavEvent::Up),
        Key::Down => Some(NavEvent::Down),
        Key::Left => Some(NavEvent::Left),
        Key::Right => Some(NavEvent::Right),
        Key::Return | Key::KP_Enter => Some(NavEvent::Select),
        Key::Escape => Some(NavEvent::Back),
        _ => None,
    }
}

fn map_gtk_fallback_key(key: Key) -> Option<NavEvent> {
    match key {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lc_numeric_is_set_to_c() {
        ensure_c_numeric_locale();
        // SAFETY: Passing NULL queries the current LC_NUMERIC locale without modifying it.
        let ptr = unsafe { libc::setlocale(libc::LC_NUMERIC, std::ptr::null()) };
        assert!(!ptr.is_null());
        let locale = unsafe { std::ffi::CStr::from_ptr(ptr) }
            .to_str()
            .expect("LC_NUMERIC should be valid UTF-8");
        assert_eq!(locale, "C");
    }

    #[test]
    fn search_keyboard_yields_printable_keys_and_preserves_nav_keys() {
        assert_eq!(map_gtk_key_for_search(Key::Up), Some(NavEvent::Up));
        assert_eq!(map_gtk_key_for_search(Key::Down), Some(NavEvent::Down));
        assert_eq!(map_gtk_key_for_search(Key::Left), Some(NavEvent::Left));
        assert_eq!(map_gtk_key_for_search(Key::Right), Some(NavEvent::Right));
        assert_eq!(map_gtk_key_for_search(Key::Return), Some(NavEvent::Select));
        assert_eq!(map_gtk_key_for_search(Key::Escape), Some(NavEvent::Back));

        // Keys that globally map to NavEvent shortcuts must yield (None) during SearchKeyboard
        assert_eq!(map_gtk_key_for_search(Key::h), None);
        assert_eq!(map_gtk_key_for_search(Key::H), None);
        assert_eq!(map_gtk_key_for_search(Key::e), None);
        assert_eq!(map_gtk_key_for_search(Key::E), None);
        assert_eq!(map_gtk_key_for_search(Key::_0), None);
        assert_eq!(map_gtk_key_for_search(Key::_5), None);
        assert_eq!(map_gtk_key_for_search(Key::BackSpace), None);
        assert_eq!(map_gtk_key_for_search(Key::space), None);
    }
}
