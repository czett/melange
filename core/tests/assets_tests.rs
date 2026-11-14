use std::path::Path;
use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use melange_core::{AudioEngine, SoundKind, StateManager, build_router};
use tower::ServiceExt;

#[tokio::test]
async fn embedded_ui_companion_and_sounds_fallback_when_disk_absent() {
    // 1. Sounds fall back to embedded assets when disk directory is absent
    let audio = Arc::new(AudioEngine::new(Path::new("/nonexistent/melange/sounds")));
    assert!(audio.has_sample(SoundKind::Focus));
    assert!(audio.has_sample(SoundKind::Select));
    assert!(audio.has_sample(SoundKind::Back));
    assert!(audio.has_sample(SoundKind::Zap));

    // 2. Router serves embedded UI (/) and SPA fallback (/some/client/route)
    let state = StateManager::new(vec![], vec![], vec![], audio);
    let app = build_router(state, Path::new("/nonexistent/melange/ui/dist"));

    let ui_res = app
        .clone()
        .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(ui_res.status(), StatusCode::OK);

    let spa_res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/channels/guide")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(spa_res.status(), StatusCode::OK);

    // 3. Router serves embedded Companion (/companion)
    let companion_res = app
        .oneshot(
            Request::builder()
                .uri("/companion")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(companion_res.status(), StatusCode::OK);
}
