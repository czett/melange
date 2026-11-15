import { createSignal } from "solid-js";
import type { KeyAction, KeymapConfig } from "../bridge/types";

export const KEYMAP_STORAGE_KEY = "melange.keymap.v1";

export type KeymapFieldKey = Exclude<keyof KeymapConfig, "wasd_navigation">;

export const DEFAULT_KEYMAP: KeymapConfig = {
  up: ["ArrowUp"],
  down: ["ArrowDown"],
  left: ["ArrowLeft"],
  right: ["ArrowRight"],
  select: ["Return", "Space"],
  back: ["Escape", "Backspace"],
  toggle_epg: ["e"],
  toggle_osd: ["i"],
  toggle_mute: ["m"],
  toggle_fullscreen: ["F11", "f"],
  channel_up: ["PageUp"],
  channel_down: ["PageDown"],
  open_settings: [",", "s"],
  open_home: ["h"],
  open_live_tv: ["t"],
  open_mediathek: ["d"],
  open_youtube: ["y"],
  open_search: ["/"],
  wasd_navigation: false
};

export const KEYMAP_FIELDS: {
  key: KeymapFieldKey;
  action: KeyAction;
  label: string;
  description: string;
}[] = [
  { key: "up", action: "Up", label: "Navigate Up", description: "Move spatial focus upward" },
  { key: "down", action: "Down", label: "Navigate Down", description: "Move spatial focus downward" },
  { key: "left", action: "Left", label: "Navigate Left", description: "Move spatial focus left" },
  { key: "right", action: "Right", label: "Navigate Right", description: "Move spatial focus right" },
  {
    key: "select",
    action: "Select",
    label: "Select / Confirm",
    description: "Activate focused tile or toggle play/pause"
  },
  {
    key: "back",
    action: "Back",
    label: "Back / Leave",
    description: "Dismiss overlay, return home, or open leave menu"
  },
  {
    key: "toggle_epg",
    action: "ToggleEpg",
    label: "Program Guide (EPG)",
    description: "Open or close the full TV program guide"
  },
  {
    key: "toggle_osd",
    action: "ToggleOsd",
    label: "Toggle OSD / Info",
    description: "Show or hide Live TV banner and player controls"
  },
  {
    key: "toggle_mute",
    action: "ToggleMute",
    label: "Toggle Mute",
    description: "Mute or unmute audio output"
  },
  {
    key: "toggle_fullscreen",
    action: "ToggleFullscreen",
    label: "Toggle Fullscreen",
    description: "Switch between windowed and fullscreen"
  },
  {
    key: "channel_up",
    action: "ChannelUp",
    label: "Channel Up",
    description: "Tune to the next TV channel"
  },
  {
    key: "channel_down",
    action: "ChannelDown",
    label: "Channel Down",
    description: "Tune to the previous TV channel"
  },
  {
    key: "open_settings",
    action: "OpenSettings",
    label: "Open Settings",
    description: "Jump directly to the Settings screen"
  },
  {
    key: "open_home",
    action: "OpenHome",
    label: "Go Home",
    description: "Return directly to the Home screen"
  },
  {
    key: "open_live_tv",
    action: "OpenLiveTv",
    label: "Open Live TV",
    description: "Tune the active or first Live TV channel"
  },
  {
    key: "open_mediathek",
    action: "OpenMediathek",
    label: "Open Mediathek",
    description: "Browse ARD / ZDF Mediathek"
  },
  {
    key: "open_youtube",
    action: "OpenYouTube",
    label: "Open YouTube",
    description: "Browse YouTube On Demand"
  },
  {
    key: "open_search",
    action: "OpenSearch",
    label: "Open Search",
    description: "Open search keyboard in Mediathek or YouTube"
  }
];

export function normalizeKeyName(raw: string): string {
  if (raw === " ") return "Space";
  const trimmed = raw.trim();
  if (!trimmed) return "";

  switch (trimmed) {
    case "space":
    case "Space":
    case "Spacebar":
      return "Space";
    case "Enter":
    case "Return":
    case "KP_Enter":
      return "Return";
    case "Escape":
    case "Esc":
      return "Escape";
    case "Backspace":
    case "BackSpace":
      return "Backspace";
    case "ArrowUp":
    case "Up":
      return "ArrowUp";
    case "ArrowDown":
    case "Down":
      return "ArrowDown";
    case "ArrowLeft":
    case "Left":
      return "ArrowLeft";
    case "ArrowRight":
    case "Right":
      return "ArrowRight";
    case "PageUp":
    case "Page_Up":
    case "Prior":
      return "PageUp";
    case "PageDown":
    case "Page_Down":
    case "Next":
      return "PageDown";
    case "Tab":
    case "ISO_Left_Tab":
      return "Tab";
    case "plus":
    case "KP_Add":
      return "+";
    case "minus":
    case "KP_Subtract":
      return "-";
    case "period":
    case "KP_Decimal":
      return ".";
    case "comma":
      return ",";
    case "slash":
    case "KP_Divide":
      return "/";
    default:
      break;
  }

  if (/^[fF]\d+$/.test(trimmed)) {
    return `F${trimmed.slice(1)}`;
  }
  if (trimmed.length === 1) {
    return trimmed.toLowerCase();
  }
  return trimmed;
}

export function formatKeyCap(key: string): string {
  const canon = normalizeKeyName(key);
  if (canon.length === 1) {
    return canon.toUpperCase();
  }
  return canon;
}

function normalizeList(list: unknown, fallback: string[]): string[] {
  if (!Array.isArray(list)) return [...fallback];
  const seen = new Set<string>();
  for (const item of list) {
    if (typeof item !== "string") continue;
    const canon = normalizeKeyName(item);
    if (canon) seen.add(canon);
  }
  return seen.size > 0 ? Array.from(seen) : [...fallback];
}

export function normalizeKeymap(raw: Partial<KeymapConfig> | null | undefined): KeymapConfig {
  return {
    up: normalizeList(raw?.up, DEFAULT_KEYMAP.up),
    down: normalizeList(raw?.down, DEFAULT_KEYMAP.down),
    left: normalizeList(raw?.left, DEFAULT_KEYMAP.left),
    right: normalizeList(raw?.right, DEFAULT_KEYMAP.right),
    select: normalizeList(raw?.select, DEFAULT_KEYMAP.select),
    back: normalizeList(raw?.back, DEFAULT_KEYMAP.back),
    toggle_epg: normalizeList(raw?.toggle_epg, DEFAULT_KEYMAP.toggle_epg),
    toggle_osd: normalizeList(raw?.toggle_osd, DEFAULT_KEYMAP.toggle_osd),
    toggle_mute: normalizeList(raw?.toggle_mute, DEFAULT_KEYMAP.toggle_mute),
    toggle_fullscreen: normalizeList(raw?.toggle_fullscreen, DEFAULT_KEYMAP.toggle_fullscreen),
    channel_up: normalizeList(raw?.channel_up, DEFAULT_KEYMAP.channel_up),
    channel_down: normalizeList(raw?.channel_down, DEFAULT_KEYMAP.channel_down),
    open_settings: normalizeList(raw?.open_settings, DEFAULT_KEYMAP.open_settings),
    open_home: normalizeList(raw?.open_home, DEFAULT_KEYMAP.open_home),
    open_live_tv: normalizeList(raw?.open_live_tv, DEFAULT_KEYMAP.open_live_tv),
    open_mediathek: normalizeList(raw?.open_mediathek, DEFAULT_KEYMAP.open_mediathek),
    open_youtube: normalizeList(raw?.open_youtube, DEFAULT_KEYMAP.open_youtube),
    open_search: normalizeList(raw?.open_search, DEFAULT_KEYMAP.open_search),
    wasd_navigation: Boolean(raw?.wasd_navigation)
  };
}

function keymapsEqual(a: KeymapConfig, b: KeymapConfig): boolean {
  return JSON.stringify(normalizeKeymap(a)) === JSON.stringify(normalizeKeymap(b));
}

function readLocalKeymap(): KeymapConfig | null {
  try {
    const raw = window.localStorage.getItem(KEYMAP_STORAGE_KEY);
    if (!raw) return null;
    return normalizeKeymap(JSON.parse(raw) as Partial<KeymapConfig>);
  } catch {
    return null;
  }
}

function writeLocalKeymap(cfg: KeymapConfig): void {
  try {
    window.localStorage.setItem(KEYMAP_STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // ignore storage errors
  }
}

const [keymap, setKeymap] = createSignal<KeymapConfig>(readLocalKeymap() ?? DEFAULT_KEYMAP);

export async function loadKeymap(): Promise<void> {
  const local = readLocalKeymap();
  try {
    const res = await fetch("/api/keymap");
    if (res.ok) {
      const serverCfg = normalizeKeymap((await res.json()) as Partial<KeymapConfig>);
      if (keymapsEqual(serverCfg, DEFAULT_KEYMAP) && local && !keymapsEqual(local, DEFAULT_KEYMAP)) {
        await saveKeymap(local);
        return;
      }
      setKeymap(serverCfg);
      writeLocalKeymap(serverCfg);
      return;
    }
  } catch {
    // ignore network error; local cache remains active
  }
  if (local) {
    setKeymap(local);
  }
}

export async function saveKeymap(next: KeymapConfig): Promise<KeymapConfig> {
  const normalized = normalizeKeymap(next);
  setKeymap(normalized);
  writeLocalKeymap(normalized);
  try {
    const res = await fetch("/api/keymap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(normalized)
    });
    if (res.ok) {
      const confirmed = normalizeKeymap((await res.json()) as Partial<KeymapConfig>);
      setKeymap(confirmed);
      writeLocalKeymap(confirmed);
      return confirmed;
    }
  } catch {
    // ignore transient sync error; local state stays updated
  }
  return normalized;
}

export async function resetKeymap(): Promise<KeymapConfig> {
  return saveKeymap(DEFAULT_KEYMAP);
}

export function resolveBrowserKeyAction(rawKey: string): KeyAction | null {
  const canon = normalizeKeyName(rawKey);
  if (!canon) return null;
  const cfg = keymap();
  for (const field of KEYMAP_FIELDS) {
    if (
      cfg.wasd_navigation &&
      ((field.action === "OpenSettings" &&
        canon === "s" &&
        JSON.stringify(cfg.open_settings) === JSON.stringify(DEFAULT_KEYMAP.open_settings)) ||
        (field.action === "OpenMediathek" &&
          canon === "d" &&
          JSON.stringify(cfg.open_mediathek) === JSON.stringify(DEFAULT_KEYMAP.open_mediathek)))
    ) {
      continue;
    }
    if (cfg[field.key].some((k) => normalizeKeyName(k) === canon)) {
      return field.action;
    }
  }
  if (cfg.wasd_navigation) {
    switch (canon) {
      case "w":
        return "Up";
      case "s":
        return "Down";
      case "a":
        return "Left";
      case "d":
        return "Right";
    }
  }
  return null;
}

export { keymap };
