use std::fs;
use std::path::{Path, PathBuf};

use crate::error::MelangeError;
use crate::providers::{BoxFuture, MediaItem, OnDemandProvider};

const VIDEO_EXTENSIONS: &[&str] = &["mp4", "mkv", "webm", "avi", "mov", "ts"];

pub struct LocalMediaProvider {
    dirs: Vec<PathBuf>,
}

impl LocalMediaProvider {
    pub fn new(dirs: Vec<PathBuf>) -> Self {
        Self { dirs }
    }

    pub fn scan_sync(&self) -> Vec<MediaItem> {
        let mut items = Vec::new();
        for dir in &self.dirs {
            if dir.exists() && dir.is_dir() {
                scan_dir_recursive(dir, &mut items);
            }
        }
        items.sort_by_key(|a| a.title.to_lowercase());
        items
    }
}

impl OnDemandProvider for LocalMediaProvider {
    fn name(&self) -> &'static str {
        "local"
    }

    fn feed(&self) -> BoxFuture<'_, Result<Vec<MediaItem>, MelangeError>> {
        Box::pin(async move { Ok(self.scan_sync()) })
    }

    fn search<'a>(&'a self, query: &'a str) -> BoxFuture<'a, Result<Vec<MediaItem>, MelangeError>> {
        Box::pin(async move {
            let q = query.trim().to_lowercase();
            let all = self.scan_sync();
            if q.is_empty() {
                return Ok(all);
            }
            Ok(all
                .into_iter()
                .filter(|item| {
                    item.title.to_lowercase().contains(&q)
                        || item
                            .subtitle
                            .as_deref()
                            .unwrap_or_default()
                            .to_lowercase()
                            .contains(&q)
                })
                .collect())
        })
    }
}

fn scan_dir_recursive(dir: &Path, out: &mut Vec<MediaItem>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            scan_dir_recursive(&path, out);
            continue;
        }
        if !is_video_file(&path) {
            continue;
        }
        let abs = fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
        let stream_url = abs.to_string_lossy().to_string();
        let title = clean_title_from_path(&path);
        let parent_name = path
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
            .map(ToString::to_string);

        out.push(MediaItem {
            id: format!("local:{}", stream_url),
            provider: "local".to_string(),
            title,
            subtitle: parent_name,
            description: Some(stream_url.clone()),
            channel_or_author: "Local Media".to_string(),
            channel_id: None,
            duration_sec: 0,
            thumbnail_url: None,
            stream_url,
            published_at: None,
        });
    }
}

fn is_video_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| VIDEO_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

fn clean_title_from_path(path: &Path) -> String {
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled");
    stem.replace(['_', '.'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
