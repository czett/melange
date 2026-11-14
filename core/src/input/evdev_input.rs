use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use evdev::{Device, InputEventKind, Key};
use tracing::{debug, info, warn};

use super::NavEvent;
use crate::audio::AudioEngine;

pub struct EvdevHandle {
    running: Arc<AtomicBool>,
    join_handle: Option<JoinHandle<()>>,
}

impl EvdevHandle {
    pub fn spawn(tx: Sender<NavEvent>, audio: Arc<AudioEngine>) -> Self {
        let running = Arc::new(AtomicBool::new(true));
        let thread_running = Arc::clone(&running);

        let join_handle = thread::Builder::new()
            .name("melange-evdev".to_string())
            .spawn(move || {
                let mut devices = discover_remote_devices();
                if devices.is_empty() {
                    debug!("no evdev remote devices found; continuing without evdev remote");
                    return;
                }

                info!(count = devices.len(), "evdev remote input thread started");

                while thread_running.load(Ordering::Relaxed) {
                    let mut had_event = false;
                    for dev in &mut devices {
                        match dev.fetch_events() {
                            Ok(events) => {
                                for ev in events {
                                    // value == 1 is key press (0 = release, 2 = repeat)
                                    if ev.value() == 1
                                        && let InputEventKind::Key(key) = ev.kind()
                                        && let Some(nav) = map_evdev_key(key)
                                    {
                                        audio.play(nav.sound_kind());
                                        let _ = tx.send(nav);
                                        had_event = true;
                                    }
                                }
                            }
                            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {}
                            Err(err) => {
                                warn!(error = %err, "evdev read error");
                            }
                        }
                    }

                    if !had_event {
                        thread::sleep(Duration::from_millis(16));
                    }
                }
            })
            .ok();

        Self {
            running,
            join_handle,
        }
    }
}

impl Drop for EvdevHandle {
    fn drop(&mut self) {
        self.running.store(false, Ordering::Relaxed);
        if let Some(handle) = self.join_handle.take() {
            let _ = handle.join();
        }
    }
}

fn discover_remote_devices() -> Vec<Device> {
    let mut remotes = Vec::new();
    for (path, dev) in evdev::enumerate() {
        let Some(keys) = dev.supported_keys() else {
            continue;
        };

        // Filter specifically for remote/consumer HID devices so we don't double-handle
        // standard laptop keyboards that GTK already processes.
        let is_remote = keys.contains(Key::KEY_CHANNELUP)
            || keys.contains(Key::KEY_EPG)
            || keys.contains(Key::KEY_HOMEPAGE)
            || keys.contains(Key::KEY_PLAYPAUSE)
            || keys.contains(Key::KEY_OK);

        if !is_remote {
            continue;
        }

        debug!(
            path = %path.display(),
            name = dev.name().unwrap_or("unknown"),
            "attached evdev remote device"
        );
        remotes.push(dev);
    }
    remotes
}

pub fn map_evdev_key(key: Key) -> Option<NavEvent> {
    match key {
        Key::KEY_UP => Some(NavEvent::Up),
        Key::KEY_DOWN => Some(NavEvent::Down),
        Key::KEY_LEFT => Some(NavEvent::Left),
        Key::KEY_RIGHT => Some(NavEvent::Right),
        Key::KEY_OK | Key::KEY_ENTER => Some(NavEvent::Select),
        Key::KEY_BACK | Key::KEY_ESC => Some(NavEvent::Back),
        Key::KEY_HOMEPAGE | Key::KEY_HOME => Some(NavEvent::Home),
        Key::KEY_CHANNELUP => Some(NavEvent::ChannelUp),
        Key::KEY_CHANNELDOWN => Some(NavEvent::ChannelDown),
        Key::KEY_EPG | Key::KEY_INFO => Some(NavEvent::ToggleEpg),
        Key::KEY_PLAYPAUSE => Some(NavEvent::PlayPause),
        Key::KEY_0 => Some(NavEvent::Digit(0)),
        Key::KEY_1 => Some(NavEvent::Digit(1)),
        Key::KEY_2 => Some(NavEvent::Digit(2)),
        Key::KEY_3 => Some(NavEvent::Digit(3)),
        Key::KEY_4 => Some(NavEvent::Digit(4)),
        Key::KEY_5 => Some(NavEvent::Digit(5)),
        Key::KEY_6 => Some(NavEvent::Digit(6)),
        Key::KEY_7 => Some(NavEvent::Digit(7)),
        Key::KEY_8 => Some(NavEvent::Digit(8)),
        Key::KEY_9 => Some(NavEvent::Digit(9)),
        _ => None,
    }
}
