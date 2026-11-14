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
  const [statusMsg, setStatusMsg] = createSignal('');

  const flash = (msg: string) => {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(''), 2000);
  };

  onMount(() => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.Snapshot?.state || msg.StateUpdate?.state) {
          const st = msg.Snapshot?.state ?? msg.StateUpdate?.state;
          if (st.channels) setChannels(st.channels);
          if (st.profiles) setProfiles(st.profiles);
        }
      } catch {
        // ignore
      }
    };
    onCleanup(() => ws.close());
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
      body: JSON.stringify({ name, avatar: '📺' }),
    });
    setNewProfileName('');
    flash('Profile created');
  };

  const renameProfile = async (id: number, currentName: string) => {
    const next = prompt('Rename profile:', currentName)?.trim();
    if (!next || next === currentName) return;
    await fetch(`/api/profiles/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: next }),
    });
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
    <div class="min-h-screen flex flex-col max-w-md mx-auto bg-zinc-950">
      <header class="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-lg font-semibold tracking-tight">Melange</span>
          <span
            class={`w-2 h-2 rounded-full ${connected() ? 'bg-emerald-400' : 'bg-zinc-600'}`}
          />
        </div>
        <Show when={statusMsg()}>
          <span class="text-xs text-amber-400">{statusMsg()}</span>
        </Show>
      </header>

      <main class="flex-1 overflow-y-auto p-4 pb-24">
        <Show when={tab() === 'remote'}>
          <div class="space-y-6">
            <div class="grid grid-cols-3 gap-3 max-w-[240px] mx-auto">
              <div />
              <button
                onClick={() => sendNav('Up')}
                class="h-14 rounded-2xl bg-zinc-800 active:bg-amber-500 active:text-zinc-950 font-bold text-lg"
              >
                ▲
              </button>
              <div />
              <button
                onClick={() => sendNav('Left')}
                class="h-14 rounded-2xl bg-zinc-800 active:bg-amber-500 active:text-zinc-950 font-bold text-lg"
              >
                ◀
              </button>
              <button
                onClick={() => sendNav('Select')}
                class="h-14 rounded-2xl bg-amber-500 text-zinc-950 active:bg-amber-400 font-bold"
              >
                OK
              </button>
              <button
                onClick={() => sendNav('Right')}
                class="h-14 rounded-2xl bg-zinc-800 active:bg-amber-500 active:text-zinc-950 font-bold text-lg"
              >
                ▶
              </button>
              <div />
              <button
                onClick={() => sendNav('Down')}
                class="h-14 rounded-2xl bg-zinc-800 active:bg-amber-500 active:text-zinc-950 font-bold text-lg"
              >
                ▼
              </button>
              <div />
            </div>

            <div class="grid grid-cols-3 gap-2">
              <button
                onClick={() => sendNav('Back')}
                class="py-3 rounded-xl bg-zinc-900 border border-zinc-800 active:bg-zinc-800 text-sm font-medium"
              >
                Back
              </button>
              <button
                onClick={() => sendNav('Home')}
                class="py-3 rounded-xl bg-zinc-900 border border-zinc-800 active:bg-zinc-800 text-sm font-medium"
              >
                Home
              </button>
              <button
                onClick={() => sendNav('ToggleEpg')}
                class="py-3 rounded-xl bg-zinc-900 border border-zinc-800 active:bg-zinc-800 text-sm font-medium"
              >
                EPG
              </button>
              <button
                onClick={() => sendNav('ChannelDown')}
                class="py-3 rounded-xl bg-zinc-900 border border-zinc-800 active:bg-zinc-800 text-sm font-medium"
              >
                Ch −
              </button>
              <button
                onClick={() => sendNav('PlayPause')}
                class="py-3 rounded-xl bg-zinc-900 border border-zinc-800 active:bg-zinc-800 text-sm font-medium"
              >
                ⏯
              </button>
              <button
                onClick={() => sendNav('ChannelUp')}
                class="py-3 rounded-xl bg-zinc-900 border border-zinc-800 active:bg-zinc-800 text-sm font-medium"
              >
                Ch +
              </button>
            </div>

            <div class="grid grid-cols-3 gap-2 max-w-[260px] mx-auto">
              <For each={[1, 2, 3, 4, 5, 6, 7, 8, 9]}>
                {(d) => (
                  <button
                    onClick={() => sendNav({ Digit: d })}
                    class="h-12 rounded-xl bg-zinc-900 border border-zinc-800 active:bg-zinc-700 font-semibold"
                  >
                    {d}
                  </button>
                )}
              </For>
              <div />
              <button
                onClick={() => sendNav({ Digit: 0 })}
                class="h-12 rounded-xl bg-zinc-900 border border-zinc-800 active:bg-zinc-700 font-semibold"
              >
                0
              </button>
              <div />
            </div>
          </div>
        </Show>

        <Show when={tab() === 'channels'}>
          <div class="space-y-2">
            <For each={channels()}>
              {(ch, idx) => (
                <div class="flex items-center justify-between p-3 rounded-xl bg-zinc-900 border border-zinc-800">
                  <div class="min-w-0 pr-2">
                    <div class="text-sm font-medium truncate">
                      <span class="text-zinc-500 mr-2">{ch.number}</span>
                      {ch.name}
                    </div>
                    <div class="text-xs text-zinc-500">{ch.group_title}</div>
                  </div>
                  <div class="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => toggleFavorite(ch.id)}
                      class={`px-2.5 py-1.5 rounded-lg text-sm ${
                        ch.is_favorite ? 'bg-amber-500/20 text-amber-400' : 'bg-zinc-800 text-zinc-400'
                      }`}
                    >
                      ★
                    </button>
                    <button
                      onClick={() => moveChannel(idx(), -1)}
                      class="px-2.5 py-1.5 rounded-lg bg-zinc-800 text-xs"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => moveChannel(idx(), 1)}
                      class="px-2.5 py-1.5 rounded-lg bg-zinc-800 text-xs"
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
            <form onSubmit={createProfile} class="flex gap-2">
              <input
                type="text"
                value={newProfileName()}
                onInput={(e) => setNewProfileName(e.currentTarget.value)}
                placeholder="New profile name..."
                class="flex-1 px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-sm focus:outline-none focus:border-amber-500"
              />
              <button
                type="submit"
                class="px-4 py-2 rounded-xl bg-amber-500 text-zinc-950 text-sm font-semibold"
              >
                Add
              </button>
            </form>

            <div class="space-y-3">
              <For each={profiles()}>
                {(p) => (
                  <div class="p-3 rounded-xl bg-zinc-900 border border-zinc-800 space-y-2">
                    <div class="flex items-center justify-between">
                      <div class="font-medium text-sm">
                        <span class="mr-2">{p.avatar || '👤'}</span>
                        {p.name}
                      </div>
                      <button
                        onClick={() => renameProfile(p.id, p.name)}
                        class="text-xs px-2.5 py-1 rounded-lg bg-zinc-800 text-zinc-300"
                      >
                        Rename
                      </button>
                    </div>
                    <Show when={p.wallpaper_path}>
                      <img
                        src={p.wallpaper_path!}
                        alt="Wallpaper"
                        class="w-full h-24 object-cover rounded-lg border border-zinc-800"
                      />
                    </Show>
                    <label class="block text-center py-2 rounded-lg bg-zinc-800 text-xs font-medium cursor-pointer active:bg-zinc-700">
                      Upload Wallpaper
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        class="hidden"
                        onChange={(e) => {
                          const file = e.currentTarget.files?.[0];
                          if (file) uploadWallpaper(p.id, file);
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

      <nav class="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-zinc-900/95 backdrop-blur border-t border-zinc-800 grid grid-cols-3">
        <button
          onClick={() => setTab('remote')}
          class={`py-3 text-xs font-medium ${tab() === 'remote' ? 'text-amber-400' : 'text-zinc-400'}`}
        >
          Remote
        </button>
        <button
          onClick={() => setTab('channels')}
          class={`py-3 text-xs font-medium ${tab() === 'channels' ? 'text-amber-400' : 'text-zinc-400'}`}
        >
          Channels
        </button>
        <button
          onClick={() => setTab('profiles')}
          class={`py-3 text-xs font-medium ${tab() === 'profiles' ? 'text-amber-400' : 'text-zinc-400'}`}
        >
          Profiles
        </button>
      </nav>
    </div>
  );
}
