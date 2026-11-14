import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import type { AppMode } from "../bridge/types";
import { melangeState, sendCommand } from "../bridge/ws";
import { ensureValidFocus, registerFocusable } from "../spatial/nav";

interface DockItem {
  id: string;
  label: string;
  mode: AppMode;
  hint: string;
}

const DOCK_ITEMS: DockItem[] = [
  { id: "dock-livetv", label: "Live TV", mode: "LiveTv", hint: "Watch" },
  { id: "dock-mediathek", label: "Mediathek", mode: "Mediathek", hint: "ARD / ZDF" },
  { id: "dock-media", label: "Media", mode: "Media", hint: "Library" },
  { id: "dock-settings", label: "Settings", mode: "Settings", hint: "System" }
];

const CONTINUE_PLACEHOLDERS = [
  { id: "cw-1", title: "Tatort: Schatten", subtitle: "Das Erste Mediathek • 42m left" },
  { id: "cw-2", title: "Terra X: Kosmos", subtitle: "ZDF Mediathek • 18m left" },
  { id: "cw-3", title: "ARTE Tracks", subtitle: "ARTE Concert • 25m left" }
];

export const HomeView = () => {
  const [now, setNow] = createSignal(new Date());

  const clockTimer = window.setInterval(() => setNow(new Date()), 1000);
  onCleanup(() => window.clearInterval(clockTimer));

  onMount(() => {
    const firstCh = melangeState().channels[0];
    requestAnimationFrame(() =>
      ensureValidFocus(firstCh ? `home-ch-${firstCh.id}` : "dock-livetv")
    );
  });

  const isVideoActive = () => {
    const s = melangeState().playback.state;
    return s === "Playing" || s === "Buffering";
  };

  const formattedTime = () =>
    now().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const formattedDate = () =>
    now().toLocaleDateString([], {
      weekday: "long",
      month: "long",
      day: "numeric"
    });

  let profileBtn!: HTMLButtonElement;
  onMount(() => {
    const cleanup = registerFocusable("home-profile", profileBtn, () =>
      sendCommand({ type: "SetOverlay", overlay: "ProfileSwitcher" })
    );
    onCleanup(cleanup);
  });

  return (
    <div class="relative flex h-full w-full flex-col justify-between overflow-hidden px-12 py-9">
      {/* Ambient wallpaper: fades to opacity 0 when live TV is playing behind WebKit6 */}
      <div
        class="pointer-events-none fixed inset-0 -z-10 transition-opacity duration-700 ease-out"
        style={{
          opacity: isVideoActive() ? "0" : "1",
          background:
            "radial-gradient(1200px circle at 15% 15%, rgba(56, 189, 248, 0.28), transparent 55%), radial-gradient(900px circle at 85% 80%, rgba(168, 85, 247, 0.24), transparent 55%), linear-gradient(135deg, #0b1020 0%, #111827 55%, #090d16 100%)"
        }}
      />

      {/* Subtle top/bottom vignette when live video shines through */}
      <div
        class="pointer-events-none fixed inset-0 -z-10 transition-opacity duration-700"
        style={{
          opacity: isVideoActive() ? "1" : "0",
          background:
            "linear-gradient(180deg, rgba(6,10,18,0.62) 0%, rgba(6,10,18,0.16) 40%, rgba(6,10,18,0.72) 100%)"
        }}
      />

      {/* Top Bar: Profile Switcher Pill + Digital Clock */}
      <header class="flex items-start justify-between">
        <button
          ref={profileBtn}
          type="button"
          data-focus-id="home-profile"
          onClick={() =>
            sendCommand({ type: "SetOverlay", overlay: "ProfileSwitcher" })
          }
          class="glass-panel flex items-center gap-3 rounded-full px-4 py-2 transition hover:bg-white/15"
        >
          <span class="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-indigo-500 text-sm font-bold text-white">
            {(melangeState().active_profile?.name ?? "D").slice(0, 1).toUpperCase()}
          </span>
          <div class="text-left">
            <div class="text-sm font-semibold leading-tight text-white">
              {melangeState().active_profile?.name ?? "Default"}
            </div>
            <div class="text-[11px] leading-tight text-white/55">
              Switch Profile
            </div>
          </div>
        </button>

        <div class="text-right">
          <div class="text-5xl font-light tracking-tight tabular-nums text-white drop-shadow">
            {formattedTime()}
          </div>
          <div class="mt-1 text-sm font-medium text-white/70">
            {formattedDate()}
          </div>
        </div>
      </header>

      {/* Center Rows: Live TV Channels & Continue Watching */}
      <main class="my-auto space-y-7 py-4">
        <section>
          <div class="mb-3 flex items-center justify-between">
            <h2 class="text-sm font-semibold uppercase tracking-widest text-white/65">
              Live TV Channels
            </h2>
            <Show when={melangeState().playback.title}>
              {(title) => (
                <span class="glass-pill inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium text-white/85">
                  <span class="h-1.5 w-1.5 rounded-full bg-red-500" />
                  Now Playing: {title()}
                </span>
              )}
            </Show>
          </div>

          <div class="no-scrollbar flex gap-4 overflow-x-auto py-1">
            <For each={melangeState().channels}>
              {(ch) => {
                let cardEl!: HTMLButtonElement;
                const nowNext = () => melangeState().epg_now_next[ch.tvg_id];
                const isActive = () => melangeState().playback.channel_id === ch.id;

                onMount(() => {
                  const cleanup = registerFocusable(`home-ch-${ch.id}`, cardEl, () =>
                    sendCommand({ type: "SelectChannel", channel_id: ch.id })
                  );
                  onCleanup(cleanup);
                });

                return (
                  <button
                    ref={cardEl}
                    type="button"
                    data-focus-id={`home-ch-${ch.id}`}
                    onClick={() =>
                      sendCommand({ type: "SelectChannel", channel_id: ch.id })
                    }
                    class="glass-panel flex w-64 shrink-0 flex-col justify-between rounded-2xl p-4 text-left transition hover:bg-white/15"
                  >
                    <div class="flex items-center justify-between">
                      <span class="flex h-9 min-w-[2.25rem] items-center justify-center rounded-xl bg-white/12 px-2.5 text-sm font-bold tabular-nums text-white">
                        {ch.number}
                      </span>
                      <Show
                        when={isActive()}
                        fallback={
                          <span class="text-xs font-medium text-white/50">
                            {ch.group_title}
                          </span>
                        }
                      >
                        <span class="inline-flex items-center gap-1.5 rounded-full bg-red-500/20 px-2.5 py-0.5 text-[11px] font-semibold text-red-300">
                          <span class="h-1.5 w-1.5 rounded-full bg-red-500" />
                          LIVE
                        </span>
                      </Show>
                    </div>

                    <div class="mt-4">
                      <div class="truncate text-base font-semibold text-white">
                        {ch.name}
                      </div>
                      <div class="mt-0.5 truncate text-xs text-white/65">
                        {nowNext()?.now?.title ?? "Live Broadcast"}
                      </div>
                    </div>
                  </button>
                );
              }}
            </For>
          </div>
        </section>

        <section>
          <h2 class="mb-3 text-sm font-semibold uppercase tracking-widest text-white/65">
            Continue Watching
          </h2>
          <div class="no-scrollbar flex gap-4 overflow-x-auto py-1">
            <For each={CONTINUE_PLACEHOLDERS}>
              {(item) => {
                let cwEl!: HTMLButtonElement;
                onMount(() => {
                  const cleanup = registerFocusable(item.id, cwEl, () =>
                    sendCommand({ type: "SetMode", mode: "Mediathek" })
                  );
                  onCleanup(cleanup);
                });

                return (
                  <button
                    ref={cwEl}
                    type="button"
                    data-focus-id={item.id}
                    onClick={() =>
                      sendCommand({ type: "SetMode", mode: "Mediathek" })
                    }
                    class="glass-panel flex w-64 shrink-0 flex-col justify-between rounded-2xl p-4 text-left transition hover:bg-white/15"
                  >
                    <div class="flex items-center justify-between text-xs text-white/50">
                      <span>On Demand</span>
                      <span class="rounded bg-white/10 px-2 py-0.5 text-[10px]">
                        M3
                      </span>
                    </div>
                    <div class="mt-4">
                      <div class="truncate text-sm font-semibold text-white">
                        {item.title}
                      </div>
                      <div class="mt-0.5 truncate text-xs text-white/60">
                        {item.subtitle}
                      </div>
                    </div>
                  </button>
                );
              }}
            </For>
          </div>
        </section>
      </main>

      {/* Bottom App & Channel Dock */}
      <footer class="flex justify-center">
        <div class="glass-panel-heavy flex items-center gap-3 rounded-3xl px-4 py-3">
          <For each={DOCK_ITEMS}>
            {(item) => {
              let dockEl!: HTMLButtonElement;
              onMount(() => {
                const cleanup = registerFocusable(item.id, dockEl, () =>
                  sendCommand({ type: "SetMode", mode: item.mode })
                );
                onCleanup(cleanup);
              });

              return (
                <button
                  ref={dockEl}
                  type="button"
                  data-focus-id={item.id}
                  onClick={() =>
                    sendCommand({ type: "SetMode", mode: item.mode })
                  }
                  class="flex min-w-[118px] flex-col items-center rounded-2xl bg-white/8 px-5 py-2.5 transition hover:bg-white/15"
                >
                  <span class="text-sm font-semibold text-white">
                    {item.label}
                  </span>
                  <span class="text-[11px] text-white/55">{item.hint}</span>
                </button>
              );
            }}
          </For>
        </div>
      </footer>
    </div>
  );
};
