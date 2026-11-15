import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { ScenicBackdrop } from './components/ScenicBackdrop';

interface Channel {
  id: number;
  number: number;
  tvg_id: string;
  name: string;
  group_title: string;
  logo_url: string;
  stream_url: string;
  is_favorite?: boolean;
}

interface Profile {
  id: number;
  name: string;
  avatar: string;
  wallpaper_path?: string | null;
}

interface WatchHistoryEntry {
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

interface EpgEntry {
  title: string;
  start_time: string;
  stop_time: string;
}

interface EpgNowNext {
  channel_tvg_id: string;
  now: EpgEntry | null;
  next: EpgEntry | null;
}

interface PlaybackSnapshot {
  channel_id: number | null;
  title: string | null;
  subtitle: string | null;
  paused: boolean;
}

type AppMode = 'Home' | 'LiveTv' | 'Mediathek' | 'YouTube' | 'Media' | 'Settings';
type Tab = 'remote' | 'watch';

const DEFAULT_PRESETS = ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg', '7.jpg'];

const APPS: {
  id: string;
  label: string;
  bg: string;
  action: { type: 'SetMode'; mode: AppMode } | { type: 'SetOverlay'; overlay: string };
}[] = [
  { id: 'livetv', label: 'Live TV', bg: '#181B22', action: { type: 'SetMode', mode: 'LiveTv' } },
  { id: 'guide', label: 'Guide', bg: '#1E2430', action: { type: 'SetOverlay', overlay: 'FullEpg' } },
  { id: 'mediathek', label: 'Mediathek', bg: '#0284C7', action: { type: 'SetMode', mode: 'Mediathek' } },
  { id: 'youtube', label: 'YouTube', bg: '#DC2626', action: { type: 'SetMode', mode: 'YouTube' } },
  { id: 'media', label: 'Media', bg: '#4F46E5', action: { type: 'SetMode', mode: 'Media' } },
  { id: 'settings', label: 'Settings', bg: '#262932', action: { type: 'SetMode', mode: 'Settings' } },
];

function AppTileIcon(props: { id: string }) {
  switch (props.id) {
    case 'livetv':
      return (
        <svg class="h-6 w-6 text-white" viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd">
          <path d="M5.6 4h12.8A2.6 2.6 0 0 1 21 6.6v7.8a2.6 2.6 0 0 1-2.6 2.6H5.6A2.6 2.6 0 0 1 3 14.4V6.6A2.6 2.6 0 0 1 5.6 4Zm4.6 3.7a.55.55 0 0 0-.84.47v4.66a.55.55 0 0 0 .84.47l3.9-2.33a.55.55 0 0 0 0-.94l-3.9-2.33Z" />
          <rect x="7.5" y="18.4" width="9" height="2.1" rx="1.05" />
        </svg>
      );
    case 'guide':
      return (
        <svg class="h-5 w-5 text-white" viewBox="0 0 24 24" fill="currentColor">
          <rect x="3" y="4.5" width="5" height="3.8" rx="1.4" />
          <rect x="9.5" y="4.5" width="11.5" height="3.8" rx="1.4" />
          <rect x="3" y="10.1" width="5" height="3.8" rx="1.4" />
          <rect x="9.5" y="10.1" width="6.2" height="3.8" rx="1.4" />
          <rect x="17" y="10.1" width="4" height="3.8" rx="1.4" />
          <rect x="3" y="15.7" width="5" height="3.8" rx="1.4" />
          <rect x="9.5" y="15.7" width="8.5" height="3.8" rx="1.4" />
        </svg>
      );
    case 'mediathek':
      return (
        <svg class="h-6 w-6 text-white" viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd">
          <path d="M6.4 4h11.2A3.4 3.4 0 0 1 21 7.4v9.2a3.4 3.4 0 0 1-3.4 3.4H6.4A3.4 3.4 0 0 1 3 16.6V7.4A3.4 3.4 0 0 1 6.4 4Zm3.8 4.4a.65.65 0 0 0-.98.56v6.08a.65.65 0 0 0 .98.56l5.2-3.04a.65.65 0 0 0 0-1.12l-5.2-3.04Z" />
        </svg>
      );
    case 'youtube':
      return (
        <svg class="h-6 w-6 translate-x-[0.5px] text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M7.8 6.15c0-.96 1.05-1.55 1.88-1.05l9.3 5.58a1.22 1.22 0 0 1 0 2.1l-9.3 5.58c-.83.5-1.88-.09-1.88-1.05V6.15Z" />
        </svg>
      );
    case 'media':
      return (
        <svg class="h-5 w-5 text-white" viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd">
          <path d="M5.6 4.2h12.8A2.6 2.6 0 0 1 21 6.8v10.4a2.6 2.6 0 0 1-2.6 2.6H5.6A2.6 2.6 0 0 1 3 17.2V6.8a2.6 2.6 0 0 1 2.6-2.6Zm-.9 2.7v2.1h2V6.9h-2Zm0 4.05v2.1h2v-2.1h-2Zm0 4.05v2.1h2V15h-2Zm12.6-8.1v2.1h2V6.9h-2Zm0 4.05v2.1h2v-2.1h-2Zm0 4.05v2.1h2V15h-2ZM9.4 7.4a1.2 1.2 0 0 0-1.2 1.2v6.8a1.2 1.2 0 0 0 1.2 1.2h5.2a1.2 1.2 0 0 0 1.2-1.2V8.6a1.2 1.2 0 0 0-1.2-1.2H9.4Zm1.4 2.45a.45.45 0 0 1 .68-.39l2.9 1.74a.45.45 0 0 1 0 .78l-2.9 1.74a.45.45 0 0 1-.68-.39V9.85Z" />
        </svg>
      );
    default:
      return (
        <svg class="h-5 w-5 text-white" viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd">
          <path d="M 19.03 10.43 L 21.61 10.71 Q 22.05 12.00 21.61 13.29 L 19.03 13.57 Q 18.51 14.70 18.08 15.86 L 19.71 17.88 Q 19.11 19.11 17.88 19.71 L 15.86 18.08 Q 14.70 18.51 13.57 19.03 L 13.29 21.61 Q 12.00 22.05 10.71 21.61 L 10.43 19.03 Q 9.30 18.51 8.14 18.08 L 6.12 19.71 Q 4.89 19.11 4.29 17.88 L 5.92 15.86 Q 5.49 14.70 4.97 13.57 L 2.39 13.29 Q 1.95 12.00 2.39 10.71 L 4.97 10.43 Q 5.49 9.30 5.92 8.14 L 4.29 6.12 Q 4.89 4.89 6.12 4.29 L 8.14 5.92 Q 9.30 5.49 10.43 4.97 L 10.71 2.39 Q 12.00 1.95 13.29 2.39 L 13.57 4.97 Q 14.70 5.49 15.86 5.92 L 17.88 4.29 Q 19.11 4.89 19.71 6.12 L 18.08 8.14 Q 18.51 9.30 19.03 10.43 Z M 15.30 12.00 A 3.3 3.3 0 1 0 8.70 12.00 A 3.3 3.3 0 1 0 15.30 12.00 Z" />
        </svg>
      );
  }
}

function formatRemaining(positionSec: number, durationSec: number): string {
  if (durationSec <= 0) return 'Resume';
  const remMin = Math.max(1, Math.round((durationSec - positionSec) / 60));
  if (remMin >= 60) {
    const h = Math.floor(remMin / 60);
    const m = remMin % 60;
    return m > 0 ? `${h}h ${m}m left` : `${h}h left`;
  }
  return `${remMin}m left`;
}

export default function App() {
  const [tab, setTab] = createSignal<Tab>('remote');
  const [channels, setChannels] = createSignal<Channel[]>([]);
  const [profiles, setProfiles] = createSignal<Profile[]>([]);
  const [activeProfile, setActiveProfile] = createSignal<Profile | null>(null);
  const [continueWatching, setContinueWatching] = createSignal<WatchHistoryEntry[]>([]);
  const [epgNowNext, setEpgNowNext] = createSignal<Record<string, EpgNowNext>>({});
  const [playback, setPlayback] = createSignal<PlaybackSnapshot>({
    channel_id: null,
    title: null,
    subtitle: null,
    paused: false,
  });
  const [tvMode, setTvMode] = createSignal<AppMode>('Home');
  const [connected, setConnected] = createSignal(false);
  const [statusMsg, setStatusMsg] = createSignal('');
  const [presets, setPresets] = createSignal<string[]>(DEFAULT_PRESETS);
  const [gestureFeedback, setGestureFeedback] = createSignal<string | null>(null);

  let ws: WebSocket | null = null;
  let toastTimer: number | undefined;
  let gestureTimer: number | undefined;

  const flash = (msg: string) => {
    setStatusMsg(msg);
    if (toastTimer !== undefined) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => setStatusMsg(''), 2200);
  };

  const pulseGesture = (label: string) => {
    setGestureFeedback(label);
    if (gestureTimer !== undefined) window.clearTimeout(gestureTimer);
    gestureTimer = window.setTimeout(() => setGestureFeedback(null), 260);
  };

  const sendCommand = (cmd: Record<string, unknown>) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(cmd));
    }
  };

  onMount(() => {
    let reconnectTimer: number | undefined;
    let disposed = false;

    void (async () => {
      try {
        const res = await fetch('/api/wallpapers');
        if (res.ok) {
          const list = (await res.json()) as unknown;
          if (Array.isArray(list)) {
            const valid = list.filter((item): item is string => typeof item === 'string');
            if (valid.length > 0) setPresets(valid);
          }
        }
      } catch {
        // ignore
      }
    })();

    const connect = () => {
      if (disposed) return;
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        ws = null;
        if (!disposed) {
          reconnectTimer = window.setTimeout(connect, 1200);
        }
      };
      ws.onerror = () => ws?.close();
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          const st =
            msg.type === 'StateSnapshot' || msg.type === 'StateUpdate'
              ? msg.state
              : msg.Snapshot?.state ?? msg.StateUpdate?.state;
          if (st) {
            if (Array.isArray(st.channels)) setChannels(st.channels);
            if (Array.isArray(st.profiles)) setProfiles(st.profiles);
            if ('active_profile' in st) setActiveProfile(st.active_profile ?? null);
            if (Array.isArray(st.continue_watching)) setContinueWatching(st.continue_watching);
            if (st.epg_now_next && typeof st.epg_now_next === 'object') {
              setEpgNowNext(st.epg_now_next);
            }
            if (st.playback) setPlayback(st.playback);
            if (typeof st.mode === 'string') setTvMode(st.mode as AppMode);
          }
        } catch {
          // ignore
        }
      };
    };

    connect();

    onCleanup(() => {
      disposed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      if (toastTimer !== undefined) window.clearTimeout(toastTimer);
      if (gestureTimer !== undefined) window.clearTimeout(gestureTimer);
      ws?.close();
    });
  });

  const sendNav = async (event: string | { Digit: number }) => {
    await fetch('/api/remote/nav', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event }),
    });
  };

  const handleSearchOnTv = () => {
    const mode = tvMode();
    if (mode === 'Mediathek' || mode === 'YouTube' || mode === 'Media') {
      sendCommand({ type: 'SetOverlay', overlay: 'SearchKeyboard' });
    } else {
      sendCommand({ type: 'SetMode', mode: 'Mediathek' });
      window.setTimeout(() => {
        sendCommand({ type: 'SetOverlay', overlay: 'SearchKeyboard' });
      }, 60);
    }
    flash('Search opened on TV');
  };

  const selectPresetWallpaper = async (filename: string) => {
    const profileId = activeProfile()?.id ?? profiles()[0]?.id ?? 1;
    await fetch(`/api/profiles/${profileId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallpaper_path: `/wallpapers/${filename}` }),
    });
    flash('Scene updated');
  };

  const resumeWatchEntry = (cw: WatchHistoryEntry) => {
    sendCommand({
      type: 'PlayMedia',
      item: {
        id: cw.item_id,
        provider: cw.provider,
        title: cw.title,
        subtitle: null,
        description: null,
        channel_or_author: cw.provider,
        duration_sec: Math.round(cw.duration_sec),
        thumbnail_url: cw.thumbnail_url,
        stream_url: cw.stream_url,
        published_at: null,
      },
      resume: true,
    });
    flash(`Resuming ${cw.title}`);
  };

  // Touch Trackpad pointer gesture state
  let activePointerId: number | null = null;
  let anchorX = 0;
  let anchorY = 0;
  let startX = 0;
  let startY = 0;
  let didSwipe = false;

  const SWIPE_THRESHOLD = 34;
  const TAP_SLOP = 14;

  const onTrackpadPointerDown = (e: PointerEvent) => {
    activePointerId = e.pointerId;
    anchorX = e.clientX;
    anchorY = e.clientY;
    startX = e.clientX;
    startY = e.clientY;
    didSwipe = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onTrackpadPointerMove = (e: PointerEvent) => {
    if (activePointerId !== e.pointerId) return;
    const dx = e.clientX - anchorX;
    const dy = e.clientY - anchorY;
    if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) return;

    didSwipe = true;
    if (Math.abs(dx) >= Math.abs(dy)) {
      const dir = dx > 0 ? 'Right' : 'Left';
      anchorX = e.clientX;
      anchorY = e.clientY;
      pulseGesture(dir);
      void sendNav(dir);
    } else {
      const dir = dy > 0 ? 'Down' : 'Up';
      anchorX = e.clientX;
      anchorY = e.clientY;
      pulseGesture(dir);
      void sendNav(dir);
    }
  };

  const onTrackpadPointerUp = (e: PointerEvent) => {
    if (activePointerId !== e.pointerId) return;
    activePointerId = null;
    const totalMove = Math.hypot(e.clientX - startX, e.clientY - startY);
    if (!didSwipe && totalMove <= TAP_SLOP) {
      pulseGesture('Select');
      void sendNav('Select');
    }
  };

  const onTrackpadPointerCancel = (e: PointerEvent) => {
    if (activePointerId === e.pointerId) {
      activePointerId = null;
    }
  };

  const profilePills = createMemo(() => {
    const list = profiles();
    const activeId = activeProfile()?.id;
    if (list.length === 0) {
      return [{ id: 1, name: activeProfile()?.name ?? 'Default', active: true }];
    }
    return list.map((p) => ({
      id: p.id,
      name: p.name,
      active: p.id === activeId,
    }));
  });

  const currentWallpaper = () => activeProfile()?.wallpaper_path ?? '/wallpapers/1.jpg';

  return (
    <div class="relative mx-auto flex min-h-screen max-w-md flex-col overflow-x-hidden">
      <ScenicBackdrop class="-z-10" />

      {/* Top Bar: Profile SegmentedPill + Settings & Power/Leave circular buttons */}
      <header class="sticky top-0 z-20 flex items-center justify-between gap-2 px-4 pt-4">
        <div class="no-scrollbar flex min-w-0 items-center gap-2 overflow-x-auto">
          <div class="segmented-pill">
            <For each={profilePills()}>
              {(p) => (
                <button
                  type="button"
                  data-active={p.active ? 'true' : undefined}
                  onClick={() => {
                    sendCommand({ type: 'SelectProfile', profile_id: p.id });
                    flash(p.name);
                  }}
                  class="segmented-item h-7 px-3 text-[12px]"
                >
                  <span
                    class={
                      p.active
                        ? connected()
                          ? 'live-dot'
                          : 'h-1.5 w-1.5 rounded-full bg-[#111318]/40'
                        : 'hidden'
                    }
                  />
                  <span>{p.name}</span>
                </button>
              )}
            </For>
          </div>
        </div>

        <div class="flex shrink-0 items-center gap-2">
          <button
            type="button"
            aria-label="TV Settings"
            title="TV Settings"
            onClick={() => {
              sendCommand({ type: 'SetMode', mode: 'Settings' });
              flash('Settings on TV');
            }}
            class="circle-btn h-9 w-9"
          >
            <svg
              class="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.9"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>

          <button
            type="button"
            aria-label="Power / Leave Menu"
            title="Leave Melange"
            onClick={() => {
              sendCommand({ type: 'SetOverlay', overlay: 'LeaveMenu' });
              flash('Leave menu');
            }}
            class="circle-btn h-9 w-9"
          >
            <svg
              class="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.9"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M12 2v10" />
              <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
            </svg>
          </button>
        </div>
      </header>

      {/* Subtle status toast */}
      <Show when={statusMsg()}>
        <div class="pointer-events-none fixed left-1/2 top-16 z-30 -translate-x-1/2">
          <span class="rounded-full bg-white px-3 py-1 text-[11px] font-semibold tracking-[-0.01em] text-[#111318] shadow-lg">
            {statusMsg()}
          </span>
        </div>
      </Show>

      <main class="flex flex-1 flex-col overflow-y-auto px-4 pb-24 pt-5">
        {/* REMOTE TAB */}
        <Show when={tab() === 'remote'}>
          <div class="flex flex-1 flex-col justify-between gap-5">
            {/* Compact Now Playing indicator */}
            <div class="flex items-center justify-between px-1">
              <div>
                <div class="eyebrow">Remote</div>
                <h1 class="mt-0.5 text-[22px] font-semibold leading-tight tracking-[-0.025em] text-white">
                  {playback().title ?? 'Couch TV'}
                </h1>
              </div>
              <Show when={playback().subtitle}>
                <span class="max-w-[160px] truncate rounded-full border border-white/[0.11] bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-white/80">
                  {playback().subtitle}
                </span>
              </Show>
            </div>

            {/* Trackpad flanked by compact circular transport/navigation buttons */}
            <div class="flex items-center gap-2.5">
              {/* Left flanking circular buttons: Back, Home, Play/Pause */}
              <div class="flex shrink-0 flex-col items-center justify-between gap-3 py-2">
                <button
                  type="button"
                  aria-label="Back"
                  title="Back"
                  onClick={() => void sendNav('Back')}
                  class="circle-btn h-11 w-11"
                >
                  <svg
                    class="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </button>

                <button
                  type="button"
                  aria-label="Home"
                  title="Home"
                  onClick={() => void sendNav('Home')}
                  class="circle-btn h-11 w-11"
                >
                  <svg
                    class="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.9"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M3 10.5 12 3l9 7.5" />
                    <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
                  </svg>
                </button>

                <button
                  type="button"
                  aria-label="Play / Pause"
                  title="Play / Pause"
                  onClick={() => void sendNav('PlayPause')}
                  class="circle-btn h-11 w-11"
                >
                  <svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="6,5 13,12 6,19" />
                    <rect x="15" y="5" width="2.4" height="14" rx="1" />
                    <rect x="19" y="5" width="2.4" height="14" rx="1" />
                  </svg>
                </button>
              </div>

              {/* Center Touch Trackpad */}
              <div
                role="application"
                aria-label="Touch trackpad — swipe to navigate, tap to select"
                onPointerDown={onTrackpadPointerDown}
                onPointerMove={onTrackpadPointerMove}
                onPointerUp={onTrackpadPointerUp}
                onPointerCancel={onTrackpadPointerCancel}
                style={{ 'touch-action': 'none' }}
                class={`relative flex h-64 flex-1 cursor-pointer select-none flex-col items-center justify-center rounded-3xl border transition-colors duration-150 ${
                  gestureFeedback()
                    ? 'border-white/[0.28] bg-white/[0.14]'
                    : 'border-white/[0.12] bg-white/[0.07]'
                }`}
              >
                <div class="flex flex-col items-center gap-2 text-center">
                  <div
                    class={`flex h-9 w-9 items-center justify-center rounded-full border transition-transform duration-150 ${
                      gestureFeedback()
                        ? 'scale-110 border-white/40 bg-white/20 text-white'
                        : 'border-white/[0.12] bg-white/[0.06] text-white/60'
                    }`}
                  >
                    <Show
                      when={gestureFeedback()}
                      fallback={<span class="h-1.5 w-1.5 rounded-full bg-white/70" />}
                    >
                      {(dir) => (
                        <span class="text-[11px] font-semibold">
                          {dir() === 'Up'
                            ? '↑'
                            : dir() === 'Down'
                              ? '↓'
                              : dir() === 'Left'
                                ? '←'
                                : dir() === 'Right'
                                  ? '→'
                                  : '•'}
                        </span>
                      )}
                    </Show>
                  </div>
                  <span class="px-4 text-[11px] font-medium text-white/45">
                    Swipe to navigate · Tap to select
                  </span>
                </div>
              </div>

              {/* Right flanking circular buttons: EPG, Ch +, Ch - */}
              <div class="flex shrink-0 flex-col items-center justify-between gap-3 py-2">
                <button
                  type="button"
                  aria-label="EPG Guide"
                  title="EPG Guide"
                  onClick={() => void sendNav('ToggleEpg')}
                  class="circle-btn h-11 w-11 text-[11px] font-semibold"
                >
                  EPG
                </button>

                <button
                  type="button"
                  aria-label="Channel Up"
                  title="Channel Up"
                  onClick={() => void sendNav('ChannelUp')}
                  class="circle-btn h-11 w-11 text-[12px] font-semibold"
                >
                  Ch+
                </button>

                <button
                  type="button"
                  aria-label="Channel Down"
                  title="Channel Down"
                  onClick={() => void sendNav('ChannelDown')}
                  class="circle-btn h-11 w-11 text-[12px] font-semibold"
                >
                  Ch−
                </button>
              </div>
            </div>

            {/* Full-width solid white Search on TV pill CTA */}
            <button
              type="button"
              onClick={handleSearchOnTv}
              class="pill pill-primary h-12 w-full rounded-full text-[14px] font-semibold"
            >
              <svg
                class="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <span>Search on TV</span>
            </button>
          </div>
        </Show>

        {/* WATCH TAB */}
        <Show when={tab() === 'watch'}>
          <div class="space-y-6">
            {/* Keep watching horizontal cards */}
            <section class="space-y-2.5">
              <div class="flex items-center justify-between px-1">
                <h2 class="text-[14px] font-semibold tracking-[-0.015em] text-white/95">
                  Keep watching
                </h2>
              </div>

              <Show
                when={continueWatching().length > 0}
                fallback={
                  <div class="glass-card rounded-[16px] px-4 py-3.5 text-[12px] font-medium text-white/65">
                    Nothing in progress yet. Start a show on TV to resume from here.
                  </div>
                }
              >
                <div class="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
                  <For each={continueWatching()}>
                    {(cw) => {
                      const pct = () =>
                        cw.duration_sec > 0
                          ? Math.round(
                              Math.min(100, Math.max(0, (cw.position_sec / cw.duration_sec) * 100))
                            )
                          : 0;

                      return (
                        <button
                          type="button"
                          onClick={() => resumeWatchEntry(cw)}
                          class="glass-card flex h-[76px] w-[264px] shrink-0 items-center gap-3 rounded-[16px] p-2 text-left transition-transform active:scale-[0.98]"
                        >
                          <div class="h-[58px] w-[90px] shrink-0 overflow-hidden rounded-[10px] bg-white/[0.06]">
                            <Show
                              when={cw.thumbnail_url}
                              fallback={
                                <div class="flex h-full w-full items-center justify-center text-white/60">
                                  <svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                                    <polygon points="8,6 18,12 8,18" />
                                  </svg>
                                </div>
                              }
                            >
                              {(thumb) => (
                                <img
                                  src={thumb()}
                                  alt={cw.title}
                                  class="h-full w-full object-cover"
                                  loading="lazy"
                                />
                              )}
                            </Show>
                          </div>

                          <div class="flex h-[58px] min-w-0 flex-1 flex-col justify-between py-0.5">
                            <div class="min-w-0">
                              <div class="truncate text-[13px] font-semibold text-white">
                                {cw.title}
                              </div>
                              <div class="mt-0.5 truncate text-[11px] font-medium text-white/65">
                                {formatRemaining(cw.position_sec, cw.duration_sec)}
                              </div>
                            </div>
                            <div class="h-[3px] w-full overflow-hidden rounded-full bg-white/20">
                              <div
                                class="h-full rounded-full bg-white"
                                style={{ width: `${pct()}%` }}
                              />
                            </div>
                          </div>
                        </button>
                      );
                    }}
                  </For>
                </div>
              </Show>
            </section>

            {/* Live TV channel switcher rows */}
            <section class="space-y-2.5">
              <div class="flex items-center justify-between px-1">
                <h2 class="text-[14px] font-semibold tracking-[-0.015em] text-white/95">
                  Live TV
                </h2>
                <Show when={channels().length > 0}>
                  <span class="text-[11px] font-medium tabular-nums text-white/60">
                    {channels().length} channels
                  </span>
                </Show>
              </div>

              <div class="space-y-2">
                <For
                  each={channels()}
                  fallback={
                    <div class="glass-card rounded-[16px] p-4 text-center text-[12px] font-medium text-white/70">
                      No channels synced yet.
                    </div>
                  }
                >
                  {(ch) => {
                    const isActive = () => playback().channel_id === ch.id;
                    const nowTitle = () => epgNowNext()[ch.tvg_id]?.now?.title;
                    return (
                      <button
                        type="button"
                        onClick={() => {
                          sendCommand({ type: 'SelectChannel', channel_id: ch.id });
                          flash(`Tuning ${ch.name}`);
                        }}
                        class={`flex h-14 w-full items-center justify-between rounded-[16px] border px-3.5 text-left transition-all duration-[260ms] ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.985] ${
                          isActive()
                            ? 'border-white/50 bg-[#f2f4f8]/90 text-[#111318] shadow-[0_10px_28px_rgba(0,0,0,0.28)]'
                            : 'border-white/[0.11] bg-[rgba(16,18,22,0.44)] text-white hover:scale-[1.016] hover:border-white/[0.32] hover:bg-white/[0.16]'
                        }`}
                      >
                        <div class="flex min-w-0 items-center gap-3">
                          <span
                            class={`flex h-8 min-w-[2rem] shrink-0 items-center justify-center rounded-[9px] px-2 text-[12px] font-semibold tabular-nums ${
                              isActive()
                                ? 'bg-[#111318]/10 text-[#111318]'
                                : 'bg-white/[0.08] text-white'
                            }`}
                          >
                            {ch.number}
                          </span>
                          <div class="min-w-0">
                            <div class="truncate text-[14px] font-semibold">{ch.name}</div>
                            <div
                              class={`truncate text-[11px] font-medium ${
                                isActive() ? 'text-[#111318]/65' : 'text-white/65'
                              }`}
                            >
                              {nowTitle() ?? (ch.group_title || 'Live broadcast')}
                            </div>
                          </div>
                        </div>

                        <Show when={isActive()}>
                          <span class="live-dot ml-2" />
                        </Show>
                      </button>
                    );
                  }}
                </For>
              </div>
            </section>

            {/* Apps squircle grid */}
            <section class="space-y-2.5">
              <div class="px-1 text-[14px] font-semibold tracking-[-0.015em] text-white/95">
                Apps
              </div>
              <div class="grid grid-cols-3 gap-2.5">
                <For each={APPS}>
                  {(app) => (
                    <button
                      type="button"
                      onClick={() => {
                        sendCommand(app.action);
                        flash(`Opening ${app.label}`);
                      }}
                      class="flex flex-col items-center gap-1.5 rounded-[16px] border border-white/[0.08] bg-white/[0.04] p-2.5 transition-transform active:scale-[0.96]"
                    >
                      <div
                        class="flex h-[52px] w-full items-center justify-center rounded-[14px] border border-white/[0.12]"
                        style={{ background: app.bg }}
                      >
                        <AppTileIcon id={app.id} />
                      </div>
                      <span class="text-[11px] font-medium text-white/85">{app.label}</span>
                    </button>
                  )}
                </For>
              </div>
            </section>

            {/* Wallpapers preset picker */}
            <section class="space-y-2.5">
              <div class="px-1 text-[14px] font-semibold tracking-[-0.015em] text-white/95">
                Wallpapers
              </div>
              <div class="glass-card rounded-[20px] p-3">
                <div class="grid grid-cols-4 gap-2">
                  <For each={presets()}>
                    {(file) => {
                      const isActive = () => currentWallpaper() === `/wallpapers/${file}`;
                      return (
                        <button
                          type="button"
                          onClick={() => void selectPresetWallpaper(file)}
                          aria-label={`Select wallpaper ${file}`}
                          aria-pressed={isActive()}
                          class={`relative aspect-video w-full overflow-hidden rounded-[10px] border transition-transform active:scale-[0.96] ${
                            isActive() ? 'border-white ring-1 ring-white' : 'border-white/[0.12]'
                          }`}
                        >
                          <img
                            src={`/wallpapers/${file}`}
                            alt={`Scene ${file}`}
                            class="h-full w-full object-cover"
                            loading="lazy"
                          />
                          <Show when={isActive()}>
                            <span class="absolute right-1 top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#22C55E] text-[9px] font-bold text-white">
                              ✓
                            </span>
                          </Show>
                        </button>
                      );
                    }}
                  </For>
                </div>
              </div>
            </section>
          </div>
        </Show>
      </main>

      {/* Bottom floating SegmentedPill switching Remote | Watch */}
      <nav class="pointer-events-none fixed bottom-4 left-0 right-0 z-20 flex justify-center px-4">
        <div class="segmented-pill segmented-pill--dock pointer-events-auto grid w-64 grid-cols-2">
          <button
            type="button"
            data-active={tab() === 'remote' ? 'true' : undefined}
            onClick={() => setTab('remote')}
            class="segmented-item"
          >
            Remote
          </button>
          <button
            type="button"
            data-active={tab() === 'watch' ? 'true' : undefined}
            onClick={() => setTab('watch')}
            class="segmented-item"
          >
            Watch
          </button>
        </div>
      </nav>
    </div>
  );
}
