use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum KeyAction {
    Up,
    Down,
    Left,
    Right,
    Select,
    Back,
    ToggleEpg,
    ToggleOsd,
    ToggleMute,
    ToggleFullscreen,
    ChannelUp,
    ChannelDown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct KeymapConfig {
    pub up: Vec<String>,
    pub down: Vec<String>,
    pub left: Vec<String>,
    pub right: Vec<String>,
    pub select: Vec<String>,
    pub back: Vec<String>,
    pub toggle_epg: Vec<String>,
    pub toggle_osd: Vec<String>,
    pub toggle_mute: Vec<String>,
    pub toggle_fullscreen: Vec<String>,
    pub channel_up: Vec<String>,
    pub channel_down: Vec<String>,
    pub wasd_navigation: bool,
}

impl Default for KeymapConfig {
    fn default() -> Self {
        Self {
            up: vec!["ArrowUp".to_string()],
            down: vec!["ArrowDown".to_string()],
            left: vec!["ArrowLeft".to_string()],
            right: vec!["ArrowRight".to_string()],
            select: vec!["Return".to_string(), "Space".to_string()],
            back: vec!["Escape".to_string(), "Backspace".to_string()],
            toggle_epg: vec!["e".to_string()],
            toggle_osd: vec!["i".to_string()],
            toggle_mute: vec!["m".to_string()],
            toggle_fullscreen: vec!["F11".to_string(), "f".to_string()],
            channel_up: vec!["PageUp".to_string()],
            channel_down: vec!["PageDown".to_string()],
            wasd_navigation: false,
        }
    }
}

/// Canonicalizes both GTK4 GDK keyval names and Web `KeyboardEvent.key` values
/// into a single shared representation.
pub fn normalize_key_name(raw: &str) -> String {
    if raw == " " {
        return "Space".to_string();
    }
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    match trimmed {
        "space" | "Space" | "Spacebar" => return "Space".to_string(),
        "Enter" | "Return" | "KP_Enter" => return "Return".to_string(),
        "Escape" | "Esc" => return "Escape".to_string(),
        "Backspace" | "BackSpace" => return "Backspace".to_string(),
        "ArrowUp" | "Up" => return "ArrowUp".to_string(),
        "ArrowDown" | "Down" => return "ArrowDown".to_string(),
        "ArrowLeft" | "Left" => return "ArrowLeft".to_string(),
        "ArrowRight" | "Right" => return "ArrowRight".to_string(),
        "PageUp" | "Page_Up" | "Prior" => return "PageUp".to_string(),
        "PageDown" | "Page_Down" | "Next" => return "PageDown".to_string(),
        "Tab" | "ISO_Left_Tab" => return "Tab".to_string(),
        "plus" | "KP_Add" => return "+".to_string(),
        "minus" | "KP_Subtract" => return "-".to_string(),
        "period" | "KP_Decimal" => return ".".to_string(),
        "comma" => return ",".to_string(),
        "slash" | "KP_Divide" => return "/".to_string(),
        _ => {}
    }

    if let Some(num) = trimmed.strip_prefix("KP_")
        && num.len() == 1
        && num.chars().all(|c| c.is_ascii_digit())
    {
        return num.to_string();
    }

    if let Some(rest) = trimmed.strip_prefix(['f', 'F'])
        && !rest.is_empty()
        && rest.chars().all(|c| c.is_ascii_digit())
    {
        return format!("F{rest}");
    }

    if trimmed.chars().count() == 1 {
        return trimmed.to_lowercase();
    }

    trimmed.to_string()
}

fn normalize_list(keys: &mut Vec<String>) {
    let mut normalized = Vec::with_capacity(keys.len());
    for raw in keys.iter() {
        let canon = normalize_key_name(raw);
        if !canon.is_empty() && !normalized.contains(&canon) {
            normalized.push(canon);
        }
    }
    *keys = normalized;
}

impl KeymapConfig {
    pub fn normalize(&mut self) {
        normalize_list(&mut self.up);
        normalize_list(&mut self.down);
        normalize_list(&mut self.left);
        normalize_list(&mut self.right);
        normalize_list(&mut self.select);
        normalize_list(&mut self.back);
        normalize_list(&mut self.toggle_epg);
        normalize_list(&mut self.toggle_osd);
        normalize_list(&mut self.toggle_mute);
        normalize_list(&mut self.toggle_fullscreen);
        normalize_list(&mut self.channel_up);
        normalize_list(&mut self.channel_down);
    }

    pub fn normalized(mut self) -> Self {
        self.normalize();
        self
    }

    pub fn resolve_action(&self, raw_key: &str) -> Option<KeyAction> {
        let key = normalize_key_name(raw_key);
        if key.is_empty() {
            return None;
        }

        let groups: [(KeyAction, &[String]); 12] = [
            (KeyAction::Up, &self.up),
            (KeyAction::Down, &self.down),
            (KeyAction::Left, &self.left),
            (KeyAction::Right, &self.right),
            (KeyAction::Select, &self.select),
            (KeyAction::Back, &self.back),
            (KeyAction::ToggleEpg, &self.toggle_epg),
            (KeyAction::ToggleOsd, &self.toggle_osd),
            (KeyAction::ToggleMute, &self.toggle_mute),
            (KeyAction::ToggleFullscreen, &self.toggle_fullscreen),
            (KeyAction::ChannelUp, &self.channel_up),
            (KeyAction::ChannelDown, &self.channel_down),
        ];

        for (action, list) in groups {
            if list.iter().any(|bound| normalize_key_name(bound) == key) {
                return Some(action);
            }
        }

        if self.wasd_navigation {
            match key.as_str() {
                "w" => return Some(KeyAction::Up),
                "s" => return Some(KeyAction::Down),
                "a" => return Some(KeyAction::Left),
                "d" => return Some(KeyAction::Right),
                _ => {}
            }
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_keymap_resolves_gtk_and_web_key_names() {
        let cfg = KeymapConfig::default();

        assert_eq!(cfg.resolve_action("ArrowUp"), Some(KeyAction::Up));
        assert_eq!(cfg.resolve_action("Up"), Some(KeyAction::Up));
        assert_eq!(cfg.resolve_action("Down"), Some(KeyAction::Down));
        assert_eq!(cfg.resolve_action("Left"), Some(KeyAction::Left));
        assert_eq!(cfg.resolve_action("Right"), Some(KeyAction::Right));

        assert_eq!(cfg.resolve_action("Return"), Some(KeyAction::Select));
        assert_eq!(cfg.resolve_action("Enter"), Some(KeyAction::Select));
        assert_eq!(cfg.resolve_action("KP_Enter"), Some(KeyAction::Select));
        assert_eq!(cfg.resolve_action("space"), Some(KeyAction::Select));
        assert_eq!(cfg.resolve_action(" "), Some(KeyAction::Select));

        assert_eq!(cfg.resolve_action("Escape"), Some(KeyAction::Back));
        assert_eq!(cfg.resolve_action("BackSpace"), Some(KeyAction::Back));
        assert_eq!(cfg.resolve_action("Backspace"), Some(KeyAction::Back));

        assert_eq!(cfg.resolve_action("e"), Some(KeyAction::ToggleEpg));
        assert_eq!(cfg.resolve_action("E"), Some(KeyAction::ToggleEpg));
        assert_eq!(cfg.resolve_action("i"), Some(KeyAction::ToggleOsd));
        assert_eq!(cfg.resolve_action("I"), Some(KeyAction::ToggleOsd));
        assert_eq!(cfg.resolve_action("m"), Some(KeyAction::ToggleMute));
        assert_eq!(cfg.resolve_action("M"), Some(KeyAction::ToggleMute));
        assert_eq!(cfg.resolve_action("F11"), Some(KeyAction::ToggleFullscreen));
        assert_eq!(cfg.resolve_action("f"), Some(KeyAction::ToggleFullscreen));
        assert_eq!(cfg.resolve_action("F"), Some(KeyAction::ToggleFullscreen));
        assert_eq!(cfg.resolve_action("Page_Up"), Some(KeyAction::ChannelUp));
        assert_eq!(cfg.resolve_action("PageUp"), Some(KeyAction::ChannelUp));
        assert_eq!(cfg.resolve_action("Page_Down"), Some(KeyAction::ChannelDown));
        assert_eq!(cfg.resolve_action("PageDown"), Some(KeyAction::ChannelDown));
    }

    #[test]
    fn custom_keymap_and_wasd_toggle_behave_cleanly() {
        let mut cfg = KeymapConfig::default();
        assert_eq!(cfg.resolve_action("w"), None);

        cfg.wasd_navigation = true;
        assert_eq!(cfg.resolve_action("w"), Some(KeyAction::Up));
        assert_eq!(cfg.resolve_action("A"), Some(KeyAction::Left));
        assert_eq!(cfg.resolve_action("s"), Some(KeyAction::Down));
        assert_eq!(cfg.resolve_action("D"), Some(KeyAction::Right));

        // Explicit binding takes precedence over optional WASD fallback
        cfg.toggle_osd = vec!["w".to_string()];
        assert_eq!(cfg.resolve_action("w"), Some(KeyAction::ToggleOsd));
    }
}
