use std::future::Future;
use std::pin::Pin;

use serde::{Deserialize, Serialize};

use crate::error::MelangeError;

pub mod local_media;
pub mod m3u_xmltv;
pub mod mediathek;
pub mod youtube;

pub use local_media::LocalMediaProvider;
pub use m3u_xmltv::{M3uXmltvProvider, SyncReport};
pub use mediathek::MediathekProvider;
pub use youtube::YouTubeProvider;

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MediaItem {
    pub id: String,
    pub provider: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub description: Option<String>,
    pub channel_or_author: String,
    pub duration_sec: u64,
    pub thumbnail_url: Option<String>,
    pub stream_url: String,
    pub published_at: Option<String>,
}

pub trait OnDemandProvider: Send + Sync {
    fn name(&self) -> &'static str;
    fn feed(&self) -> BoxFuture<'_, Result<Vec<MediaItem>, MelangeError>>;
    fn search<'a>(&'a self, query: &'a str) -> BoxFuture<'a, Result<Vec<MediaItem>, MelangeError>>;
}
