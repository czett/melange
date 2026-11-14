use thiserror::Error;

#[derive(Debug, Error)]
pub enum MelangeError {
    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),

    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),

    #[error("xml parse error: {0}")]
    Xml(#[from] quick_xml::Error),

    #[error("parse error: {0}")]
    Parse(String),

    #[error("configuration error: {0}")]
    Config(String),

    #[error("player backend error: {0}")]
    Player(String),
}
