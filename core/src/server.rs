use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::State;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;
use tracing::{debug, info, warn};

use crate::audio::{AudioEngine, SoundKind};
use crate::db::{Channel, EpgEntry, Profile};
use crate::error::MelangeError;
use crate::input::NavEvent;
use crate::player::PlaybackState;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AppMode {
    Home,
    LiveTv,
    Mediathek,
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
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlaybackSnapshot {
    pub state: PlaybackState,
    pub title: Option<String>,
    pub subtitle: Option<String>,
    pub channel_id: Option<i64>,
    pub channel_number: Option<i64>,
    pub position_sec: f64,
    pub duration_sec: f64,
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
            position_sec: 0.0,
            duration_sec: 0.0,
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
pub enum ClientCommand {
    SelectChannel { channel_id: i64 },
    SetMode { mode: AppMode },
    SetOverlay { overlay: OverlayKind },
    SelectProfile { profile_id: i64 },
    PlaySound { sound: SoundKind },
}

#[derive(Debug, Clone)]
pub enum ShellCommand {
    SelectChannel { channel_id: i64 },
    SetMode { mode: AppMode },
    SetOverlay { overlay: OverlayKind },
}

pub struct StateManager {
    state: RwLock<MelangeState>,
    epg_entries: RwLock<Vec<EpgEntry>>,
    ws_tx: broadcast::Sender<ServerMessage>,
    shell_cmd_tx: RwLock<Option<std::sync::mpsc::Sender<ShellCommand>>>,
    audio: Arc<AudioEngine>,
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
        };

        Arc::new(Self {
            state: RwLock::new(initial),
            epg_entries: RwLock::new(epg_entries),
            ws_tx,
            shell_cmd_tx: RwLock::new(None),
            audio,
        })
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
                NavEvent::Back => {
                    if st.overlay != OverlayKind::None {
                        st.overlay = OverlayKind::None;
                        changed = true;
                    }
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
                position_sec,
                duration_sec,
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
    let api_router = Router::new()
        .route("/api/health", get(health_handler))
        .route("/api/channels", get(channels_handler))
        .route("/api/epg", get(epg_handler))
        .route("/api/profiles", get(profiles_handler))
        .route("/ws", get(ws_handler))
        .with_state(state);

    let serve_dir = ServeDir::new(ui_dist_dir).append_index_html_on_directories(true);

    api_router
        .fallback_service(serve_dir)
        .layer(CorsLayer::permissive())
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
