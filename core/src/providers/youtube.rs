use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::process::Command;
use tokio::sync::Mutex;
use tokio::time::timeout;
use tracing::{debug, warn};

use crate::db::{Database, WatchHistoryEntry, YouTubeAccount};
use crate::error::MelangeError;
use crate::providers::{BoxFuture, MediaItem, OnDemandProvider};

const FALLBACK_PIPED_INSTANCES: &[&str] = &[
    "https://api.piped.private.coffee",
    "https://pipedapi.kavin.rocks",
];

const DEFAULT_YTDLP_FEED_QUERY: &str = "Doku Arte ZDF Tagesschau Wissenschaft";
const PIPED_TIMEOUT: Duration = Duration::from_secs(4);
const INNERTUBE_TIMEOUT: Duration = Duration::from_secs(6);
const YTDLP_TIMEOUT: Duration = Duration::from_secs(15);

const DEFAULT_TV_CLIENT_ID: &str =
    "861556708454-d6dlm3lh05idd8npek18k6be8ba3oc68.apps.googleusercontent.com";
const DEFAULT_TV_CLIENT_SECRET: &str = "SboVhoG9s0rNafixCSGGKXAT";
const YOUTUBE_SCOPE: &str = "https://www.googleapis.com/auth/youtube";
const YOUTUBE_ACTIVATE_URL: &str = "https://www.youtube.com/activate";

const TV_CLIENT_NAME: &str = "TVHTML5";
const TV_CLIENT_NAME_ID: &str = "7";
const TV_CLIENT_VERSION: &str = "7.20250212.16.00";
const TV_USER_AGENT: &str = "Mozilla/5.0 (SMART-TV; Linux; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 TV Safari/537.36";

const WEB_CLIENT_NAME: &str = "WEB";
const WEB_CLIENT_NAME_ID: &str = "1";
const WEB_CLIENT_VERSION: &str = "2.20250212.01.00";

const CHANNEL_VIDEOS_PARAMS: &str = "EgZ2aWRlb3PyBgQKAjoA";
const SEARCH_VIDEOS_PARAMS: &str = "EgIQAQ==";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum YouTubeFeedTab {
    ForYou,
    Subscriptions,
    History,
    Channel(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct YouTubeChannelChip {
    pub channel_id: String,
    pub title: String,
    #[serde(default)]
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct YouTubeFeedResponse {
    pub items: Vec<MediaItem>,
    #[serde(default)]
    pub channels: Vec<YouTubeChannelChip>,
    #[serde(default)]
    pub channel_title: Option<String>,
    #[serde(default)]
    pub requires_auth: bool,
    pub source: String,
}

#[derive(Debug, Clone)]
pub struct YouTubeEndpoints {
    pub oauth_device_code_url: String,
    pub oauth_token_url: String,
    pub innertube_base_url: String,
    pub client_id: String,
    pub client_secret: String,
}

impl Default for YouTubeEndpoints {
    fn default() -> Self {
        let client_id = std::env::var("MELANGE_YT_CLIENT_ID")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| DEFAULT_TV_CLIENT_ID.to_string());
        let client_secret = std::env::var("MELANGE_YT_CLIENT_SECRET")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| DEFAULT_TV_CLIENT_SECRET.to_string());
        Self {
            oauth_device_code_url: "https://oauth2.googleapis.com/device/code".to_string(),
            oauth_token_url: "https://oauth2.googleapis.com/token".to_string(),
            innertube_base_url: "https://www.youtube.com".to_string(),
            client_id,
            client_secret,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_url: String,
    pub expires_in: i64,
    pub interval: i64,
}

#[derive(Debug, Deserialize)]
struct RawDeviceCodeResponse {
    device_code: String,
    user_code: String,
    #[serde(default)]
    verification_url: Option<String>,
    #[serde(default)]
    verification_uri: Option<String>,
    #[serde(default = "default_expires_in")]
    expires_in: i64,
    #[serde(default = "default_interval")]
    interval: i64,
}

fn default_expires_in() -> i64 {
    1800
}

fn default_interval() -> i64 {
    5
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OAuthTokenResponse {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default = "default_token_expires")]
    pub expires_in: i64,
    #[serde(default)]
    pub token_type: Option<String>,
}

fn default_token_expires() -> i64 {
    3600
}

#[derive(Debug, Deserialize)]
struct OAuthErrorBody {
    #[serde(default)]
    error: String,
    #[serde(default)]
    error_description: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TokenPollOutcome {
    Authorized(OAuthTokenResponse),
    Pending,
    SlowDown,
    Expired,
    Denied,
    Failed(String),
}

pub fn now_unix_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub struct YouTubeProvider {
    client: Client,
    endpoints: YouTubeEndpoints,
    piped_urls: Vec<String>,
    enable_ytdlp_fallback: bool,
    refresh_locks: Arc<Mutex<HashMap<i64, Arc<Mutex<()>>>>>,
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
        Self::with_endpoints(YouTubeEndpoints::default(), piped_urls, enable_ytdlp_fallback)
    }

    pub fn with_endpoints(
        endpoints: YouTubeEndpoints,
        piped_urls: Vec<String>,
        enable_ytdlp_fallback: bool,
    ) -> Self {
        let client = Client::builder()
            .timeout(INNERTUBE_TIMEOUT)
            .user_agent(TV_USER_AGENT)
            .build()
            .unwrap_or_else(|_| Client::new());
        let cleaned = piped_urls
            .into_iter()
            .map(|u| u.trim().trim_end_matches('/').to_string())
            .filter(|u| !u.is_empty())
            .collect();
        Self {
            client,
            endpoints,
            piped_urls: cleaned,
            enable_ytdlp_fallback,
            refresh_locks: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn endpoints(&self) -> &YouTubeEndpoints {
        &self.endpoints
    }

    pub fn innertube_tv_context(&self) -> Value {
        json!({
            "client": {
                "clientName": TV_CLIENT_NAME,
                "clientVersion": TV_CLIENT_VERSION,
                "platform": "TV",
                "hl": "de",
                "gl": "DE",
                "utcOffsetMinutes": 60
            },
            "user": {
                "lockedSafetyMode": false
            }
        })
    }

    pub async fn start_device_auth(&self) -> Result<DeviceCodeResponse, MelangeError> {
        let resp = self
            .client
            .post(&self.endpoints.oauth_device_code_url)
            .form(&[
                ("client_id", self.endpoints.client_id.as_str()),
                ("scope", YOUTUBE_SCOPE),
            ])
            .send()
            .await
            .map_err(|e| MelangeError::Player(format!("youtube device code request failed: {e}")))?;

        let status = resp.status();
        let body = resp
            .text()
            .await
            .map_err(|e| MelangeError::Player(format!("youtube device code read failed: {e}")))?;
        if !status.is_success() {
            return Err(MelangeError::Player(format!(
                "youtube device code HTTP {status}: {body}"
            )));
        }

        let raw: RawDeviceCodeResponse = serde_json::from_str(&body)
            .map_err(|e| MelangeError::Parse(format!("device code json: {e}")))?;
        let raw_url = raw
            .verification_url
            .or(raw.verification_uri)
            .unwrap_or_default();
        let verification_url = normalize_activation_url(&raw_url);

        Ok(DeviceCodeResponse {
            device_code: raw.device_code,
            user_code: raw.user_code,
            verification_url,
            expires_in: raw.expires_in.max(60),
            interval: raw.interval.max(1),
        })
    }

    pub async fn poll_device_token(&self, device_code: &str) -> Result<TokenPollOutcome, MelangeError> {
        let resp = self
            .client
            .post(&self.endpoints.oauth_token_url)
            .form(&[
                ("client_id", self.endpoints.client_id.as_str()),
                ("client_secret", self.endpoints.client_secret.as_str()),
                ("device_code", device_code),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ])
            .send()
            .await
            .map_err(|e| MelangeError::Player(format!("youtube token poll failed: {e}")))?;

        let status = resp.status();
        let body = resp
            .text()
            .await
            .map_err(|e| MelangeError::Player(format!("youtube token poll read failed: {e}")))?;

        if status.is_success() {
            let token: OAuthTokenResponse = serde_json::from_str(&body)
                .map_err(|e| MelangeError::Parse(format!("oauth token json: {e}")))?;
            return Ok(TokenPollOutcome::Authorized(token));
        }

        if let Ok(err_body) = serde_json::from_str::<OAuthErrorBody>(&body) {
            return Ok(match err_body.error.as_str() {
                "authorization_pending" => TokenPollOutcome::Pending,
                "slow_down" => TokenPollOutcome::SlowDown,
                "expired_token" => TokenPollOutcome::Expired,
                "access_denied" => TokenPollOutcome::Denied,
                other => {
                    let detail = err_body
                        .error_description
                        .filter(|d| !d.is_empty())
                        .unwrap_or_else(|| other.to_string());
                    TokenPollOutcome::Failed(detail)
                }
            });
        }

        Ok(TokenPollOutcome::Failed(format!(
            "token endpoint returned HTTP {status}"
        )))
    }

    pub async fn refresh_access_token(
        &self,
        refresh_token: &str,
    ) -> Result<OAuthTokenResponse, MelangeError> {
        let resp = self
            .client
            .post(&self.endpoints.oauth_token_url)
            .form(&[
                ("client_id", self.endpoints.client_id.as_str()),
                ("client_secret", self.endpoints.client_secret.as_str()),
                ("refresh_token", refresh_token),
                ("grant_type", "refresh_token"),
            ])
            .send()
            .await
            .map_err(|e| MelangeError::Player(format!("youtube token refresh failed: {e}")))?;

        let status = resp.status();
        let body = resp
            .text()
            .await
            .map_err(|e| MelangeError::Player(format!("youtube token refresh read failed: {e}")))?;
        if !status.is_success() {
            return Err(MelangeError::Player(format!(
                "youtube token refresh HTTP {status}: {body}"
            )));
        }

        serde_json::from_str(&body)
            .map_err(|e| MelangeError::Parse(format!("refresh token json: {e}")))
    }

    pub async fn fetch_account_info(
        &self,
        access_token: &str,
    ) -> Result<(String, Option<String>), MelangeError> {
        let url = format!(
            "{}/youtubei/v1/account/account_menu",
            self.endpoints.innertube_base_url.trim_end_matches('/')
        );
        let payload = json!({
            "context": self.innertube_tv_context()
        });

        let resp = self
            .client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("X-Youtube-Client-Name", TV_CLIENT_NAME_ID)
            .header("X-Youtube-Client-Version", TV_CLIENT_VERSION)
            .header("Origin", "https://www.youtube.com")
            .bearer_auth(access_token)
            .json(&payload)
            .send()
            .await
            .map_err(|e| MelangeError::Player(format!("innertube account_menu failed: {e}")))?;

        if !resp.status().is_success() {
            return Ok(("YouTube Account".to_string(), None));
        }

        let body = resp.text().await.unwrap_or_default();
        Ok(parse_account_menu_response(&body)
            .unwrap_or_else(|| ("YouTube Account".to_string(), None)))
    }

    pub async fn ensure_valid_token(
        &self,
        db_path: Option<&Path>,
        profile_id: i64,
        account: YouTubeAccount,
    ) -> Result<YouTubeAccount, MelangeError> {
        let lock = {
            let mut map = self.refresh_locks.lock().await;
            map.entry(profile_id)
                .or_insert_with(|| Arc::new(Mutex::new(())))
                .clone()
        };
        let _guard = lock.lock().await;

        let current = if let Some(path) = db_path
            && let Ok(db) = Database::open(path)
            && let Ok(Some(fresh_row)) = db.get_youtube_account(profile_id)
        {
            fresh_row
        } else {
            account
        };

        let now = now_unix_secs();
        if current.expires_at > now + 60 {
            return Ok(current);
        }

        let refreshed = self.refresh_access_token(&current.refresh_token).await?;
        let updated = YouTubeAccount {
            profile_id,
            access_token: refreshed.access_token,
            refresh_token: refreshed
                .refresh_token
                .filter(|t| !t.is_empty())
                .unwrap_or_else(|| current.refresh_token.clone()),
            expires_at: now + refreshed.expires_in.max(60),
            account_name: current.account_name.clone(),
            account_avatar_url: current.account_avatar_url.clone(),
            updated_at: String::new(),
        };

        if let Some(path) = db_path
            && let Ok(db) = Database::open(path)
        {
            db.upsert_youtube_account(&updated)?;
        }

        Ok(updated)
    }

    pub fn innertube_web_context(&self) -> Value {
        json!({
            "client": {
                "clientName": WEB_CLIENT_NAME,
                "clientVersion": WEB_CLIENT_VERSION,
                "hl": "de",
                "gl": "DE",
                "utcOffsetMinutes": 60
            },
            "user": {
                "lockedSafetyMode": false
            }
        })
    }

    async fn innertube_post(
        &self,
        path: &str,
        body: Value,
        access_token: Option<&str>,
        use_web_client: bool,
    ) -> Result<String, MelangeError> {
        let url = format!(
            "{}/youtubei/v1/{path}",
            self.endpoints.innertube_base_url.trim_end_matches('/')
        );
        let (client_id, client_ver) = if use_web_client {
            (WEB_CLIENT_NAME_ID, WEB_CLIENT_VERSION)
        } else {
            (TV_CLIENT_NAME_ID, TV_CLIENT_VERSION)
        };
        let mut req = self
            .client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("X-Youtube-Client-Name", client_id)
            .header("X-Youtube-Client-Version", client_ver)
            .header("Origin", "https://www.youtube.com");
        if let Some(token) = access_token {
            req = req.bearer_auth(token);
        }

        let resp = req
            .json(&body)
            .send()
            .await
            .map_err(|e| MelangeError::Player(format!("innertube {path} failed: {e}")))?;

        let status = resp.status();
        let text = resp
            .text()
            .await
            .map_err(|e| MelangeError::Player(format!("innertube {path} read failed: {e}")))?;
        if !status.is_success() {
            return Err(MelangeError::Player(format!(
                "innertube {path} returned HTTP {status}"
            )));
        }
        Ok(text)
    }

    pub async fn innertube_browse(
        &self,
        browse_id: &str,
        params: Option<&str>,
        access_token: Option<&str>,
        filter_shorts: bool,
    ) -> Result<InnertubeBrowseParsed, MelangeError> {
        let mut body = json!({
            "context": self.innertube_tv_context(),
            "browseId": browse_id,
        });
        if let Some(p) = params {
            body["params"] = Value::String(p.to_string());
        }

        match self.innertube_post("browse", body, access_token, false).await {
            Ok(text) => {
                let parsed = parse_innertube_browse_response(&text, filter_shorts)?;
                if !parsed.0.is_empty() || !parsed.1.is_empty() || access_token.is_some() {
                    return Ok(parsed);
                }
            }
            Err(err) => {
                debug!(browse_id, error = %err, "TVHTML5 browse failed, trying WEB context");
            }
        }

        let mut web_body = json!({
            "context": self.innertube_web_context(),
            "browseId": browse_id,
        });
        if let Some(p) = params {
            web_body["params"] = Value::String(p.to_string());
        }
        let text = self
            .innertube_post("browse", web_body, access_token, true)
            .await?;
        parse_innertube_browse_response(&text, filter_shorts)
    }

    pub async fn innertube_search(
        &self,
        query: &str,
        access_token: Option<&str>,
    ) -> Result<Vec<MediaItem>, MelangeError> {
        let tv_body = json!({
            "context": self.innertube_tv_context(),
            "query": query,
            "params": SEARCH_VIDEOS_PARAMS,
        });
        if let Ok(text) = self.innertube_post("search", tv_body, access_token, false).await
            && let Ok(items) = parse_innertube_search_response(&text)
            && !items.is_empty()
        {
            return Ok(items);
        }

        let web_body = json!({
            "context": self.innertube_web_context(),
            "query": query,
            "params": SEARCH_VIDEOS_PARAMS,
        });
        let text = self
            .innertube_post("search", web_body, access_token, true)
            .await?;
        parse_innertube_search_response(&text)
    }

    pub async fn fetch_feed_with_account(
        &self,
        tab: YouTubeFeedTab,
        account: Option<&YouTubeAccount>,
        local_history: &[WatchHistoryEntry],
    ) -> Result<YouTubeFeedResponse, MelangeError> {
        let token = account.map(|a| a.access_token.as_str());
        match tab {
            YouTubeFeedTab::ForYou => {
                if let Some(tok) = token {
                    match self
                        .innertube_browse("FEwhat_to_watch", None, Some(tok), true)
                        .await
                    {
                        Ok((items, channels, _)) if !items.is_empty() => {
                            return Ok(YouTubeFeedResponse {
                                items,
                                channels,
                                channel_title: None,
                                requires_auth: false,
                                source: "innertube-auth".to_string(),
                            });
                        }
                        Ok(_) => warn!("authenticated FEwhat_to_watch returned empty; falling back"),
                        Err(err) => warn!(error = %err, "authenticated FEwhat_to_watch failed; falling back"),
                    }
                }

                for browse_id in ["FEwhat_to_watch", "FEtrending"] {
                    if let Ok((items, channels, _)) =
                        self.innertube_browse(browse_id, None, None, true).await
                        && !items.is_empty()
                    {
                        return Ok(YouTubeFeedResponse {
                            items,
                            channels,
                            channel_title: None,
                            requires_auth: false,
                            source: "innertube-guest".to_string(),
                        });
                    }
                }

                if let Some(items) = self.try_piped_feed().await {
                    return Ok(YouTubeFeedResponse {
                        items,
                        channels: Vec::new(),
                        channel_title: None,
                        requires_auth: false,
                        source: "piped".to_string(),
                    });
                }

                if self.enable_ytdlp_fallback {
                    let items = self.ytdlp_search(DEFAULT_YTDLP_FEED_QUERY).await?;
                    return Ok(YouTubeFeedResponse {
                        items,
                        channels: Vec::new(),
                        channel_title: None,
                        requires_auth: false,
                        source: "ytdlp".to_string(),
                    });
                }

                Err(MelangeError::Config(
                    "all youtube feed sources failed and yt-dlp fallback is disabled".to_string(),
                ))
            }
            YouTubeFeedTab::Subscriptions => {
                let Some(tok) = token else {
                    return Ok(YouTubeFeedResponse {
                        items: Vec::new(),
                        channels: Vec::new(),
                        channel_title: None,
                        requires_auth: true,
                        source: "auth-required".to_string(),
                    });
                };

                let (items, mut channels, _) = self
                    .innertube_browse("FEsubscriptions", None, Some(tok), true)
                    .await?;
                if channels.is_empty() {
                    channels = derive_channel_chips(&items);
                }
                Ok(YouTubeFeedResponse {
                    items,
                    channels,
                    channel_title: None,
                    requires_auth: false,
                    source: "innertube-auth".to_string(),
                })
            }
            YouTubeFeedTab::History => {
                let mut remote_items = Vec::new();
                if let Some(tok) = token {
                    match self
                        .innertube_browse("FEhistory", None, Some(tok), true)
                        .await
                    {
                        Ok((items, _, _)) => remote_items = items,
                        Err(err) => warn!(error = %err, "authenticated FEhistory failed; using local history"),
                    }
                }

                let merged = merge_youtube_history(remote_items, local_history);
                Ok(YouTubeFeedResponse {
                    items: merged,
                    channels: Vec::new(),
                    channel_title: None,
                    requires_auth: false,
                    source: if token.is_some() {
                        "innertube-auth".to_string()
                    } else {
                        "local-history".to_string()
                    },
                })
            }
            YouTubeFeedTab::Channel(channel_id) => {
                let clean_id = channel_id.trim();
                if clean_id.is_empty() {
                    return Err(MelangeError::Parse("empty channel_id".to_string()));
                }
                let (mut items, channels, mut channel_title) = self
                    .innertube_browse(clean_id, Some(CHANNEL_VIDEOS_PARAMS), token, true)
                    .await
                    .unwrap_or_else(|_| (Vec::new(), Vec::new(), None));
                if items.is_empty() {
                    let (fallback_items, _, fallback_title) = self
                        .innertube_browse(clean_id, None, token, true)
                        .await?;
                    items = fallback_items;
                    if channel_title.is_none() {
                        channel_title = fallback_title;
                    }
                }
                if channel_title.is_none() {
                    channel_title = items.first().map(|i| i.channel_or_author.clone());
                }
                Ok(YouTubeFeedResponse {
                    items,
                    channels,
                    channel_title,
                    requires_auth: false,
                    source: if token.is_some() {
                        "innertube-auth".to_string()
                    } else {
                        "innertube-guest".to_string()
                    },
                })
            }
        }
    }

    pub async fn search_with_account(
        &self,
        query: &str,
        account: Option<&YouTubeAccount>,
    ) -> Result<Vec<MediaItem>, MelangeError> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return Ok(self
                .fetch_feed_with_account(YouTubeFeedTab::ForYou, account, &[])
                .await?
                .items);
        }

        let token = account.map(|a| a.access_token.as_str());
        if let Ok(items) = self.innertube_search(trimmed, token).await
            && !items.is_empty()
        {
            return Ok(items);
        }

        let encoded = urlencoding_simple(trimmed);
        if let Some(items) = self.try_piped_search(&encoded).await {
            return Ok(items);
        }

        if self.enable_ytdlp_fallback {
            return self.ytdlp_search(trimmed).await;
        }

        Err(MelangeError::Config(
            "all youtube search sources failed and yt-dlp fallback is disabled".to_string(),
        ))
    }

    async fn fetch_text(&self, url: &str) -> Option<String> {
        let resp = match self.client.get(url).timeout(PIPED_TIMEOUT).send().await {
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
            let res = self
                .fetch_feed_with_account(YouTubeFeedTab::ForYou, None, &[])
                .await?;
            Ok(res.items)
        })
    }

    fn search<'a>(&'a self, query: &'a str) -> BoxFuture<'a, Result<Vec<MediaItem>, MelangeError>> {
        Box::pin(async move { self.search_with_account(query, None).await })
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
        channel_id: None,
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
            channel_id: None,
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

fn normalize_activation_url(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed == "https://www.google.com/device" {
        return YOUTUBE_ACTIVATE_URL.to_string();
    }
    trimmed.to_string()
}

pub fn parse_account_menu_response(body: &str) -> Option<(String, Option<String>)> {
    let root: Value = serde_json::from_str(body).ok()?;
    let header = find_object_by_key(&root, "activeAccountHeaderRenderer")?;
    let name = extract_yt_text(header.get("accountName")?)
        .or_else(|| header.get("channelHandle").and_then(extract_yt_text))
        .filter(|s| !s.is_empty())?;
    let avatar = header
        .get("accountPhoto")
        .and_then(extract_best_thumbnail);
    Some((name, avatar))
}

fn find_object_by_key<'a>(value: &'a Value, target_key: &str) -> Option<&'a Value> {
    match value {
        Value::Object(map) => {
            if let Some(found) = map.get(target_key) {
                return Some(found);
            }
            for v in map.values() {
                if let Some(found) = find_object_by_key(v, target_key) {
                    return Some(found);
                }
            }
            None
        }
        Value::Array(arr) => {
            for v in arr {
                if let Some(found) = find_object_by_key(v, target_key) {
                    return Some(found);
                }
            }
            None
        }
        _ => None,
    }
}

fn extract_yt_text(val: &Value) -> Option<String> {
    if let Some(s) = val.as_str() {
        let trimmed = s.trim();
        return (!trimmed.is_empty()).then(|| trimmed.to_string());
    }
    if let Some(simple) = val.get("simpleText").and_then(Value::as_str) {
        let trimmed = simple.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    if let Some(runs) = val.get("runs").and_then(Value::as_array) {
        let mut out = String::new();
        for run in runs {
            if let Some(t) = run.get("text").and_then(Value::as_str) {
                out.push_str(t);
            }
        }
        let trimmed = out.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    None
}

fn extract_best_thumbnail(val: &Value) -> Option<String> {
    let thumbs = val.get("thumbnails").and_then(Value::as_array)?;
    let mut best_url: Option<String> = None;
    let mut best_width: i64 = -1;
    for t in thumbs {
        let Some(url) = t.get("url").and_then(Value::as_str) else {
            continue;
        };
        let url = url.trim();
        if url.is_empty() {
            continue;
        }
        let normalized = if url.starts_with("//") {
            format!("https:{url}")
        } else {
            url.to_string()
        };
        let width = t.get("width").and_then(Value::as_i64).unwrap_or(0);
        if width >= best_width {
            best_width = width;
            best_url = Some(normalized);
        }
    }
    best_url
}

pub type InnertubeBrowseParsed = (Vec<MediaItem>, Vec<YouTubeChannelChip>, Option<String>);

pub fn parse_innertube_browse_response(
    body: &str,
    filter_shorts: bool,
) -> Result<InnertubeBrowseParsed, MelangeError> {
    let root: Value = serde_json::from_str(body)
        .map_err(|e| MelangeError::Parse(format!("innertube browse json: {e}")))?;

    let mut items = Vec::new();
    let mut seen_ids = HashSet::new();
    let mut channels = Vec::new();
    let mut seen_channels = HashSet::new();

    let channel_title = extract_channel_header_title(&root);
    collect_innertube_renderers(
        &root,
        filter_shorts,
        &mut items,
        &mut seen_ids,
        &mut channels,
        &mut seen_channels,
        channel_title.as_deref(),
    );

    Ok((items, channels, channel_title))
}

pub fn parse_innertube_search_response(body: &str) -> Result<Vec<MediaItem>, MelangeError> {
    let root: Value = serde_json::from_str(body)
        .map_err(|e| MelangeError::Parse(format!("innertube search json: {e}")))?;

    let mut items = Vec::new();
    let mut seen_ids = HashSet::new();
    let mut channels = Vec::new();
    let mut seen_channels = HashSet::new();

    collect_innertube_renderers(
        &root,
        false,
        &mut items,
        &mut seen_ids,
        &mut channels,
        &mut seen_channels,
        None,
    );

    Ok(items)
}

fn extract_channel_header_title(root: &Value) -> Option<String> {
    if let Some(c4) = find_object_by_key(root, "c4TabbedHeaderRenderer")
        && let Some(t) = c4.get("title").and_then(extract_yt_text)
    {
        return Some(t);
    }
    if let Some(meta) = find_object_by_key(root, "channelMetadataRenderer")
        && let Some(t) = meta.get("title").and_then(extract_yt_text)
    {
        return Some(t);
    }
    if let Some(page) = find_object_by_key(root, "pageHeaderRenderer")
        && let Some(t) = page.get("pageTitle").and_then(extract_yt_text)
    {
        return Some(t);
    }
    None
}

fn collect_innertube_renderers(
    node: &Value,
    filter_shorts: bool,
    items: &mut Vec<MediaItem>,
    seen_ids: &mut HashSet<String>,
    channels: &mut Vec<YouTubeChannelChip>,
    seen_channels: &mut HashSet<String>,
    fallback_channel: Option<&str>,
) {
    match node {
        Value::Object(map) => {
            if let Some(tile) = map.get("tileRenderer") {
                if let Some(chip) = parse_channel_tile_renderer(tile)
                    && seen_channels.insert(chip.channel_id.clone())
                {
                    channels.push(chip);
                } else if let Some(item) = parse_tile_renderer(tile, filter_shorts, fallback_channel)
                    && seen_ids.insert(item.id.clone())
                {
                    items.push(item);
                }
                return;
            }
            for key in ["gridVideoRenderer", "videoRenderer", "compactVideoRenderer"] {
                if let Some(renderer) = map.get(key) {
                    if let Some(item) =
                        parse_web_video_renderer(renderer, filter_shorts, fallback_channel)
                        && seen_ids.insert(item.id.clone())
                    {
                        items.push(item);
                    }
                    return;
                }
            }
            for key in ["channelListItemRenderer", "channelRenderer", "gridChannelRenderer"] {
                if let Some(renderer) = map.get(key)
                    && let Some(chip) = parse_channel_list_renderer(renderer)
                    && seen_channels.insert(chip.channel_id.clone())
                {
                    channels.push(chip);
                }
            }
            for v in map.values() {
                collect_innertube_renderers(
                    v,
                    filter_shorts,
                    items,
                    seen_ids,
                    channels,
                    seen_channels,
                    fallback_channel,
                );
            }
        }
        Value::Array(arr) => {
            for v in arr {
                collect_innertube_renderers(
                    v,
                    filter_shorts,
                    items,
                    seen_ids,
                    channels,
                    seen_channels,
                    fallback_channel,
                );
            }
        }
        _ => {}
    }
}

fn is_short_renderer(val: &Value) -> bool {
    if val
        .get("contentType")
        .and_then(Value::as_str)
        .is_some_and(|s| s.eq_ignore_ascii_case("TILE_CONTENT_TYPE_SHORTS"))
    {
        return true;
    }
    if val
        .get("style")
        .and_then(Value::as_str)
        .is_some_and(|s| s.eq_ignore_ascii_case("TILE_STYLE_SHORTS"))
    {
        return true;
    }
    if find_object_by_key(val, "reelWatchEndpoint").is_some() {
        return true;
    }
    if let Some(url) = find_object_by_key(val, "webCommandMetadata")
        .and_then(|m| m.get("url"))
        .and_then(Value::as_str)
        && url.starts_with("/shorts/")
    {
        return true;
    }
    if let Some(overlays) = find_object_by_key(val, "thumbnailOverlays").and_then(Value::as_array) {
        for ov in overlays {
            if let Some(ts) = ov.get("thumbnailOverlayTimeStatusRenderer") {
                if ts
                    .get("style")
                    .and_then(Value::as_str)
                    .is_some_and(|s| s.eq_ignore_ascii_case("SHORTS"))
                {
                    return true;
                }
                if ts
                    .get("text")
                    .and_then(extract_yt_text)
                    .is_some_and(|t| t.eq_ignore_ascii_case("SHORTS"))
                {
                    return true;
                }
            }
        }
    }
    false
}

fn parse_channel_tile_renderer(tile: &Value) -> Option<YouTubeChannelChip> {
    let content_type = tile
        .get("contentType")
        .and_then(Value::as_str)
        .unwrap_or("");
    let is_channel = content_type == "TILE_CONTENT_TYPE_CHANNEL";
    let browse_id = find_object_by_key(tile, "browseEndpoint")
        .and_then(|b| b.get("browseId"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|id| id.starts_with("UC"))?;

    if !is_channel && tile.get("contentId").and_then(Value::as_str).is_some_and(|c| !c.starts_with("UC")) {
        return None;
    }
    if tile
        .get("onSelectCommand")
        .and_then(|c| c.get("watchEndpoint"))
        .is_some()
    {
        return None;
    }

    let title = tile
        .get("metadata")
        .and_then(|m| m.get("tileMetadataRenderer"))
        .and_then(|tm| tm.get("title"))
        .and_then(extract_yt_text)
        .or_else(|| tile.get("title").and_then(extract_yt_text))?;

    let avatar_url = tile
        .get("header")
        .and_then(|h| h.get("tileHeaderRenderer"))
        .and_then(|th| th.get("thumbnail"))
        .and_then(extract_best_thumbnail);

    Some(YouTubeChannelChip {
        channel_id: browse_id.to_string(),
        title,
        avatar_url,
    })
}

fn parse_channel_list_renderer(renderer: &Value) -> Option<YouTubeChannelChip> {
    let channel_id = renderer
        .get("channelId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
        .or_else(|| {
            find_object_by_key(renderer, "browseEndpoint")
                .and_then(|b| b.get("browseId"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| s.starts_with("UC"))
                .map(ToString::to_string)
        })?;

    let title = renderer
        .get("title")
        .and_then(extract_yt_text)
        .or_else(|| renderer.get("displayName").and_then(extract_yt_text))?;
    let avatar_url = renderer
        .get("thumbnail")
        .and_then(extract_best_thumbnail);

    Some(YouTubeChannelChip {
        channel_id,
        title,
        avatar_url,
    })
}

fn parse_tile_renderer(
    tile: &Value,
    filter_shorts: bool,
    fallback_channel: Option<&str>,
) -> Option<MediaItem> {
    if filter_shorts && is_short_renderer(tile) {
        return None;
    }

    let video_id = tile
        .get("onSelectCommand")
        .and_then(|c| find_object_by_key(c, "watchEndpoint"))
        .and_then(|w| w.get("videoId"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .or_else(|| {
            tile.get("contentId")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty() && !s.starts_with("UC"))
        })?
        .to_string();

    let meta = tile
        .get("metadata")
        .and_then(|m| m.get("tileMetadataRenderer"));
    let title = meta
        .and_then(|m| m.get("title"))
        .and_then(extract_yt_text)
        .or_else(|| tile.get("title").and_then(extract_yt_text))
        .unwrap_or_else(|| video_id.clone());

    let mut line_texts: Vec<String> = Vec::new();
    let mut line_channel_id: Option<String> = None;
    if let Some(lines) = meta.and_then(|m| m.get("lines")).and_then(Value::as_array) {
        for line in lines {
            if let Some(items) = line
                .get("lineRenderer")
                .and_then(|lr| lr.get("items"))
                .and_then(Value::as_array)
            {
                let mut parts = Vec::new();
                for li in items {
                    if let Some(lir) = li.get("lineItemRenderer") {
                        if let Some(t) = lir.get("text").and_then(extract_yt_text) {
                            parts.push(t);
                        }
                        if line_channel_id.is_none() {
                            line_channel_id = find_object_by_key(lir, "browseEndpoint")
                                .and_then(|b| b.get("browseId"))
                                .and_then(Value::as_str)
                                .map(str::trim)
                                .filter(|id| id.starts_with("UC"))
                                .map(ToString::to_string);
                        }
                    }
                }
                if !parts.is_empty() {
                    line_texts.push(parts.join(" · "));
                }
            }
        }
    }

    let channel_or_author = line_texts
        .first()
        .cloned()
        .or_else(|| fallback_channel.map(ToString::to_string))
        .unwrap_or_else(|| "YouTube".to_string());
    let subtitle = if line_texts.len() > 1 {
        Some(line_texts[1..].join(" · "))
    } else {
        None
    };

    let channel_id = line_channel_id.or_else(|| {
        find_object_by_key(tile, "browseEndpoint")
            .and_then(|b| b.get("browseId"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|id| id.starts_with("UC"))
            .map(ToString::to_string)
    });

    let header = tile
        .get("header")
        .and_then(|h| h.get("tileHeaderRenderer"));
    let thumbnail_url = header
        .and_then(|h| h.get("thumbnail"))
        .and_then(extract_best_thumbnail)
        .or_else(|| tile.get("thumbnail").and_then(extract_best_thumbnail))
        .or_else(|| Some(format!("https://i.ytimg.com/vi/{video_id}/hq720.jpg")));

    let duration_text = header
        .and_then(extract_overlay_duration_text)
        .or_else(|| extract_overlay_duration_text(tile));
    let duration_sec = duration_text
        .as_deref()
        .map(parse_duration_str)
        .unwrap_or(0);

    Some(MediaItem {
        id: format!("yt:{video_id}"),
        provider: "youtube".to_string(),
        title,
        subtitle,
        description: None,
        channel_or_author,
        channel_id,
        duration_sec,
        thumbnail_url,
        stream_url: format!("https://www.youtube.com/watch?v={video_id}"),
        published_at: None,
    })
}

fn parse_web_video_renderer(
    renderer: &Value,
    filter_shorts: bool,
    fallback_channel: Option<&str>,
) -> Option<MediaItem> {
    if filter_shorts && is_short_renderer(renderer) {
        return None;
    }

    let video_id = renderer
        .get("videoId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .or_else(|| {
            find_object_by_key(renderer, "watchEndpoint")
                .and_then(|w| w.get("videoId"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
        })?
        .to_string();

    let title = renderer
        .get("title")
        .and_then(extract_yt_text)
        .unwrap_or_else(|| video_id.clone());

    let author_obj = renderer
        .get("ownerText")
        .or_else(|| renderer.get("shortBylineText"))
        .or_else(|| renderer.get("longBylineText"));
    let channel_or_author = author_obj
        .and_then(extract_yt_text)
        .or_else(|| fallback_channel.map(ToString::to_string))
        .unwrap_or_else(|| "YouTube".to_string());
    let channel_id = author_obj
        .and_then(|a| find_object_by_key(a, "browseEndpoint"))
        .and_then(|b| b.get("browseId"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|id| id.starts_with("UC"))
        .map(ToString::to_string);

    let views = renderer
        .get("shortViewCountText")
        .or_else(|| renderer.get("viewCountText"))
        .and_then(extract_yt_text);
    let published_at = renderer
        .get("publishedTimeText")
        .and_then(extract_yt_text);
    let subtitle = match (views, published_at.as_ref()) {
        (Some(v), Some(p)) => Some(format!("{v} · {p}")),
        (Some(v), None) => Some(v),
        (None, Some(p)) => Some(p.clone()),
        (None, None) => None,
    };

    let duration_sec = renderer
        .get("lengthText")
        .and_then(extract_yt_text)
        .or_else(|| extract_overlay_duration_text(renderer))
        .as_deref()
        .map(parse_duration_str)
        .unwrap_or(0);

    let thumbnail_url = renderer
        .get("thumbnail")
        .and_then(extract_best_thumbnail)
        .or_else(|| Some(format!("https://i.ytimg.com/vi/{video_id}/hq720.jpg")));

    let description = renderer
        .get("descriptionSnippet")
        .and_then(extract_yt_text);

    Some(MediaItem {
        id: format!("yt:{video_id}"),
        provider: "youtube".to_string(),
        title,
        subtitle,
        description,
        channel_or_author,
        channel_id,
        duration_sec,
        thumbnail_url,
        stream_url: format!("https://www.youtube.com/watch?v={video_id}"),
        published_at,
    })
}

fn extract_overlay_duration_text(node: &Value) -> Option<String> {
    let overlays = node.get("thumbnailOverlays").and_then(Value::as_array)?;
    for ov in overlays {
        if let Some(ts) = ov.get("thumbnailOverlayTimeStatusRenderer")
            && let Some(text) = ts.get("text").and_then(extract_yt_text)
        {
            return Some(text);
        }
    }
    None
}

pub fn parse_duration_str(raw: &str) -> u64 {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("LIVE") {
        return 0;
    }
    let parts: Vec<u64> = trimmed
        .split(':')
        .filter_map(|p| p.trim().parse::<u64>().ok())
        .collect();
    match parts.as_slice() {
        [s] => *s,
        [m, s] => m * 60 + s,
        [h, m, s] => h * 3600 + m * 60 + s,
        _ => 0,
    }
}

fn derive_channel_chips(items: &[MediaItem]) -> Vec<YouTubeChannelChip> {
    let mut seen = HashSet::new();
    let mut chips = Vec::new();
    for item in items {
        if let Some(ref cid) = item.channel_id
            && !cid.is_empty()
            && seen.insert(cid.clone())
        {
            chips.push(YouTubeChannelChip {
                channel_id: cid.clone(),
                title: item.channel_or_author.clone(),
                avatar_url: None,
            });
        }
    }
    chips
}

pub fn merge_youtube_history(
    remote_items: Vec<MediaItem>,
    local_history: &[WatchHistoryEntry],
) -> Vec<MediaItem> {
    let mut by_id: HashMap<String, &WatchHistoryEntry> = HashMap::new();
    for entry in local_history {
        if entry.provider == "youtube" {
            by_id.insert(entry.item_id.clone(), entry);
        }
    }

    let mut out = Vec::new();
    let mut seen = HashSet::new();

    for entry in local_history {
        if entry.provider != "youtube" {
            continue;
        }
        if seen.insert(entry.item_id.clone()) {
            let resume_min = (entry.position_sec / 60.0).floor() as u64;
            let subtitle = if entry.position_sec > 5.0 {
                Some(format!("Resumed at {}m", resume_min.max(1)))
            } else {
                Some("Watched locally".to_string())
            };
            out.push(MediaItem {
                id: entry.item_id.clone(),
                provider: "youtube".to_string(),
                title: entry.title.clone(),
                subtitle,
                description: None,
                channel_or_author: "YouTube".to_string(),
                channel_id: None,
                duration_sec: entry.duration_sec.max(0.0).round() as u64,
                thumbnail_url: entry.thumbnail_url.clone(),
                stream_url: entry.stream_url.clone(),
                published_at: Some(entry.updated_at.clone()),
            });
        }
    }

    for mut item in remote_items {
        if let Some(local) = by_id.get(&item.id) {
            if let Some(existing) = out.iter_mut().find(|i| i.id == item.id) {
                existing.channel_or_author = item.channel_or_author;
                existing.channel_id = item.channel_id;
                if existing.duration_sec == 0 {
                    existing.duration_sec = item.duration_sec;
                }
                if existing.thumbnail_url.is_none() {
                    existing.thumbnail_url = item.thumbnail_url;
                }
            }
            let _ = local;
        } else if seen.insert(item.id.clone()) {
            if item.subtitle.is_none() {
                item.subtitle = item.published_at.clone();
            }
            out.push(item);
        }
    }

    out
}
