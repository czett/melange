pub mod assets;
pub mod audio;
pub mod config;
pub mod db;
pub mod error;
pub mod input;
pub mod keymap;
pub mod player;
pub mod providers;
pub mod server;

pub use audio::{AudioEngine, SoundKind};
pub use config::{AppConfig, RunMode};
pub use db::{Channel, ChannelInput, Database, EpgEntry, EpgEntryInput, Profile, WatchHistoryEntry};
pub use error::MelangeError;
pub use input::{CecHandle, EvdevHandle, GamepadHandle, InputRouter, NavEvent};
pub use keymap::{KeyAction, KeymapConfig, normalize_key_name};
pub use player::{PlaybackState, PlayerBackend, PlayerController};
pub use providers::{
    LocalMediaProvider, M3uXmltvProvider, MediaItem, MediathekProvider, OnDemandProvider,
    SyncReport, TvheadendProvider, YouTubeProvider,
};
pub use server::{
    AppMode, ClientCommand, EpgNowNext, MelangeState, OverlayKind, PlaybackSnapshot,
    ServerMessage, ShellCommand, StateManager, build_router, serve_on_listener,
    spawn_server_thread,
};
