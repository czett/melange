use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::error::MelangeError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Profile {
    pub id: i64,
    pub name: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChannelInput {
    pub number: i64,
    pub tvg_id: String,
    pub name: String,
    pub group_title: String,
    pub logo_url: String,
    pub stream_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Channel {
    pub id: i64,
    pub number: i64,
    pub tvg_id: String,
    pub name: String,
    pub group_title: String,
    pub logo_url: String,
    pub stream_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EpgEntryInput {
    pub channel_tvg_id: String,
    pub title: String,
    pub description: String,
    pub start_time: String,
    pub stop_time: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EpgEntry {
    pub id: i64,
    pub channel_tvg_id: String,
    pub title: String,
    pub description: String,
    pub start_time: String,
    pub stop_time: String,
}

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self, MelangeError> {
        if let Some(parent) = path.parent()
            && !parent.as_os_str().is_empty()
        {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        let db = Self { conn };
        db.migrate()?;
        Ok(db)
    }

    pub fn open_in_memory() -> Result<Self, MelangeError> {
        let conn = Connection::open_in_memory()?;
        let db = Self { conn };
        db.migrate()?;
        Ok(db)
    }

    pub fn migrate(&self) -> Result<(), MelangeError> {
        self.conn.execute_batch(
            "
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;

            CREATE TABLE IF NOT EXISTS profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS channels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                number INTEGER NOT NULL UNIQUE,
                tvg_id TEXT NOT NULL,
                name TEXT NOT NULL,
                group_title TEXT NOT NULL DEFAULT '',
                logo_url TEXT NOT NULL DEFAULT '',
                stream_url TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS epg_cache (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                channel_tvg_id TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                start_time TEXT NOT NULL,
                stop_time TEXT NOT NULL,
                UNIQUE(channel_tvg_id, start_time, title)
            );

            CREATE TABLE IF NOT EXISTS watch_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
                channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
                watched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            ",
        )?;

        let profile_count: i64 =
            self.conn
                .query_row("SELECT COUNT(*) FROM profiles", [], |row| row.get(0))?;
        if profile_count == 0 {
            self.conn
                .execute("INSERT INTO profiles (name) VALUES (?1)", params!["Default"])?;
        }

        Ok(())
    }

    pub fn list_profiles(&self) -> Result<Vec<Profile>, MelangeError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, name, created_at FROM profiles ORDER BY id ASC")?;
        let rows = stmt.query_map([], |row| {
            Ok(Profile {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn upsert_channel(&self, ch: &ChannelInput) -> Result<i64, MelangeError> {
        self.conn.execute(
            "
            INSERT INTO channels (number, tvg_id, name, group_title, logo_url, stream_url)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(number) DO UPDATE SET
                tvg_id = excluded.tvg_id,
                name = excluded.name,
                group_title = excluded.group_title,
                logo_url = excluded.logo_url,
                stream_url = excluded.stream_url
            ",
            params![
                ch.number,
                ch.tvg_id,
                ch.name,
                ch.group_title,
                ch.logo_url,
                ch.stream_url
            ],
        )?;
        let id: i64 = self.conn.query_row(
            "SELECT id FROM channels WHERE number = ?1",
            params![ch.number],
            |row| row.get(0),
        )?;
        Ok(id)
    }

    pub fn list_channels(&self) -> Result<Vec<Channel>, MelangeError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, number, tvg_id, name, group_title, logo_url, stream_url
             FROM channels
             ORDER BY number ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Channel {
                id: row.get(0)?,
                number: row.get(1)?,
                tvg_id: row.get(2)?,
                name: row.get(3)?,
                group_title: row.get(4)?,
                logo_url: row.get(5)?,
                stream_url: row.get(6)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn get_channel_by_number(&self, number: i64) -> Result<Option<Channel>, MelangeError> {
        self.conn
            .query_row(
                "SELECT id, number, tvg_id, name, group_title, logo_url, stream_url
                 FROM channels WHERE number = ?1",
                params![number],
                |row| {
                    Ok(Channel {
                        id: row.get(0)?,
                        number: row.get(1)?,
                        tvg_id: row.get(2)?,
                        name: row.get(3)?,
                        group_title: row.get(4)?,
                        logo_url: row.get(5)?,
                        stream_url: row.get(6)?,
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn upsert_epg_entry(&self, entry: &EpgEntryInput) -> Result<(), MelangeError> {
        self.conn.execute(
            "
            INSERT INTO epg_cache (channel_tvg_id, title, description, start_time, stop_time)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(channel_tvg_id, start_time, title) DO UPDATE SET
                description = excluded.description,
                stop_time = excluded.stop_time
            ",
            params![
                entry.channel_tvg_id,
                entry.title,
                entry.description,
                entry.start_time,
                entry.stop_time
            ],
        )?;
        Ok(())
    }

    pub fn list_epg_for_channel(&self, tvg_id: &str) -> Result<Vec<EpgEntry>, MelangeError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, channel_tvg_id, title, description, start_time, stop_time
             FROM epg_cache
             WHERE channel_tvg_id = ?1
             ORDER BY start_time ASC",
        )?;
        let rows = stmt.query_map(params![tvg_id], |row| {
            Ok(EpgEntry {
                id: row.get(0)?,
                channel_tvg_id: row.get(1)?,
                title: row.get(2)?,
                description: row.get(3)?,
                start_time: row.get(4)?,
                stop_time: row.get(5)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn list_all_epg(&self) -> Result<Vec<EpgEntry>, MelangeError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, channel_tvg_id, title, description, start_time, stop_time
             FROM epg_cache
             ORDER BY channel_tvg_id ASC, start_time ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(EpgEntry {
                id: row.get(0)?,
                channel_tvg_id: row.get(1)?,
                title: row.get(2)?,
                description: row.get(3)?,
                start_time: row.get(4)?,
                stop_time: row.get(5)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn record_watch(&self, profile_id: i64, channel_id: i64) -> Result<(), MelangeError> {
        self.conn.execute(
            "INSERT INTO watch_history (profile_id, channel_id) VALUES (?1, ?2)",
            params![profile_id, channel_id],
        )?;
        Ok(())
    }
}
