use std::time::Duration;

use reqwest::Client;
use serde::Deserialize;
use tokio::process::Command;
use tokio::time::timeout;
use tracing::{debug, warn};

use crate::error::MelangeError;
use crate::providers::{BoxFuture, MediaItem, OnDemandProvider};

const FALLBACK_PIPED_INSTANCES: &[&str] = &[
    "https://api.piped.private.coffee",
    "https://pipedapi.kavin.rocks",
];

const DEFAULT_YTDLP_FEED_QUERY: &str = "Doku Arte ZDF Tagesschau Wissenschaft";
const PIPED_TIMEOUT: Duration = Duration::from_secs(4);
const YTDLP_TIMEOUT: Duration = Duration::from_secs(15);

pub struct YouTubeProvider {
    client: Client,
    piped_urls: Vec<String>,
    enable_ytdlp_fallback: bool,
}

impl YouTubeProvider {
    pub fn new(piped_url: impl Into<String>) -> Self {
        let primary = piped_url.into().trim().trim_end_matches('/').to_string();
        let mut urls = Vec::new();
        if !primary.is_empty() {
            urls.push(primary);
        }
        for &fallback in FALLBACK_PIPED_INSTANCES {
            if !urls.iter().any(|u| u == fallback) {
                urls.push(fallback.to_string());
            }
        }
        Self::with_piped_urls(urls, true)
    }

    pub fn with_piped_urls(piped_urls: Vec<String>, enable_ytdlp_fallback: bool) -> Self {
        let client = Client::builder()
            .timeout(PIPED_TIMEOUT)
            .user_agent("melange/0.1")
            .build()
            .unwrap_or_else(|_| Client::new());
        let cleaned = piped_urls
            .into_iter()
            .map(|u| u.trim().trim_end_matches('/').to_string())
            .filter(|u| !u.is_empty())
            .collect();
        Self {
            client,
            piped_urls: cleaned,
            enable_ytdlp_fallback,
        }
    }

    async fn fetch_text(&self, url: &str) -> Option<String> {
        let resp = match self.client.get(url).send().await {
            Ok(r) => r,
            Err(err) => {
                warn!("piped request failed ({url}): {err}");
                return None;
            }
        };

        if !resp.status().is_success() {
            warn!("piped returned status {} for {url}", resp.status());
            return None;
        }

        match resp.text().await {
            Ok(t) => Some(t),
            Err(err) => {
                warn!("piped body read failed ({url}): {err}");
                None
            }
        }
    }

    async fn try_piped_feed(&self) -> Option<Vec<MediaItem>> {
        for base in &self.piped_urls {
            let url = format!("{base}/trending?region=DE");
            let Some(body) = self.fetch_text(&url).await else {
                continue;
            };
            match parse_piped_trending_response(&body) {
                Ok(items) if !items.is_empty() => return Some(items),
                Ok(_) => warn!("piped trending returned empty items ({base})"),
                Err(err) => warn!("piped trending parse failed ({base}): {err}"),
            }
        }
        None
    }

    async fn try_piped_search(&self, encoded_query: &str) -> Option<Vec<MediaItem>> {
        for base in &self.piped_urls {
            let url = format!("{base}/search?q={encoded_query}&filter=videos");
            let Some(body) = self.fetch_text(&url).await else {
                continue;
            };
            match parse_piped_search_response(&body) {
                Ok(items) if !items.is_empty() => return Some(items),
                Ok(_) => warn!("piped search returned empty items ({base})"),
                Err(err) => warn!("piped search parse failed ({base}): {err}"),
            }
        }
        None
    }

    async fn ytdlp_search(&self, query: &str) -> Result<Vec<MediaItem>, MelangeError> {
        let search_arg = format!("ytsearch20:{query}");
        debug!(query = %search_arg, "running yt-dlp youtube fallback");
        let output = timeout(
            YTDLP_TIMEOUT,
            Command::new("yt-dlp")
                .args([
                    "--flat-playlist",
                    "--dump-single-json",
                    "--no-warnings",
                    "--skip-download",
                    &search_arg,
                ])
                .output(),
        )
        .await
        .map_err(|_| MelangeError::Player("yt-dlp search timed out".to_string()))?
        .map_err(|err| MelangeError::Player(format!("failed to spawn yt-dlp: {err}")))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(MelangeError::Player(format!(
                "yt-dlp exited with {}: {}",
                output.status,
                stderr.trim()
            )));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        parse_ytdlp_json_response(&stdout)
    }
}

impl OnDemandProvider for YouTubeProvider {
    fn name(&self) -> &'static str {
        "youtube"
    }

    fn feed(&self) -> BoxFuture<'_, Result<Vec<MediaItem>, MelangeError>> {
        Box::pin(async move {
            if let Some(items) = self.try_piped_feed().await {
                return Ok(items);
            }
            if self.enable_ytdlp_fallback {
                return self.ytdlp_search(DEFAULT_YTDLP_FEED_QUERY).await;
            }
            Err(MelangeError::Config(
                "all youtube Piped instances failed and yt-dlp fallback is disabled".to_string(),
            ))
        })
    }

    fn search<'a>(&'a self, query: &'a str) -> BoxFuture<'a, Result<Vec<MediaItem>, MelangeError>> {
        Box::pin(async move {
            let trimmed = query.trim();
            if trimmed.is_empty() {
                return self.feed().await;
            }
            let encoded = urlencoding_simple(trimmed);
            if let Some(items) = self.try_piped_search(&encoded).await {
                return Ok(items);
            }
            if self.enable_ytdlp_fallback {
                return self.ytdlp_search(trimmed).await;
            }
            Err(MelangeError::Config(
                "all youtube Piped instances failed and yt-dlp fallback is disabled".to_string(),
            ))
        })
    }
}

#[derive(Deserialize)]
struct PipedSearchResponse {
    #[serde(default)]
    items: Vec<PipedRawItem>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PipedRawItem {
    #[serde(default)]
    url: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    thumbnail: Option<String>,
    #[serde(default)]
    uploader_name: Option<String>,
    #[serde(default)]
    duration: Option<i64>,
    #[serde(default)]
    uploaded_date: Option<String>,
    #[serde(default)]
    short_description: Option<String>,
    #[serde(rename = "type", default)]
    item_type: Option<String>,
}

fn convert_piped_item(raw: PipedRawItem) -> Option<MediaItem> {
    if let Some(ref t) = raw.item_type
        && t != "stream"
    {
        return None;
    }

    let video_id = extract_video_id(&raw.url)?;
    let stream_url = format!("https://www.youtube.com/watch?v={video_id}");
    let duration_sec = raw.duration.unwrap_or(0).max(0) as u64;

    Some(MediaItem {
        id: format!("yt:{video_id}"),
        provider: "youtube".to_string(),
        title: raw.title,
        subtitle: None,
        description: raw.short_description.filter(|s| !s.is_empty()),
        channel_or_author: raw.uploader_name.unwrap_or_else(|| "YouTube".to_string()),
        duration_sec,
        thumbnail_url: raw.thumbnail.filter(|s| !s.is_empty()),
        stream_url,
        published_at: raw.uploaded_date.filter(|s| !s.is_empty()),
    })
}

#[derive(Deserialize)]
struct YtDlpSearchResponse {
    #[serde(default)]
    entries: Vec<YtDlpEntry>,
}

#[derive(Deserialize)]
struct YtDlpThumbnail {
    #[serde(default)]
    url: String,
}

#[derive(Deserialize)]
struct YtDlpEntry {
    #[serde(default)]
    id: String,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default)]
    uploader: Option<String>,
    #[serde(default)]
    channel: Option<String>,
    #[serde(default)]
    thumbnail: Option<String>,
    #[serde(default)]
    thumbnails: Vec<YtDlpThumbnail>,
    #[serde(default)]
    upload_date: Option<String>,
}

pub fn parse_ytdlp_json_response(body: &str) -> Result<Vec<MediaItem>, MelangeError> {
    let parsed: YtDlpSearchResponse = serde_json::from_str(body)
        .map_err(|e| MelangeError::Parse(format!("yt-dlp json: {e}")))?;

    let mut items = Vec::with_capacity(parsed.entries.len());
    for entry in parsed.entries {
        let video_id = if !entry.id.trim().is_empty() {
            entry.id.trim().to_string()
        } else if let Some(ref url) = entry.url
            && let Some(id) = extract_video_id(url)
        {
            id
        } else {
            continue;
        };

        let title = entry
            .title
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| video_id.clone());
        let channel_or_author = entry
            .channel
            .filter(|s| !s.trim().is_empty())
            .or_else(|| entry.uploader.filter(|s| !s.trim().is_empty()))
            .unwrap_or_else(|| "YouTube".to_string());
        let thumbnail_url = entry
            .thumbnails
            .into_iter()
            .rev()
            .find(|t| !t.url.is_empty())
            .map(|t| t.url)
            .or_else(|| entry.thumbnail.filter(|s| !s.is_empty()))
            .or_else(|| Some(format!("https://i.ytimg.com/vi/{video_id}/hqdefault.jpg")));
        let duration_sec = entry.duration.unwrap_or(0.0).max(0.0).round() as u64;

        items.push(MediaItem {
            id: format!("yt:{video_id}"),
            provider: "youtube".to_string(),
            title,
            subtitle: None,
            description: entry.description.filter(|s| !s.is_empty()),
            channel_or_author,
            duration_sec,
            thumbnail_url,
            stream_url: format!("https://www.youtube.com/watch?v={video_id}"),
            published_at: entry.upload_date.filter(|s| !s.is_empty()),
        });
    }
    Ok(items)
}

pub fn extract_video_id(url: &str) -> Option<String> {
    if let Some(idx) = url.find("v=") {
        let rest = &url[idx + 2..];
        let id = rest.split('&').next().unwrap_or(rest).trim();
        if !id.is_empty() {
            return Some(id.to_string());
        }
    }
    if let Some(idx) = url.find("youtu.be/") {
        let rest = &url[idx + "youtu.be/".len()..];
        let id = rest.split(['?', '&', '/']).next().unwrap_or(rest).trim();
        if !id.is_empty() {
            return Some(id.to_string());
        }
    }
    if let Some(idx) = url.find("/shorts/") {
        let rest = &url[idx + "/shorts/".len()..];
        let id = rest.split(['?', '&', '/']).next().unwrap_or(rest).trim();
        if !id.is_empty() {
            return Some(id.to_string());
        }
    }
    None
}

pub fn parse_piped_trending_response(body: &str) -> Result<Vec<MediaItem>, MelangeError> {
    let raw_items: Vec<PipedRawItem> = serde_json::from_str(body)
        .map_err(|e| MelangeError::Parse(format!("piped trending json: {e}")))?;
    Ok(raw_items.into_iter().filter_map(convert_piped_item).collect())
}

pub fn parse_piped_search_response(body: &str) -> Result<Vec<MediaItem>, MelangeError> {
    let parsed: PipedSearchResponse = serde_json::from_str(body)
        .map_err(|e| MelangeError::Parse(format!("piped search json: {e}")))?;
    Ok(parsed
        .items
        .into_iter()
        .filter_map(convert_piped_item)
        .collect())
}

fn urlencoding_simple(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char);
            }
            b' ' => out.push('+'),
            _ => {
                out.push('%');
                out.push_str(&format!("{byte:02X}"));
            }
        }
    }
    out
}
