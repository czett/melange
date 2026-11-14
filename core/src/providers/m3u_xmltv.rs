use std::path::Path;

use quick_xml::Reader;
use quick_xml::events::Event;

use crate::db::{ChannelInput, Database, EpgEntryInput};
use crate::error::MelangeError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SyncReport {
    pub channels_upserted: usize,
    pub epg_entries_upserted: usize,
}

pub struct M3uXmltvProvider;

impl M3uXmltvProvider {
    pub fn parse_m3u(content: &str) -> Result<Vec<ChannelInput>, MelangeError> {
        let mut channels = Vec::new();
        let mut pending_meta: Option<(String, String, Option<i64>, String, String)> = None;
        let mut next_auto_number: i64 = 1;

        for raw_line in content.lines() {
            let line = raw_line.trim();
            if line.is_empty() || line == "#EXTM3U" {
                continue;
            }
            if let Some(rest) = line.strip_prefix("#EXTINF:") {
                let (attrs_part, display_name) = match rest.split_once(',') {
                    Some((a, n)) => (a, n.trim().to_string()),
                    None => (rest, String::new()),
                };
                let tvg_id = extract_attr(attrs_part, "tvg-id").unwrap_or_default();
                let tvg_name = extract_attr(attrs_part, "tvg-name").unwrap_or_default();
                let tvg_chno = extract_attr(attrs_part, "tvg-chno")
                    .and_then(|s| s.parse::<i64>().ok())
                    .filter(|&n| n > 0);
                let logo_url = extract_attr(attrs_part, "tvg-logo").unwrap_or_default();
                let group_title = extract_attr(attrs_part, "group-title").unwrap_or_default();

                let name = if !display_name.is_empty() {
                    display_name
                } else if !tvg_name.is_empty() {
                    tvg_name
                } else {
                    format!("Channel {next_auto_number}")
                };

                pending_meta = Some((tvg_id, name, tvg_chno, logo_url, group_title));
                continue;
            }
            if line.starts_with('#') {
                continue;
            }

            if let Some((tvg_id, name, chno, logo_url, group_title)) = pending_meta.take() {
                let number = chno.unwrap_or(next_auto_number);
                next_auto_number = next_auto_number.max(number + 1);
                let effective_tvg_id = if tvg_id.is_empty() {
                    name.to_lowercase().replace(' ', ".")
                } else {
                    tvg_id
                };
                channels.push(ChannelInput {
                    number,
                    tvg_id: effective_tvg_id,
                    name,
                    group_title,
                    logo_url,
                    stream_url: line.to_string(),
                });
            }
        }

        Ok(channels)
    }

    pub fn parse_xmltv(content: &str) -> Result<Vec<EpgEntryInput>, MelangeError> {
        let mut reader = Reader::from_str(content);
        reader.config_mut().trim_text(true);

        let mut entries = Vec::new();
        let mut current: Option<EpgEntryInput> = None;
        let mut current_tag: Option<String> = None;

        loop {
            match reader.read_event() {
                Ok(Event::Start(ref e)) => {
                    let tag = String::from_utf8_lossy(e.name().as_ref()).into_owned();
                    if tag == "programme" {
                        let mut channel = String::new();
                        let mut start = String::new();
                        let mut stop = String::new();
                        for attr in e.attributes().flatten() {
                            let key = String::from_utf8_lossy(attr.key.as_ref());
                            let val = attr
                                .unescape_value()
                                .map(|v| v.into_owned())
                                .unwrap_or_default();
                            match key.as_ref() {
                                "channel" => channel = val,
                                "start" => start = val,
                                "stop" => stop = val,
                                _ => {}
                            }
                        }
                        current = Some(EpgEntryInput {
                            channel_tvg_id: channel,
                            title: String::new(),
                            description: String::new(),
                            start_time: start,
                            stop_time: stop,
                        });
                    } else if current.is_some() {
                        current_tag = Some(tag);
                    }
                }
                Ok(Event::Text(e)) => {
                    if let (Some(entry), Some(tag)) = (current.as_mut(), current_tag.as_deref()) {
                        let text = e.unescape().map(|v| v.into_owned()).unwrap_or_default();
                        match tag {
                            "title" if entry.title.is_empty() => entry.title = text,
                            "desc" if entry.description.is_empty() => entry.description = text,
                            _ => {}
                        }
                    }
                }
                Ok(Event::End(ref e)) => {
                    let tag = String::from_utf8_lossy(e.name().as_ref()).into_owned();
                    if tag == "programme" {
                        if let Some(entry) = current.take()
                            && !entry.channel_tvg_id.is_empty()
                            && !entry.title.is_empty()
                        {
                            entries.push(entry);
                        }
                    } else if current_tag.as_deref() == Some(tag.as_str()) {
                        current_tag = None;
                    }
                }
                Ok(Event::Eof) => break,
                Err(e) => return Err(MelangeError::Xml(e)),
                _ => {}
            }
        }

        Ok(entries)
    }

    pub fn sync_from_files(
        db: &Database,
        m3u_path: &Path,
        epg_path: &Path,
    ) -> Result<SyncReport, MelangeError> {
        let mut channels_upserted = 0;
        let mut epg_entries_upserted = 0;

        if m3u_path.exists() {
            let m3u_raw = std::fs::read_to_string(m3u_path)?;
            let channels = Self::parse_m3u(&m3u_raw)?;
            for ch in &channels {
                db.upsert_channel(ch)?;
                channels_upserted += 1;
            }
        }

        if epg_path.exists() {
            let epg_raw = std::fs::read_to_string(epg_path)?;
            let entries = Self::parse_xmltv(&epg_raw)?;
            for entry in &entries {
                db.upsert_epg_entry(entry)?;
                epg_entries_upserted += 1;
            }
        }

        Ok(SyncReport {
            channels_upserted,
            epg_entries_upserted,
        })
    }
}

fn extract_attr(attrs: &str, key: &str) -> Option<String> {
    let needle = format!("{key}=\"");
    let start = attrs.find(&needle)? + needle.len();
    let rest = &attrs[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}
