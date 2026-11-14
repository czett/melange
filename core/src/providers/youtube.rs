use std::time::Duration;

use reqwest::Client;
use serde::Deserialize;
use tracing::warn;

use crate::error::MelangeError;
use crate::providers::{BoxFuture, MediaItem, OnDemandProvider};

pub struct YouTubeProvider {
    client: Client,
    piped_url: String,
}

impl YouTubeProvider {
    pub fn new(piped_url: impl Into<String>) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(10))
            .user_agent("melange/0.1")
            .build()
            .unwrap_or_else(|_| Client::new());
        Self {
            client,
            piped_url: piped_url.into().trim_end_matches('/').to_string(),
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
}

impl OnDemandProvider for YouTubeProvider {
    fn name(&self) -> &'static str {
        "youtube"
    }

    fn feed(&self) -> BoxFuture<'_, Result<Vec<MediaItem>, MelangeError>> {
        Box::pin(async move {
            let url = format!("{}/trending?region=DE", self.piped_url);
            let Some(body) = self.fetch_text(&url).await else {
                return Ok(Vec::new());
            };
            parse_piped_trending_response(&body)
        })
    }

    fn search<'a>(&'a self, query: &'a str) -> BoxFuture<'a, Result<Vec<MediaItem>, MelangeError>> {
        Box::pin(async move {
            let trimmed = query.trim();
            if trimmed.is_empty() {
                return self.feed().await;
            }
            let encoded = urlencoding_simple(trimmed);
            let url = format!("{}/search?q={}&filter=videos", self.piped_url, encoded);
            let Some(body) = self.fetch_text(&url).await else {
                return Ok(Vec::new());
            };
            parse_piped_search_response(&body)
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

fn extract_video_id(url: &str) -> Option<String> {
    if let Some(idx) = url.find("v=") {
        let rest = &url[idx + 2..];
        let id = rest.split('&').next().unwrap_or(rest).trim();
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
