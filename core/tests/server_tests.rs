use std::path::PathBuf;
use std::sync::Arc;

use futures_util::{SinkExt, StreamExt};
use melange_core::{
    AppMode, AudioEngine, Channel, ClientCommand, EpgEntry, NavEvent, OverlayKind, PlaybackState,
    Profile, ServerMessage, StateManager, serve_on_listener,
};
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::Message as WsMessage;

async fn spawn_test_server() -> (String, Arc<StateManager>) {
    let profiles = vec![Profile {
        id: 1,
        name: "Default".to_string(),
        avatar: String::new(),
        wallpaper_path: None,
        created_at: "2026-11-14 00:00:00".to_string(),
    }];
    let channels = vec![
        Channel {
            id: 1,
            number: 1,
            tvg_id: "daserste.de".to_string(),
            name: "Das Erste HD".to_string(),
            group_title: "Public".to_string(),
            logo_url: String::new(),
            stream_url: "https://example.com/1.m3u8".to_string(),
            is_favorite: false,
            sort_order: 0,
        },
        Channel {
            id: 2,
            number: 2,
            tvg_id: "zdf.de".to_string(),
            name: "ZDF HD".to_string(),
            group_title: "Public".to_string(),
            logo_url: String::new(),
            stream_url: "https://example.com/2.m3u8".to_string(),
            is_favorite: false,
            sort_order: 0,
        },
    ];
    let epg = vec![EpgEntry {
        id: 1,
        channel_tvg_id: "daserste.de".to_string(),
        title: "Tagesschau".to_string(),
        description: "Nachrichten".to_string(),
        start_time: "20261114120000 +0000".to_string(),
        stop_time: "20261114130000 +0000".to_string(),
    }];

    let state = StateManager::new(profiles, channels, epg, Arc::new(AudioEngine::noop()));
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind ephemeral port");
    let addr = listener.local_addr().expect("local addr");

    let state_clone = Arc::clone(&state);
    tokio::spawn(async move {
        let _ = serve_on_listener(listener, state_clone, &PathBuf::from("ui/dist")).await;
    });

    (format!("127.0.0.1:{}", addr.port()), state)
}

#[tokio::test]
async fn rest_endpoints_return_expected_json() {
    let (host, _state) = spawn_test_server().await;
    let client = reqwest::Client::new();

    let health: serde_json::Value = client
        .get(format!("http://{host}/api/health"))
        .send()
        .await
        .expect("health req")
        .json()
        .await
        .expect("health json");
    assert_eq!(health["status"], "ok");

    let channels: Vec<Channel> = client
        .get(format!("http://{host}/api/channels"))
        .send()
        .await
        .expect("channels req")
        .json()
        .await
        .expect("channels json");
    assert_eq!(channels.len(), 2);
    assert_eq!(channels[0].name, "Das Erste HD");

    let epg: Vec<EpgEntry> = client
        .get(format!("http://{host}/api/epg"))
        .send()
        .await
        .expect("epg req")
        .json()
        .await
        .expect("epg json");
    assert_eq!(epg.len(), 1);
    assert_eq!(epg[0].title, "Tagesschau");

    let profiles: Vec<Profile> = client
        .get(format!("http://{host}/api/profiles"))
        .send()
        .await
        .expect("profiles req")
        .json()
        .await
        .expect("profiles json");
    assert_eq!(profiles.len(), 1);
    assert_eq!(profiles[0].name, "Default");
}

#[tokio::test]
async fn websocket_snapshot_nav_broadcast_and_select_channel() {
    let (host, state) = spawn_test_server().await;
    let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{host}/ws"))
        .await
        .expect("ws connect");

    // 1. Initial StateSnapshot
    let first = ws.next().await.expect("first msg").expect("ws ok");
    let first_text = first.into_text().expect("text");
    let snapshot_msg: ServerMessage = serde_json::from_str(&first_text).expect("parse snapshot");
    match snapshot_msg {
        ServerMessage::StateSnapshot { state: snap } => {
            assert_eq!(snap.mode, AppMode::Home);
            assert_eq!(snap.overlay, OverlayKind::None);
            assert_eq!(snap.channels.len(), 2);
        }
        other => panic!("expected StateSnapshot, got {other:?}"),
    }

    // 2. NavEvent::ToggleEpg broadcasts NavEvent + StateUpdate with FullEpg
    state.handle_nav_event(NavEvent::ToggleEpg);

    let msg_nav = ws.next().await.expect("nav msg").expect("ws ok");
    let parsed_nav: ServerMessage =
        serde_json::from_str(&msg_nav.into_text().expect("text")).expect("parse nav");
    assert!(matches!(
        parsed_nav,
        ServerMessage::NavEvent {
            event: NavEvent::ToggleEpg
        }
    ));

    let msg_update = ws.next().await.expect("update msg").expect("ws ok");
    let parsed_update: ServerMessage =
        serde_json::from_str(&msg_update.into_text().expect("text")).expect("parse update");
    match parsed_update {
        ServerMessage::StateUpdate { state: st } => {
            assert_eq!(st.overlay, OverlayKind::FullEpg);
        }
        other => panic!("expected StateUpdate, got {other:?}"),
    }

    // 3. ClientCommand::SelectChannel updates playback and broadcasts StateUpdate
    let cmd_json = serde_json::to_string(&ClientCommand::SelectChannel { channel_id: 2 }).unwrap();
    ws.send(WsMessage::Text(cmd_json.into()))
        .await
        .expect("send SelectChannel");

    let msg_zap = ws.next().await.expect("zap msg").expect("ws ok");
    let parsed_zap: ServerMessage =
        serde_json::from_str(&msg_zap.into_text().expect("text")).expect("parse zap");
    match parsed_zap {
        ServerMessage::StateUpdate { state: st } => {
            assert_eq!(st.mode, AppMode::LiveTv);
            assert_eq!(st.overlay, OverlayKind::ZapBanner);
            assert_eq!(st.playback.channel_id, Some(2));
            assert_eq!(st.playback.channel_number, Some(2));
            assert_eq!(st.playback.state, PlaybackState::Buffering);
            assert!(st.playback.is_zapping);
        }
        other => panic!("expected StateUpdate, got {other:?}"),
    }
}

#[tokio::test]
async fn nav_back_transitions_overlays_and_modes_to_home() {
    let (_host, state) = spawn_test_server().await;

    // 1. LiveTv + FullEpg -> Back closes overlay -> Back returns to Home
    state.set_mode(AppMode::LiveTv);
    state.set_overlay(OverlayKind::FullEpg);
    state.handle_nav_event(NavEvent::Back);
    let snap = state.snapshot();
    assert_eq!(snap.mode, AppMode::LiveTv);
    assert_eq!(snap.overlay, OverlayKind::None);

    state.handle_nav_event(NavEvent::Back);
    let snap = state.snapshot();
    assert_eq!(snap.mode, AppMode::Home);
    assert_eq!(snap.overlay, OverlayKind::None);

    // 2. SearchKeyboard overlay inside YouTube -> Back closes keyboard, second Back returns Home
    state.set_mode(AppMode::YouTube);
    state.set_overlay(OverlayKind::SearchKeyboard);
    state.handle_nav_event(NavEvent::Back);
    let snap = state.snapshot();
    assert_eq!(snap.mode, AppMode::YouTube);
    assert_eq!(snap.overlay, OverlayKind::None);

    state.handle_nav_event(NavEvent::Back);
    assert_eq!(state.snapshot().mode, AppMode::Home);

    // 3. Mediathek, Media, Settings -> Back returns to Home
    for mode in [AppMode::Mediathek, AppMode::Media, AppMode::Settings] {
        state.set_mode(mode);
        state.handle_nav_event(NavEvent::Back);
        assert_eq!(state.snapshot().mode, AppMode::Home);
    }
}

#[tokio::test]
async fn play_media_switches_mode_to_live_tv_and_sets_player_osd() {
    let (_host, state) = spawn_test_server().await;
    state.set_mode(AppMode::YouTube);

    let item = melange_core::MediaItem {
        id: "yt:abc123".to_string(),
        provider: "youtube".to_string(),
        title: "Sample Video".to_string(),
        subtitle: None,
        description: None,
        channel_or_author: "Channel".to_string(),
        duration_sec: 120,
        thumbnail_url: None,
        stream_url: "https://www.youtube.com/watch?v=abc123".to_string(),
        published_at: None,
    };

    state.apply_client_command(ClientCommand::PlayMedia { item, resume: false });
    let snap = state.snapshot();
    assert_eq!(snap.mode, AppMode::LiveTv);
    assert_eq!(snap.overlay, OverlayKind::PlayerOsd);
    assert!(snap.playback.current_media.is_some());
    assert_eq!(snap.playback.title.as_deref(), Some("Sample Video"));

    // SelectChannel clears current_media
    state.apply_client_command(ClientCommand::SelectChannel { channel_id: 1 });
    let snap = state.snapshot();
    assert!(snap.playback.current_media.is_none());
    assert_eq!(snap.playback.channel_id, Some(1));
}

#[tokio::test]
async fn toggle_fullscreen_updates_state_and_forwards_shell_command() {
    let (_host, state) = spawn_test_server().await;
    assert!(!state.snapshot().is_fullscreen);

    state.apply_client_command(ClientCommand::ToggleFullscreen);
    assert!(state.snapshot().is_fullscreen);

    state.apply_client_command(ClientCommand::ToggleFullscreen);
    assert!(!state.snapshot().is_fullscreen);

    let (tx, rx) = std::sync::mpsc::channel();
    state.attach_shell_sender(tx);
    state.apply_client_command(ClientCommand::ToggleFullscreen);
    assert!(matches!(
        rx.try_recv(),
        Ok(melange_core::ShellCommand::ToggleFullscreen)
    ));
}
