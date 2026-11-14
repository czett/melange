use std::cell::RefCell;
use std::path::Path;
use std::rc::Rc;
use std::sync::Arc;
use std::sync::mpsc;

use melange_core::{
    AppConfig, AudioEngine, Channel, Database, GamepadHandle, InputRouter, M3uXmltvProvider,
    MelangeError, NavEvent, PlaybackState, PlayerBackend, PlayerController, RunMode, SoundKind,
};
use tempfile::TempDir;

struct MockBackend {
    loaded_urls: Rc<RefCell<Vec<String>>>,
    paused: bool,
}

impl MockBackend {
    fn new() -> Self {
        Self {
            loaded_urls: Rc::new(RefCell::new(Vec::new())),
            paused: false,
        }
    }

    fn urls(&self) -> Vec<String> {
        self.loaded_urls.borrow().clone()
    }
}

impl PlayerBackend for MockBackend {
    fn load_replace(&mut self, url: &str) -> Result<(), MelangeError> {
        self.loaded_urls.borrow_mut().push(url.to_string());
        self.paused = false;
        Ok(())
    }

    fn toggle_pause(&mut self) -> Result<bool, MelangeError> {
        self.paused = !self.paused;
        Ok(self.paused)
    }
}

fn sample_channels(count: usize) -> Vec<Channel> {
    (1..=count)
        .map(|n| Channel {
            id: n as i64,
            number: n as i64,
            tvg_id: format!("ch{n}.de"),
            name: format!("Channel {n}"),
            group_title: "Public".to_string(),
            logo_url: String::new(),
            stream_url: format!("https://example.com/stream/{n}.m3u8"),
        })
        .collect()
}

#[test]
fn config_parses_modes() {
    let dev = AppConfig::from_args(["--dev"]).expect("dev config");
    assert_eq!(dev.mode, RunMode::Dev);
    assert_eq!(dev.db_path, Path::new("dev/melange.db"));
    assert_eq!(dev.channels_path, Path::new("dev/channels.m3u"));
    assert_eq!(dev.epg_path, Path::new("dev/epg.xml"));

    let desktop = AppConfig::from_args(["--desktop"]).expect("desktop config");
    assert_eq!(desktop.mode, RunMode::Desktop);

    let kiosk = AppConfig::from_args(["--kiosk"]).expect("kiosk config");
    assert_eq!(kiosk.mode, RunMode::Kiosk);

    assert!(AppConfig::from_args(["--unknown-flag"]).is_err());
}

#[test]
fn m3u_xmltv_parsing_and_sqlite_persistence() {
    let dir = TempDir::new().expect("tempdir");
    let m3u_path = dir.path().join("channels.m3u");
    let epg_path = dir.path().join("epg.xml");
    let db_path = dir.path().join("melange.db");

    std::fs::write(
        &m3u_path,
        r#"#EXTM3U
#EXTINF:-1 tvg-id="daserste.de" tvg-chno="1" group-title="Public",Das Erste HD
https://example.com/daserste.m3u8
#EXTINF:-1 tvg-id="zdf.de" tvg-chno="2" group-title="Public",ZDF HD
https://example.com/zdf.m3u8
"#,
    )
    .expect("write m3u");

    std::fs::write(
        &epg_path,
        r#"<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="daserste.de"><display-name>Das Erste HD</display-name></channel>
  <programme start="20261114120000 +0000" stop="20261114130000 +0000" channel="daserste.de">
    <title>Tagesschau</title>
    <desc>Nachrichten</desc>
  </programme>
  <programme start="20261114120000 +0000" stop="20261114130000 +0000" channel="zdf.de">
    <title>heute</title>
    <desc>Nachrichten und Wetter</desc>
  </programme>
</tv>
"#,
    )
    .expect("write epg");

    let db = Database::open(&db_path).expect("open db");
    let profiles = db.list_profiles().expect("list profiles");
    assert_eq!(profiles.len(), 1);
    assert_eq!(profiles[0].name, "Default");

    let report = M3uXmltvProvider::sync_from_files(&db, &m3u_path, &epg_path).expect("sync");
    assert_eq!(report.channels_upserted, 2);
    assert_eq!(report.epg_entries_upserted, 2);

    // Syncing again should upsert idempotently without duplicating rows.
    let report2 = M3uXmltvProvider::sync_from_files(&db, &m3u_path, &epg_path).expect("resync");
    assert_eq!(report2.channels_upserted, 2);

    let channels = db.list_channels().expect("list channels");
    assert_eq!(channels.len(), 2);
    assert_eq!(channels[0].number, 1);
    assert_eq!(channels[0].name, "Das Erste HD");
    assert_eq!(channels[1].number, 2);
    assert_eq!(channels[1].tvg_id, "zdf.de");

    let epg = db.list_epg_for_channel("daserste.de").expect("list epg");
    assert_eq!(epg.len(), 1);
    assert_eq!(epg[0].title, "Tagesschau");

    db.record_watch(profiles[0].id, channels[0].id)
        .expect("record watch");
}

#[test]
fn player_zapping_wrap_around_and_digits() {
    let channels = sample_channels(4);
    let mut player = PlayerController::new(channels, MockBackend::new());

    assert_eq!(player.state(), PlaybackState::Idle);
    assert!(!player.is_zapping());

    // Load channel 1
    let ch = player.load_channel(1).expect("load 1").expect("ch 1");
    assert_eq!(ch.number, 1);
    assert_eq!(player.state(), PlaybackState::Buffering);
    assert!(player.is_zapping());

    player.mark_frame_rendered();
    assert_eq!(player.state(), PlaybackState::Playing);
    assert!(!player.is_zapping());

    // ChannelDown from 1 wraps around to 4
    let ch = player.channel_down().expect("down").expect("ch 4");
    assert_eq!(ch.number, 4);
    assert!(player.is_zapping());

    // ChannelUp from 4 wraps around to 1
    let ch = player.channel_up().expect("up").expect("ch 1");
    assert_eq!(ch.number, 1);

    // Single-digit zap on <10 channel lineup tunes immediately
    let ch = player.zap_digit(3).expect("zap 3").expect("ch 3");
    assert_eq!(ch.number, 3);

    // Toggle pause
    assert_eq!(
        player.toggle_pause().expect("pause"),
        PlaybackState::Paused
    );
    assert_eq!(
        player.toggle_pause().expect("unpause"),
        PlaybackState::Playing
    );

    assert_eq!(
        player.backend().urls(),
        vec![
            "https://example.com/stream/1.m3u8",
            "https://example.com/stream/4.m3u8",
            "https://example.com/stream/1.m3u8",
            "https://example.com/stream/3.m3u8",
        ]
    );
}

#[test]
fn player_multi_digit_zapping() {
    let channels = sample_channels(12);
    let mut player = PlayerController::new(channels, MockBackend::new());

    assert!(player.zap_digit(1).expect("digit 1").is_none());
    assert_eq!(player.digit_buffer(), "1");

    let ch = player.zap_digit(2).expect("digit 2").expect("ch 12");
    assert_eq!(ch.number, 12);
    assert_eq!(player.digit_buffer(), "");
}

#[test]
fn input_router_and_graceful_audio_gamepad_degradation() {
    let audio = Arc::new(AudioEngine::new(Path::new("/nonexistent/melange/sounds")));
    assert!(!audio.has_sample(SoundKind::Focus));

    let (tx, rx) = mpsc::channel();
    let router = InputRouter::new(Arc::clone(&audio), tx.clone());

    router.dispatch(NavEvent::Up);
    router.dispatch(NavEvent::ChannelUp);
    router.dispatch(NavEvent::Digit(4));
    router.dispatch(NavEvent::Back);

    assert_eq!(rx.recv().unwrap(), NavEvent::Up);
    assert_eq!(rx.recv().unwrap(), NavEvent::ChannelUp);
    assert_eq!(rx.recv().unwrap(), NavEvent::Digit(4));
    assert_eq!(rx.recv().unwrap(), NavEvent::Back);

    // Spawning and dropping gamepad handle must never panic even if no controller is attached.
    let gamepad = GamepadHandle::spawn(tx, audio);
    drop(gamepad);
}
