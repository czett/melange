use std::env;
use std::path::PathBuf;

use crate::error::MelangeError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunMode {
    Dev,
    Desktop,
    Kiosk,
}

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub mode: RunMode,
    pub db_path: PathBuf,
    pub channels_path: PathBuf,
    pub epg_path: PathBuf,
    pub sounds_dir: PathBuf,
    pub ui_dist_dir: PathBuf,
    pub companion_dist_dir: PathBuf,
    pub wallpapers_dir: PathBuf,
    pub port: u16,
    pub piped_url: String,
    pub media_dirs: Vec<PathBuf>,
    pub tvheadend_url: Option<String>,
    pub tvheadend_user: Option<String>,
    pub tvheadend_pass: Option<String>,
}

impl AppConfig {
    pub fn from_env_args() -> Result<Self, MelangeError> {
        Self::from_args(env::args().skip(1))
    }

    pub fn from_args<I, S>(args: I) -> Result<Self, MelangeError>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let mut mode = RunMode::Desktop;
        let mut port_override: Option<u16> = env::var("MELANGE_PORT")
            .ok()
            .and_then(|v| v.parse::<u16>().ok());

        let mut iter = args.into_iter();
        while let Some(arg) = iter.next() {
            match arg.as_ref() {
                "--dev" => mode = RunMode::Dev,
                "--desktop" => mode = RunMode::Desktop,
                "--kiosk" => mode = RunMode::Kiosk,
                "--port" => {
                    let val = iter.next().ok_or_else(|| {
                        MelangeError::Config("--port requires a numeric argument".to_string())
                    })?;
                    let parsed = val.as_ref().parse::<u16>().map_err(|_| {
                        MelangeError::Config(format!("invalid port: {}", val.as_ref()))
                    })?;
                    port_override = Some(parsed);
                }
                other if other.starts_with("--port=") => {
                    let val = &other["--port=".len()..];
                    let parsed = val
                        .parse::<u16>()
                        .map_err(|_| MelangeError::Config(format!("invalid port: {val}")))?;
                    port_override = Some(parsed);
                }
                other if other.starts_with("--") => {
                    return Err(MelangeError::Config(format!("unknown flag: {other}")));
                }
                _ => {}
            }
        }
        let mut cfg = Self::for_mode(mode);
        if let Some(port) = port_override {
            cfg.port = port;
        }
        Ok(cfg)
    }

    pub fn for_mode(mode: RunMode) -> Self {
        let tvheadend_url = env::var("MELANGE_TVHEADEND_URL")
            .ok()
            .map(|s| s.trim().trim_end_matches('/').to_string())
            .filter(|s| !s.is_empty());
        let tvheadend_user = env::var("MELANGE_TVHEADEND_USER")
            .ok()
            .filter(|s| !s.is_empty());
        let tvheadend_pass = env::var("MELANGE_TVHEADEND_PASS").ok();

        match mode {
            RunMode::Dev => {
                let dev_dir = PathBuf::from("dev");
                Self {
                    mode,
                    db_path: dev_dir.join("melange.db"),
                    channels_path: dev_dir.join("channels.m3u"),
                    epg_path: dev_dir.join("epg.xml"),
                    sounds_dir: PathBuf::from("assets").join("sounds"),
                    ui_dist_dir: PathBuf::from("ui").join("dist"),
                    companion_dist_dir: PathBuf::from("companion").join("dist"),
                    wallpapers_dir: dev_dir.join("wallpapers"),
                    port: 9000,
                    piped_url: default_piped_url(),
                    media_dirs: vec![dev_dir.join("media")],
                    tvheadend_url,
                    tvheadend_user,
                    tvheadend_pass,
                }
            }
            RunMode::Desktop | RunMode::Kiosk => {
                let data_dir = xdg_data_dir().join("melange");
                Self {
                    mode,
                    db_path: data_dir.join("melange.db"),
                    channels_path: data_dir.join("channels.m3u"),
                    epg_path: data_dir.join("epg.xml"),
                    sounds_dir: PathBuf::from("assets").join("sounds"),
                    ui_dist_dir: PathBuf::from("ui").join("dist"),
                    companion_dist_dir: PathBuf::from("companion").join("dist"),
                    wallpapers_dir: data_dir.join("wallpapers"),
                    port: 9000,
                    piped_url: default_piped_url(),
                    media_dirs: default_media_dirs(),
                    tvheadend_url,
                    tvheadend_user,
                    tvheadend_pass,
                }
            }
        }
    }
}

fn xdg_data_dir() -> PathBuf {
    if let Ok(dir) = env::var("XDG_DATA_HOME")
        && !dir.is_empty()
    {
        return PathBuf::from(dir);
    }
    if let Ok(home) = env::var("HOME")
        && !home.is_empty()
    {
        return PathBuf::from(home).join(".local").join("share");
    }
    PathBuf::from(".")
}

fn default_piped_url() -> String {
    env::var("MELANGE_PIPED_URL")
        .ok()
        .map(|s| s.trim().trim_end_matches('/').to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "https://pipedapi.kavin.rocks".to_string())
}

fn default_media_dirs() -> Vec<PathBuf> {
    if let Ok(home) = env::var("HOME")
        && !home.is_empty()
    {
        return vec![PathBuf::from(home).join("Videos")];
    }
    vec![PathBuf::from("dev").join("media")]
}
