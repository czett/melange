use std::fs;
use std::sync::Arc;

use melange_core::providers::mediathek::parse_mediathek_response;
use melange_core::providers::youtube::{
    extract_video_id, parse_piped_search_response, parse_piped_trending_response,
    parse_ytdlp_json_response,
};
use melange_core::{
    AudioEngine, Database, LocalMediaProvider, MediaItem, OnDemandProvider, StateManager,
    YouTubeProvider, serve_on_listener,
};
use tempfile::TempDir;
use tokio::net::TcpListener;

#[test]
fn test_mediathek_json_parsing() {
    let fixture = r#"{
        "result": {
            "results": [
                {
                    "id": "abc123",
                    "channel": "ARD",
                    "topic": "Tagesschau",
                    "title": "Tagesschau 20:00 Uhr",
                    "description": "Nachrichten",
                    "timestamp": 1700000000,
                    "duration": 900,
                    "url_video_hd": "https://cdn.example.org/hd.mp4",
                    "url_video": "https://cdn.example.org/sd.mp4"
                },
                {
                    "id": "no-url",
                    "channel": "ZDF",
                    "topic": "Heute",
                    "title": "Skipped"
                }
            ]
        }
    }"#;

    let items = parse_mediathek_response(fixture).expect("parse mediathek");
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].id, "mt:abc123");
    assert_eq!(items[0].provider, "mediathek");
    assert_eq!(items[0].title, "Tagesschau 20:00 Uhr");
    assert_eq!(items[0].subtitle.as_deref(), Some("Tagesschau"));
    assert_eq!(items[0].channel_or_author, "ARD");
    assert_eq!(items[0].duration_sec, 900);
    assert_eq!(items[0].stream_url, "https://cdn.example.org/hd.mp4");
}

#[test]
fn test_piped_youtube_json_parsing() {
    let trending_fixture = r#"[
        {
            "url": "/watch?v=dQw4w9WgXcQ",
            "title": "Sample Video",
            "thumbnail": "https://img.example.org/thumb.jpg",
            "uploaderName": "Example Channel",
            "duration": 212,
            "uploadedDate": "2 days ago",
            "type": "stream"
        },
        {
            "url": "/channel/UC123",
            "title": "Channel Entry",
            "type": "channel"
        }
    ]"#;

    let trending = parse_piped_trending_response(trending_fixture).expect("parse trending");
    assert_eq!(trending.len(), 1);
    assert_eq!(trending[0].id, "yt:dQw4w9WgXcQ");
    assert_eq!(trending[0].provider, "youtube");
    assert_eq!(
        trending[0].stream_url,
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    );
    assert_eq!(trending[0].duration_sec, 212);

    let search_fixture = format!(r#"{{"items": {trending_fixture}}}"#);
    let searched = parse_piped_search_response(&search_fixture).expect("parse search");
    assert_eq!(searched.len(), 1);
    assert_eq!(searched[0].title, "Sample Video");
}

#[tokio::test]
async fn test_local_media_provider_scanning() {
    let tmp = TempDir::new().expect("tempdir");
    let sub = tmp.path().join("movies");
    fs::create_dir_all(&sub).expect("mkdir");
    fs::write(sub.join("big_buck_bunny.mp4"), b"fake").expect("write mp4");
    fs::write(sub.join("notes.txt"), b"ignore").expect("write txt");

    let provider = LocalMediaProvider::new(vec![tmp.path().to_path_buf()]);
    let items = provider.feed().await.expect("feed");
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].provider, "local");
    assert_eq!(items[0].title, "big buck bunny");
    assert_eq!(items[0].subtitle.as_deref(), Some("movies"));

    let filtered = provider.search("buck").await.expect("search");
    assert_eq!(filtered.len(), 1);

    let empty = provider.search("nonexistent").await.expect("search empty");
    assert!(empty.is_empty());
}

#[tokio::test]
async fn test_watch_history_and_rest_routes() {
    let db = Database::open_in_memory().expect("db");
    let profiles = db.list_profiles().expect("profiles");
    let profile_id = profiles[0].id;

    let item = MediaItem {
        id: "mt:test1".to_string(),
        provider: "mediathek".to_string(),
        title: "Test Documentary".to_string(),
        subtitle: Some("Terra X".to_string()),
        description: None,
        channel_or_author: "ZDF".to_string(),
        duration_sec: 1000,
        thumbnail_url: None,
        stream_url: "https://cdn.example.org/doc.mp4".to_string(),
        published_at: None,
    };

    db.upsert_watch_progress(profile_id, &item, 250.0, 1000.0)
        .expect("upsert 25%");
    let list = db.list_continue_watching(profile_id, 10).expect("list");
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].position_sec, 250.0);

    // >= 95% completion should remove from continue watching
    db.upsert_watch_progress(profile_id, &item, 960.0, 1000.0)
        .expect("upsert 96%");
    let list_after = db.list_continue_watching(profile_id, 10).expect("list after");
    assert!(list_after.is_empty());

    // Re-insert and test REST routes
    db.upsert_watch_progress(profile_id, &item, 120.0, 1000.0)
        .expect("upsert 12%");
    let entries = db.list_continue_watching(profile_id, 10).expect("list");

    let audio = Arc::new(AudioEngine::noop());
    let state = StateManager::new(profiles, Vec::new(), Vec::new(), audio);
    state.set_continue_watching(entries);

    let tmp_ui = TempDir::new().expect("ui dir");
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("local_addr");
    let ui_dir = tmp_ui.path().to_path_buf();
    tokio::spawn(async move {
        let _ = serve_on_listener(listener, state, &ui_dir).await;
    });

    let res = reqwest::get(format!("http://{addr}/api/continue-watching"))
        .await
        .expect("get continue-watching");
    assert_eq!(res.status(), 200);

    let res_local = reqwest::get(format!("http://{addr}/api/ondemand/feed?provider=local"))
        .await
        .expect("get local feed");
    assert_eq!(res_local.status(), 200);
}

#[test]
fn test_ytdlp_json_parsing_and_video_id_extraction() {
    let fixture = r#"{
        "entries": [
            {
                "id": "N_vxQl7lFRA",
                "url": "https://www.youtube.com/watch?v=N_vxQl7lFRA",
                "title": "tagesschau 20:00 Uhr",
                "description": "Nachrichten",
                "duration": 904.4,
                "channel": "tagesschau",
                "uploader": "tagesschau",
                "thumbnails": [
                    { "url": "https://i.ytimg.com/vi/N_vxQl7lFRA/hqdefault.jpg" },
                    { "url": "https://i.ytimg.com/vi/N_vxQl7lFRA/hq720.jpg" }
                ],
                "upload_date": "20261114"
            }
        ]
    }"#;

    let items = parse_ytdlp_json_response(fixture).expect("parse ytdlp");
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].id, "yt:N_vxQl7lFRA");
    assert_eq!(items[0].provider, "youtube");
    assert_eq!(items[0].title, "tagesschau 20:00 Uhr");
    assert_eq!(items[0].channel_or_author, "tagesschau");
    assert_eq!(items[0].duration_sec, 904);
    assert_eq!(
        items[0].thumbnail_url.as_deref(),
        Some("https://i.ytimg.com/vi/N_vxQl7lFRA/hq720.jpg")
    );
    assert_eq!(
        items[0].stream_url,
        "https://www.youtube.com/watch?v=N_vxQl7lFRA"
    );

    assert_eq!(
        extract_video_id("https://youtu.be/dQw4w9WgXcQ?t=10").as_deref(),
        Some("dQw4w9WgXcQ")
    );
    assert_eq!(
        extract_video_id("https://www.youtube.com/shorts/abcDEF123").as_deref(),
        Some("abcDEF123")
    );
}

#[tokio::test]
async fn test_youtube_provider_fallback_chain() {
    use axum::{Router, http::StatusCode, response::Html, routing::get};

    // Primary mock returns 200 HTML (antibot page) on trending and 502 on search
    let bad_app = Router::new()
        .route(
            "/trending",
            get(|| async { Html("<html><body>captcha</body></html>") }),
        )
        .route("/search", get(|| async { StatusCode::BAD_GATEWAY }));
    let bad_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let bad_addr = bad_listener.local_addr().unwrap();
    tokio::spawn(async move {
        let _ = axum::serve(bad_listener, bad_app).await;
    });

    // Secondary mock returns valid Piped JSON
    let good_app = Router::new()
        .route(
            "/trending",
            get(|| async {
                r#"[{"url":"/watch?v=dQw4w9WgXcQ","title":"Fallback Trend","type":"stream","duration":212}]"#
            }),
        )
        .route(
            "/search",
            get(|| async {
                r#"{"items":[{"url":"/watch?v=aqz-KE-bpKQ","title":"Fallback Search","type":"stream","duration":634}]}"#
            }),
        );
    let good_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let good_addr = good_listener.local_addr().unwrap();
    tokio::spawn(async move {
        let _ = axum::serve(good_listener, good_app).await;
    });

    let provider = YouTubeProvider::with_piped_urls(
        vec![
            format!("http://{bad_addr}"),
            format!("http://{good_addr}"),
        ],
        false,
    );

    let feed = provider.feed().await.expect("feed fallback");
    assert_eq!(feed.len(), 1);
    assert_eq!(feed[0].title, "Fallback Trend");

    let search = provider.search("blender").await.expect("search fallback");
    assert_eq!(search.len(), 1);
    assert_eq!(search[0].title, "Fallback Search");
}

#[tokio::test]
async fn test_youtube_oauth_device_code_and_token_refresh() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use axum::{Router, http::StatusCode, routing::post};
    use melange_core::YouTubeAccount;
    use melange_core::providers::youtube::{
        TokenPollOutcome, YouTubeEndpoints, now_unix_secs, parse_account_menu_response,
    };

    let poll_calls = Arc::new(AtomicUsize::new(0));
    let poll_calls_srv = Arc::clone(&poll_calls);

    let mock_oauth = Router::new()
        .route(
            "/device/code",
            post(|| async {
                axum::Json(serde_json::json!({
                    "device_code": "dev-code-123",
                    "user_code": "ABCD-EFGH",
                    "verification_url": "https://www.google.com/device",
                    "expires_in": 1800,
                    "interval": 1
                }))
            }),
        )
        .route(
            "/token",
            post(move |axum::Form(params): axum::Form<std::collections::HashMap<String, String>>| {
                let poll_calls = Arc::clone(&poll_calls_srv);
                async move {
                    if params.get("grant_type").map(String::as_str) == Some("refresh_token") {
                        return (
                            StatusCode::OK,
                            axum::Json(serde_json::json!({
                                "access_token": "fresh-access-token",
                                "expires_in": 3600,
                                "token_type": "Bearer"
                            })),
                        );
                    }
                    let attempt = poll_calls.fetch_add(1, Ordering::SeqCst);
                    if attempt == 0 {
                        (
                            StatusCode::PRECONDITION_REQUIRED,
                            axum::Json(serde_json::json!({ "error": "authorization_pending" })),
                        )
                    } else if attempt == 1 {
                        (
                            StatusCode::BAD_REQUEST,
                            axum::Json(serde_json::json!({ "error": "slow_down" })),
                        )
                    } else {
                        (
                            StatusCode::OK,
                            axum::Json(serde_json::json!({
                                "access_token": "initial-access-token",
                                "refresh_token": "initial-refresh-token",
                                "expires_in": 3600,
                                "token_type": "Bearer"
                            })),
                        )
                    }
                }
            }),
        )
        .route(
            "/youtubei/v1/account/account_menu",
            post(|| async {
                axum::Json(serde_json::json!({
                    "actions": [{
                        "openPopupAction": {
                            "popup": {
                                "multiPageMenuRenderer": {
                                    "header": {
                                        "activeAccountHeaderRenderer": {
                                            "accountName": { "simpleText": "Couch Viewer" },
                                            "accountPhoto": {
                                                "thumbnails": [
                                                    { "url": "https://yt3.ggpht.com/s48.jpg", "width": 48 },
                                                    { "url": "https://yt3.ggpht.com/s176.jpg", "width": 176 }
                                                ]
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }]
                }))
            }),
        );

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let _ = axum::serve(listener, mock_oauth).await;
    });

    let endpoints = YouTubeEndpoints {
        oauth_device_code_url: format!("http://{addr}/device/code"),
        oauth_token_url: format!("http://{addr}/token"),
        innertube_base_url: format!("http://{addr}"),
        client_id: "test-client".to_string(),
        client_secret: "test-secret".to_string(),
    };
    let yt = YouTubeProvider::with_endpoints(endpoints, vec![], false);

    // 1. Device code normalized to youtube.com/activate
    let code = yt.start_device_auth().await.expect("start_device_auth");
    assert_eq!(code.device_code, "dev-code-123");
    assert_eq!(code.user_code, "ABCD-EFGH");
    assert_eq!(code.verification_url, "https://www.youtube.com/activate");

    // 2. Poll pending -> slow_down -> authorized
    assert_eq!(
        yt.poll_device_token(&code.device_code).await.unwrap(),
        TokenPollOutcome::Pending
    );
    assert_eq!(
        yt.poll_device_token(&code.device_code).await.unwrap(),
        TokenPollOutcome::SlowDown
    );
    let tok = match yt.poll_device_token(&code.device_code).await.unwrap() {
        TokenPollOutcome::Authorized(t) => t,
        other => panic!("expected Authorized, got {other:?}"),
    };
    assert_eq!(tok.access_token, "initial-access-token");
    assert_eq!(tok.refresh_token.as_deref(), Some("initial-refresh-token"));

    // 3. Account info fetch + parser
    let (name, avatar) = yt.fetch_account_info(&tok.access_token).await.unwrap();
    assert_eq!(name, "Couch Viewer");
    assert_eq!(avatar.as_deref(), Some("https://yt3.ggpht.com/s176.jpg"));
    assert!(parse_account_menu_response("{}").is_none());

    // 4. Transparent refresh within 60s of expiry persists to SQLite
    let tmp = TempDir::new().unwrap();
    let db_path = tmp.path().join("melange.db");
    let db = Database::open(&db_path).unwrap();
    let profile_id = db.list_profiles().unwrap()[0].id;

    let expiring = YouTubeAccount {
        profile_id,
        access_token: "stale-token".to_string(),
        refresh_token: "initial-refresh-token".to_string(),
        expires_at: now_unix_secs() + 30,
        account_name: name,
        account_avatar_url: avatar,
        updated_at: String::new(),
    };
    db.upsert_youtube_account(&expiring).unwrap();

    let refreshed = yt
        .ensure_valid_token(Some(&db_path), profile_id, expiring)
        .await
        .expect("ensure_valid_token");
    assert_eq!(refreshed.access_token, "fresh-access-token");
    assert_eq!(refreshed.refresh_token, "initial-refresh-token");
    assert!(refreshed.expires_at > now_unix_secs() + 3000);

    let persisted = db.get_youtube_account(profile_id).unwrap().unwrap();
    assert_eq!(persisted.access_token, "fresh-access-token");
}
