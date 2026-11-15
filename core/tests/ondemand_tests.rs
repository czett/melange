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
        channel_id: None,
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

    let provider = YouTubeProvider::with_endpoints(
        melange_core::providers::youtube::YouTubeEndpoints {
            innertube_base_url: format!("http://{bad_addr}"),
            ..Default::default()
        },
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
        ..Default::default()
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

#[test]
fn test_innertube_tv_tile_and_web_parsing_filters_shorts_and_extracts_channels() {
    use melange_core::WatchHistoryEntry;
    use melange_core::providers::youtube::{
        merge_youtube_history, parse_duration_str, parse_innertube_browse_response,
        parse_innertube_search_response,
    };

    assert_eq!(parse_duration_str("12:34"), 754);
    assert_eq!(parse_duration_str("1:02:03"), 3723);
    assert_eq!(parse_duration_str("LIVE"), 0);

    let browse_fixture = r#"{
        "header": {
            "c4TabbedHeaderRenderer": {
                "title": "ARTEde"
            }
        },
        "contents": {
            "tvSurfaceContentRenderer": {
                "content": {
                    "sectionListRenderer": {
                        "contents": [
                            {
                                "shelfRenderer": {
                                    "content": {
                                        "horizontalListRenderer": {
                                            "items": [
                                                {
                                                    "tileRenderer": {
                                                        "contentId": "UCarte12345",
                                                        "contentType": "TILE_CONTENT_TYPE_CHANNEL",
                                                        "header": {
                                                            "tileHeaderRenderer": {
                                                                "thumbnail": {
                                                                    "thumbnails": [
                                                                        { "url": "https://yt3.ggpht.com/arte.jpg", "width": 176 }
                                                                    ]
                                                                }
                                                            }
                                                        },
                                                        "metadata": {
                                                            "tileMetadataRenderer": {
                                                                "title": { "simpleText": "ARTEde" }
                                                            }
                                                        },
                                                        "onSelectCommand": {
                                                            "browseEndpoint": { "browseId": "UCarte12345" }
                                                        }
                                                    }
                                                },
                                                {
                                                    "tileRenderer": {
                                                        "contentId": "vidNormal01",
                                                        "contentType": "TILE_CONTENT_TYPE_VIDEO",
                                                        "header": {
                                                            "tileHeaderRenderer": {
                                                                "thumbnail": {
                                                                    "thumbnails": [
                                                                        { "url": "https://i.ytimg.com/vi/vidNormal01/hqdefault.jpg", "width": 480 },
                                                                        { "url": "https://i.ytimg.com/vi/vidNormal01/maxresdefault.jpg", "width": 1280 }
                                                                    ]
                                                                },
                                                                "thumbnailOverlays": [
                                                                    { "thumbnailOverlayTimeStatusRenderer": { "text": { "simpleText": "43:15" } } }
                                                                ]
                                                            }
                                                        },
                                                        "metadata": {
                                                            "tileMetadataRenderer": {
                                                                "title": { "runs": [{ "text": "Alpen aus dem All" }] },
                                                                "lines": [
                                                                    {
                                                                        "lineRenderer": {
                                                                            "items": [
                                                                                {
                                                                                    "lineItemRenderer": {
                                                                                        "text": { "simpleText": "ARTEde" },
                                                                                        "navigationEndpoint": {
                                                                                            "browseEndpoint": { "browseId": "UCarte12345" }
                                                                                        }
                                                                                    }
                                                                                }
                                                                            ]
                                                                        }
                                                                    },
                                                                    {
                                                                        "lineRenderer": {
                                                                            "items": [
                                                                                { "lineItemRenderer": { "text": { "simpleText": "120K views" } } },
                                                                                { "lineItemRenderer": { "text": { "simpleText": "2 days ago" } } }
                                                                            ]
                                                                        }
                                                                    }
                                                                ]
                                                            }
                                                        },
                                                        "onSelectCommand": {
                                                            "watchEndpoint": { "videoId": "vidNormal01" }
                                                        }
                                                    }
                                                },
                                                {
                                                    "tileRenderer": {
                                                        "contentId": "shortVid99",
                                                        "contentType": "TILE_CONTENT_TYPE_SHORTS",
                                                        "metadata": {
                                                            "tileMetadataRenderer": {
                                                                "title": { "simpleText": "Vertical Short" }
                                                            }
                                                        },
                                                        "onSelectCommand": {
                                                            "reelWatchEndpoint": { "videoId": "shortVid99" }
                                                        }
                                                    }
                                                }
                                            ]
                                        }
                                    }
                                }
                            }
                        ]
                    }
                }
            }
        }
    }"#;

    let (items, channels, header_title) =
        parse_innertube_browse_response(browse_fixture, true).expect("parse browse");
    assert_eq!(header_title.as_deref(), Some("ARTEde"));
    assert_eq!(channels.len(), 1);
    assert_eq!(channels[0].channel_id, "UCarte12345");
    assert_eq!(channels[0].title, "ARTEde");
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].id, "yt:vidNormal01");
    assert_eq!(items[0].title, "Alpen aus dem All");
    assert_eq!(items[0].channel_or_author, "ARTEde");
    assert_eq!(items[0].channel_id.as_deref(), Some("UCarte12345"));
    assert_eq!(items[0].duration_sec, 2595);
    assert_eq!(
        items[0].subtitle.as_deref(),
        Some("120K views · 2 days ago")
    );
    assert_eq!(
        items[0].thumbnail_url.as_deref(),
        Some("https://i.ytimg.com/vi/vidNormal01/maxresdefault.jpg")
    );

    // Search response (including videoRenderer) keeps results
    let search_fixture = r#"{
        "contents": {
            "twoColumnSearchResultsRenderer": {
                "primaryContents": {
                    "sectionListRenderer": {
                        "contents": [{
                            "itemSectionRenderer": {
                                "contents": [{
                                    "videoRenderer": {
                                        "videoId": "searchVid42",
                                        "title": { "runs": [{ "text": "Rust Async Deep Dive" }] },
                                        "ownerText": {
                                            "runs": [{
                                                "text": "Jon Gjengset",
                                                "navigationEndpoint": { "browseEndpoint": { "browseId": "UCjon123" } }
                                            }]
                                        },
                                        "lengthText": { "simpleText": "1:10:05" },
                                        "shortViewCountText": { "simpleText": "85K views" },
                                        "publishedTimeText": { "simpleText": "1 month ago" },
                                        "thumbnail": {
                                            "thumbnails": [{ "url": "https://i.ytimg.com/vi/searchVid42/hq720.jpg", "width": 1280 }]
                                        }
                                    }
                                }]
                            }
                        }]
                    }
                }
            }
        }
    }"#;

    let search_items = parse_innertube_search_response(search_fixture).expect("parse search");
    assert_eq!(search_items.len(), 1);
    assert_eq!(search_items[0].id, "yt:searchVid42");
    assert_eq!(search_items[0].duration_sec, 4205);
    assert_eq!(search_items[0].channel_id.as_deref(), Some("UCjon123"));

    // History merge deduplicates and enriches local resume entries
    let local = vec![WatchHistoryEntry {
        id: 1,
        profile_id: 1,
        item_id: "yt:vidNormal01".to_string(),
        provider: "youtube".to_string(),
        title: "Alpen aus dem All".to_string(),
        stream_url: "https://www.youtube.com/watch?v=vidNormal01".to_string(),
        thumbnail_url: None,
        position_sec: 320.0,
        duration_sec: 2595.0,
        updated_at: "2026-11-15 12:00:00".to_string(),
    }];
    let merged = merge_youtube_history(items, &local);
    assert_eq!(merged.len(), 1);
    assert_eq!(merged[0].channel_or_author, "ARTEde");
    assert_eq!(merged[0].channel_id.as_deref(), Some("UCarte12345"));
    assert_eq!(merged[0].subtitle.as_deref(), Some("Resumed at 5m"));
}

#[tokio::test]
async fn test_youtube_http_routes_auth_feeds_channel_and_logout() {
    use axum::{Router, routing::post};
    use melange_core::providers::youtube::{YouTubeEndpoints, YouTubeFeedResponse};

    let mock_yt = Router::new()
        .route(
            "/device/code",
            post(|| async {
                axum::Json(serde_json::json!({
                    "device_code": "dc-route-1",
                    "user_code": "WXYZ-1234",
                    "verification_url": "https://www.youtube.com/activate",
                    "expires_in": 600,
                    "interval": 1
                }))
            }),
        )
        .route(
            "/token",
            post(|| async {
                axum::Json(serde_json::json!({
                    "access_token": "tok-route-1",
                    "refresh_token": "ref-route-1",
                    "expires_in": 3600
                }))
            }),
        )
        .route(
            "/youtubei/v1/account/account_menu",
            post(|| async {
                axum::Json(serde_json::json!({
                    "activeAccountHeaderRenderer": {
                        "accountName": { "simpleText": "Living Room" }
                    }
                }))
            }),
        )
        .route(
            "/youtubei/v1/browse",
            post(|axum::Json(body): axum::Json<serde_json::Value>| async move {
                let browse_id = body["browseId"].as_str().unwrap_or("");
                let (vid, title, chan, cid) = match browse_id {
                    "FEsubscriptions" => ("subVid1", "Sub Video", "Veritasium", "UChnyf"),
                    "FEhistory" => ("histVid1", "History Video", "Kurzgesagt", "UCsXVk"),
                    "UChnyf" => ("chanVid1", "Channel Upload", "Veritasium", "UChnyf"),
                    _ => ("homeVid1", "For You Pick", "3Blue1Brown", "UCYO_j"),
                };
                axum::Json(serde_json::json!({
                    "contents": {
                        "tvSurfaceContentRenderer": {
                            "content": {
                                "tileRenderer": {
                                    "contentId": vid,
                                    "metadata": {
                                        "tileMetadataRenderer": {
                                            "title": { "simpleText": title },
                                            "lines": [{
                                                "lineRenderer": {
                                                    "items": [{
                                                        "lineItemRenderer": {
                                                            "text": { "simpleText": chan },
                                                            "navigationEndpoint": {
                                                                "browseEndpoint": { "browseId": cid }
                                                            }
                                                        }
                                                    }]
                                                }
                                            }]
                                        }
                                    },
                                    "onSelectCommand": {
                                        "watchEndpoint": { "videoId": vid }
                                    }
                                }
                            }
                        }
                    }
                }))
            }),
        )
        .route(
            "/youtubei/v1/search",
            post(|| async {
                axum::Json(serde_json::json!({
                    "contents": {
                        "tileRenderer": {
                            "contentId": "srchVid1",
                            "metadata": {
                                "tileMetadataRenderer": {
                                    "title": { "simpleText": "Innertube Search Hit" }
                                }
                            },
                            "onSelectCommand": {
                                "watchEndpoint": { "videoId": "srchVid1" }
                            }
                        }
                    }
                }))
            }),
        );

    let mock_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mock_addr = mock_listener.local_addr().unwrap();
    tokio::spawn(async move {
        let _ = axum::serve(mock_listener, mock_yt).await;
    });

    let tmp = TempDir::new().unwrap();
    let db_path = tmp.path().join("melange.db");
    let db = Database::open(&db_path).unwrap();
    let profiles = db.list_profiles().unwrap();
    let state = StateManager::new(profiles, vec![], vec![], Arc::new(AudioEngine::noop()));
    state.attach_db_path(db_path);
    state.set_youtube_provider(Arc::new(YouTubeProvider::with_endpoints(
        YouTubeEndpoints {
            oauth_device_code_url: format!("http://{mock_addr}/device/code"),
            oauth_token_url: format!("http://{mock_addr}/token"),
            innertube_base_url: format!("http://{mock_addr}"),
            client_id: "cid".to_string(),
            client_secret: "csec".to_string(),
            ..Default::default()
        },
        vec![],
        false,
    )));

    let app_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let app_addr = app_listener.local_addr().unwrap();
    let ui_dir = tmp.path().to_path_buf();
    tokio::spawn(async move {
        let _ = serve_on_listener(app_listener, state, &ui_dir).await;
    });

    let client = reqwest::Client::new();

    // Signed-out Subscriptions requires auth
    let subs_unauth: YouTubeFeedResponse = client
        .get(format!("http://{app_addr}/api/youtube/feed?tab=subscriptions"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(subs_unauth.requires_auth);
    assert!(subs_unauth.items.is_empty());

    // Start device auth & wait for background poll completion
    let start_json: serde_json::Value = client
        .post(format!("http://{app_addr}/api/youtube/auth/start"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(start_json["user_code"], "WXYZ-1234");
    assert!(start_json["qr_svg"].as_str().unwrap_or("").contains("<svg"));

    let mut authorized = false;
    for _ in 0..20 {
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        let st: serde_json::Value = client
            .get(format!("http://{app_addr}/api/youtube/auth/status"))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        if st["status"] == "Authorized" {
            assert_eq!(st["account"]["account_name"], "Living Room");
            authorized = true;
            break;
        }
    }
    assert!(authorized, "expected background auth polling to authorize");

    // Signed-in For You, Subscriptions, History, Channel, and Search
    let foryou: YouTubeFeedResponse = client
        .get(format!("http://{app_addr}/api/youtube/feed?tab=foryou"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(foryou.source, "innertube-auth");
    assert_eq!(foryou.items[0].id, "yt:homeVid1");

    let subs: YouTubeFeedResponse = client
        .get(format!("http://{app_addr}/api/youtube/feed?tab=subscriptions"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(!subs.requires_auth);
    assert_eq!(subs.items[0].id, "yt:subVid1");
    assert_eq!(subs.channels[0].channel_id, "UChnyf");

    let chan: YouTubeFeedResponse = client
        .get(format!(
            "http://{app_addr}/api/youtube/feed?tab=channel&channel_id=UChnyf"
        ))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(chan.items[0].id, "yt:chanVid1");

    let searched: Vec<MediaItem> = client
        .get(format!(
            "http://{app_addr}/api/ondemand/search?provider=youtube&q=rust"
        ))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(searched[0].id, "yt:srchVid1");

    // Logout clears account cleanly
    let logout_res = client
        .post(format!("http://{app_addr}/api/youtube/auth/logout"))
        .send()
        .await
        .unwrap();
    assert_eq!(logout_res.status(), 200);
    let st_after: serde_json::Value = client
        .get(format!("http://{app_addr}/api/youtube/auth/status"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(st_after["account"].is_null());
}

#[tokio::test]
async fn test_sponsorblock_fetch_timeout_and_play_media_hook() {
    use axum::{Router, extract::Query, http::StatusCode, routing::get};
    use melange_core::{ClientCommand, ShellCommand};
    use melange_core::providers::youtube::{
        YouTubeEndpoints, human_sponsor_category, parse_sponsorblock_segments,
    };

    // Parser sanity & invalid segment filtering
    let parsed = parse_sponsorblock_segments(
        r#"[
            {"UUID":"seg-b","category":"selfpromo","segment":[120.5,145.0]},
            {"UUID":"seg-a","category":"sponsor","segment":[15.0,45.25]},
            {"UUID":"seg-tiny","category":"intro","segment":[2.0,2.1]}
        ]"#,
    );
    assert_eq!(parsed.len(), 2);
    assert_eq!(parsed[0].uuid, "seg-a");
    assert_eq!(parsed[1].uuid, "seg-b");
    assert_eq!(human_sponsor_category("selfpromo"), "self-promo");

    let mock_sb = Router::new().route(
        "/api/skipSegments",
        get(|Query(q): Query<std::collections::HashMap<String, String>>| async move {
            match q.get("videoID").map(String::as_str) {
                Some("sbVid1") => (
                    StatusCode::OK,
                    r#"[{"UUID":"u1","category":"sponsor","segment":[10.0,30.0]}]"#,
                ),
                Some("slowVid") => {
                    tokio::time::sleep(std::time::Duration::from_millis(2000)).await;
                    (StatusCode::OK, "[]")
                }
                _ => (StatusCode::NOT_FOUND, "Not Found"),
            }
        }),
    );

    let sb_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let sb_addr = sb_listener.local_addr().unwrap();
    tokio::spawn(async move {
        let _ = axum::serve(sb_listener, mock_sb).await;
    });

    let yt = Arc::new(YouTubeProvider::with_endpoints(
        YouTubeEndpoints {
            sponsorblock_base_url: format!("http://{sb_addr}"),
            ..Default::default()
        },
        vec![],
        false,
    ));

    // Normal fetch + 404 + timeout (<1.65s)
    let segs = yt.fetch_sponsorblock_segments("sbVid1").await;
    assert_eq!(segs.len(), 1);
    assert_eq!(segs[0].start_sec, 10.0);
    assert_eq!(segs[0].end_sec, 30.0);
    assert!(yt.fetch_sponsorblock_segments("missingVid").await.is_empty());

    let t0 = std::time::Instant::now();
    let timed_out = yt.fetch_sponsorblock_segments("slowVid").await;
    assert!(timed_out.is_empty());
    assert!(t0.elapsed() < std::time::Duration::from_millis(1900));

    // PlayMedia triggers async SponsorBlock fetch -> ShellCommand::SetSponsorSegments + snapshot
    let state = StateManager::new(vec![], vec![], vec![], Arc::new(AudioEngine::noop()));
    state.set_youtube_provider(yt);
    let (tx, rx) = std::sync::mpsc::channel();
    state.attach_shell_sender(tx);

    let item = MediaItem {
        id: "yt:sbVid1".to_string(),
        provider: "youtube".to_string(),
        title: "Sponsored Video".to_string(),
        subtitle: None,
        description: None,
        channel_or_author: "Creator".to_string(),
        channel_id: None,
        duration_sec: 300,
        thumbnail_url: None,
        stream_url: "https://www.youtube.com/watch?v=sbVid1".to_string(),
        published_at: None,
    };

    state.apply_client_command(ClientCommand::PlayMedia {
        item,
        resume: false,
    });

    assert!(matches!(rx.try_recv(), Ok(ShellCommand::PlayMedia { .. })));

    let mut received_segments = false;
    for _ in 0..20 {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        if let Ok(ShellCommand::SetSponsorSegments { item_id, segments }) = rx.try_recv() {
            assert_eq!(item_id, "yt:sbVid1");
            assert_eq!(segments.len(), 1);
            received_segments = true;
            break;
        }
    }
    assert!(received_segments, "expected SetSponsorSegments shell command");
    assert_eq!(state.snapshot().playback.sponsor_segments.len(), 1);

    state.emit_osd_notice("Skipped sponsor segment");
    assert_eq!(
        state.snapshot().playback.osd_notice.as_deref(),
        Some("Skipped sponsor segment")
    );
}

#[test]
fn test_innertube_continuation_and_playlist_parsing() {
    use melange_core::providers::youtube::parse_innertube_browse_full;

    // 1. Continuation token + video items
    let feed_with_cont = r#"{
        "contents": {
            "twoColumnBrowseResultsRenderer": {
                "tabs": [{
                    "tabRenderer": {
                        "content": {
                            "richGridRenderer": {
                                "contents": [
                                    {
                                        "richItemRenderer": {
                                            "content": {
                                                "videoRenderer": {
                                                    "videoId": "contVid1",
                                                    "title": { "simpleText": "First Chunk Video" },
                                                    "lengthText": { "simpleText": "10:00" }
                                                }
                                            }
                                        }
                                    },
                                    {
                                        "continuationItemRenderer": {
                                            "continuationEndpoint": {
                                                "continuationCommand": {
                                                    "token": "4qmFsgI_NEXT_CHUNK_TOKEN"
                                                }
                                            }
                                        }
                                    }
                                ]
                            }
                        }
                    }
                }]
            }
        }
    }"#;

    let parsed = parse_innertube_browse_full(feed_with_cont, true).expect("parse cont");
    assert_eq!(parsed.items.len(), 1);
    assert_eq!(parsed.items[0].id, "yt:contVid1");
    assert_eq!(
        parsed.next_continuation.as_deref(),
        Some("4qmFsgI_NEXT_CHUNK_TOKEN")
    );

    // 2. Playlists extraction across tileRenderer, gridPlaylistRenderer, and lockupViewModel
    let playlists_fixture = r#"{
        "contents": {
            "tvSurfaceContentRenderer": {
                "content": {
                    "sectionListRenderer": {
                        "contents": [
                            {
                                "tileRenderer": {
                                    "contentId": "WL",
                                    "contentType": "TILE_CONTENT_TYPE_PLAYLIST",
                                    "header": {
                                        "tileHeaderRenderer": {
                                            "thumbnail": {
                                                "thumbnails": [{ "url": "https://i.ytimg.com/vi/wl1/hq720.jpg", "width": 1280 }]
                                            },
                                            "thumbnailOverlays": [
                                                { "thumbnailOverlaySidePanelRenderer": { "text": { "simpleText": "18 videos" } } }
                                            ]
                                        }
                                    },
                                    "metadata": {
                                        "tileMetadataRenderer": {
                                            "title": { "simpleText": "Watch Later" }
                                        }
                                    },
                                    "onSelectCommand": {
                                        "browseEndpoint": { "browseId": "VLWL" }
                                    }
                                }
                            },
                            {
                                "gridPlaylistRenderer": {
                                    "playlistId": "LL",
                                    "title": { "simpleText": "Liked videos" },
                                    "videoCountText": { "runs": [{ "text": "42 videos" }] },
                                    "thumbnail": {
                                        "thumbnails": [{ "url": "https://i.ytimg.com/vi/ll1/hqdefault.jpg", "width": 480 }]
                                    }
                                }
                            },
                            {
                                "lockupViewModel": {
                                    "contentId": "PLcustom999",
                                    "contentType": "LOCKUP_CONTENT_TYPE_PLAYLIST",
                                    "metadata": {
                                        "lockupMetadataViewModel": {
                                            "title": { "content": "Documentaries" }
                                        }
                                    },
                                    "contentImage": {
                                        "collectionThumbnailViewModel": {
                                            "primaryThumbnail": {
                                                "thumbnailViewModel": {
                                                    "image": {
                                                        "sources": [{ "url": "https://i.ytimg.com/vi/doc1/hq720.jpg", "width": 1280 }]
                                                    },
                                                    "overlays": [{
                                                        "thumbnailOverlayBadgeViewModel": {
                                                            "thumbnailBadges": [{
                                                                "thumbnailBadgeViewModel": {
                                                                    "text": "9 videos"
                                                                }
                                                            }]
                                                        }
                                                    }]
                                                }
                                            }
                                        }
                                    },
                                    "rendererContext": {
                                        "commandContext": {
                                            "onTap": {
                                                "innertubeCommand": {
                                                    "browseEndpoint": { "browseId": "VLPLcustom999" }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        ]
                    }
                }
            }
        }
    }"#;

    let pl_parsed = parse_innertube_browse_full(playlists_fixture, true).expect("parse playlists");
    assert!(pl_parsed.items.is_empty());
    assert_eq!(pl_parsed.playlists.len(), 3);
    assert_eq!(pl_parsed.playlists[0].playlist_id, "WL");
    assert_eq!(pl_parsed.playlists[0].title, "Watch Later");
    assert_eq!(
        pl_parsed.playlists[0].item_count.as_deref(),
        Some("18 videos")
    );
    assert_eq!(pl_parsed.playlists[1].playlist_id, "LL");
    assert_eq!(pl_parsed.playlists[1].title, "Liked videos");
    assert_eq!(pl_parsed.playlists[2].playlist_id, "PLcustom999");
    assert_eq!(pl_parsed.playlists[2].title, "Documentaries");
    assert_eq!(
        pl_parsed.playlists[2].item_count.as_deref(),
        Some("9 videos")
    );

    // 3. Playlist detail browse parses playlistVideoRenderer + playlistHeaderRenderer title
    let playlist_detail_fixture = r#"{
        "header": {
            "playlistHeaderRenderer": {
                "title": { "simpleText": "Documentaries" }
            }
        },
        "contents": {
            "playlistVideoListRenderer": {
                "contents": [
                    {
                        "playlistVideoRenderer": {
                            "videoId": "plItem1",
                            "title": { "runs": [{ "text": "Ocean Abyss" }] },
                            "shortBylineText": { "runs": [{ "text": "ARTEde" }] },
                            "lengthText": { "simpleText": "52:10" }
                        }
                    },
                    {
                        "continuationItemRenderer": {
                            "continuationEndpoint": {
                                "continuationCommand": { "token": "PL_CONT_2" }
                            }
                        }
                    }
                ]
            }
        }
    }"#;

    let detail = parse_innertube_browse_full(playlist_detail_fixture, true).expect("parse detail");
    assert_eq!(detail.header_title.as_deref(), Some("Documentaries"));
    assert_eq!(detail.items.len(), 1);
    assert_eq!(detail.items[0].id, "yt:plItem1");
    assert_eq!(detail.items[0].duration_sec, 3130);
    assert_eq!(detail.next_continuation.as_deref(), Some("PL_CONT_2"));
}

#[tokio::test]
async fn test_youtube_continuation_and_playlists_http_routes() {
    use axum::{Router, routing::post};
    use melange_core::YouTubeAccount;
    use melange_core::providers::youtube::{YouTubeEndpoints, YouTubeFeedResponse};

    let mock_yt = Router::new().route(
        "/youtubei/v1/browse",
        post(|axum::Json(body): axum::Json<serde_json::Value>| async move {
            if let Some(cont) = body.get("continuation").and_then(|v| v.as_str())
                && cont == "TOK_PAGE_2"
            {
                return axum::Json(serde_json::json!({
                        "onResponseReceivedActions": [{
                            "appendContinuationItemsAction": {
                                "continuationItems": [
                                    {
                                        "tileRenderer": {
                                            "contentId": "page2Vid",
                                            "metadata": {
                                                "tileMetadataRenderer": {
                                                    "title": { "simpleText": "Page 2 Video" }
                                                }
                                            },
                                            "onSelectCommand": {
                                                "watchEndpoint": { "videoId": "page2Vid" }
                                            }
                                        }
                                    }
                                ]
                            }
                        }]
                    }));
            }

            let browse_id = body["browseId"].as_str().unwrap_or("");
            match browse_id {
                "FEmy_youtube" => axum::Json(serde_json::json!({
                    "contents": {
                        "tileRenderer": {
                            "contentId": "WL",
                            "contentType": "TILE_CONTENT_TYPE_PLAYLIST",
                            "metadata": {
                                "tileMetadataRenderer": {
                                    "title": { "simpleText": "Watch Later" }
                                }
                            },
                            "onSelectCommand": {
                                "browseEndpoint": { "browseId": "VLWL" }
                            }
                        }
                    }
                })),
                "VLWL" => axum::Json(serde_json::json!({
                    "header": {
                        "playlistHeaderRenderer": {
                            "title": { "simpleText": "Watch Later" }
                        }
                    },
                    "contents": {
                        "playlistVideoRenderer": {
                            "videoId": "wlVideo1",
                            "title": { "simpleText": "Saved For Later" },
                            "lengthText": { "simpleText": "14:20" }
                        }
                    }
                })),
                _ => axum::Json(serde_json::json!({
                    "contents": {
                        "sectionListRenderer": {
                            "contents": [
                                {
                                    "tileRenderer": {
                                        "contentId": "page1Vid",
                                        "metadata": {
                                            "tileMetadataRenderer": {
                                                "title": { "simpleText": "Page 1 Video" }
                                            }
                                        },
                                        "onSelectCommand": {
                                            "watchEndpoint": { "videoId": "page1Vid" }
                                        }
                                    }
                                },
                                {
                                    "continuationItemRenderer": {
                                        "continuationEndpoint": {
                                            "continuationCommand": { "token": "TOK_PAGE_2" }
                                        }
                                    }
                                }
                            ]
                        }
                    }
                })),
            }
        }),
    );

    let mock_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mock_addr = mock_listener.local_addr().unwrap();
    tokio::spawn(async move {
        let _ = axum::serve(mock_listener, mock_yt).await;
    });

    let tmp = TempDir::new().unwrap();
    let db_path = tmp.path().join("melange.db");
    let db = Database::open(&db_path).unwrap();
    let profiles = db.list_profiles().unwrap();
    let pid = profiles[0].id;

    let state = StateManager::new(profiles, vec![], vec![], Arc::new(AudioEngine::noop()));
    state.attach_db_path(db_path.clone());
    state.set_youtube_provider(Arc::new(YouTubeProvider::with_endpoints(
        YouTubeEndpoints {
            innertube_base_url: format!("http://{mock_addr}"),
            data_api_base_url: format!("http://{mock_addr}/v3"),
            ..Default::default()
        },
        vec![],
        false,
    )));

    let app_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let app_addr = app_listener.local_addr().unwrap();
    let ui_dir = tmp.path().to_path_buf();
    tokio::spawn(async move {
        let _ = serve_on_listener(app_listener, state, &ui_dir).await;
    });

    let client = reqwest::Client::new();

    // Unauthenticated playlists requires auth
    let pl_unauth: YouTubeFeedResponse = client
        .get(format!("http://{app_addr}/api/youtube/feed?tab=playlists"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(pl_unauth.requires_auth);

    // Seed signed-in YouTube account
    db.upsert_youtube_account(&YouTubeAccount {
        profile_id: pid,
        access_token: "valid-token".to_string(),
        refresh_token: "refresh-token".to_string(),
        expires_at: melange_core::providers::youtube::now_unix_secs() + 3600,
        account_name: "Tester".to_string(),
        account_avatar_url: None,
        updated_at: String::new(),
    })
    .unwrap();

    // Fetch For You + continuation chunk
    let page1: YouTubeFeedResponse = client
        .get(format!("http://{app_addr}/api/youtube/feed?tab=foryou"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(page1.items[0].id, "yt:page1Vid");
    assert_eq!(page1.next_continuation.as_deref(), Some("TOK_PAGE_2"));

    let page2: YouTubeFeedResponse = client
        .get(format!(
            "http://{app_addr}/api/youtube/feed?tab=foryou&continuation=TOK_PAGE_2"
        ))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(page2.items.len(), 1);
    assert_eq!(page2.items[0].id, "yt:page2Vid");
    assert!(page2.next_continuation.is_none());

    // Fetch Playlists + drill into Watch Later playlist
    let playlists_resp: YouTubeFeedResponse = client
        .get(format!("http://{app_addr}/api/youtube/feed?tab=playlists"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(!playlists_resp.requires_auth);
    assert!(
        playlists_resp
            .playlists
            .iter()
            .any(|p| p.playlist_id == "WL")
    );
    assert!(
        playlists_resp
            .playlists
            .iter()
            .any(|p| p.playlist_id == "LL")
    );

    let wl_detail: YouTubeFeedResponse = client
        .get(format!(
            "http://{app_addr}/api/youtube/feed?tab=playlist&playlist_id=WL"
        ))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(wl_detail.channel_title.as_deref(), Some("Watch Later"));
    assert_eq!(wl_detail.items.len(), 1);
    assert_eq!(wl_detail.items[0].id, "yt:wlVideo1");
}

#[test]
fn test_playback_speed_quality_commands_and_direct_seek_nav() {
    use melange_core::{AppMode, ClientCommand, NavEvent, OverlayKind, ShellCommand};

    let state = StateManager::new(vec![], vec![], vec![], Arc::new(AudioEngine::noop()));
    let (tx, rx) = std::sync::mpsc::channel();
    state.attach_shell_sender(tx);

    // Defaults
    let init = state.snapshot();
    assert_eq!(init.playback.playback_speed, 1.0);
    assert_eq!(init.playback.max_quality, "auto");

    // SetPlaybackSpeed updates snapshot + emits ShellCommand (and clamps out-of-range)
    state.apply_client_command(ClientCommand::SetPlaybackSpeed { speed: 1.5 });
    assert_eq!(state.snapshot().playback.playback_speed, 1.5);
    match rx.try_recv().unwrap() {
        ShellCommand::SetPlaybackSpeed { speed } => assert_eq!(speed, 1.5),
        other => panic!("expected SetPlaybackSpeed, got {other:?}"),
    }

    state.apply_client_command(ClientCommand::SetPlaybackSpeed { speed: 10.0 });
    assert_eq!(state.snapshot().playback.playback_speed, 4.0);
    let _ = rx.try_recv();

    // SetMaxQuality normalizes & emits ShellCommand
    state.apply_client_command(ClientCommand::SetMaxQuality {
        quality: "1080p".to_string(),
    });
    assert_eq!(state.snapshot().playback.max_quality, "1080p");
    match rx.try_recv().unwrap() {
        ShellCommand::SetMaxQuality { quality } => assert_eq!(quality, "1080p"),
        other => panic!("expected SetMaxQuality, got {other:?}"),
    }

    state.apply_client_command(ClientCommand::SetMaxQuality {
        quality: "invalid".to_string(),
    });
    assert_eq!(state.snapshot().playback.max_quality, "auto");
    let _ = rx.try_recv();

    // Direct Left/Right seek when mode == LiveTv and overlay == None
    state.set_mode(AppMode::LiveTv);
    assert_eq!(state.snapshot().overlay, OverlayKind::None);

    state.handle_nav_event(NavEvent::Left);
    assert_eq!(state.snapshot().overlay, OverlayKind::PlayerOsd);
    match rx.try_recv().unwrap() {
        ShellCommand::SeekRelative { offset_sec } => assert_eq!(offset_sec, -10.0),
        other => panic!("expected SeekRelative(-10), got {other:?}"),
    }

    // Reset overlay to None and test Right (+10s)
    state.set_overlay(OverlayKind::None);
    state.handle_nav_event(NavEvent::Right);
    assert_eq!(state.snapshot().overlay, OverlayKind::PlayerOsd);
    match rx.try_recv().unwrap() {
        ShellCommand::SeekRelative { offset_sec } => assert_eq!(offset_sec, 10.0),
        other => panic!("expected SeekRelative(10), got {other:?}"),
    }
}

#[tokio::test]
async fn test_youtube_subscriptions_and_playlists_data_api_v3_and_tvhtml5() {
    use axum::{
        Router,
        extract::Query,
        http::{HeaderMap, StatusCode},
        response::IntoResponse,
        routing::{get, post},
    };
    use melange_core::YouTubeAccount;
    use melange_core::providers::youtube::{
        YouTubeEndpoints, YouTubeFeedResponse, parse_iso8601_duration,
    };
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicBool, Ordering};

    assert_eq!(parse_iso8601_duration("PT1H2M3S"), 3723);
    assert_eq!(parse_iso8601_duration("PT12M30S"), 750);

    let saw_web_with_bearer = Arc::new(AtomicBool::new(false));
    let saw_web_flag = Arc::clone(&saw_web_with_bearer);

    let mock_google = Router::new()
        .route(
            "/youtubei/v1/browse",
            post(move |headers: HeaderMap, axum::Json(body): axum::Json<serde_json::Value>| {
                let saw_web_flag = Arc::clone(&saw_web_flag);
                async move {
                    let client_id = headers
                        .get("x-youtube-client-name")
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("");
                    let has_auth = headers.contains_key("authorization");
                    if has_auth && client_id == "1" {
                        saw_web_flag.store(true, Ordering::SeqCst);
                        return (
                            StatusCode::BAD_REQUEST,
                            axum::Json(serde_json::json!({ "error": "WEB header with TV OAuth" })),
                        )
                            .into_response();
                    }

                    let browse_id = body["browseId"].as_str().unwrap_or("");
                    match browse_id {
                        // Simulate Innertube FEsubscriptions returning 400 (forcing Data API v3 fallback)
                        "FEsubscriptions" => (
                            StatusCode::BAD_REQUEST,
                            axum::Json(serde_json::json!({ "error": "invalid request" })),
                        )
                            .into_response(),
                        "VLWL" => axum::Json(serde_json::json!({
                            "header": {
                                "playlistHeaderRenderer": {
                                    "title": { "simpleText": "Watch Later" }
                                }
                            },
                            "contents": {
                                "playlistVideoRenderer": {
                                    "videoId": "wlVid99",
                                    "title": { "simpleText": "Watch Later Item" },
                                    "longBylineText": {
                                        "runs": [{
                                            "text": "Arte Doc",
                                            "navigationEndpoint": {
                                                "browseEndpoint": { "browseId": "UCarte1234567890" }
                                            }
                                        }]
                                    },
                                    "lengthText": { "simpleText": "20:00" }
                                }
                            }
                        }))
                        .into_response(),
                        _ => axum::Json(serde_json::json!({})).into_response(),
                    }
                }
            }),
        )
        .route(
            "/v3/subscriptions",
            get(|headers: HeaderMap| async move {
                assert!(headers.get("authorization").is_some());
                axum::Json(serde_json::json!({
                    "items": [
                        {
                            "snippet": {
                                "title": "Arte Documentary",
                                "resourceId": { "channelId": "UCarte1234567890" },
                                "thumbnails": {
                                    "high": { "url": "https://yt3.ggpht.com/arte-avatar.jpg" }
                                }
                            }
                        },
                        {
                            "snippet": {
                                "title": "ZDFheute",
                                "resourceId": { "channelId": "UCzdf12345678901" },
                                "thumbnails": {
                                    "medium": { "url": "https://yt3.ggpht.com/zdf-avatar.jpg" }
                                }
                            }
                        }
                    ]
                }))
            }),
        )
        .route(
            "/v3/playlists",
            get(|headers: HeaderMap| async move {
                assert!(headers.get("authorization").is_some());
                axum::Json(serde_json::json!({
                    "items": [
                        {
                            "id": "PLcustomDoc01",
                            "snippet": {
                                "title": "Science Docs",
                                "thumbnails": {
                                    "high": { "url": "https://i.ytimg.com/vi/doc01/hqdefault.jpg" }
                                }
                            },
                            "contentDetails": { "itemCount": 7 }
                        }
                    ]
                }))
            }),
        )
        .route(
            "/v3/playlistItems",
            get(|Query(params): Query<HashMap<String, String>>| async move {
                let pid = params.get("playlistId").map(String::as_str).unwrap_or("");
                match pid {
                    "UUarte1234567890" => axum::Json(serde_json::json!({
                        "items": [
                            {
                                "snippet": {
                                    "title": "Deep Sea Volcanoes",
                                    "videoOwnerChannelTitle": "Arte Documentary",
                                    "videoOwnerChannelId": "UCarte1234567890",
                                    "thumbnails": {
                                        "high": { "url": "https://i.ytimg.com/vi/arteVid1/hqdefault.jpg" }
                                    }
                                },
                                "contentDetails": {
                                    "videoId": "arteVid1",
                                    "videoPublishedAt": "2026-11-10T18:00:00Z"
                                }
                            }
                        ]
                    }))
                    .into_response(),
                    "UUzdf12345678901" => axum::Json(serde_json::json!({
                        "items": [
                            {
                                "snippet": {
                                    "title": "Abendnachrichten Live",
                                    "videoOwnerChannelTitle": "ZDFheute",
                                    "videoOwnerChannelId": "UCzdf12345678901",
                                    "thumbnails": {
                                        "high": { "url": "https://i.ytimg.com/vi/zdfVid1/hqdefault.jpg" }
                                    }
                                },
                                "contentDetails": {
                                    "videoId": "zdfVid1",
                                    "videoPublishedAt": "2026-11-11T19:00:00Z"
                                }
                            }
                        ]
                    }))
                    .into_response(),
                    "PLcustomDoc01" => axum::Json(serde_json::json!({
                        "items": [
                            {
                                "snippet": {
                                    "title": "Cosmic Horizons",
                                    "videoOwnerChannelTitle": "Arte Documentary",
                                    "videoOwnerChannelId": "UCarte1234567890",
                                    "thumbnails": {
                                        "high": { "url": "https://i.ytimg.com/vi/cosmo1/hqdefault.jpg" }
                                    }
                                },
                                "contentDetails": {
                                    "videoId": "cosmo1",
                                    "videoPublishedAt": "2026-11-01T12:00:00Z"
                                }
                            }
                        ]
                    }))
                    .into_response(),
                    // Watch Later ("WL") is unavailable via Data API v3, triggering TVHTML5 VLWL fallback
                    "WL" => (
                        StatusCode::NOT_FOUND,
                        axum::Json(serde_json::json!({ "error": "not found" })),
                    )
                        .into_response(),
                    _ => axum::Json(serde_json::json!({ "items": [] })).into_response(),
                }
            }),
        )
        .route(
            "/v3/videos",
            get(|Query(params): Query<HashMap<String, String>>| async move {
                let ids = params.get("id").map(String::as_str).unwrap_or("");
                let items: Vec<serde_json::Value> = ids
                    .split(',')
                    .filter(|s| !s.is_empty())
                    .map(|id| {
                        serde_json::json!({
                            "id": id,
                            "contentDetails": { "duration": "PT45M10S" }
                        })
                    })
                    .collect();
                axum::Json(serde_json::json!({ "items": items }))
            }),
        );

    let mock_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mock_addr = mock_listener.local_addr().unwrap();
    tokio::spawn(async move {
        let _ = axum::serve(mock_listener, mock_google).await;
    });

    let tmp = TempDir::new().unwrap();
    let db_path = tmp.path().join("melange.db");
    let db = Database::open(&db_path).unwrap();
    let profiles = db.list_profiles().unwrap();
    let pid = profiles[0].id;
    db.upsert_youtube_account(&YouTubeAccount {
        profile_id: pid,
        access_token: "tv-oauth-bearer".to_string(),
        refresh_token: "refresh-tok".to_string(),
        expires_at: melange_core::providers::youtube::now_unix_secs() + 3600,
        account_name: "Couch User".to_string(),
        account_avatar_url: None,
        updated_at: String::new(),
    })
    .unwrap();

    let state = StateManager::new(profiles, vec![], vec![], Arc::new(AudioEngine::noop()));
    state.attach_db_path(db_path);
    state.set_youtube_provider(Arc::new(YouTubeProvider::with_endpoints(
        YouTubeEndpoints {
            innertube_base_url: format!("http://{mock_addr}"),
            data_api_base_url: format!("http://{mock_addr}/v3"),
            ..Default::default()
        },
        vec![],
        false,
    )));

    let app_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let app_addr = app_listener.local_addr().unwrap();
    let ui_dir = tmp.path().to_path_buf();
    tokio::spawn(async move {
        let _ = serve_on_listener(app_listener, state, &ui_dir).await;
    });

    let client = reqwest::Client::new();

    // 1. Subscriptions: even when FEsubscriptions returns 400, Data API v3 populates channels + recent uploads
    let subs: YouTubeFeedResponse = client
        .get(format!("http://{app_addr}/api/youtube/feed?tab=subscriptions"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(subs.source, "youtube-data-api");
    assert_eq!(subs.channels.len(), 2);
    assert_eq!(subs.channels[0].channel_id, "UCarte1234567890");
    assert_eq!(subs.items.len(), 2);
    assert_eq!(subs.items[0].id, "yt:zdfVid1"); // newest published_at first
    assert_eq!(subs.items[0].duration_sec, 2710);
    assert_eq!(
        subs.items[0].channel_id.as_deref(),
        Some("UCzdf12345678901")
    );

    // 2. Playlists: Data API v3 playlists + standard WL/LL entries
    let playlists: YouTubeFeedResponse = client
        .get(format!("http://{app_addr}/api/youtube/feed?tab=playlists"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(playlists.source, "youtube-data-api");
    assert_eq!(playlists.playlists.len(), 3);
    assert_eq!(playlists.playlists[0].playlist_id, "WL");
    assert_eq!(playlists.playlists[1].playlist_id, "LL");
    assert_eq!(playlists.playlists[2].playlist_id, "PLcustomDoc01");
    assert_eq!(playlists.playlists[2].item_count.as_deref(), Some("7 videos"));

    // 3. Custom playlist items via Data API v3
    let pl_items: YouTubeFeedResponse = client
        .get(format!(
            "http://{app_addr}/api/youtube/feed?tab=playlist&playlist_id=PLcustomDoc01"
        ))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(pl_items.items.len(), 1);
    assert_eq!(pl_items.items[0].id, "yt:cosmo1");
    assert_eq!(pl_items.items[0].duration_sec, 2710);

    // 4. Watch Later ("WL") falls back cleanly to TVHTML5 VLWL
    let wl_items: YouTubeFeedResponse = client
        .get(format!(
            "http://{app_addr}/api/youtube/feed?tab=playlist&playlist_id=WL"
        ))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(wl_items.items.len(), 1);
    assert_eq!(wl_items.items[0].id, "yt:wlVid99");
    assert_eq!(
        wl_items.items[0].channel_id.as_deref(),
        Some("UCarte1234567890")
    );

    // Never sent WEB client headers with an OAuth bearer token
    assert!(!saw_web_with_bearer.load(Ordering::SeqCst));
}
