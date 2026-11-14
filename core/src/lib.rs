pub mod audio;
pub mod config;
pub mod db;
pub mod error;
pub mod input;
pub mod player;
pub mod provider;
pub mod server;

pub use audio::{AudioEngine, SoundKind};
pub use config::{AppConfig, RunMode};
pub use db::{Channel, ChannelInput, Database, EpgEntry, EpgEntryInput, Profile};
pub use error::MelangeError;
pub use input::{GamepadHandle, InputRouter, NavEvent};
pub use player::{PlaybackState, PlayerBackend, PlayerController};
pub use provider::{M3uXmltvProvider, SyncReport};
pub use server::{
    AppMode, ClientCommand, EpgNowNext, MelangeState, OverlayKind, PlaybackSnapshot,
    ServerMessage, ShellCommand, StateManager, build_router, serve_on_listener,
    spawn_server_thread,
};
