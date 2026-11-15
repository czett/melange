import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { ScenicBackdrop } from './components/ScenicBackdrop';

interface Channel {
  id: number;
  number: number;
  name: string;
  group_title: string;
  is_favorite: boolean;
}

interface Profile {
  id: number;
  name: string;
  avatar: string;
  wallpaper_path?: string | null;
}

type Tab = 'remote' | 'channels' | 'profiles';

export default function App() {
  const [tab, setTab] = createSignal<Tab>('remote');
  const [channels, setChannels] = createSignal<Channel[]>([]);
  const [profiles, setProfiles] = createSignal<Profile[]>([]);
  const [connected, setConnected] = createSignal(false);
  const [newProfileName, setNewProfileName] = createSignal('');
  const [editingProfileId, setEditingProfileId] = createSignal<number | null>(null);
  const [editingName, setEditingName] = createSignal('');
  const [statusMsg, setStatusMsg] = createSignal('');
  const [presets, setPresets] = createSignal<string[]>([]);

  let toastTimer: number | undefined;
  const flash = (msg: string) => {
    setStatusMsg(msg);
    if (toastTimer !== undefined) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => setStatusMsg(''), 2200);
  };

  onMount(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let disposed = false;

    void (async () => {
      try {
        const res = await fetch('/api/wallpapers');
        if (res.ok) {
          const list = (await res.json()) as unknown;
          if (Array.isArray(list)) {
            setPresets(list.filter((item): item is string => typeof item === 'string'));
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

  const moveChannel = async (index: number, dir: -1 | 1) => {
    const list = [...channels()];
    const target = index + dir;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    setChannels(list);
    await fetch('/api/channels/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel_ids: list.map((c) => c.id) }),
    });
    flash('Channel order saved');
  };

  const toggleFavorite = async (id: number) => {
    await fetch(`/api/channels/${id}/favorite`, { method: 'POST' });
    flash('Favorite updated');
  };

  const createProfile = async (e: Event) => {
    e.preventDefault();
    const name = newProfileName().trim();
    if (!name) return;
    await fetch('/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, avatar: name.slice(0, 1).toUpperCase() }),
    });
    setNewProfileName('');
    flash('Profile created');
  };

  const startRename = (p: Profile) => {
    setEditingProfileId(p.id);
    setEditingName(p.name);
  };

  const cancelRename = () => {
    setEditingProfileId(null);
    setEditingName('');
  };

  const submitRename = async (id: number, currentName: string) => {
    const next = editingName().trim();
    if (!next || next === currentName) {
      cancelRename();
      return;
    }
    await fetch(`/api/profiles/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: next }),
    });
    cancelRename();
    flash('Profile renamed');
  };

  const uploadWallpaper = async (id: number, file: File) => {
    const form = new FormData();
    form.append('file', file);
    await fetch(`/api/profiles/${id}/wallpaper`, {
      method: 'POST',
      body: form,
    });
    flash('Wallpaper updated');
  };

  const selectPresetWallpaper = async (id: number, filename: string) => {
    await fetch(`/api/profiles/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallpaper_path: `/wallpapers/${filename}` }),
    });
    flash('Wallpaper updated');
  };

  const pageHeading = () => {
    switch (tab()) {
      case 'channels':
        return { eyebrow: 'Lineup', title: 'Channels' };
      case 'profiles':
        return { eyebrow: 'Household', title: 'Profiles' };
      default:
        return { eyebrow: 'Control', title: 'Remote' };
    }
  };

  return (
    <div class="relative mx-auto flex min-h-screen max-w-md flex-col overflow-x-hidden">
      <ScenicBackdrop class="-z-10" />

      <header class="sticky top-0 z-20 px-4 pt-3.5">
        <div class="flex h-11 items-center justify-between rounded-full border border-white/[0.11] bg-black/45 px-4 shadow-[0_12px_32px_rgba(0,0,0,0.36)] backdrop-blur-2xl">
          <div class="flex items-center gap-2">
            <span class="text-[14px] font-semibold tracking-[-0.02em] text-white">melange</span>
            <span
              class={connected() ? 'live-dot ml-0.5' : 'ml-0.5 h-1.5 w-1.5 rounded-full bg-white/30'}
              title={connected() ? 'Connected' : 'Reconnecting'}
            />
          </div>

          <Show
            when={statusMsg()}
            fallback={<span class="eyebrow">Companion</span>}
          >
            <span class="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-semibold tracking-[-0.01em] text-[#111318]">
              {statusMsg()}
            </span>
          </Show>
        </div>
      </header>

      <main class="flex-1 overflow-y-auto px-4 pb-24 pt-5">
        <div class="mb-5 px-1">
          <div class="eyebrow">{pageHeading().eyebrow}</div>
          <h1 class="mt-0.5 text-[26px] font-semibold leading-[1.1] tracking-[-0.03em] text-white">
            {pageHeading().title}
          </h1>
        </div>

        <Show when={tab() === 'remote'}>
          <div class="space-y-4">
            {/* Spatial D-Pad */}
            <div class="glass-card mx-auto max-w-[268px] rounded-[22px] p-4">
              <div class="grid grid-cols-3 gap-2.5">
                <div />
                <button
                  type="button"
                  onClick={() => void sendNav('Up')}
                  class="key flex h-12 items-center justify-center rounded-[14px] text-sm"
                  aria-label="Up"
                >
                  <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M18 15l-6-6-6 6" />
                  </svg>
                </button>
                <div />
                <button
                  type="button"
                  onClick={() => void sendNav('Left')}
                  class="key flex h-12 items-center justify-center rounded-[14px] text-sm"
                  aria-label="Left"
                >
                  <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => void sendNav('Select')}
                  class="flex h-12 items-center justify-center rounded-[14px] bg-white text-[13px] font-semibold tracking-[-0.01em] text-[#111318] shadow-[0_8px_20px_rgba(0,0,0,0.35)] transition-transform duration-150 focus-visible:outline-none active:scale-95"
                >
                  OK
                </button>
                <button
                  type="button"
                  onClick={() => void sendNav('Right')}
                  class="key flex h-12 items-center justify-center rounded-[14px] text-sm"
                  aria-label="Right"
                >
                  <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </button>
                <div />
                <button
                  type="button"
                  onClick={() => void sendNav('Down')}
                  class="key flex h-12 items-center justify-center rounded-[14px] text-sm"
                  aria-label="Down"
                >
                  <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                <div />
              </div>
            </div>

            {/* Quick Action Pills */}
            <div class="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => void sendNav('Back')}
                class="pill pill-secondary w-full"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={() => void sendNav('Home')}
                class="pill pill-secondary w-full"
              >
                Home
              </button>
              <button
                type="button"
                onClick={() => void sendNav('ToggleEpg')}
                class="pill pill-secondary w-full"
              >
                Guide
              </button>
              <button
                type="button"
                onClick={() => void sendNav('ChannelDown')}
                class="pill pill-secondary w-full"
              >
                Ch −
              </button>
              <button
                type="button"
                onClick={() => void sendNav('PlayPause')}
                class="pill pill-secondary w-full"
              >
                Play / Pause
              </button>
              <button
                type="button"
                onClick={() => void sendNav('ChannelUp')}
                class="pill pill-secondary w-full"
              >
                Ch +
              </button>
            </div>

            {/* Numeric Keypad */}
            <div class="glass-card mx-auto max-w-[268px] rounded-[22px] p-4">
              <div class="grid grid-cols-3 gap-2">
                <For each={[1, 2, 3, 4, 5, 6, 7, 8, 9]}>
                  {(d) => (
                    <button
                      type="button"
                      onClick={() => void sendNav({ Digit: d })}
                      class="key h-11 rounded-[12px] text-[14px] font-semibold tabular-nums"
                    >
                      {d}
                    </button>
                  )}
                </For>
                <div />
                <button
                  type="button"
                  onClick={() => void sendNav({ Digit: 0 })}
                  class="key h-11 rounded-[12px] text-[14px] font-semibold tabular-nums"
                >
                  0
                </button>
                <div />
              </div>
            </div>
          </div>
        </Show>

        <Show when={tab() === 'channels'}>
          <div class="space-y-2.5">
            <For
              each={channels()}
              fallback={
                <div class="glass-card rounded-[18px] p-6 text-center text-[13px] font-medium text-white/[0.62]">
                  No channels synced yet.
                </div>
              }
            >
              {(ch, idx) => (
                <div class="glass-card flex items-center justify-between rounded-[18px] px-3.5 py-3">
                  <div class="flex min-w-0 items-center gap-3 pr-2">
                    <span class="glass-inner flex h-8 min-w-[2rem] shrink-0 items-center justify-center rounded-[9px] px-2 text-[12px] font-semibold tabular-nums text-white">
                      {ch.number}
                    </span>
                    <div class="min-w-0">
                      <div class="truncate text-[14px] font-semibold text-white">{ch.name}</div>
                      <div class="truncate text-[12px] font-medium text-white/[0.62]">
                        {ch.group_title || 'Live TV'}
                      </div>
                    </div>
                  </div>
                  <div class="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void toggleFavorite(ch.id)}
                      data-active={ch.is_favorite ? 'true' : undefined}
                      class="pill pill-secondary h-8 w-8 px-0 text-xs"
                      aria-label="Toggle favorite"
                    >
                      ★
                    </button>
                    <button
                      type="button"
                      onClick={() => void moveChannel(idx(), -1)}
                      class="pill pill-secondary h-8 w-8 px-0 text-xs"
                      aria-label="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => void moveChannel(idx(), 1)}
                      class="pill pill-secondary h-8 w-8 px-0 text-xs"
                      aria-label="Move down"
                    >
                      ↓
                    </button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>

        <Show when={tab() === 'profiles'}>
          <div class="space-y-3">
            <form
              onSubmit={(e) => void createProfile(e)}
              class="glass-card flex items-center gap-2 rounded-full p-1.5"
            >
              <input
                type="text"
                value={newProfileName()}
                onInput={(e) => setNewProfileName(e.currentTarget.value)}
                placeholder="New profile name..."
                class="glass-inner h-9 flex-1 rounded-full px-4 text-[13px] font-medium text-white placeholder:text-white/45"
              />
              <button type="submit" class="pill pill-primary">
                Add
              </button>
            </form>

            <div class="space-y-2.5">
              <For each={profiles()}>
                {(p) => (
                  <div class="glass-card space-y-3 rounded-[20px] p-4">
                    <Show
                      when={editingProfileId() === p.id}
                      fallback={
                        <div class="flex items-center justify-between gap-3">
                          <div class="flex items-center gap-3">
                            <span class="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[13px] font-bold text-[#111318]">
                              {p.name.slice(0, 1).toUpperCase()}
                            </span>
                            <div>
                              <div class="text-[14px] font-semibold text-white">{p.name}</div>
                              <div class="text-[12px] font-medium text-white/[0.62]">
                                Local profile
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => startRename(p)}
                            class="pill pill-secondary h-8 px-3.5"
                          >
                            Rename
                          </button>
                        </div>
                      }
                    >
                      <div class="flex items-center gap-2">
                        <input
                          type="text"
                          value={editingName()}
                          onInput={(e) => setEditingName(e.currentTarget.value)}
                          class="glass-inner h-9 flex-1 rounded-full px-3.5 text-[13px] font-medium text-white"
                        />
                        <button
                          type="button"
                          onClick={() => void submitRename(p.id, p.name)}
                          class="pill pill-primary"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={cancelRename}
                          class="pill pill-secondary"
                        >
                          Cancel
                        </button>
                      </div>
                    </Show>

                    <Show when={p.wallpaper_path ?? '/wallpapers/1.jpg'}>
                      <img
                        src={p.wallpaper_path ?? '/wallpapers/1.jpg'}
                        alt="Wallpaper"
                        class="h-28 w-full rounded-[14px] border border-white/10 object-cover"
                      />
                    </Show>

                    <Show when={presets().length > 0}>
                      <div class="space-y-1.5">
                        <div class="text-[11px] font-medium text-white/[0.62]">
                          Alpine presets
                        </div>
                        <div class="grid grid-cols-3 gap-2 sm:grid-cols-4">
                          <For each={presets()}>
                            {(file) => {
                              const isActive = () =>
                                (p.wallpaper_path ?? '/wallpapers/1.jpg') ===
                                `/wallpapers/${file}`;
                              return (
                                <button
                                  type="button"
                                  onClick={() => void selectPresetWallpaper(p.id, file)}
                                  aria-label={`Select preset ${file}`}
                                  aria-pressed={isActive()}
                                  class={`relative aspect-video w-full overflow-hidden rounded-[10px] border transition-transform duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white active:scale-95 ${
                                    isActive()
                                      ? 'border-white ring-2 ring-white ring-offset-2 ring-offset-[#12141a]'
                                      : 'border-white/15 hover:border-white/40'
                                  }`}
                                >
                                  <img
                                    src={`/wallpapers/${file}`}
                                    alt={`Preset ${file}`}
                                    class="h-full w-full object-cover"
                                    loading="lazy"
                                  />
                                </button>
                              );
                            }}
                          </For>
                        </div>
                      </div>
                    </Show>

                    <label class="pill pill-secondary w-full cursor-pointer">
                      Upload Wallpaper
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        class="hidden"
                        onChange={(e) => {
                          const file = e.currentTarget.files?.[0];
                          if (file) void uploadWallpaper(p.id, file);
                        }}
                      />
                    </label>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>
      </main>

      <nav class="fixed bottom-4 left-0 right-0 z-20 mx-auto max-w-md px-4">
        <div class="nav-bar">
          <button
            type="button"
            data-active={tab() === 'remote' ? 'true' : undefined}
            onClick={() => setTab('remote')}
            class="nav-link"
          >
            <span>Remote</span>
          </button>
          <button
            type="button"
            data-active={tab() === 'channels' ? 'true' : undefined}
            onClick={() => setTab('channels')}
            class="nav-link"
          >
            <span>Channels</span>
          </button>
          <button
            type="button"
            data-active={tab() === 'profiles' ? 'true' : undefined}
            onClick={() => setTab('profiles')}
            class="nav-link"
          >
            <span>Profiles</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
