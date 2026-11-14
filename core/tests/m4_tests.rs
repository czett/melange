use std::sync::{Arc, mpsc};

use axum::body::Body;
use axum::http::{Request, StatusCode};
use melange_core::{
    AudioEngine, ChannelInput, Database, NavEvent, ServerMessage, StateManager, TvheadendProvider,
    build_router,
};
use tempfile::TempDir;
use tower::ServiceExt;

#[test]
fn test_tvheadend_json_parsing() {
    let provider = TvheadendProvider::new(
        "http://192.168.1.50:9981",
        Some("tv".to_string()),
        Some("secret".to_string()),
    );

    let ch_json = r#"{
        "entries": [
            {
                "uuid": "uuid-1",
                "name": "Das Erste HD",
                "number": 1,
                "icon_public_url": "imagecache/1",
                "enabled": true
            },
            {
                "uuid": "uuid-disabled",
                "name": "Disabled",
                "number": 2,
                "enabled": false
            }
        ]
    }"#;

    let channels = provider.parse_channels_json(ch_json).expect("parse channels");
    assert_eq!(channels.len(), 1);
    assert_eq!(channels[0].tvg_id, "uuid-1");
    assert_eq!(channels[0].name, "Das Erste HD");
    assert_eq!(
        channels[0].stream_url,
        "http://tv:secret@192.168.1.50:9981/stream/channel/uuid-1"
    );
    assert_eq!(
        channels[0].logo_url,
        "http://192.168.1.50:9981/imagecache/1"
    );

    let epg_json = r#"{
        "entries": [
            {
                "channelUuid": "uuid-1",
                "title": "Tagesschau",
                "description": "Nachrichten",
                "start": 1700000000,
                "stop": 1700000900
            }
        ]
    }"#;
    let epg = provider.parse_epg_json(epg_json).expect("parse epg");
    assert_eq!(epg.len(), 1);
    assert_eq!(epg[0].channel_tvg_id, "uuid-1");
    assert_eq!(epg[0].title, "Tagesschau");
}

#[tokio::test]
async fn test_companion_apis_and_state_broadcast() {
    let dir = TempDir::new().expect("tempdir");
    let db_path = dir.path().join("melange.db");
    let wallpapers_dir = dir.path().join("wallpapers");

    let db = Database::open(&db_path).expect("open db");
    let ch1 = db
        .upsert_channel(&ChannelInput {
            number: 1,
            tvg_id: "ch1".to_string(),
            name: "One".to_string(),
            group_title: "Public".to_string(),
            logo_url: String::new(),
            stream_url: "http://example.com/1".to_string(),
        })
        .expect("ch1");
    let ch2 = db
        .upsert_channel(&ChannelInput {
            number: 2,
            tvg_id: "ch2".to_string(),
            name: "Two".to_string(),
            group_title: "Public".to_string(),
            logo_url: String::new(),
            stream_url: "http://example.com/2".to_string(),
        })
        .expect("ch2");

    let profiles = db.list_profiles().expect("profiles");
    let channels = db.list_channels().expect("channels");
    let audio = Arc::new(AudioEngine::new(&dir.path().join("sounds")));
    let state = StateManager::new(profiles, channels, Vec::new(), audio);
    state.attach_db_path(db_path.clone());
    state.set_wallpapers_dir(wallpapers_dir.clone());
    state.set_port(9000);

    let (nav_tx, nav_rx) = mpsc::channel::<NavEvent>();
    state.attach_nav_sender(nav_tx);

    let mut ws_rx = state.subscribe();
    let app = build_router(Arc::clone(&state), dir.path());

    // 1. /api/companion/info returns offline SVG QR code
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/companion/info")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let info: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(info["url"].as_str().unwrap().ends_with(":9000/companion"));
    assert!(info["qr_svg"].as_str().unwrap().contains("<svg"));

    // 2. /api/channels/reorder persists and broadcasts StateUpdate
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/channels/reorder")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({ "channel_ids": [ch2, ch1] }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let msg = ws_rx.recv().await.unwrap();
    match msg {
        ServerMessage::StateUpdate { state: s } => {
            assert_eq!(s.channels[0].id, ch2);
            assert_eq!(s.channels[1].id, ch1);
        }
        other => panic!("expected StateUpdate, got {other:?}"),
    }

    // 3. /api/channels/:id/favorite toggles favorite and broadcasts StateUpdate
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/channels/{ch1}/favorite"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let msg = ws_rx.recv().await.unwrap();
    match msg {
        ServerMessage::StateUpdate { state: s } => {
            let c = s.channels.iter().find(|c| c.id == ch1).unwrap();
            assert!(c.is_favorite);
        }
        other => panic!("expected StateUpdate, got {other:?}"),
    }

    // 4. /api/profiles creates profile + /api/profiles/:id/wallpaper multipart upload
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/profiles")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({ "name": "Kids", "avatar": "🦊" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let _ = ws_rx.recv().await.unwrap();
    let created: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let pid = created["id"].as_i64().unwrap();

    let boundary = "----melangeboundary";
    let multipart_body = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"wall.png\"\r\nContent-Type: image/png\r\n\r\nPNGDATA\r\n--{boundary}--\r\n"
    );
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/profiles/{pid}/wallpaper"))
                .header(
                    "content-type",
                    format!("multipart/form-data; boundary={boundary}"),
                )
                .body(Body::from(multipart_body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let msg = ws_rx.recv().await.unwrap();
    match msg {
        ServerMessage::StateUpdate { state: s } => {
            let p = s.profiles.iter().find(|p| p.id == pid).unwrap();
            assert!(
                p.wallpaper_path
                    .as_deref()
                    .unwrap_or("")
                    .starts_with("/wallpapers/profile_")
            );
        }
        other => panic!("expected StateUpdate, got {other:?}"),
    }

    // 5. /api/remote/nav forwards into NavEvent bus
    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/remote/nav")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({ "event": "ChannelUp" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(nav_rx.try_recv().unwrap(), NavEvent::ChannelUp);
}
