use std::collections::HashMap;
use std::io::Cursor;
use std::path::Path;
use std::sync::Arc;
use std::sync::mpsc::{self, Sender};
use std::thread;

use rodio::{Decoder, OutputStream, Sink};
use serde::{Deserialize, Serialize};
use tracing::{debug, warn};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SoundKind {
    Focus,
    Select,
    Back,
    Zap,
}

impl SoundKind {
    pub fn filename(self) -> &'static str {
        match self {
            Self::Focus => "focus.wav",
            Self::Select => "select.wav",
            Self::Back => "back.wav",
            Self::Zap => "zap.wav",
        }
    }
}

pub struct AudioEngine {
    samples: HashMap<SoundKind, Arc<Vec<u8>>>,
    tx: Option<Sender<Arc<Vec<u8>>>>,
}

impl AudioEngine {
    pub fn new(sounds_dir: &Path) -> Self {
        let mut samples = HashMap::new();
        for kind in [
            SoundKind::Focus,
            SoundKind::Select,
            SoundKind::Back,
            SoundKind::Zap,
        ] {
            let path = sounds_dir.join(kind.filename());
            match std::fs::read(&path) {
                Ok(bytes) => {
                    debug!(path = %path.display(), bytes = bytes.len(), "preloaded ui sound");
                    samples.insert(kind, Arc::new(bytes));
                }
                Err(err) => {
                    warn!(path = %path.display(), error = %err, "ui sound not loaded");
                }
            }
        }

        let tx = Self::spawn_audio_thread();
        Self { samples, tx }
    }

    pub fn noop() -> Self {
        Self {
            samples: HashMap::new(),
            tx: None,
        }
    }

    pub fn has_sample(&self, kind: SoundKind) -> bool {
        self.samples.contains_key(&kind)
    }

    pub fn has_audio_sink(&self) -> bool {
        self.tx.is_some()
    }

    pub fn play(&self, kind: SoundKind) {
        let Some(tx) = &self.tx else {
            return;
        };
        let Some(bytes) = self.samples.get(&kind) else {
            return;
        };
        let _ = tx.send(Arc::clone(bytes));
    }

    fn spawn_audio_thread() -> Option<Sender<Arc<Vec<u8>>>> {
        let (tx, rx) = mpsc::channel::<Arc<Vec<u8>>>();
        let (ready_tx, ready_rx) = mpsc::sync_channel::<bool>(1);

        let spawned = thread::Builder::new()
            .name("melange-audio".to_string())
            .spawn(move || {
                let Ok((_stream, handle)) = OutputStream::try_default() else {
                    warn!("no audio output device available; running with silent audio fallback");
                    let _ = ready_tx.send(false);
                    return;
                };
                let _ = ready_tx.send(true);

                while let Ok(bytes) = rx.recv() {
                    let cursor = Cursor::new(SharedBytes(bytes));
                    if let Ok(source) = Decoder::new(cursor)
                        && let Ok(sink) = Sink::try_new(&handle)
                    {
                        sink.append(source);
                        sink.detach();
                    }
                }
            });

        if spawned.is_err() {
            warn!("failed to spawn audio thread; running with silent audio fallback");
            return None;
        }

        match ready_rx.recv() {
            Ok(true) => Some(tx),
            _ => None,
        }
    }
}

#[derive(Clone)]
struct SharedBytes(Arc<Vec<u8>>);

impl AsRef<[u8]> for SharedBytes {
    fn as_ref(&self) -> &[u8] {
        self.0.as_slice()
    }
}
