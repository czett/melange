use std::path::Path;

use axum::body::Body;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "../ui/dist"]
pub struct EmbeddedUi;

#[derive(RustEmbed)]
#[folder = "../companion/dist"]
pub struct EmbeddedCompanion;

#[derive(RustEmbed)]
#[folder = "../assets/sounds"]
pub struct EmbeddedSounds;

/// Serve an asset from disk (if `prefer_disk` is true and the file exists),
/// falling back to the embedded `RustEmbed` bundle with SPA `index.html` fallback.
pub async fn serve_embedded_or_disk<E: RustEmbed>(
    disk_dir: Option<&Path>,
    rel_path: &str,
    prefer_disk: bool,
) -> Response {
    let clean_path = rel_path.trim_start_matches('/');
    let target = if clean_path.is_empty() {
        "index.html"
    } else {
        clean_path
    };

    if prefer_disk && let Some(dir) = disk_dir {
        let candidate = dir.join(target);
        if candidate.is_file()
            && let Ok(bytes) = tokio::fs::read(&candidate).await
        {
            return bytes_response(target, bytes);
        }
        // SPA fallback on disk if `index.html` exists
        let index = dir.join("index.html");
        if !target.contains('.')
            && index.is_file()
            && let Ok(bytes) = tokio::fs::read(&index).await
        {
            return bytes_response("index.html", bytes);
        }
    }

    if let Some(file) = E::get(target) {
        return bytes_response(target, file.data.into_owned());
    }

    // SPA fallback to embedded `index.html` for client-side routes
    if let Some(index) = E::get("index.html") {
        return bytes_response("index.html", index.data.into_owned());
    }

    (StatusCode::NOT_FOUND, "Not Found").into_response()
}

fn bytes_response(path: &str, bytes: Vec<u8>) -> Response {
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let mut response = Response::new(Body::from(bytes));
    if let Ok(ct) = HeaderValue::from_str(mime.as_ref()) {
        response.headers_mut().insert(header::CONTENT_TYPE, ct);
    }
    response
}
