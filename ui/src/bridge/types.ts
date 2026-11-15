export type AppMode = "Home" | "LiveTv" | "Mediathek" | "YouTube" | "Media" | "Settings";

export type OverlayKind =
  | "None"
  | "ZapBanner"
  | "MiniEpg"
  | "FullEpg"
  | "ProfileSwitcher"
  | "PlayerOsd"
  | "SearchKeyboard"
  | "LeaveMenu";

export type PlaybackState = "Idle" | "Buffering" | "Playing" | "Paused";

export type SoundKind = "focus" | "nav" | "select" | "back" | "zap" | "error";

export interface Profile {
  id: number;
  name: string;
  avatar?: string;
  wallpaper_path?: string | null;
  created_at: string;
}

export interface Channel {
  id: number;
  number: number;
  tvg_id: string;
  name: string;
  group_title: string;
  logo_url: string;
  stream_url: string;
}

export interface EpgEntry {
  id: number;
  channel_tvg_id: string;
  title: string;
  description: string;
  start_time: string;
  stop_time: string;
}

export interface EpgNowNext {
  channel_tvg_id: string;
  now: EpgEntry | null;
  next: EpgEntry | null;
}

export interface MediaItem {
  id: string;
  provider: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  channel_or_author: string;
  duration_sec: number;
  thumbnail_url: string | null;
  stream_url: string;
  published_at: string | null;
}

export interface WatchHistoryEntry {
  id: number;
  profile_id: number;
  item_id: string;
  provider: string;
  title: string;
  stream_url: string;
  thumbnail_url: string | null;
  position_sec: number;
  duration_sec: number;
  updated_at: string;
}

export interface PlaybackSnapshot {
  state: PlaybackState;
  title: string | null;
  subtitle: string | null;
  channel_id: number | null;
  channel_number: number | null;
  current_media: MediaItem | null;
  position_sec: number;
  duration_sec: number;
  paused: boolean;
  is_zapping: boolean;
}

export interface MelangeState {
  mode: AppMode;
  overlay: OverlayKind;
  is_fullscreen: boolean;
  active_profile: Profile | null;
  profiles: Profile[];
  channels: Channel[];
  epg_now_next: Record<string, EpgNowNext>;
  playback: PlaybackSnapshot;
  digit_buffer: string;
  continue_watching: WatchHistoryEntry[];
}

export type NavEvent =
  | "Up"
  | "Down"
  | "Left"
  | "Right"
  | "Select"
  | "Back"
  | "Home"
  | "ChannelUp"
  | "ChannelDown"
  | "ToggleEpg"
  | { Digit: number };

export type ServerMessage =
  | { type: "StateSnapshot"; state: MelangeState }
  | { type: "StateUpdate"; state: MelangeState }
  | { type: "NavEvent"; event: NavEvent };

export type ClientCommand =
  | { type: "SelectChannel"; channel_id: number }
  | { type: "SetMode"; mode: AppMode }
  | { type: "SetOverlay"; overlay: OverlayKind }
  | { type: "SelectProfile"; profile_id: number }
  | { type: "SetPresetWallpaper"; profile_id: number; filename: string }
  | { type: "PlaySound"; sound: SoundKind }
  | { type: "PlayMedia"; item: MediaItem; resume: boolean }
  | { type: "SeekRelative"; offset_sec: number }
  | { type: "TogglePause" }
  | { type: "ToggleFullscreen" }
  | { type: "QuitApp" };
