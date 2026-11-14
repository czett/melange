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
        for arg in args {
            match arg.as_ref() {
                "--dev" => mode = RunMode::Dev,
                "--desktop" => mode = RunMode::Desktop,
                "--kiosk" => mode = RunMode::Kiosk,
                other if other.starts_with("--") => {
                    return Err(MelangeError::Config(format!("unknown flag: {other}")));
                }
                _ => {}
            }
        }
        Ok(Self::for_mode(mode))
    }

    pub fn for_mode(mode: RunMode) -> Self {
        match mode {
            RunMode::Dev => {
                let dev_dir = PathBuf::from("dev");
                Self {
                    mode,
                    db_path: dev_dir.join("melange.db"),
                    channels_path: dev_dir.join("channels.m3u"),
                    epg_path: dev_dir.join("epg.xml"),
                    sounds_dir: PathBuf::from("assets").join("sounds"),
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
