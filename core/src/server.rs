use std::cmp::Ordering;
use std::collections::HashMap;
use std::net::{SocketAddr, UdpSocket};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering as AtomicOrdering};
use std::sync::{Arc, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Multipart, Path as AxumPath, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use futures_util::{SinkExt, StreamExt};
use qrcode::QrCode;
use qrcode::render::svg;
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;
use tracing::{debug, info, warn};

use crate::assets::{EmbeddedCompanion, EmbeddedUi, serve_embedded_or_disk};
use crate::audio::{AudioEngine, SoundKind};
use crate::db::{
    Channel, EpgEntry, Profile, WatchHistoryEntry, YouTubeAccount, YouTubeAccountSummary,
};
use crate::error::MelangeError;
use crate::input::NavEvent;
use crate::keymap::{KeyAction, KeymapConfig};
use crate::player::PlaybackState;
use crate::providers::youtube::{TokenPollOutcome, YouTubeFeedTab, now_unix_secs};
use crate::providers::{
    LocalMediaProvider, MediaItem, MediathekProvider, OnDemandProvider, YouTubeProvider,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AppMode {
    Home,
    LiveTv,
    Mediathek,
    YouTube,
    Media,
    Settings,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OverlayKind {
    None,
    ZapBanner,
    MiniEpg,
    FullEpg,
    ProfileSwitcher,
    PlayerOsd,
    SearchKeyboard,
    LeaveMenu,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlaybackSnapshot {
    pub state: PlaybackState,
    pub title: Option<String>,
    pub subtitle: Option<String>,
    pub channel_id: Option<i64>,
    pub channel_number: Option<i64>,
    pub current_media: Option<MediaItem>,
    pub position_sec: f64,
    pub duration_sec: f64,
    pub paused: bool,
    #[serde(default)]
    pub muted: bool,
    pub is_zapping: bool,
}

impl Default for PlaybackSnapshot {
    fn default() -> Self {
        Self {
            state: PlaybackState::Idle,
            title: None,
            subtitle: None,
            channel_id: None,
            channel_number: None,
            current_media: None,
            position_sec: 0.0,
            duration_sec: 0.0,
            paused: false,
            muted: false,
            is_zapping: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EpgNowNext {
    pub channel_tvg_id: String,
    pub now: Option<EpgEntry>,
    pub next: Option<EpgEntry>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MelangeState {
    pub mode: AppMode,
    pub overlay: OverlayKind,
    pub is_fullscreen: bool,
    pub active_profile: Option<Profile>,
    pub profiles: Vec<Profile>,
    pub channels: Vec<Channel>,
    pub epg_now_next: HashMap<String, EpgNowNext>,
    pub playback: PlaybackSnapshot,
    pub digit_buffer: String,
    pub continue_watching: Vec<WatchHistoryEntry>,
    #[serde(default)]
    pub youtube_account: Option<YouTubeAccountSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ServerMessage {
    StateSnapshot { state: MelangeState },
    StateUpdate { state: MelangeState },
    NavEvent { event: NavEvent },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
#[allow(clippy::large_enum_variant)]
pub enum ClientCommand {
    SelectChannel { channel_id: i64 },
    SetMode { mode: AppMode },
    SetOverlay { overlay: OverlayKind },
    SelectProfile { profile_id: i64 },
    SetPresetWallpaper {
        #[serde(deserialize_with = "deserialize_profile_id")]
        profile_id: i64,
        filename: String,
    },
    PlaySound { sound: SoundKind },
    PlayMedia { item: MediaItem, resume: bool },
    SeekRelative { offset_sec: f64 },
    TogglePause,
    ToggleFullscreen,
    SetKeyCapture { active: bool },
    QuitApp,
}

fn deserialize_profile_id<'de, D>(deserializer: D) -> Result<i64, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    match value {
        serde_json::Value::Number(n) => n
            .as_i64()
            .ok_or_else(|| serde::de::Error::custom("expected integer profile_id")),
        serde_json::Value::String(s) => s
            .trim()
            .parse::<i64>()
            .map_err(|_| serde::de::Error::custom("expected numeric profile_id string")),
        _ => Err(serde::de::Error::custom("expected integer or string profile_id")),
    }
}

#[derive(Debug, Clone)]
#[allow(clippy::large_enum_variant)]
pub enum ShellCommand {
    SelectChannel { channel_id: i64 },
    SetMode { mode: AppMode },
    SetOverlay { overlay: OverlayKind },
    PlayMedia { item: MediaItem, start_position_sec: f64 },
    SeekRelative { offset_sec: f64 },
    TogglePause,
    StopPlayback,
    ToggleFullscreen,
    QuitApp,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YouTubeAuthSessionState {
    pub session_id: u64,
    pub profile_id: i64,
    pub status: String,
    pub user_code: String,
    pub verification_url: String,
    pub qr_svg: String,
    pub expires_at: i64,
    #[serde(default)]
    pub error: Option<String>,
}

pub struct StateManager {
    state: RwLock<MelangeState>,
    epg_entries: RwLock<Vec<EpgEntry>>,
    keymap: RwLock<KeymapConfig>,
    key_capture: AtomicBool,
    ws_tx: broadcast::Sender<ServerMessage>,
    shell_cmd_tx: RwLock<Option<std::sync::mpsc::Sender<ShellCommand>>>,
    nav_tx: RwLock<Option<std::sync::mpsc::Sender<NavEvent>>>,
    db_path: RwLock<Option<PathBuf>>,
    wallpapers_dir: RwLock<PathBuf>,
    port: RwLock<u16>,
    audio: Arc<AudioEngine>,
    mediathek: Arc<MediathekProvider>,
    youtube: RwLock<Arc<YouTubeProvider>>,
    youtube_auth: RwLock<Option<YouTubeAuthSessionState>>,
    youtube_auth_seq: AtomicU64,
    local_media: RwLock<Arc<LocalMediaProvider>>,
}

struct LeaveLiveTvResult {
    stopped: bool,
    pending_progress: Option<(i64, MediaItem, f64, f64)>,
}

fn clear_playback_on_exit(st: &mut MelangeState, next_mode: AppMode) -> LeaveLiveTvResult {
    let has_active_playback = st.mode == AppMode::LiveTv
        || st.playback.state != PlaybackState::Idle
        || st.playback.channel_id.is_some()
        || st.playback.current_media.is_some();

    if next_mode != AppMode::LiveTv && has_active_playback {
        let pending_progress = match (
            st.active_profile.as_ref().map(|p| p.id),
            st.playback.current_media.clone(),
        ) {
            (Some(profile_id), Some(item)) if st.playback.position_sec > 1.0 => Some((
                profile_id,
                item,
                st.playback.position_sec,
                st.playback.duration_sec,
            )),
            _ => None,
        };
        let preserved_mute = st.playback.muted;
        st.playback = PlaybackSnapshot {
            muted: preserved_mute,
            ..PlaybackSnapshot::default()
        };
        st.digit_buffer.clear();
        LeaveLiveTvResult {
            stopped: true,
            pending_progress,
        }
    } else {
        LeaveLiveTvResult {
            stopped: false,
            pending_progress: None,
        }
    }
}

impl StateManager {
    pub fn new(
        profiles: Vec<Profile>,
        channels: Vec<Channel>,
        epg_entries: Vec<EpgEntry>,
        audio: Arc<AudioEngine>,
    ) -> Arc<Self> {
        let active_profile = profiles.first().cloned();
        let epg_now_next = compute_epg_now_next(&channels, &epg_entries);
        let (ws_tx, _) = broadcast::channel(128);

        let initial = MelangeState {
            mode: AppMode::Home,
            overlay: OverlayKind::None,
            is_fullscreen: false,
            active_profile,
            profiles,
            channels,
            epg_now_next,
            playback: PlaybackSnapshot::default(),
            digit_buffer: String::new(),
            continue_watching: Vec::new(),
            youtube_account: None,
        };

        Arc::new(Self {
            state: RwLock::new(initial),
            epg_entries: RwLock::new(epg_entries),
            keymap: RwLock::new(KeymapConfig::default()),
            key_capture: AtomicBool::new(false),
            ws_tx,
            shell_cmd_tx: RwLock::new(None),
            nav_tx: RwLock::new(None),
            db_path: RwLock::new(None),
            wallpapers_dir: RwLock::new(crate::config::default_wallpapers_dir()),
            port: RwLock::new(9000),
            audio,
            mediathek: Arc::new(MediathekProvider::new()),
            youtube: RwLock::new(Arc::new(YouTubeProvider::new("https://pipedapi.kavin.rocks"))),
            youtube_auth: RwLock::new(None),
            youtube_auth_seq: AtomicU64::new(1),
            local_media: RwLock::new(Arc::new(LocalMediaProvider::new(Vec::new()))),
        })
    }

    pub fn attach_db_path(&self, path: PathBuf) {
        if let Ok(db) = crate::db::Database::open(&path) {
            if let Ok(Some(raw)) = db.get_setting("keymap")
                && let Ok(parsed) = serde_json::from_str::<KeymapConfig>(&raw)
                && let Ok(mut guard) = self.keymap.write()
            {
                *guard = parsed.normalized();
            }
            let active_id = self
                .state
                .read()
                .ok()
                .and_then(|s| s.active_profile.as_ref().map(|p| p.id));
            if let Some(pid) = active_id {
                let summary = db
                    .get_youtube_account(pid)
                    .ok()
                    .flatten()
                    .map(|a| YouTubeAccountSummary::from(&a));
                let cw = db.list_continue_watching(pid, 20).ok();
                if let Ok(mut st) = self.state.write() {
                    st.youtube_account = summary;
                    if let Some(entries) = cw {
                        st.continue_watching = entries;
                    }
                }
            }
        }
        if let Ok(mut guard) = self.db_path.write() {
            *guard = Some(path);
        }
    }

    pub fn set_youtube_provider(&self, provider: Arc<YouTubeProvider>) {
        if let Ok(mut guard) = self.youtube.write() {
            *guard = provider;
        }
    }

    pub fn sync_active_profile_from_db(&self) {
        let db_path = self.db_path.read().ok().and_then(|g| g.clone());
        let Some(path) = db_path else {
            return;
        };
        let active_id = self
            .state
            .read()
            .ok()
            .and_then(|s| s.active_profile.as_ref().map(|p| p.id));
        let Some(pid) = active_id else {
            return;
        };
        if let Ok(db) = crate::db::Database::open(&path) {
            let summary = db
                .get_youtube_account(pid)
                .ok()
                .flatten()
                .map(|a| YouTubeAccountSummary::from(&a));
            let cw = db.list_continue_watching(pid, 20).ok();
            if let Ok(mut st) = self.state.write() {
                st.youtube_account = summary;
                if let Some(entries) = cw {
                    st.continue_watching = entries;
                }
            }
        }
    }

    pub async fn active_youtube_account(&self) -> Option<YouTubeAccount> {
        let db_path = self.db_path.read().ok().and_then(|g| g.clone())?;
        let profile_id = self
            .state
            .read()
            .ok()
            .and_then(|s| s.active_profile.as_ref().map(|p| p.id))?;
        let account = crate::db::Database::open(&db_path)
            .ok()
            .and_then(|db| db.get_youtube_account(profile_id).ok().flatten())?;
        let yt = self.youtube.read().ok().map(|g| g.clone())?;
        match yt
            .ensure_valid_token(Some(db_path.as_path()), profile_id, account.clone())
            .await
        {
            Ok(fresh) => {
                if fresh.expires_at != account.expires_at
                    && let Ok(mut st) = self.state.write()
                    && st.active_profile.as_ref().map(|p| p.id) == Some(profile_id)
                {
                    st.youtube_account = Some(YouTubeAccountSummary::from(&fresh));
                }
                Some(fresh)
            }
            Err(err) => {
                warn!(profile_id, error = %err, "youtube token refresh failed; using stored token");
                Some(account)
            }
        }
    }

    pub fn keymap(&self) -> KeymapConfig {
        self.keymap
            .read()
            .map(|g| g.clone())
            .unwrap_or_default()
    }

    pub fn set_keymap(&self, keymap: KeymapConfig) -> KeymapConfig {
        let normalized = keymap.normalized();
        if let Ok(mut guard) = self.keymap.write() {
            *guard = normalized.clone();
        }
        let db_path = self.db_path.read().ok().and_then(|g| g.clone());
        if let Some(path) = db_path
            && let Ok(db) = crate::db::Database::open(&path)
            && let Ok(json) = serde_json::to_string(&normalized)
        {
            let _ = db.set_setting("keymap", &json);
        }
        normalized
    }

    pub fn is_key_capture(&self) -> bool {
        self.key_capture.load(AtomicOrdering::Relaxed)
    }

    pub fn set_key_capture(&self, active: bool) {
        self.key_capture.store(active, AtomicOrdering::Relaxed);
    }

    pub fn set_muted(&self, muted: bool) {
        let mut changed = false;
        if let Ok(mut guard) = self.state.write()
            && guard.playback.muted != muted
        {
            guard.playback.muted = muted;
            changed = true;
        }
        if changed {
            self.broadcast_state();
        }
    }

    pub fn attach_nav_sender(&self, tx: std::sync::mpsc::Sender<NavEvent>) {
        if let Ok(mut guard) = self.nav_tx.write() {
            *guard = Some(tx);
        }
    }

    pub fn set_wallpapers_dir(&self, dir: PathBuf) {
        if let Ok(mut guard) = self.wallpapers_dir.write() {
            *guard = dir;
        }
    }

    pub fn set_port(&self, port: u16) {
        if let Ok(mut guard) = self.port.write() {
            *guard = port;
        }
    }

    pub fn set_channels(&self, channels: Vec<Channel>) {
        if let Ok(mut guard) = self.state.write() {
            guard.channels = channels;
            let _ = self.ws_tx.send(ServerMessage::StateUpdate {
                state: guard.clone(),
            });
        }
    }

    pub fn set_profiles(&self, profiles: Vec<Profile>) {
        if let Ok(mut guard) = self.state.write() {
            if let Some(active) = &guard.active_profile
                && let Some(updated) = profiles.iter().find(|p| p.id == active.id)
            {
                guard.active_profile = Some(updated.clone());
            }
            guard.profiles = profiles;
            let _ = self.ws_tx.send(ServerMessage::StateUpdate {
                state: guard.clone(),
            });
        }
    }

    pub fn set_providers(&self, piped_url: String, media_dirs: Vec<std::path::PathBuf>) {
        if let Ok(mut guard) = self.youtube.write() {
            *guard = Arc::new(YouTubeProvider::new(piped_url));
        }
        if let Ok(mut guard) = self.local_media.write() {
            *guard = Arc::new(LocalMediaProvider::new(media_dirs));
        }
    }

    pub fn set_continue_watching(&self, entries: Vec<WatchHistoryEntry>) {
        if let Ok(mut guard) = self.state.write() {
            guard.continue_watching = entries;
        }
        self.broadcast_state();
    }

    pub fn update_playback_progress(&self, position_sec: f64, duration_sec: f64, paused: bool) {
        let mut changed = false;
        if let Ok(mut guard) = self.state.write()
            && ((guard.playback.position_sec - position_sec).abs() >= 0.5
                || (guard.playback.duration_sec - duration_sec).abs() >= 0.5
                || guard.playback.paused != paused)
        {
            guard.playback.position_sec = position_sec;
            guard.playback.duration_sec = duration_sec;
            guard.playback.paused = paused;
            changed = true;
        }
        if changed {
            self.broadcast_state();
        }
    }

    pub fn clear_zapping(&self) {
        let mut changed = false;
        if let Ok(mut guard) = self.state.write()
            && guard.playback.is_zapping
        {
            guard.playback.is_zapping = false;
            changed = true;
        }
        if changed {
            self.broadcast_state();
        }
    }

    pub fn attach_shell_sender(&self, tx: std::sync::mpsc::Sender<ShellCommand>) {
        if let Ok(mut guard) = self.shell_cmd_tx.write() {
            *guard = Some(tx);
        }
    }

    pub fn snapshot(&self) -> MelangeState {
        self.state.read().expect("state lock").clone()
    }

    pub fn epg_entries(&self) -> Vec<EpgEntry> {
        self.epg_entries.read().expect("epg lock").clone()
    }

    pub fn subscribe(&self) -> broadcast::Receiver<ServerMessage> {
        self.ws_tx.subscribe()
    }

    pub fn set_mode(&self, mode: AppMode) {
        let leave_res = {
            let mut st = self.state.write().expect("state lock");
            let res = clear_playback_on_exit(&mut st, mode);
            st.mode = mode;
            st.overlay = OverlayKind::None;
            res
        };
        self.persist_pending_progress(leave_res.pending_progress);
        self.broadcast_state();
        if leave_res.stopped {
            self.send_shell_command(ShellCommand::StopPlayback);
        }
    }

    fn persist_pending_progress(&self, pending: Option<(i64, MediaItem, f64, f64)>) {
        let Some((profile_id, item, pos, dur)) = pending else {
            return;
        };
        let db_path = self.db_path.read().ok().and_then(|g| g.clone());
        if let Some(path) = db_path
            && let Ok(db) = crate::db::Database::open(&path)
            && db.upsert_watch_progress(profile_id, &item, pos, dur).is_ok()
            && let Ok(entries) = db.list_continue_watching(profile_id, 20)
            && let Ok(mut st) = self.state.write()
        {
            st.continue_watching = entries;
        }
    }

    pub fn set_overlay(&self, overlay: OverlayKind) {
        {
            let mut st = self.state.write().expect("state lock");
            st.overlay = overlay;
        }
        self.broadcast_state();
    }

    pub fn set_fullscreen(&self, is_fullscreen: bool) {
        let mut changed = false;
        {
            let mut st = self.state.write().expect("state lock");
            if st.is_fullscreen != is_fullscreen {
                st.is_fullscreen = is_fullscreen;
                changed = true;
            }
        }
        if changed {
            self.broadcast_state();
        }
    }

    pub fn handle_nav_event(&self, event: NavEvent) {
        let _ = self.ws_tx.send(ServerMessage::NavEvent { event });

        let mut changed = false;
        let mut leave_res = LeaveLiveTvResult {
            stopped: false,
            pending_progress: None,
        };
        {
            let mut st = self.state.write().expect("state lock");
            match event {
                NavEvent::ToggleEpg => {
                    st.overlay = if st.overlay == OverlayKind::FullEpg {
                        OverlayKind::None
                    } else {
                        OverlayKind::FullEpg
                    };
                    changed = true;
                }
                NavEvent::ToggleOsd if st.mode == AppMode::LiveTv => {
                    st.overlay = match st.overlay {
                        OverlayKind::PlayerOsd | OverlayKind::ZapBanner => OverlayKind::None,
                        OverlayKind::None => {
                            if st.playback.current_media.is_some() {
                                OverlayKind::PlayerOsd
                            } else {
                                OverlayKind::ZapBanner
                            }
                        }
                        other => other,
                    };
                    changed = true;
                }
                NavEvent::Home => {
                    let next_mode = if st.mode == AppMode::Home {
                        AppMode::LiveTv
                    } else {
                        AppMode::Home
                    };
                    leave_res = clear_playback_on_exit(&mut st, next_mode);
                    st.mode = next_mode;
                    st.overlay = OverlayKind::None;
                    changed = true;
                }
                NavEvent::ChannelUp | NavEvent::ChannelDown | NavEvent::Digit(_) => {
                    st.mode = AppMode::LiveTv;
                    st.overlay = OverlayKind::ZapBanner;
                    changed = true;
                }
                NavEvent::Back if st.overlay != OverlayKind::None => {
                    st.overlay = OverlayKind::None;
                    changed = true;
                }
                NavEvent::Back if st.mode != AppMode::Home => {
                    leave_res = clear_playback_on_exit(&mut st, AppMode::Home);
                    st.mode = AppMode::Home;
                    changed = true;
                }
                NavEvent::Back => {
                    st.overlay = OverlayKind::LeaveMenu;
                    changed = true;
                }
                _ => {}
            }
        }

        self.persist_pending_progress(leave_res.pending_progress);
        if changed {
            self.broadcast_state();
        }
        if leave_res.stopped {
            self.send_shell_command(ShellCommand::StopPlayback);
        }
    }

    pub fn handle_key_action(&self, action: KeyAction) {
        match action {
            KeyAction::OpenSettings => {
                self.audio.play(SoundKind::Select);
                self.apply_client_command(ClientCommand::SetMode {
                    mode: AppMode::Settings,
                });
            }
            KeyAction::OpenHome => {
                self.audio.play(SoundKind::Select);
                self.apply_client_command(ClientCommand::SetMode {
                    mode: AppMode::Home,
                });
            }
            KeyAction::OpenLiveTv => {
                let channel_id = {
                    let st = self.state.read().expect("state lock");
                    st.playback
                        .channel_id
                        .or_else(|| st.channels.first().map(|c| c.id))
                };
                if let Some(channel_id) = channel_id {
                    self.apply_client_command(ClientCommand::SelectChannel { channel_id });
                } else {
                    self.audio.play(SoundKind::Select);
                    self.apply_client_command(ClientCommand::SetMode {
                        mode: AppMode::LiveTv,
                    });
                }
            }
            KeyAction::OpenMediathek => {
                self.audio.play(SoundKind::Select);
                self.apply_client_command(ClientCommand::SetMode {
                    mode: AppMode::Mediathek,
                });
            }
            KeyAction::OpenYouTube => {
                self.audio.play(SoundKind::Select);
                self.apply_client_command(ClientCommand::SetMode {
                    mode: AppMode::YouTube,
                });
            }
            KeyAction::OpenSearch => {
                let can_search = {
                    let st = self.state.read().expect("state lock");
                    matches!(st.mode, AppMode::Mediathek | AppMode::YouTube)
                };
                if can_search {
                    self.audio.play(SoundKind::Select);
                    self.apply_client_command(ClientCommand::SetOverlay {
                        overlay: OverlayKind::SearchKeyboard,
                    });
                }
            }
            _ => {}
        }
    }

    pub fn apply_client_command(&self, cmd: ClientCommand) {
        match cmd {
            ClientCommand::SelectChannel { channel_id } => {
                let mut found = false;
                {
                    let mut st = self.state.write().expect("state lock");
                    if let Some(ch) = st.channels.iter().find(|c| c.id == channel_id).cloned() {
                        let subtitle = st
                            .epg_now_next
                            .get(&ch.tvg_id)
                            .and_then(|e| e.now.as_ref())
                            .map(|n| n.title.clone());
                        st.mode = AppMode::LiveTv;
                        st.overlay = OverlayKind::ZapBanner;
                        st.playback.channel_id = Some(ch.id);
                        st.playback.channel_number = Some(ch.number);
                        st.playback.title = Some(ch.name);
                        st.playback.subtitle = subtitle;
                        st.playback.current_media = None;
                        st.playback.paused = false;
                        st.playback.state = PlaybackState::Buffering;
                        st.playback.is_zapping = true;
                        found = true;
                    }
                }
                if found {
                    self.audio.play(SoundKind::Zap);
                    self.broadcast_state();
                    self.send_shell_command(ShellCommand::SelectChannel { channel_id });
                }
            }
            ClientCommand::SetMode { mode } => {
                let leave_res = {
                    let mut st = self.state.write().expect("state lock");
                    let res = clear_playback_on_exit(&mut st, mode);
                    st.mode = mode;
                    st.overlay = OverlayKind::None;
                    res
                };
                self.persist_pending_progress(leave_res.pending_progress);
                self.broadcast_state();
                if leave_res.stopped {
                    self.send_shell_command(ShellCommand::StopPlayback);
                }
                self.send_shell_command(ShellCommand::SetMode { mode });
            }
            ClientCommand::SetOverlay { overlay } => {
                {
                    let mut st = self.state.write().expect("state lock");
                    st.overlay = overlay;
                }
                self.broadcast_state();
                self.send_shell_command(ShellCommand::SetOverlay { overlay });
            }
            ClientCommand::SelectProfile { profile_id } => {
                let mut changed = false;
                {
                    let mut st = self.state.write().expect("state lock");
                    if let Some(profile) = st.profiles.iter().find(|p| p.id == profile_id).cloned()
                    {
                        st.active_profile = Some(profile);
                        st.overlay = OverlayKind::None;
                        changed = true;
                    }
                }
                if changed {
                    self.sync_active_profile_from_db();
                    self.audio.play(SoundKind::Select);
                    self.broadcast_state();
                }
            }
            ClientCommand::SetPresetWallpaper {
                profile_id,
                filename,
            } => {
                let Some(clean_name) = Path::new(&filename)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .map(str::trim)
                    .filter(|n| !n.is_empty() && !n.contains('/') && !n.contains('\\'))
                    .map(ToString::to_string)
                else {
                    return;
                };
                let public_path = format!("/wallpapers/{clean_name}");

                let db_path = self.db_path.read().ok().and_then(|g| g.clone());
                let mut updated = false;
                if let Some(path) = db_path {
                    if let Ok(db) = crate::db::Database::open(&path)
                        && db.set_profile_wallpaper(profile_id, &public_path).is_ok()
                        && let Ok(profiles) = db.list_profiles()
                    {
                        self.set_profiles(profiles);
                        updated = true;
                    }
                } else {
                    {
                        let mut st = self.state.write().expect("state lock");
                        let updated_profile =
                            st.profiles.iter_mut().find(|p| p.id == profile_id).map(|profile| {
                                profile.wallpaper_path = Some(public_path);
                                profile.clone()
                            });
                        if let Some(profile) = updated_profile {
                            if st.active_profile.as_ref().map(|a| a.id) == Some(profile_id) {
                                st.active_profile = Some(profile);
                            }
                            updated = true;
                        }
                    }
                    if updated {
                        self.broadcast_state();
                    }
                }

                if updated {
                    self.audio.play(SoundKind::Select);
                }
            }
            ClientCommand::PlaySound { sound } => {
                self.audio.play(sound);
            }
            ClientCommand::PlayMedia { item, resume } => {
                let start_position_sec = if resume {
                    let st = self.state.read().expect("state lock");
                    st.continue_watching
                        .iter()
                        .find(|e| e.item_id == item.id)
                        .map(|e| e.position_sec)
                        .unwrap_or(0.0)
                } else {
                    0.0
                };
                {
                    let mut st = self.state.write().expect("state lock");
                    st.mode = AppMode::LiveTv;
                    st.overlay = OverlayKind::PlayerOsd;
                    st.playback.state = PlaybackState::Playing;
                    st.playback.title = Some(item.title.clone());
                    st.playback.subtitle = item
                        .subtitle
                        .clone()
                        .or_else(|| Some(item.channel_or_author.clone()));
                    st.playback.channel_id = None;
                    st.playback.channel_number = None;
                    st.playback.current_media = Some(item.clone());
                    st.playback.position_sec = start_position_sec;
                    st.playback.duration_sec = item.duration_sec as f64;
                    st.playback.paused = false;
                    st.playback.is_zapping = false;
                }
                self.audio.play(SoundKind::Select);
                self.broadcast_state();
                self.send_shell_command(ShellCommand::PlayMedia {
                    item,
                    start_position_sec,
                });
            }
            ClientCommand::SeekRelative { offset_sec } => {
                self.send_shell_command(ShellCommand::SeekRelative { offset_sec });
            }
            ClientCommand::TogglePause => {
                {
                    let mut st = self.state.write().expect("state lock");
                    st.playback.paused = !st.playback.paused;
                }
                self.broadcast_state();
                self.send_shell_command(ShellCommand::TogglePause);
            }
            ClientCommand::ToggleFullscreen => {
                let has_shell = self
                    .shell_cmd_tx
                    .read()
                    .map(|g| g.is_some())
                    .unwrap_or(false);
                if has_shell {
                    self.send_shell_command(ShellCommand::ToggleFullscreen);
                } else {
                    {
                        let mut st = self.state.write().expect("state lock");
                        st.is_fullscreen = !st.is_fullscreen;
                    }
                    self.broadcast_state();
                }
            }
            ClientCommand::SetKeyCapture { active } => {
                self.set_key_capture(active);
            }
            ClientCommand::QuitApp => {
                self.send_shell_command(ShellCommand::QuitApp);
            }
        }
    }

    pub fn sync_player_state(
        &self,
        channel: Option<&Channel>,
        playback_state: PlaybackState,
        is_zapping: bool,
        digit_buffer: &str,
        position_sec: f64,
        duration_sec: f64,
    ) {
        let mut changed = false;
        {
            let mut st = self.state.write().expect("state lock");
            let next_channel_id = channel.map(|c| c.id);
            let next_channel_number = channel.map(|c| c.number);
            let next_title = channel.map(|c| c.name.clone());
            let next_subtitle = channel.and_then(|c| {
                st.epg_now_next
                    .get(&c.tvg_id)
                    .and_then(|e| e.now.as_ref())
                    .map(|n| n.title.clone())
            });

            let next_playback = PlaybackSnapshot {
                state: playback_state,
                title: next_title,
                subtitle: next_subtitle,
                channel_id: next_channel_id,
                channel_number: next_channel_number,
                current_media: None,
                position_sec,
                duration_sec,
                paused: false,
                muted: st.playback.muted,
                is_zapping,
            };

            if st.playback != next_playback || st.digit_buffer != digit_buffer {
                st.playback = next_playback;
                st.digit_buffer = digit_buffer.to_string();
                changed = true;
            }
        }

        if changed {
            self.broadcast_state();
        }
    }

    fn broadcast_state(&self) {
        let snapshot = self.snapshot();
        let _ = self
            .ws_tx
            .send(ServerMessage::StateUpdate { state: snapshot });
    }

    fn send_shell_command(&self, cmd: ShellCommand) {
        if let Ok(guard) = self.shell_cmd_tx.read()
            && let Some(tx) = guard.as_ref()
        {
            let _ = tx.send(cmd);
        }
    }
}

pub fn build_router(state: Arc<StateManager>, ui_dist_dir: &Path) -> Router {
    let wallpapers_dir = state
        .wallpapers_dir
        .read()
        .map(|g| g.clone())
        .unwrap_or_else(|_| crate::config::default_wallpapers_dir());

    let api_router = Router::new()
        .route("/api/health", get(health_handler))
        .route("/api/companion/info", get(companion_info_handler))
        .route("/api/wallpapers", get(wallpapers_list_handler))
        .route(
            "/api/keymap",
            get(get_keymap_handler)
                .post(update_keymap_handler)
                .put(update_keymap_handler),
        )
        .route("/api/channels", get(channels_handler))
        .route("/api/channels/reorder", post(reorder_channels_handler))
        .route("/api/channels/{id}/favorite", post(toggle_favorite_handler))
        .route("/api/epg", get(epg_handler))
        .route("/api/profiles", get(profiles_handler).post(create_profile_handler))
        .route("/api/profiles/{id}", patch(update_profile_handler))
        .route("/api/profiles/{id}/wallpaper", post(upload_wallpaper_handler))
        .route("/api/remote/nav", post(remote_nav_handler))
        .route("/api/ondemand/feed", get(ondemand_feed_handler))
        .route("/api/ondemand/search", get(ondemand_search_handler))
        .route("/api/youtube/feed", get(youtube_feed_handler))
        .route("/api/youtube/auth/start", post(youtube_auth_start_handler))
        .route("/api/youtube/auth/status", get(youtube_auth_status_handler))
        .route("/api/youtube/auth/logout", post(youtube_auth_logout_handler))
        .route("/api/continue-watching", get(continue_watching_handler))
        .route("/ws", get(ws_handler))
        .with_state(state);

    let ui_dist_dir = ui_dist_dir.to_path_buf();
    let wallpapers_service = ServeDir::new(wallpapers_dir);

    api_router
        .route("/companion", get(companion_index_handler))
        .route("/companion/", get(companion_index_handler))
        .route("/companion/{*path}", get(companion_asset_handler))
        .nest_service("/wallpapers", wallpapers_service)
        .fallback(move |uri: axum::http::Uri| {
            let ui_dir = ui_dist_dir.clone();
            async move { serve_embedded_or_disk::<EmbeddedUi>(Some(&ui_dir), uri.path(), true).await }
        })
        .layer(CorsLayer::permissive())
}

fn resolve_companion_dist_dir() -> Option<PathBuf> {
    for candidate in ["companion/dist", "../companion/dist", "../../companion/dist"] {
        let path = PathBuf::from(candidate);
        if path.is_dir() {
            return Some(path);
        }
    }
    None
}

async fn companion_index_handler() -> impl IntoResponse {
    let dir = resolve_companion_dist_dir();
    serve_embedded_or_disk::<EmbeddedCompanion>(dir.as_deref(), "index.html", true).await
}

async fn companion_asset_handler(
    axum::extract::Path(path): axum::extract::Path<String>,
) -> impl IntoResponse {
    let dir = resolve_companion_dist_dir();
    serve_embedded_or_disk::<EmbeddedCompanion>(dir.as_deref(), &path, true).await
}

pub async fn serve_on_listener(
    listener: TcpListener,
    state: Arc<StateManager>,
    ui_dist_dir: &Path,
) -> Result<(), MelangeError> {
    let app = build_router(state, ui_dist_dir);
    axum::serve(listener, app)
        .await
        .map_err(|e| MelangeError::Io(std::io::Error::other(e)))
}

pub fn spawn_server_thread(
    port: u16,
    state: Arc<StateManager>,
    ui_dist_dir: std::path::PathBuf,
) -> Result<std::thread::JoinHandle<()>, MelangeError> {
    let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel::<Result<SocketAddr, String>>(1);

    let handle = std::thread::Builder::new()
        .name("melange-http".to_string())
        .spawn(move || {
            let rt = match tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(err) => {
                    let _ = ready_tx.send(Err(format!("tokio runtime init failed: {err}")));
                    return;
                }
            };

            rt.block_on(async move {
                let addr = match std::env::var("MELANGE_BIND_ADDR") {
                    Ok(raw) if !raw.trim().is_empty() => match raw.trim().parse::<SocketAddr>() {
                        Ok(parsed) => SocketAddr::new(parsed.ip(), port),
                        Err(err) => {
                            let _ = ready_tx
                                .send(Err(format!("invalid MELANGE_BIND_ADDR '{raw}': {err}")));
                            return;
                        }
                    },
                    _ => SocketAddr::from(([127, 0, 0, 1], port)),
                };
                let listener = match TcpListener::bind(addr).await {
                    Ok(l) => l,
                    Err(err) => {
                        let _ = ready_tx.send(Err(format!("bind {addr} failed: {err}")));
                        return;
                    }
                };
                let bound_addr = listener.local_addr().unwrap_or(addr);
                state.set_port(bound_addr.port());
                info!(addr = %bound_addr, "melange axum server listening");
                let _ = ready_tx.send(Ok(bound_addr));

                if let Err(err) = serve_on_listener(listener, state, &ui_dist_dir).await {
                    warn!(error = %err, "axum server exited with error");
                }
            });
        })?;

    match ready_rx.recv() {
        Ok(Ok(_)) => Ok(handle),
        Ok(Err(msg)) => Err(MelangeError::Config(msg)),
        Err(err) => Err(MelangeError::Config(format!(
            "server startup channel failed: {err}"
        ))),
    }
}

async fn health_handler() -> impl IntoResponse {
    Json(serde_json::json!({ "status": "ok", "service": "melange-core" }))
}

fn natural_cmp(a: &str, b: &str) -> Ordering {
    let mut ai = a.char_indices().peekable();
    let mut bi = b.char_indices().peekable();

    while let (Some(&(a_idx, ac)), Some(&(b_idx, bc))) = (ai.peek(), bi.peek()) {
        if ac.is_ascii_digit() && bc.is_ascii_digit() {
            let mut a_end = a_idx;
            while let Some(&(idx, ch)) = ai.peek() {
                if ch.is_ascii_digit() {
                    a_end = idx + ch.len_utf8();
                    ai.next();
                } else {
                    break;
                }
            }
            let mut b_end = b_idx;
            while let Some(&(idx, ch)) = bi.peek() {
                if ch.is_ascii_digit() {
                    b_end = idx + ch.len_utf8();
                    bi.next();
                } else {
                    break;
                }
            }
            let a_num = a[a_idx..a_end].parse::<u64>().unwrap_or(0);
            let b_num = b[b_idx..b_end].parse::<u64>().unwrap_or(0);
            match a_num.cmp(&b_num) {
                Ordering::Equal => {
                    // Tie-break shorter zero-padded run first (e.g. "2" before "02")
                    match (a_end - a_idx).cmp(&(b_end - b_idx)) {
                        Ordering::Equal => continue,
                        non_eq => return non_eq,
                    }
                }
                non_eq => return non_eq,
            }
        } else {
            let al = ac.to_ascii_lowercase();
            let bl = bc.to_ascii_lowercase();
            match al.cmp(&bl) {
                Ordering::Equal => {
                    ai.next();
                    bi.next();
                }
                non_eq => return non_eq,
            }
        }
    }

    ai.peek()
        .is_some()
        .cmp(&bi.peek().is_some())
        .then_with(|| a.cmp(b))
}

async fn wallpapers_list_handler(State(state): State<Arc<StateManager>>) -> impl IntoResponse {
    let wallpapers_dir = state
        .wallpapers_dir
        .read()
        .map(|g| g.clone())
        .unwrap_or_else(|_| crate::config::default_wallpapers_dir());

    let mut files: Vec<String> = Vec::new();
    if let Ok(mut entries) = tokio::fs::read_dir(&wallpapers_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if name.starts_with("profile_") {
                continue;
            }
            let is_image = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_ascii_lowercase())
                .is_some_and(|e| matches!(e.as_str(), "jpg" | "jpeg" | "png" | "webp"));
            if is_image {
                files.push(name.to_string());
            }
        }
    }

    files.sort_by(|a, b| natural_cmp(a, b));

    Json(files)
}

async fn get_keymap_handler(State(state): State<Arc<StateManager>>) -> impl IntoResponse {
    Json(state.keymap())
}

async fn update_keymap_handler(
    State(state): State<Arc<StateManager>>,
    Json(payload): Json<KeymapConfig>,
) -> impl IntoResponse {
    let saved = state.set_keymap(payload);
    Json(saved)
}

async fn channels_handler(State(state): State<Arc<StateManager>>) -> impl IntoResponse {
    Json(state.snapshot().channels)
}

async fn epg_handler(State(state): State<Arc<StateManager>>) -> impl IntoResponse {
    Json(state.epg_entries())
}

async fn profiles_handler(State(state): State<Arc<StateManager>>) -> impl IntoResponse {
    Json(state.snapshot().profiles)
}

#[derive(Deserialize)]
struct OnDemandFeedQuery {
    provider: String,
}

#[derive(Deserialize)]
struct OnDemandSearchQuery {
    provider: String,
    #[serde(default)]
    q: String,
}

#[derive(Deserialize)]
struct YouTubeFeedQuery {
    #[serde(default = "default_yt_tab")]
    tab: String,
    #[serde(default)]
    channel_id: String,
}

fn default_yt_tab() -> String {
    "foryou".to_string()
}

#[derive(Deserialize, Default)]
struct YouTubeAuthStartRequest {
    #[serde(default)]
    profile_id: Option<i64>,
}

fn render_qr_svg(url: &str) -> String {
    QrCode::new(url.as_bytes())
        .map(|code| {
            code.render::<svg::Color>()
                .min_dimensions(200, 200)
                .dark_color(svg::Color("#000000"))
                .light_color(svg::Color("#ffffff"))
                .build()
        })
        .unwrap_or_default()
}

async fn youtube_auth_start_handler(
    State(state): State<Arc<StateManager>>,
    payload: Option<Json<YouTubeAuthStartRequest>>,
) -> impl IntoResponse {
    let profile_id = payload
        .and_then(|p| p.profile_id)
        .or_else(|| {
            state
                .snapshot()
                .active_profile
                .map(|p| p.id)
        })
        .unwrap_or(1);

    let yt = state.youtube.read().expect("youtube lock").clone();
    let dev = match yt.start_device_auth().await {
        Ok(d) => d,
        Err(err) => {
            warn!(error = %err, "youtube device auth start failed");
            return (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({ "error": err.to_string() })),
            )
                .into_response();
        }
    };

    let qr_svg = render_qr_svg(&dev.verification_url);
    let session_id = state
        .youtube_auth_seq
        .fetch_add(1, AtomicOrdering::Relaxed);
    let expires_at = now_unix_secs() + dev.expires_in;

    let session = YouTubeAuthSessionState {
        session_id,
        profile_id,
        status: "Pending".to_string(),
        user_code: dev.user_code.clone(),
        verification_url: dev.verification_url.clone(),
        qr_svg: qr_svg.clone(),
        expires_at,
        error: None,
    };

    if let Ok(mut guard) = state.youtube_auth.write() {
        *guard = Some(session);
    }

    // Spawn background polling task for this device_code session
    let state_bg = Arc::clone(&state);
    let yt_bg = Arc::clone(&yt);
    let device_code = dev.device_code.clone();
    let mut poll_interval = dev.interval.max(1) as u64;

    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(poll_interval)).await;

            // Abort if superseded or cancelled
            let still_active = state_bg
                .youtube_auth
                .read()
                .ok()
                .and_then(|g| g.as_ref().map(|s| s.session_id == session_id && s.status == "Pending"))
                .unwrap_or(false);
            if !still_active {
                break;
            }

            if now_unix_secs() >= expires_at {
                if let Ok(mut guard) = state_bg.youtube_auth.write()
                    && let Some(ref mut s) = *guard
                    && s.session_id == session_id
                {
                    s.status = "Expired".to_string();
                }
                break;
            }

            match yt_bg.poll_device_token(&device_code).await {
                Ok(TokenPollOutcome::Pending) => continue,
                Ok(TokenPollOutcome::SlowDown) => {
                    poll_interval = poll_interval.saturating_add(5);
                    continue;
                }
                Ok(TokenPollOutcome::Expired) => {
                    if let Ok(mut guard) = state_bg.youtube_auth.write()
                        && let Some(ref mut s) = *guard
                        && s.session_id == session_id
                    {
                        s.status = "Expired".to_string();
                    }
                    break;
                }
                Ok(TokenPollOutcome::Denied) => {
                    if let Ok(mut guard) = state_bg.youtube_auth.write()
                        && let Some(ref mut s) = *guard
                        && s.session_id == session_id
                    {
                        s.status = "Denied".to_string();
                        s.error = Some("Authorization denied".to_string());
                    }
                    break;
                }
                Ok(TokenPollOutcome::Failed(msg)) => {
                    if let Ok(mut guard) = state_bg.youtube_auth.write()
                        && let Some(ref mut s) = *guard
                        && s.session_id == session_id
                    {
                        s.status = "Error".to_string();
                        s.error = Some(msg);
                    }
                    break;
                }
                Ok(TokenPollOutcome::Authorized(tok)) => {
                    let (account_name, account_avatar_url) = yt_bg
                        .fetch_account_info(&tok.access_token)
                        .await
                        .unwrap_or_else(|_| ("YouTube Account".to_string(), None));

                    let account = YouTubeAccount {
                        profile_id,
                        access_token: tok.access_token,
                        refresh_token: tok.refresh_token.unwrap_or_default(),
                        expires_at: now_unix_secs() + tok.expires_in.max(60),
                        account_name,
                        account_avatar_url,
                        updated_at: String::new(),
                    };

                    let db_path = state_bg.db_path.read().ok().and_then(|g| g.clone());
                    if let Some(path) = db_path
                        && let Ok(db) = crate::db::Database::open(&path)
                        && let Err(err) = db.upsert_youtube_account(&account)
                    {
                        warn!(error = %err, "failed to persist youtube account");
                    }

                    let summary = YouTubeAccountSummary::from(&account);
                    if let Ok(mut guard) = state_bg.youtube_auth.write()
                        && let Some(ref mut s) = *guard
                        && s.session_id == session_id
                    {
                        s.status = "Authorized".to_string();
                    }

                    let mut broadcast_needed = false;
                    if let Ok(mut st) = state_bg.state.write()
                        && st.active_profile.as_ref().map(|p| p.id) == Some(profile_id)
                    {
                        st.youtube_account = Some(summary);
                        broadcast_needed = true;
                    }
                    if broadcast_needed {
                        state_bg.broadcast_state();
                    }
                    break;
                }
                Err(err) => {
                    warn!(error = %err, "youtube token poll transport error");
                }
            }
        }
    });

    Json(serde_json::json!({
        "session_id": session_id,
        "profile_id": profile_id,
        "user_code": dev.user_code,
        "verification_url": dev.verification_url,
        "qr_svg": qr_svg,
        "expires_in": dev.expires_in,
        "interval": dev.interval,
    }))
    .into_response()
}

async fn youtube_auth_status_handler(State(state): State<Arc<StateManager>>) -> impl IntoResponse {
    let snap = state.snapshot();
    let session = state.youtube_auth.read().ok().and_then(|g| g.clone());
    let status = session
        .as_ref()
        .map(|s| s.status.clone())
        .unwrap_or_else(|| {
            if snap.youtube_account.as_ref().is_some_and(|a| a.signed_in) {
                "Authorized".to_string()
            } else {
                "Idle".to_string()
            }
        });

    Json(serde_json::json!({
        "status": status,
        "account": snap.youtube_account,
        "user_code": session.as_ref().map(|s| s.user_code.clone()),
        "verification_url": session.as_ref().map(|s| s.verification_url.clone()),
        "error": session.and_then(|s| s.error),
    }))
}

async fn youtube_auth_logout_handler(State(state): State<Arc<StateManager>>) -> impl IntoResponse {
    let profile_id = state
        .snapshot()
        .active_profile
        .map(|p| p.id)
        .unwrap_or(1);

    if let Ok(mut guard) = state.youtube_auth.write() {
        *guard = None;
    }

    let db_path = state.db_path.read().ok().and_then(|g| g.clone());
    if let Some(path) = db_path
        && let Ok(db) = crate::db::Database::open(&path)
        && let Err(err) = db.delete_youtube_account(profile_id)
    {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": err.to_string() })),
        )
            .into_response();
    }

    if let Ok(mut st) = state.state.write()
        && st.active_profile.as_ref().map(|p| p.id) == Some(profile_id)
    {
        st.youtube_account = None;
    }
    state.broadcast_state();

    Json(serde_json::json!({ "ok": true })).into_response()
}

async fn youtube_feed_handler(
    State(state): State<Arc<StateManager>>,
    Query(params): Query<YouTubeFeedQuery>,
) -> impl IntoResponse {
    let tab = match params.tab.trim().to_ascii_lowercase().as_str() {
        "subscriptions" | "subs" => YouTubeFeedTab::Subscriptions,
        "history" => YouTubeFeedTab::History,
        "channel" => YouTubeFeedTab::Channel(params.channel_id.clone()),
        _ => YouTubeFeedTab::ForYou,
    };

    let account = state.active_youtube_account().await;
    let local_history = state.snapshot().continue_watching;
    let yt = state.youtube.read().expect("youtube lock").clone();

    match yt
        .fetch_feed_with_account(tab, account.as_ref(), &local_history)
        .await
    {
        Ok(resp) => Json(resp).into_response(),
        Err(err) => {
            warn!(tab = %params.tab, error = %err, "youtube feed failed");
            (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({ "error": err.to_string() })),
            )
                .into_response()
        }
    }
}

async fn ondemand_feed_handler(
    State(state): State<Arc<StateManager>>,
    Query(params): Query<OnDemandFeedQuery>,
) -> impl IntoResponse {
    let result = match params.provider.as_str() {
        "mediathek" => state.mediathek.feed().await,
        "youtube" => {
            let account = state.active_youtube_account().await;
            let local_history = state.snapshot().continue_watching;
            let yt = state.youtube.read().expect("youtube lock").clone();
            yt.fetch_feed_with_account(YouTubeFeedTab::ForYou, account.as_ref(), &local_history)
                .await
                .map(|r| r.items)
        }
        "local" => {
            let local = state.local_media.read().expect("local lock").clone();
            local.feed().await
        }
        _ => Ok(Vec::new()),
    };
    match result {
        Ok(items) => Json(items).into_response(),
        Err(err) => {
            warn!(provider = %params.provider, error = %err, "ondemand feed failed");
            (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({ "error": err.to_string() })),
            )
                .into_response()
        }
    }
}

async fn ondemand_search_handler(
    State(state): State<Arc<StateManager>>,
    Query(params): Query<OnDemandSearchQuery>,
) -> impl IntoResponse {
    let result = match params.provider.as_str() {
        "mediathek" => state.mediathek.search(&params.q).await,
        "youtube" => {
            let account = state.active_youtube_account().await;
            let yt = state.youtube.read().expect("youtube lock").clone();
            yt.search_with_account(&params.q, account.as_ref()).await
        }
        "local" => {
            let local = state.local_media.read().expect("local lock").clone();
            local.search(&params.q).await
        }
        _ => Ok(Vec::new()),
    };
    match result {
        Ok(items) => Json(items).into_response(),
        Err(err) => {
            warn!(provider = %params.provider, query = %params.q, error = %err, "ondemand search failed");
            (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({ "error": err.to_string() })),
            )
                .into_response()
        }
    }
}

async fn continue_watching_handler(
    State(state): State<Arc<StateManager>>,
) -> Json<Vec<WatchHistoryEntry>> {
    Json(state.snapshot().continue_watching)
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<StateManager>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws_connection(socket, state))
}

async fn handle_ws_connection(socket: WebSocket, state: Arc<StateManager>) {
    let (mut sender, mut receiver) = socket.split();
    let mut rx = state.subscribe();

    let initial = ServerMessage::StateSnapshot {
        state: state.snapshot(),
    };
    if let Ok(json) = serde_json::to_string(&initial)
        && sender.send(Message::Text(json.into())).await.is_err()
    {
        return;
    }

    let send_task = tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(msg) => {
                    if let Ok(json) = serde_json::to_string(&msg)
                        && sender.send(Message::Text(json.into())).await.is_err()
                    {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    debug!(skipped, "websocket client lagged");
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    while let Some(Ok(msg)) = receiver.next().await {
        match msg {
            Message::Text(text) => match serde_json::from_str::<ClientCommand>(&text) {
                Ok(cmd) => state.apply_client_command(cmd),
                Err(err) => debug!(error = %err, "ignored malformed ws client command"),
            },
            Message::Close(_) => break,
            _ => {}
        }
    }

    send_task.abort();
}

fn compute_epg_now_next(
    channels: &[Channel],
    entries: &[EpgEntry],
) -> HashMap<String, EpgNowNext> {
    let now_key = current_utc_yyyymmddhhmmss();
    let mut by_channel: HashMap<String, Vec<&EpgEntry>> = HashMap::new();
    for entry in entries {
        by_channel
            .entry(entry.channel_tvg_id.clone())
            .or_default()
            .push(entry);
    }

    let mut result = HashMap::new();
    for ch in channels {
        let mut now: Option<EpgEntry> = None;
        let mut next: Option<EpgEntry> = None;

        if let Some(list) = by_channel.get(&ch.tvg_id) {
            for (idx, item) in list.iter().enumerate() {
                let start = normalize_xmltv_ts(&item.start_time);
                let stop = normalize_xmltv_ts(&item.stop_time);
                if start <= now_key && now_key < stop {
                    now = Some((*item).clone());
                    next = list.get(idx + 1).map(|e| (*e).clone());
                    break;
                }
            }

            if now.is_none() && !list.is_empty() {
                now = Some(list[0].clone());
                next = list.get(1).map(|e| (*e).clone());
            }
        }

        result.insert(
            ch.tvg_id.clone(),
            EpgNowNext {
                channel_tvg_id: ch.tvg_id.clone(),
                now,
                next,
            },
        );
    }

    result
}

fn normalize_xmltv_ts(ts: &str) -> String {
    ts.chars().filter(|c| c.is_ascii_digit()).take(14).collect()
}

fn current_utc_yyyymmddhhmmss() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let hour = rem / 3600;
    let minute = (rem % 3600) / 60;
    let second = rem % 60;
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}{month:02}{day:02}{hour:02}{minute:02}{second:02}")
}

fn civil_from_days(days_since_epoch: i64) -> (i64, i64, i64) {
    // Howard Hinnant's civil-from-days algorithm (UTC).
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if m <= 2 { 1 } else { 0 };
    (year, m, d)
}


#[derive(Serialize)]
struct CompanionInfoResponse {
    url: String,
    qr_svg: String,
}

fn detect_lan_ip() -> String {
    if let Ok(socket) = UdpSocket::bind("0.0.0.0:0")
        && socket.connect("192.0.2.1:80").is_ok()
        && let Ok(addr) = socket.local_addr()
    {
        let ip = addr.ip();
        if !ip.is_loopback() {
            return ip.to_string();
        }
    }
    "127.0.0.1".to_string()
}

async fn companion_info_handler(State(state): State<Arc<StateManager>>) -> impl IntoResponse {
    let port = state.port.read().map(|g| *g).unwrap_or(9000);
    let ip = detect_lan_ip();
    let url = format!("http://{ip}:{port}/companion");
    let qr_svg = QrCode::new(url.as_bytes())
        .map(|code| {
            code.render::<svg::Color>()
                .min_dimensions(200, 200)
                .dark_color(svg::Color("#000000"))
                .light_color(svg::Color("#ffffff"))
                .build()
        })
        .unwrap_or_default();

    Json(CompanionInfoResponse { url, qr_svg })
}

#[derive(Deserialize)]
struct ReorderChannelsRequest {
    channel_ids: Vec<serde_json::Value>,
}

async fn reorder_channels_handler(
    State(state): State<Arc<StateManager>>,
    Json(payload): Json<ReorderChannelsRequest>,
) -> impl IntoResponse {
    let ids: Vec<i64> = payload
        .channel_ids
        .into_iter()
        .filter_map(|v| match v {
            serde_json::Value::Number(n) => n.as_i64(),
            serde_json::Value::String(s) => s.parse::<i64>().ok(),
            _ => None,
        })
        .collect();

    let Some(db_path) = state.db_path.read().ok().and_then(|g| g.clone()) else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "database not configured" })),
        )
            .into_response();
    };

    match crate::db::Database::open(&db_path) {
        Ok(db) => {
            if let Err(err) = db.reorder_channels(&ids) {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": err.to_string() })),
                )
                    .into_response();
            }
            if let Ok(channels) = db.list_channels() {
                state.set_channels(channels);
            }
            Json(serde_json::json!({ "ok": true })).into_response()
        }
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": err.to_string() })),
        )
            .into_response(),
    }
}

async fn toggle_favorite_handler(
    State(state): State<Arc<StateManager>>,
    AxumPath(id): AxumPath<i64>,
) -> impl IntoResponse {
    let Some(db_path) = state.db_path.read().ok().and_then(|g| g.clone()) else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "database not configured" })),
        )
            .into_response();
    };

    match crate::db::Database::open(&db_path) {
        Ok(db) => match db.toggle_channel_favorite(id) {
            Ok(is_favorite) => {
                if let Ok(channels) = db.list_channels() {
                    state.set_channels(channels);
                }
                Json(serde_json::json!({ "ok": true, "is_favorite": is_favorite })).into_response()
            }
            Err(err) => (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": err.to_string() })),
            )
                .into_response(),
        },
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": err.to_string() })),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
struct CreateProfileRequest {
    name: String,
    #[serde(default)]
    avatar: String,
}

async fn create_profile_handler(
    State(state): State<Arc<StateManager>>,
    Json(payload): Json<CreateProfileRequest>,
) -> impl IntoResponse {
    let Some(db_path) = state.db_path.read().ok().and_then(|g| g.clone()) else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "database not configured" })),
        )
            .into_response();
    };

    match crate::db::Database::open(&db_path) {
        Ok(db) => match db.create_profile(payload.name.trim(), payload.avatar.trim()) {
            Ok(profile) => {
                if let Ok(profiles) = db.list_profiles() {
                    state.set_profiles(profiles);
                }
                (StatusCode::CREATED, Json(profile)).into_response()
            }
            Err(err) => (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": err.to_string() })),
            )
                .into_response(),
        },
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": err.to_string() })),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
struct UpdateProfileRequest {
    name: Option<String>,
    avatar: Option<String>,
    wallpaper_path: Option<String>,
}

async fn update_profile_handler(
    State(state): State<Arc<StateManager>>,
    AxumPath(id): AxumPath<i64>,
    Json(payload): Json<UpdateProfileRequest>,
) -> impl IntoResponse {
    let Some(db_path) = state.db_path.read().ok().and_then(|g| g.clone()) else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "database not configured" })),
        )
            .into_response();
    };

    match crate::db::Database::open(&db_path) {
        Ok(db) => match db.update_profile(
            id,
            payload.name.as_deref(),
            payload.avatar.as_deref(),
            payload.wallpaper_path.as_deref(),
        ) {
            Ok(profile) => {
                if let Ok(profiles) = db.list_profiles() {
                    state.set_profiles(profiles);
                }
                Json(profile).into_response()
            }
            Err(err) => (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": err.to_string() })),
            )
                .into_response(),
        },
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": err.to_string() })),
        )
            .into_response(),
    }
}

async fn upload_wallpaper_handler(
    State(state): State<Arc<StateManager>>,
    AxumPath(id): AxumPath<i64>,
    mut multipart: Multipart,
) -> impl IntoResponse {
    let Some(db_path) = state.db_path.read().ok().and_then(|g| g.clone()) else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "database not configured" })),
        )
            .into_response();
    };

    let wallpapers_dir = state
        .wallpapers_dir
        .read()
        .map(|g| g.clone())
        .unwrap_or_else(|_| PathBuf::from("wallpapers"));

    if let Err(err) = tokio::fs::create_dir_all(&wallpapers_dir).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": err.to_string() })),
        )
            .into_response();
    }

    if let Ok(Some(field)) = multipart.next_field().await {
        let filename = field
            .file_name()
            .map(ToString::to_string)
            .unwrap_or_else(|| "wallpaper.png".to_string());
        let ext = Path::new(&filename)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .filter(|e| matches!(e.as_str(), "png" | "jpg" | "jpeg" | "webp"))
            .unwrap_or_else(|| "png".to_string());

        let Ok(bytes) = field.bytes().await else {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "failed to read multipart field" })),
            )
                .into_response();
        };

        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let out_name = format!("profile_{id}_{ts}.{ext}");
        let out_path = wallpapers_dir.join(&out_name);
        if let Err(err) = tokio::fs::write(&out_path, &bytes).await {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": err.to_string() })),
            )
                .into_response();
        }

        let public_path = format!("/wallpapers/{out_name}");
        return match crate::db::Database::open(&db_path) {
            Ok(db) => match db.set_profile_wallpaper(id, &public_path) {
                Ok(profile) => {
                    if let Ok(profiles) = db.list_profiles() {
                        state.set_profiles(profiles);
                    }
                    Json(profile).into_response()
                }
                Err(err) => (
                    StatusCode::NOT_FOUND,
                    Json(serde_json::json!({ "error": err.to_string() })),
                )
                    .into_response(),
            },
            Err(err) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": err.to_string() })),
            )
                .into_response(),
        };
    }

    (
        StatusCode::BAD_REQUEST,
        Json(serde_json::json!({ "error": "no file uploaded" })),
    )
        .into_response()
}

#[derive(Deserialize)]
struct RemoteNavRequest {
    event: NavEvent,
}

async fn remote_nav_handler(
    State(state): State<Arc<StateManager>>,
    Json(payload): Json<RemoteNavRequest>,
) -> impl IntoResponse {
    state.audio.play(payload.event.sound_kind());
    if let Ok(guard) = state.nav_tx.read()
        && let Some(tx) = guard.as_ref()
    {
        let _ = tx.send(payload.event);
    }
    Json(serde_json::json!({ "ok": true }))
}
