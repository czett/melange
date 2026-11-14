use std::sync::Arc;
use std::sync::mpsc::Sender;

use serde::{Deserialize, Serialize};

use crate::audio::{AudioEngine, SoundKind};

pub mod cec_input;
pub mod evdev_input;
pub mod gilrs_input;

pub use cec_input::CecHandle;
pub use evdev_input::{EvdevHandle, map_evdev_key};
pub use gilrs_input::{GamepadHandle, map_ds4_button};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NavEvent {
    Up,
    Down,
    Left,
    Right,
    Select,
    Back,
    Home,
    ChannelUp,
    ChannelDown,
    ToggleEpg,
    PlayPause,
    Digit(u8),
}

impl NavEvent {
    pub fn sound_kind(self) -> SoundKind {
        match self {
            Self::Up | Self::Down | Self::Left | Self::Right | Self::Digit(_) => SoundKind::Focus,
            Self::Select | Self::Home | Self::ToggleEpg | Self::PlayPause => SoundKind::Select,
            Self::Back => SoundKind::Back,
            Self::ChannelUp | Self::ChannelDown => SoundKind::Zap,
        }
    }
}

pub struct InputRouter {
    audio: Arc<AudioEngine>,
    tx: Sender<NavEvent>,
}

impl InputRouter {
    pub fn new(audio: Arc<AudioEngine>, tx: Sender<NavEvent>) -> Self {
        Self { audio, tx }
    }

    pub fn dispatch(&self, event: NavEvent) {
        self.audio.play(event.sound_kind());
        let _ = self.tx.send(event);
    }

    pub fn sender(&self) -> Sender<NavEvent> {
        self.tx.clone()
    }
}
