use crate::db::Channel;
use crate::error::MelangeError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlaybackState {
    Idle,
    Buffering,
    Playing,
    Paused,
}

pub trait PlayerBackend {
    fn load_replace(&mut self, url: &str) -> Result<(), MelangeError>;
    fn toggle_pause(&mut self) -> Result<bool, MelangeError>;
}

pub struct PlayerController<B: PlayerBackend> {
    channels: Vec<Channel>,
    current_index: Option<usize>,
    state: PlaybackState,
    is_zapping: bool,
    digit_buffer: String,
    backend: B,
}

impl<B: PlayerBackend> PlayerController<B> {
    pub fn new(channels: Vec<Channel>, backend: B) -> Self {
        Self {
            channels,
            current_index: None,
            state: PlaybackState::Idle,
            is_zapping: false,
            digit_buffer: String::new(),
            backend,
        }
    }

    pub fn set_channels(&mut self, channels: Vec<Channel>) {
        self.channels = channels;
        if let Some(idx) = self.current_index
            && idx >= self.channels.len()
        {
            self.current_index = None;
        }
    }

    pub fn channels(&self) -> &[Channel] {
        &self.channels
    }

    pub fn current_channel(&self) -> Option<&Channel> {
        self.current_index.and_then(|i| self.channels.get(i))
    }

    pub fn state(&self) -> PlaybackState {
        self.state
    }

    pub fn is_zapping(&self) -> bool {
        self.is_zapping
    }

    pub fn digit_buffer(&self) -> &str {
        &self.digit_buffer
    }

    pub fn backend(&self) -> &B {
        &self.backend
    }

    pub fn backend_mut(&mut self) -> &mut B {
        &mut self.backend
    }

    pub fn load_channel(&mut self, number: i64) -> Result<Option<&Channel>, MelangeError> {
        let Some(idx) = self.channels.iter().position(|c| c.number == number) else {
            return Ok(None);
        };
        self.load_index(idx)
    }

    pub fn channel_up(&mut self) -> Result<Option<&Channel>, MelangeError> {
        if self.channels.is_empty() {
            return Ok(None);
        }
        let next_idx = match self.current_index {
            Some(idx) => (idx + 1) % self.channels.len(),
            None => 0,
        };
        self.load_index(next_idx)
    }

    pub fn channel_down(&mut self) -> Result<Option<&Channel>, MelangeError> {
        if self.channels.is_empty() {
            return Ok(None);
        }
        let prev_idx = match self.current_index {
            Some(0) | None => self.channels.len() - 1,
            Some(idx) => idx - 1,
        };
        self.load_index(prev_idx)
    }

    pub fn zap_digit(&mut self, digit: u8) -> Result<Option<&Channel>, MelangeError> {
        if digit > 9 {
            return Ok(None);
        }
        let max_num = self.channels.iter().map(|c| c.number).max().unwrap_or(0);
        if max_num < 10 && digit > 0 && self.digit_buffer.is_empty() {
            return self.load_channel(i64::from(digit));
        }

        if self.digit_buffer.len() < 4 {
            self.digit_buffer.push((b'0' + digit) as char);
        }

        // Auto-commit if buffer reaches max digit width of available channels
        let max_digits = max_num.max(1).to_string().len();
        if self.digit_buffer.len() >= max_digits {
            return self.commit_digits();
        }

        Ok(None)
    }

    pub fn commit_digits(&mut self) -> Result<Option<&Channel>, MelangeError> {
        if self.digit_buffer.is_empty() {
            return Ok(None);
        }
        let parsed = self.digit_buffer.parse::<i64>().ok();
        self.digit_buffer.clear();
        if let Some(num) = parsed {
            return self.load_channel(num);
        }
        Ok(None)
    }

    pub fn toggle_pause(&mut self) -> Result<PlaybackState, MelangeError> {
        if self.current_index.is_none() {
            return Ok(self.state);
        }
        let paused = self.backend.toggle_pause()?;
        self.state = if paused {
            PlaybackState::Paused
        } else {
            PlaybackState::Playing
        };
        Ok(self.state)
    }

    pub fn mark_frame_rendered(&mut self) {
        self.is_zapping = false;
        if self.state == PlaybackState::Buffering {
            self.state = PlaybackState::Playing;
        }
    }

    fn load_index(&mut self, idx: usize) -> Result<Option<&Channel>, MelangeError> {
        let url = self.channels[idx].stream_url.clone();
        self.is_zapping = true;
        self.state = PlaybackState::Buffering;
        self.backend.load_replace(&url)?;
        self.current_index = Some(idx);
        Ok(self.channels.get(idx))
    }
}
