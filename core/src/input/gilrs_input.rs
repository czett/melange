use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use gilrs::{Axis, Button, EventType, Gilrs};
use tracing::{debug, warn};

use super::NavEvent;
use crate::audio::AudioEngine;

const DIRECTION_REPEAT_DEBOUNCE: Duration = Duration::from_millis(180);
const STICK_THRESHOLD: f32 = 0.55;

pub struct GamepadHandle {
    running: Arc<AtomicBool>,
    join_handle: Option<JoinHandle<()>>,
}

impl GamepadHandle {
    pub fn spawn(tx: Sender<NavEvent>, audio: Arc<AudioEngine>) -> Self {
        let running = Arc::new(AtomicBool::new(true));
        let thread_running = Arc::clone(&running);

        let join_handle = thread::Builder::new()
            .name("melange-gamepad".to_string())
            .spawn(move || {
                let mut gilrs = match Gilrs::new() {
                    Ok(g) => g,
                    Err(err) => {
                        warn!(error = %err, "gilrs unavailable; continuing without gamepad support");
                        return;
                    }
                };

                debug!("gamepad input thread started");
                let mut last_dir: Option<(NavEvent, Instant)> = None;
                let mut held_stick_x: Option<NavEvent> = None;
                let mut held_stick_y: Option<NavEvent> = None;

                while thread_running.load(Ordering::Relaxed) {
                    while let Some(ev) = gilrs.next_event() {
                        match ev.event {
                            EventType::ButtonPressed(btn, _) => {
                                if let Some(nav) = map_ds4_button(btn) {
                                    if is_directional(nav)
                                        && !allow_direction(&mut last_dir, nav, Instant::now())
                                    {
                                        continue;
                                    }
                                    audio.play(nav.sound_kind());
                                    let _ = tx.send(nav);
                                }
                            }
                            EventType::AxisChanged(axis, val, _) => match axis {
                                Axis::LeftStickX => {
                                    held_stick_x = if val > STICK_THRESHOLD {
                                        Some(NavEvent::Right)
                                    } else if val < -STICK_THRESHOLD {
                                        Some(NavEvent::Left)
                                    } else {
                                        None
                                    };
                                    if let Some(nav) = held_stick_x
                                        && allow_direction(&mut last_dir, nav, Instant::now())
                                    {
                                        audio.play(nav.sound_kind());
                                        let _ = tx.send(nav);
                                    }
                                }
                                Axis::LeftStickY => {
                                    held_stick_y = if val > STICK_THRESHOLD {
                                        Some(NavEvent::Up)
                                    } else if val < -STICK_THRESHOLD {
                                        Some(NavEvent::Down)
                                    } else {
                                        None
                                    };
                                    if let Some(nav) = held_stick_y
                                        && allow_direction(&mut last_dir, nav, Instant::now())
                                    {
                                        audio.play(nav.sound_kind());
                                        let _ = tx.send(nav);
                                    }
                                }
                                _ => {}
                            },
                            _ => {}
                        }
                    }

                    // Support smooth 180ms repeat when stick is held past threshold.
                    let now = Instant::now();
                    for held in [held_stick_x, held_stick_y].into_iter().flatten() {
                        if allow_direction(&mut last_dir, held, now) {
                            audio.play(held.sound_kind());
                            let _ = tx.send(held);
                        }
                    }

                    thread::sleep(Duration::from_millis(16));
                }
            })
            .ok();

        Self {
            running,
            join_handle,
        }
    }
}

impl Drop for GamepadHandle {
    fn drop(&mut self) {
        self.running.store(false, Ordering::Relaxed);
        if let Some(handle) = self.join_handle.take() {
            let _ = handle.join();
        }
    }
}

pub fn map_ds4_button(btn: Button) -> Option<NavEvent> {
    match btn {
        Button::DPadUp => Some(NavEvent::Up),
        Button::DPadDown => Some(NavEvent::Down),
        Button::DPadLeft => Some(NavEvent::Left),
        Button::DPadRight => Some(NavEvent::Right),
        Button::South => Some(NavEvent::Select),
        Button::East => Some(NavEvent::Back),
        Button::LeftTrigger => Some(NavEvent::ChannelDown),
        Button::RightTrigger => Some(NavEvent::ChannelUp),
        Button::Start => Some(NavEvent::ToggleEpg),
        Button::Mode => Some(NavEvent::Home),
        _ => None,
    }
}

fn is_directional(nav: NavEvent) -> bool {
    matches!(
        nav,
        NavEvent::Up | NavEvent::Down | NavEvent::Left | NavEvent::Right
    )
}

fn allow_direction(last_dir: &mut Option<(NavEvent, Instant)>, nav: NavEvent, now: Instant) -> bool {
    if let Some((prev_nav, prev_time)) = *last_dir
        && prev_nav == nav
        && now.duration_since(prev_time) < DIRECTION_REPEAT_DEBOUNCE
    {
        return false;
    }
    *last_dir = Some((nav, now));
    true
}
