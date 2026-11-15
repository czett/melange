use std::time::Duration;

use reqwest::Client;
use serde::{Deserialize, Serialize};
use tracing::warn;

use crate::error::MelangeError;
use crate::providers::{BoxFuture, MediaItem, OnDemandProvider};

const DEFAULT_MEDIATHEK_URL: &str = "https://mediathekviewweb.de/api/query";

pub struct MediathekProvider {
    client: Client,
    endpoint: String,
}

impl MediathekProvider {
    pub fn new() -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(10))
            .user_agent("melange/0.1")
            .build()
            .unwrap_or_else(|_| Client::new());
        Self {
            client,
            endpoint: DEFAULT_MEDIATHEK_URL.to_string(),
        }
    }

    pub fn with_endpoint(endpoint: impl Into<String>) -> Self {
        let mut p = Self::new();
        p.endpoint = endpoint.into();
        p
    }

    async fn query_api(&self, query: Option<&str>) -> Result<Vec<MediaItem>, MelangeError> {
        let queries = match query.map(str::trim).filter(|q| !q.is_empty()) {
            Some(q) => vec![MediathekQueryClause {
                fields: vec!["title".to_string(), "topic".to_string()],
                query: q.to_string(),
            }],
            None => Vec::new(),
        };

        let payload = MediathekRequest {
            queries,
            sort_by: "timestamp",
            sort_order: "desc",
            future: false,
            offset: 0,
            size: 30,
        };

        let resp = match self
            .client
            .post(&self.endpoint)
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await
        {
            Ok(r) => r,
            Err(err) => {
                warn!("mediathek request failed: {err}");
                return Ok(Vec::new());
            }
        };

        if !resp.status().is_success() {
            warn!("mediathek returned status {}", resp.status());
            return Ok(Vec::new());
        }

        let body = match resp.text().await {
            Ok(t) => t,
            Err(err) => {
                warn!("mediathek body read failed: {err}");
                return Ok(Vec::new());
            }
        };

        parse_mediathek_response(&body)
    }
}

impl Default for MediathekProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl OnDemandProvider for MediathekProvider {
    fn name(&self) -> &'static str {
        "mediathek"
    }

    fn feed(&self) -> BoxFuture<'_, Result<Vec<MediaItem>, MelangeError>> {
        Box::pin(async move { self.query_api(None).await })
    }

    fn search<'a>(&'a self, query: &'a str) -> BoxFuture<'a, Result<Vec<MediaItem>, MelangeError>> {
        Box::pin(async move { self.query_api(Some(query)).await })
    }
}

#[derive(Serialize)]
struct MediathekRequest {
    queries: Vec<MediathekQueryClause>,
    #[serde(rename = "sortBy")]
    sort_by: &'static str,
    #[serde(rename = "sortOrder")]
    sort_order: &'static str,
    future: bool,
    offset: u32,
    size: u32,
}

#[derive(Serialize)]
struct MediathekQueryClause {
    fields: Vec<String>,
    query: String,
}

#[derive(Deserialize)]
struct MediathekApiResponse {
    result: Option<MediathekResultBlock>,
}

#[derive(Deserialize)]
struct MediathekResultBlock {
    #[serde(default)]
    results: Vec<MediathekRawItem>,
}

#[derive(Deserialize)]
struct MediathekRawItem {
    #[serde(default)]
    id: String,
    #[serde(default)]
    channel: String,
    #[serde(default)]
    topic: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    timestamp: Option<i64>,
    #[serde(default)]
    duration: Option<u64>,
    #[serde(default)]
    url_video_hd: Option<String>,
    #[serde(default)]
    url_video: Option<String>,
    #[serde(default)]
    url_video_low: Option<String>,
}

pub fn parse_mediathek_response(body: &str) -> Result<Vec<MediaItem>, MelangeError> {
    let parsed: MediathekApiResponse = serde_json::from_str(body)
        .map_err(|e| MelangeError::Parse(format!("mediathek json: {e}")))?;

    let results = parsed.result.map(|r| r.results).unwrap_or_default();
    let mut items = Vec::with_capacity(results.len());

    for raw in results {
        let stream_url = raw
            .url_video_hd
            .filter(|s| !s.is_empty())
            .or_else(|| raw.url_video.filter(|s| !s.is_empty()))
            .or_else(|| raw.url_video_low.filter(|s| !s.is_empty()));

        let Some(stream_url) = stream_url else {
            continue;
        };

        let id = if raw.id.is_empty() {
            format!("mt:{}", stream_url)
        } else {
            format!("mt:{}", raw.id)
        };

        let subtitle = if raw.topic.is_empty() {
            None
        } else {
            Some(raw.topic)
        };

        let published_at = raw.timestamp.map(|ts| ts.to_string());

        items.push(MediaItem {
            id,
            provider: "mediathek".to_string(),
            title: raw.title,
            subtitle,
            description: raw.description.filter(|s| !s.is_empty()),
            channel_or_author: raw.channel,
            channel_id: None,
            duration_sec: raw.duration.unwrap_or(0),
            thumbnail_url: None,
            stream_url,
            published_at,
        });
    }

    Ok(items)
}
