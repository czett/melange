use std::collections::HashMap;
use std::net::{SocketAddr, UdpSocket};
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

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
use crate::db::{Channel, EpgEntry, Profile, WatchHistoryEntry};
use crate::error::MelangeError;
use crate::input::NavEvent;
use crate::player::PlaybackState;
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
    pub active_profile: Option<Profile>,
    pub profiles: Vec<Profile>,
    pub channels: Vec<Channel>,
    pub epg_now_next: HashMap<String, EpgNowNext>,
    pub playback: PlaybackSnapshot,
    pub digit_buffer: String,
    pub continue_watching: Vec<WatchHistoryEntry>,
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
    PlaySound { sound: SoundKind },
    PlayMedia { item: MediaItem, resume: bool },
    SeekRelative { offset_sec: f64 },
    TogglePause,
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
}

pub struct StateManager {
    state: RwLock<MelangeState>,
    epg_entries: RwLock<Vec<EpgEntry>>,
    ws_tx: broadcast::Sender<ServerMessage>,
    shell_cmd_tx: RwLock<Option<std::sync::mpsc::Sender<ShellCommand>>>,
    nav_tx: RwLock<Option<std::sync::mpsc::Sender<NavEvent>>>,
    db_path: RwLock<Option<PathBuf>>,
    wallpapers_dir: RwLock<PathBuf>,
    port: RwLock<u16>,
    audio: Arc<AudioEngine>,
    mediathek: Arc<MediathekProvider>,
    youtube: RwLock<Arc<YouTubeProvider>>,
    local_media: RwLock<Arc<LocalMediaProvider>>,
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
            active_profile,
            profiles,
            channels,
            epg_now_next,
            playback: PlaybackSnapshot::default(),
            digit_buffer: String::new(),
            continue_watching: Vec::new(),
        };

        Arc::new(Self {
            state: RwLock::new(initial),
            epg_entries: RwLock::new(epg_entries),
            ws_tx,
            shell_cmd_tx: RwLock::new(None),
            nav_tx: RwLock::new(None),
            db_path: RwLock::new(None),
            wallpapers_dir: RwLock::new(PathBuf::from("wallpapers")),
            port: RwLock::new(9000),
            audio,
            mediathek: Arc::new(MediathekProvider::new()),
            youtube: RwLock::new(Arc::new(YouTubeProvider::new("https://pipedapi.kavin.rocks"))),
            local_media: RwLock::new(Arc::new(LocalMediaProvider::new(Vec::new()))),
        })
    }

    pub fn attach_db_path(&self, path: PathBuf) {
        if let Ok(mut guard) = self.db_path.write() {
            *guard = Some(path);
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
        if let Ok(mut guard) = self.state.write() {
            guard.playback.position_sec = position_sec;
            guard.playback.duration_sec = duration_sec;
            guard.playback.paused = paused;
        }
        self.broadcast_state();
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
        {
            let mut st = self.state.write().expect("state lock");
            st.mode = mode;
            st.overlay = OverlayKind::None;
        }
        self.broadcast_state();
    }

    pub fn set_overlay(&self, overlay: OverlayKind) {
        {
            let mut st = self.state.write().expect("state lock");
            st.overlay = overlay;
        }
        self.broadcast_state();
    }

    pub fn handle_nav_event(&self, event: NavEvent) {
        let _ = self.ws_tx.send(ServerMessage::NavEvent { event });

        let mut changed = false;
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
                NavEvent::Home => {
                    st.mode = if st.mode == AppMode::Home {
                        AppMode::LiveTv
                    } else {
                        AppMode::Home
                    };
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
                _ => {}
            }
        }

        if changed {
            self.broadcast_state();
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
                {
                    let mut st = self.state.write().expect("state lock");
                    st.mode = mode;
                    st.overlay = OverlayKind::None;
                }
                self.broadcast_state();
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
                    self.audio.play(SoundKind::Select);
                    self.broadcast_state();
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
        .unwrap_or_else(|_| PathBuf::from("wallpapers"));

    let api_router = Router::new()
        .route("/api/health", get(health_handler))
        .route("/api/companion/info", get(companion_info_handler))
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
        .route("/api/continue-watching", get(continue_watching_handler))
        .route("/ws", get(ws_handler))
        .with_state(state);

    let ui_dist_dir = ui_dist_dir.to_path_buf();
    let wallpapers_service = ServeDir::new(wallpapers_dir);

    api_router
        .route("/companion", get(companion_index_handler))
        .route("/companion/{*path}", get(companion_asset_handler))
        .nest_service("/wallpapers", wallpapers_service)
        .fallback(move |uri: axum::http::Uri| {
            let ui_dir = ui_dist_dir.clone();
            async move { serve_embedded_or_disk::<EmbeddedUi>(Some(&ui_dir), uri.path(), true).await }
        })
        .layer(CorsLayer::permissive())
}

async fn companion_index_handler() -> impl IntoResponse {
    serve_embedded_or_disk::<EmbeddedCompanion>(
        Some(Path::new("companion/dist")),
        "index.html",
        true,
    )
    .await
}

async fn companion_asset_handler(
    axum::extract::Path(path): axum::extract::Path<String>,
) -> impl IntoResponse {
    serve_embedded_or_disk::<EmbeddedCompanion>(Some(Path::new("companion/dist")), &path, true)
        .await
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
                let addr = SocketAddr::from(([127, 0, 0, 1], port));
                let listener = match TcpListener::bind(addr).await {
                    Ok(l) => l,
                    Err(err) => {
                        let _ = ready_tx.send(Err(format!("bind {addr} failed: {err}")));
                        return;
                    }
                };
                let bound_addr = listener.local_addr().unwrap_or(addr);
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

async fn ondemand_feed_handler(
    State(state): State<Arc<StateManager>>,
    Query(params): Query<OnDemandFeedQuery>,
) -> Json<Vec<MediaItem>> {
    let items = match params.provider.as_str() {
        "mediathek" => state.mediathek.feed().await.unwrap_or_default(),
        "youtube" => {
            let yt = state.youtube.read().expect("youtube lock").clone();
            yt.feed().await.unwrap_or_default()
        }
        "local" => {
            let local = state.local_media.read().expect("local lock").clone();
            local.feed().await.unwrap_or_default()
        }
        _ => Vec::new(),
    };
    Json(items)
}

async fn ondemand_search_handler(
    State(state): State<Arc<StateManager>>,
    Query(params): Query<OnDemandSearchQuery>,
) -> Json<Vec<MediaItem>> {
    let items = match params.provider.as_str() {
        "mediathek" => state.mediathek.search(&params.q).await.unwrap_or_default(),
        "youtube" => {
            let yt = state.youtube.read().expect("youtube lock").clone();
            yt.search(&params.q).await.unwrap_or_default()
        }
        "local" => {
            let local = state.local_media.read().expect("local lock").clone();
            local.search(&params.q).await.unwrap_or_default()
        }
        _ => Vec::new(),
    };
    Json(items)
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
