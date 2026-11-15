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
  channel_id?: string | null;
  duration_sec: number;
  thumbnail_url: string | null;
  stream_url: string;
  published_at: string | null;
}

export interface YouTubeAccountSummary {
  profile_id: number;
  signed_in: boolean;
  account_name: string;
  account_avatar_url?: string | null;
  expires_at: number;
}

export interface YouTubeChannelChip {
  channel_id: string;
  title: string;
  avatar_url?: string | null;
}

export interface YouTubeFeedResponse {
  items: MediaItem[];
  channels: YouTubeChannelChip[];
  channel_title?: string | null;
  requires_auth: boolean;
  source: string;
}

export interface YouTubeAuthStartResponse {
  session_id: number;
  profile_id: number;
  user_code: string;
  verification_url: string;
  qr_svg: string;
  expires_in: number;
  interval: number;
}

export interface YouTubeAuthStatusResponse {
  status: string;
  account?: YouTubeAccountSummary | null;
  user_code?: string | null;
  verification_url?: string | null;
  error?: string | null;
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

export interface SponsorSegment {
  uuid: string;
  category: string;
  start_sec: number;
  end_sec: number;
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
  muted?: boolean;
  is_zapping: boolean;
  sponsor_segments?: SponsorSegment[];
  osd_notice?: string | null;
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
  youtube_account?: YouTubeAccountSummary | null;
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
  | "ToggleOsd"
  | "ToggleMute"
  | { Digit: number };

export type KeyAction =
  | "Up"
  | "Down"
  | "Left"
  | "Right"
  | "Select"
  | "Back"
  | "ToggleEpg"
  | "ToggleOsd"
  | "ToggleMute"
  | "ToggleFullscreen"
  | "ChannelUp"
  | "ChannelDown"
  | "OpenSettings"
  | "OpenHome"
  | "OpenLiveTv"
  | "OpenMediathek"
  | "OpenYouTube"
  | "OpenSearch";

export interface KeymapConfig {
  up: string[];
  down: string[];
  left: string[];
  right: string[];
  select: string[];
  back: string[];
  toggle_epg: string[];
  toggle_osd: string[];
  toggle_mute: string[];
  toggle_fullscreen: string[];
  channel_up: string[];
  channel_down: string[];
  open_settings: string[];
  open_home: string[];
  open_live_tv: string[];
  open_mediathek: string[];
  open_youtube: string[];
  open_search: string[];
  wasd_navigation: boolean;
}

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
  | { type: "SetKeyCapture"; active: boolean }
  | { type: "QuitApp" };
