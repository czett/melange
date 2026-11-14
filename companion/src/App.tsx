import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';

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

    const connect = () => {
      if (disposed) return;
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${location.host}/ws`);
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
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

  return (
    <div class="relative mx-auto flex min-h-screen max-w-md flex-col overflow-x-hidden">
      <div class="crimson-ambient-bg pointer-events-none fixed inset-0 -z-10" />

      <header class="sticky top-0 z-20 px-4 pt-3">
        <div class="fluted-surface flex items-center justify-between rounded-2xl px-4 py-3">
          <div class="flex items-center gap-2.5">
            <span class="text-lg font-light tracking-editorial text-white">
              melange
            </span>
            <span
              class={`h-2 w-2 rounded-full ${
                connected() ? 'live-beacon' : 'bg-white/30'
              }`}
              title={connected() ? 'Connected' : 'Reconnecting'}
            />
          </div>
          <Show
            when={statusMsg()}
            fallback={
              <span class="text-[11px] uppercase tracking-[0.2em] text-white/50">
                Companion
              </span>
            }
          >
            <span class="fluted-pill rounded-full border-[#E13A26]/50 px-3 py-0.5 text-[11px] font-medium text-white">
              {statusMsg()}
            </span>
          </Show>
        </div>
      </header>

      <main class="flex-1 overflow-y-auto px-4 pb-28 pt-5">
        <Show when={tab() === 'remote'}>
          <div class="space-y-6">
            {/* Tactile Fluted D-Pad */}
            <div class="fluted-surface mx-auto max-w-[264px] rounded-3xl p-4">
              <div class="grid grid-cols-3 gap-3">
                <div />
                <button
                  type="button"
                  onClick={() => void sendNav('Up')}
                  class="fluted-key flex h-14 items-center justify-center rounded-2xl text-lg font-semibold"
                  aria-label="Up"
                >
                  ▲
                </button>
                <div />
                <button
                  type="button"
                  onClick={() => void sendNav('Left')}
                  class="fluted-key flex h-14 items-center justify-center rounded-2xl text-lg font-semibold"
                  aria-label="Left"
                >
                  ◀
                </button>
                <button
                  type="button"
                  onClick={() => void sendNav('Select')}
                  class="pill-cta-white flex h-14 items-center justify-center rounded-2xl text-sm font-bold tracking-wider shadow-[0_0_24px_rgba(225,58,38,0.45)]"
                >
                  OK
                </button>
                <button
                  type="button"
                  onClick={() => void sendNav('Right')}
                  class="fluted-key flex h-14 items-center justify-center rounded-2xl text-lg font-semibold"
                  aria-label="Right"
                >
                  ▶
                </button>
                <div />
                <button
                  type="button"
                  onClick={() => void sendNav('Down')}
                  class="fluted-key flex h-14 items-center justify-center rounded-2xl text-lg font-semibold"
                  aria-label="Down"
                >
                  ▼
                </button>
                <div />
              </div>
            </div>

            {/* Quick Action Pills */}
            <div class="grid grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() => void sendNav('Back')}
                class="fluted-pill rounded-2xl py-3.5 text-sm font-medium text-white"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => void sendNav('Home')}
                class="fluted-pill rounded-2xl py-3.5 text-sm font-medium text-white"
              >
                Home
              </button>
              <button
                type="button"
                onClick={() => void sendNav('ToggleEpg')}
                class="fluted-pill rounded-2xl py-3.5 text-sm font-medium text-white"
              >
                EPG
              </button>
              <button
                type="button"
                onClick={() => void sendNav('ChannelDown')}
                class="fluted-pill rounded-2xl py-3.5 text-sm font-medium text-white"
              >
                Ch −
              </button>
              <button
                type="button"
                onClick={() => void sendNav('PlayPause')}
                class="fluted-pill rounded-2xl border-[#E13A26]/45 py-3.5 text-sm font-medium text-white"
              >
                ⏯
              </button>
              <button
                type="button"
                onClick={() => void sendNav('ChannelUp')}
                class="fluted-pill rounded-2xl py-3.5 text-sm font-medium text-white"
              >
                Ch +
              </button>
            </div>

            {/* Numeric Keypad */}
            <div class="fluted-card mx-auto max-w-[272px] rounded-3xl p-4">
              <div class="grid grid-cols-3 gap-2.5">
                <For each={[1, 2, 3, 4, 5, 6, 7, 8, 9]}>
                  {(d) => (
                    <button
                      type="button"
                      onClick={() => void sendNav({ Digit: d })}
                      class="fluted-key h-12 rounded-xl text-base font-medium tabular-nums"
                    >
                      {d}
                    </button>
                  )}
                </For>
                <div />
                <button
                  type="button"
                  onClick={() => void sendNav({ Digit: 0 })}
                  class="fluted-key h-12 rounded-xl text-base font-medium tabular-nums"
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
                <div class="fluted-card rounded-2xl p-5 text-center text-sm text-white/60">
                  No channels synced yet.
                </div>
              }
            >
              {(ch, idx) => (
                <div class="fluted-card flex items-center justify-between rounded-2xl p-3.5">
                  <div class="flex min-w-0 items-center gap-3 pr-2">
                    <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/20 bg-[#120303]/75 text-xs font-semibold tabular-nums text-white">
                      {ch.number}
                    </span>
                    <div class="min-w-0">
                      <div class="truncate text-sm font-medium text-white">
                        {ch.name}
                      </div>
                      <div class="truncate text-xs text-white/55">
                        {ch.group_title}
                      </div>
                    </div>
                  </div>
                  <div class="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void toggleFavorite(ch.id)}
                      class={`rounded-xl px-2.5 py-1.5 text-sm transition ${
                        ch.is_favorite
                          ? 'border border-[#E13A26] bg-[#E13A26] text-white shadow-[0_0_16px_rgba(225,58,38,0.45)]'
                          : 'fluted-pill text-white/55'
                      }`}
                    >
                      ★
                    </button>
                    <button
                      type="button"
                      onClick={() => void moveChannel(idx(), -1)}
                      class="fluted-pill rounded-xl px-2.5 py-1.5 text-xs text-white"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => void moveChannel(idx(), 1)}
                      class="fluted-pill rounded-xl px-2.5 py-1.5 text-xs text-white"
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
          <div class="space-y-4">
            <form
              onSubmit={(e) => void createProfile(e)}
              class="fluted-surface flex gap-2 rounded-2xl p-2.5"
            >
              <input
                type="text"
                value={newProfileName()}
                onInput={(e) => setNewProfileName(e.currentTarget.value)}
                placeholder="New profile name..."
                class="flex-1 rounded-xl border border-white/15 bg-[#120303]/80 px-3.5 py-2 text-sm text-white placeholder:text-white/40 focus:border-white/50 focus:outline-none"
              />
              <button
                type="submit"
                class="pill-cta-white rounded-xl px-4 py-2 text-sm font-semibold"
              >
                Add
              </button>
            </form>

            <div class="space-y-3">
              <For each={profiles()}>
                {(p) => (
                  <div class="fluted-card space-y-3 rounded-2xl p-4">
                    <Show
                      when={editingProfileId() === p.id}
                      fallback={
                        <div class="flex items-center justify-between gap-3">
                          <div class="flex items-center gap-3">
                            <span class="flex h-9 w-9 items-center justify-center rounded-full border border-white/30 bg-gradient-to-br from-[#E13A26] to-[#831613] text-sm font-semibold text-white">
                              {p.name.slice(0, 1).toUpperCase()}
                            </span>
                            <span class="text-sm font-medium text-white">
                              {p.name}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => startRename(p)}
                            class="fluted-pill rounded-full px-3.5 py-1 text-xs font-medium text-white"
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
                          class="flex-1 rounded-xl border border-white/30 bg-[#120303]/85 px-3 py-1.5 text-sm text-white focus:border-white focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => void submitRename(p.id, p.name)}
                          class="pill-cta-white rounded-full px-3.5 py-1.5 text-xs font-semibold"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={cancelRename}
                          class="fluted-pill rounded-full px-3 py-1.5 text-xs text-white/75"
                        >
                          Cancel
                        </button>
                      </div>
                    </Show>

                    <Show when={p.wallpaper_path}>
                      <img
                        src={p.wallpaper_path!}
                        alt="Wallpaper"
                        class="h-28 w-full rounded-xl border border-white/20 object-cover"
                      />
                    </Show>

                    <label class="fluted-pill block cursor-pointer rounded-full py-2.5 text-center text-xs font-medium text-white">
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
        <div class="fluted-surface grid grid-cols-3 gap-1.5 rounded-full p-1.5">
          <button
            type="button"
            onClick={() => setTab('remote')}
            class={`rounded-full py-2.5 text-xs font-semibold transition ${
              tab() === 'remote' ? 'pill-cta-white' : 'text-white/70'
            }`}
          >
            Remote
          </button>
          <button
            type="button"
            onClick={() => setTab('channels')}
            class={`rounded-full py-2.5 text-xs font-semibold transition ${
              tab() === 'channels' ? 'pill-cta-white' : 'text-white/70'
            }`}
          >
            Channels
          </button>
          <button
            type="button"
            onClick={() => setTab('profiles')}
            class={`rounded-full py-2.5 text-xs font-semibold transition ${
              tab() === 'profiles' ? 'pill-cta-white' : 'text-white/70'
            }`}
          >
            Profiles
          </button>
        </div>
      </nav>
    </div>
  );
}
