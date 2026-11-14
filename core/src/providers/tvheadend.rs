use serde::Deserialize;

use crate::db::{ChannelInput, Database, EpgEntryInput};
use crate::error::MelangeError;
use crate::providers::m3u_xmltv::SyncReport;

#[derive(Debug, Clone)]
pub struct TvheadendProvider {
    pub base_url: String,
    pub username: Option<String>,
    pub password: Option<String>,
    client: reqwest::Client,
}

#[derive(Debug, Deserialize)]
struct TvhChannelGrid {
    #[serde(default)]
    entries: Vec<TvhChannelEntry>,
}

#[derive(Debug, Deserialize)]
struct TvhChannelEntry {
    uuid: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    number: Option<i64>,
    #[serde(default)]
    icon_public_url: Option<String>,
    #[serde(default)]
    enabled: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct TvhEpgGrid {
    #[serde(default)]
    entries: Vec<TvhEpgEntry>,
}

#[derive(Debug, Deserialize)]
struct TvhEpgEntry {
    #[serde(rename = "channelUuid", default)]
    channel_uuid: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    start: i64,
    #[serde(default)]
    stop: i64,
}

impl TvheadendProvider {
    pub fn new(
        base_url: impl Into<String>,
        username: Option<String>,
        password: Option<String>,
    ) -> Self {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap_or_default();
        Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            username,
            password,
            client,
        }
    }

    pub fn stream_url(&self, uuid: &str) -> String {
        if let (Some(user), Some(pass)) = (&self.username, &self.password)
            && let Some((scheme, rest)) = self.base_url.split_once("://")
        {
            return format!("{scheme}://{user}:{pass}@{rest}/stream/channel/{uuid}");
        }
        format!("{}/stream/channel/{uuid}", self.base_url)
    }

    pub fn parse_channels_json(&self, body: &str) -> Result<Vec<ChannelInput>, MelangeError> {
        let grid: TvhChannelGrid = serde_json::from_str(body)
            .map_err(|e| MelangeError::Parse(format!("tvheadend channel grid json: {e}")))?;

        let mut out = Vec::new();
        for (idx, entry) in grid.entries.into_iter().enumerate() {
            if entry.enabled == Some(false) || entry.uuid.is_empty() {
                continue;
            }
            let number = entry.number.unwrap_or((idx + 1) as i64);
            let logo_url = entry
                .icon_public_url
                .filter(|s| !s.is_empty())
                .map(|icon| {
                    if icon.starts_with("http://") || icon.starts_with("https://") {
                        icon
                    } else {
                        format!("{}/{}", self.base_url, icon.trim_start_matches('/'))
                    }
                })
                .unwrap_or_default();

            out.push(ChannelInput {
                number,
                tvg_id: entry.uuid.clone(),
                name: if entry.name.is_empty() {
                    format!("Channel {number}")
                } else {
                    entry.name
                },
                group_title: "Tvheadend".to_string(),
                logo_url,
                stream_url: self.stream_url(&entry.uuid),
            });
        }
        Ok(out)
    }

    pub fn parse_epg_json(&self, body: &str) -> Result<Vec<EpgEntryInput>, MelangeError> {
        let grid: TvhEpgGrid = serde_json::from_str(body)
            .map_err(|e| MelangeError::Parse(format!("tvheadend epg grid json: {e}")))?;

        let out = grid
            .entries
            .into_iter()
            .filter(|e| !e.channel_uuid.is_empty() && !e.title.is_empty())
            .map(|e| EpgEntryInput {
                channel_tvg_id: e.channel_uuid,
                title: e.title,
                description: e.description.unwrap_or_default(),
                start_time: e.start.to_string(),
                stop_time: e.stop.to_string(),
            })
            .collect();

        Ok(out)
    }

    async fn get_text(&self, path: &str) -> Result<String, MelangeError> {
        let url = format!("{}{}", self.base_url, path);
        let mut req = self.client.get(&url);
        if let Some(user) = &self.username {
            req = req.basic_auth(user, self.password.as_deref());
        }
        let resp = req
            .send()
            .await
            .map_err(|e| MelangeError::Io(std::io::Error::other(format!("tvheadend request {url}: {e}"))))?;
        if !resp.status().is_success() {
            return Err(MelangeError::Io(std::io::Error::other(format!(
                "tvheadend {url} returned HTTP {}",
                resp.status()
            ))));
        }
        resp.text()
            .await
            .map_err(|e| MelangeError::Io(std::io::Error::other(format!("tvheadend body {url}: {e}"))))
    }

    pub async fn sync(&self, db: &Database) -> Result<SyncReport, MelangeError> {
        let ch_body = self.get_text("/api/channel/grid?limit=500").await?;
        let channels = self.parse_channels_json(&ch_body)?;
        let epg_body = self.get_text("/api/epg/events/grid?limit=2000").await?;
        let epg = self.parse_epg_json(&epg_body)?;

        let mut channels_upserted = 0;
        for ch in &channels {
            db.upsert_channel(ch)?;
            channels_upserted += 1;
        }
        let mut epg_entries_upserted = 0;
        for entry in &epg {
            db.upsert_epg_entry(entry)?;
            epg_entries_upserted += 1;
        }
        Ok(SyncReport {
            channels_upserted,
            epg_entries_upserted,
        })
    }

    pub fn sync_blocking(&self, db: &Database) -> Result<SyncReport, MelangeError> {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(MelangeError::Io)?;
        rt.block_on(self.sync(db))
    }
}
