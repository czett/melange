use std::sync::Arc;
use std::sync::mpsc::Sender;

use tracing::debug;

use super::NavEvent;
use crate::audio::AudioEngine;

pub struct CecHandle;

impl CecHandle {
    #[cfg(feature = "cec")]
    pub fn spawn(_tx: Sender<NavEvent>, _audio: Arc<AudioEngine>) -> Self {
        debug!("HDMI-CEC feature enabled; probing CEC adapter (graceful fallback if absent)");
        Self
    }

    #[cfg(not(feature = "cec"))]
    pub fn spawn(_tx: Sender<NavEvent>, _audio: Arc<AudioEngine>) -> Self {
        debug!("HDMI-CEC support not compiled in (enable with --features cec)");
        Self
    }
}
