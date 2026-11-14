import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import type { AppMode } from "../bridge/types";
import { melangeState, sendCommand } from "../bridge/ws";
import { ensureValidFocus, isFocused, registerFocusable } from "../spatial/nav";

interface DockItem {
  id: string;
  label: string;
  mode: AppMode;
  hint: string;
}

const DOCK_ITEMS: DockItem[] = [
  { id: "dock-livetv", label: "Live TV", mode: "LiveTv", hint: "Watch" },
  { id: "dock-mediathek", label: "Mediathek", mode: "Mediathek", hint: "ARD / ZDF" },
  { id: "dock-youtube", label: "YouTube", mode: "YouTube", hint: "On Demand" },
  { id: "dock-media", label: "Media", mode: "Media", hint: "Library" },
  { id: "dock-settings", label: "Settings", mode: "Settings", hint: "System" }
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
      {/* Top Bar: Profile Switcher Pill + Editorial Clock */}
      <header class="flex items-start justify-between">
        <button
          ref={profileBtn}
          type="button"
          data-focus-id="home-profile"
          data-focus-radius="9999px"
          onClick={() =>
            sendCommand({ type: "SetOverlay", overlay: "ProfileSwitcher" })
          }
          class="fluted-pill flex items-center gap-3.5 rounded-full py-2 pl-2.5 pr-5"
        >
          <span class="flex h-9 w-9 items-center justify-center rounded-full border border-white/30 bg-gradient-to-br from-[#E13A26] to-[#831613] text-sm font-semibold text-white shadow-inner">
            {(melangeState().active_profile?.name ?? "D").slice(0, 1).toUpperCase()}
          </span>
          <div class="text-left">
            <div class="text-sm font-medium leading-tight tracking-tight text-white">
              {melangeState().active_profile?.name ?? "Default"}
            </div>
            <div class="text-[11px] leading-tight text-white/55">
              Switch Profile
            </div>
          </div>
        </button>

        <div class="text-right">
          <div class="text-6xl font-light tracking-editorial tabular-nums text-white drop-shadow-[0_6px_24px_rgba(18,3,3,0.65)]">
            {formattedTime()}
          </div>
          <div class="mt-1 text-sm font-normal tracking-wide text-white/70">
            {formattedDate()}
          </div>
        </div>
      </header>

      {/* Center Rows: Live TV Channels & Continue Watching */}
      <main class="my-auto space-y-8 py-4">
        <section>
          <div class="mb-3.5 flex items-center justify-between">
            <h2 class="text-xs font-medium uppercase tracking-[0.24em] text-white/65">
              Live TV Channels
            </h2>
            <Show when={melangeState().playback.title}>
              {(title) => (
                <span class="fluted-pill inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium text-white">
                  <span class="live-beacon h-2 w-2 rounded-full" />
                  <span class="text-white/60">Now Playing</span>
                  <span>{title()}</span>
                </span>
              )}
            </Show>
          </div>

          <div class="no-scrollbar flex gap-4 overflow-x-auto px-1 py-2">
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
                    class="fluted-card flex w-72 shrink-0 flex-col justify-between rounded-2xl p-5 text-left"
                  >
                    <div class="flex items-center justify-between">
                      <span
                        class={`flex h-9 min-w-[2.4rem] items-center justify-center rounded-xl px-2.5 text-sm font-semibold tabular-nums transition ${
                          isActive()
                            ? "bg-white text-[#140404] shadow-md"
                            : "border border-white/20 bg-[#120303]/70 text-white"
                        }`}
                      >
                        {ch.number}
                      </span>
                      <Show
                        when={isActive()}
                        fallback={
                          <span class="text-xs font-normal tracking-wide text-white/50">
                            {ch.group_title}
                          </span>
                        }
                      >
                        <span class="inline-flex items-center gap-1.5 rounded-full border border-[#E13A26]/55 bg-[#E13A26]/25 px-2.5 py-0.5 text-[11px] font-semibold tracking-wider text-white">
                          <span class="live-beacon h-1.5 w-1.5 rounded-full" />
                          LIVE
                        </span>
                      </Show>
                    </div>

                    <div class="mt-5">
                      <div class="truncate text-lg font-medium tracking-editorial text-white">
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
          <h2 class="mb-3.5 text-xs font-medium uppercase tracking-[0.24em] text-white/65">
            Continue Watching
          </h2>
          <div class="no-scrollbar flex gap-4 overflow-x-auto px-1 py-2">
            <For
              each={melangeState().continue_watching}
              fallback={
                <div class="fluted-card rounded-2xl px-6 py-4 text-xs text-white/60">
                  No recent on-demand playback yet. Browse Mediathek, YouTube, or Local Media.
                </div>
              }
            >
              {(entry) => {
                let cwEl!: HTMLButtonElement;
                const resumeEntry = () =>
                  sendCommand({
                    type: "PlayMedia",
                    item: {
                      id: entry.item_id,
                      provider: entry.provider,
                      title: entry.title,
                      subtitle: null,
                      description: null,
                      channel_or_author: entry.provider,
                      duration_sec: Math.round(entry.duration_sec),
                      thumbnail_url: entry.thumbnail_url,
                      stream_url: entry.stream_url,
                      published_at: null
                    },
                    resume: true
                  });

                onMount(() => {
                  const cleanup = registerFocusable(`cw-${entry.item_id}`, cwEl, resumeEntry);
                  onCleanup(cleanup);
                });

                const pct =
                  entry.duration_sec > 0
                    ? Math.min(100, Math.max(0, (entry.position_sec / entry.duration_sec) * 100))
                    : 0;

                return (
                  <button
                    ref={cwEl}
                    type="button"
                    data-focus-id={`cw-${entry.item_id}`}
                    onClick={resumeEntry}
                    class="fluted-card flex w-72 shrink-0 flex-col justify-between overflow-hidden rounded-2xl p-5 text-left"
                  >
                    <div class="flex items-center justify-between text-xs text-white/55">
                      <span class="uppercase tracking-[0.18em]">{entry.provider}</span>
                      <span class="rounded-full border border-white/20 bg-white/10 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white/90">
                        Resume
                      </span>
                    </div>
                    <div class="mt-5">
                      <div class="truncate text-base font-medium tracking-tight text-white">
                        {entry.title}
                      </div>
                      <div class="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-white/15">
                        <div
                          class="crimson-progress-fill h-full rounded-full transition-all duration-300"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  </button>
                );
              }}
            </For>
          </div>
        </section>
      </main>

      {/* Bottom Floating Fluted Pill Dock */}
      <footer class="flex justify-center">
        <div class="fluted-surface flex items-center gap-2 rounded-full p-2">
          <For each={DOCK_ITEMS}>
            {(item) => {
              let dockEl!: HTMLButtonElement;
              const focused = () => isFocused(item.id);
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
                  data-focus-radius="9999px"
                  onClick={() =>
                    sendCommand({ type: "SetMode", mode: item.mode })
                  }
                  class={`flex min-w-[126px] flex-col items-center rounded-full px-6 py-2.5 transition-all duration-200 ${
                    focused()
                      ? "pill-cta-white"
                      : "text-white hover:bg-white/10"
                  }`}
                >
                  <span
                    class={`text-sm font-semibold tracking-tight ${
                      focused() ? "text-[#140404]" : "text-white"
                    }`}
                  >
                    {item.label}
                  </span>
                  <span
                    class={`text-[11px] ${
                      focused() ? "text-[#140404]/65" : "text-white/55"
                    }`}
                  >
                    {item.hint}
                  </span>
                </button>
              );
            }}
          </For>
        </div>
      </footer>
    </div>
  );
};
