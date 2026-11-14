import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { formatXmltvTime, parseXmltvDate } from "../bridge/epgTime";
import type { AppMode, Channel, WatchHistoryEntry } from "../bridge/types";
import { melangeState, sendCommand } from "../bridge/ws";
import { ensureValidFocus, isFocused, registerFocusable } from "../spatial/nav";

interface TopNavItem {
  id: string;
  label: string;
  mode: AppMode;
}

const TOP_NAV_ITEMS: TopNavItem[] = [
  { id: "nav-home", label: "Home", mode: "Home" },
  { id: "nav-livetv", label: "Live TV", mode: "LiveTv" },
  { id: "nav-mediathek", label: "Mediathek", mode: "Mediathek" },
  { id: "nav-youtube", label: "YouTube", mode: "YouTube" },
  { id: "nav-media", label: "Media", mode: "Media" }
];

type QuickStripEntry =
  | { kind: "cw"; id: string; title: string; meta: string; icon: "resume"; entry: WatchHistoryEntry }
  | { kind: "ch"; id: string; title: string; meta: string; icon: "tv" | "signal" | "sparkles" | "clock"; ch: Channel };

function formatDurationMinutes(startTs?: string, stopTs?: string): string {
  if (!startTs || !stopTs) return "Live";
  const start = parseXmltvDate(startTs)?.getTime();
  const stop = parseXmltvDate(stopTs)?.getTime();
  if (!start || !stop || stop <= start) return "Live";
  const mins = Math.round((stop - start) / 60000);
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${mins}m`;
}

function HairlineIcon(props: { kind: "tv" | "resume" | "signal" | "sparkles" | "clock" }) {
  switch (props.kind) {
    case "resume":
      return (
        <svg class="h-5 w-5 text-white/90" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="6 4 20 12 6 20 6 4" />
        </svg>
      );
    case "signal":
      return (
        <svg class="h-5 w-5 text-white/90" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M2 12a10 10 0 0 1 20 0" />
          <path d="M5.5 15.5a6 6 0 0 1 13 0" />
          <circle cx="12" cy="18" r="1.2" />
        </svg>
      );
    case "sparkles":
      return (
        <svg class="h-5 w-5 text-white/90" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M7 15h4M15 9h2M15 12h2" />
        </svg>
      );
    case "clock":
      return (
        <svg class="h-5 w-5 text-white/90" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    default:
      return (
        <svg class="h-5 w-5 text-white/90" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2.5" y="6" width="19" height="13" rx="2.5" />
          <path d="M8 2.5l4 3.5 4-3.5" />
        </svg>
      );
  }
}

export const HomeView = () => {
  const [now, setNow] = createSignal(new Date());

  const clockTimer = window.setInterval(() => setNow(new Date()), 1000);
  onCleanup(() => window.clearInterval(clockTimer));

  onMount(() => {
    requestAnimationFrame(() => ensureValidFocus("home-cta-watch"));
  });

  const formattedTime = () =>
    now().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const formattedDate = () =>
    now().toLocaleDateString([], {
      weekday: "short",
      month: "short",
      day: "numeric"
    });

  const featuredChannel = createMemo(() => {
    const state = melangeState();
    return (
      state.channels.find((c) => c.id === state.playback.channel_id) ??
      state.channels[0] ??
      null
    );
  });

  const featuredNowNext = createMemo(() => {
    const ch = featuredChannel();
    if (!ch) return null;
    return melangeState().epg_now_next[ch.tvg_id] ?? null;
  });

  const heroTitle = () => {
    const nowProg = featuredNowNext()?.now?.title;
    if (nowProg) return nowProg;
    const ch = featuredChannel();
    if (ch) return ch.name;
    return "Your Living-Room Television";
  };

  const heroDescription = () => {
    const desc = featuredNowNext()?.now?.description;
    if (desc && desc.trim().length > 0) return desc;
    const ch = featuredChannel();
    if (ch) {
      return `Now airing on ${ch.name} (${ch.group_title}). Tune instantly with zero-black-screen zapping or explore the live program guide.`;
    }
    return "Stream live broadcasts, Mediathek catch-up, and your personal media library with instant spatial control.";
  };

  const scheduleChannels = createMemo(() => {
    const list = melangeState().channels;
    const activeId = melangeState().playback.channel_id;
    if (!activeId) return list.slice(0, 3);
    const active = list.find((c) => c.id === activeId);
    const rest = list.filter((c) => c.id !== activeId);
    return active ? [active, ...rest].slice(0, 3) : list.slice(0, 3);
  });

  const bottomStripItems = createMemo<QuickStripEntry[]>(() => {
    const result: QuickStripEntry[] = [];
    for (const cw of melangeState().continue_watching.slice(0, 2)) {
      const pct =
        cw.duration_sec > 0
          ? Math.round(Math.min(100, Math.max(0, (cw.position_sec / cw.duration_sec) * 100)))
          : 0;
      result.push({
        kind: "cw",
        id: `strip-cw-${cw.item_id}`,
        title: cw.title,
        meta: `Resume ${cw.provider} · ${pct}% watched`,
        icon: "resume",
        entry: cw
      });
    }
    const icons: Array<"tv" | "signal" | "sparkles" | "clock"> = [
      "tv",
      "signal",
      "sparkles",
      "clock"
    ];
    for (const [idx, ch] of melangeState().channels.entries()) {
      if (result.length >= 5) break;
      const nn = melangeState().epg_now_next[ch.tvg_id];
      result.push({
        kind: "ch",
        id: `strip-ch-${ch.id}`,
        title: `${ch.number}. ${ch.name}`,
        meta: nn?.now?.title ?? ch.group_title,
        icon: icons[idx % icons.length],
        ch
      });
    }
    return result;
  });

  const handleWatchLive = () => {
    const ch = featuredChannel();
    if (ch) {
      sendCommand({ type: "SelectChannel", channel_id: ch.id });
    } else {
      sendCommand({ type: "SetMode", mode: "LiveTv" });
    }
  };

  return (
    <div class="relative flex h-full w-full flex-col justify-between overflow-hidden px-12 py-8">
      {/* Top Bar: Brand Logo (Left) · Floating Frosted Nav Pill (Center) · White Profile & Frosted Settings Circles (Right) */}
      <header class="flex items-center justify-between gap-6">
        <div class="flex items-center gap-3">
          <svg
            class="h-6 w-6 text-white"
            viewBox="0 0 28 20"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M8.5 15.5c-3 0-5.5-2.4-5.5-5.5S5.5 4.5 8.5 4.5c4.2 0 6.8 11 11 11 3 0 5.5-2.4 5.5-5.5s-2.5-5.5-5.5-5.5c-4.2 0-6.8 11-11 11z" />
          </svg>
          <span class="text-lg font-normal tracking-tight text-white">
            melange
          </span>
        </div>

        <nav class="fluted-pill flex items-center gap-1 rounded-full px-2 py-1.5">
          <For each={TOP_NAV_ITEMS}>
            {(item) => {
              const isCurrent = () => melangeState().mode === item.mode;
              const focused = () => isFocused(item.id);
              return (
                <button
                  ref={(el) =>
                    onCleanup(
                      registerFocusable(item.id, el, () =>
                        sendCommand({ type: "SetMode", mode: item.mode })
                      )
                    )
                  }
                  type="button"
                  data-focus-id={item.id}
                  data-focus-radius="9999px"
                  onClick={() => sendCommand({ type: "SetMode", mode: item.mode })}
                  class={`flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium tracking-wide transition-all duration-200 ${
                    focused()
                      ? "bg-white text-[#140404] shadow-md"
                      : isCurrent()
                        ? "bg-white/15 text-white"
                        : "text-white/70 hover:text-white"
                  }`}
                >
                  <Show when={isCurrent()}>
                    <span
                      class={`h-1.5 w-1.5 rounded-full ${
                        focused()
                          ? "bg-[#E13A26]"
                          : "bg-white shadow-[0_0_8px_rgba(255,255,255,0.9)]"
                      }`}
                    />
                  </Show>
                  <span>{item.label}</span>
                </button>
              );
            }}
          </For>
        </nav>

        <div class="flex items-center gap-2.5">
          <button
            ref={(el) =>
              onCleanup(
                registerFocusable("home-profile", el, () =>
                  sendCommand({ type: "SetOverlay", overlay: "ProfileSwitcher" })
                )
              )
            }
            type="button"
            data-focus-id="home-profile"
            data-focus-radius="9999px"
            onClick={() =>
              sendCommand({ type: "SetOverlay", overlay: "ProfileSwitcher" })
            }
            title={`Profile: ${melangeState().active_profile?.name ?? "Default"}`}
            class="pill-cta-white flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold"
          >
            {(melangeState().active_profile?.name ?? "D").slice(0, 1).toUpperCase()}
          </button>

          <button
            ref={(el) =>
              onCleanup(
                registerFocusable("home-settings", el, () =>
                  sendCommand({ type: "SetMode", mode: "Settings" })
                )
              )
            }
            type="button"
            data-focus-id="home-settings"
            data-focus-radius="9999px"
            onClick={() => sendCommand({ type: "SetMode", mode: "Settings" })}
            title="Settings"
            class={`flex h-10 w-10 items-center justify-center rounded-full transition ${
              isFocused("home-settings") ? "pill-cta-white" : "fluted-pill text-white"
            }`}
          >
            <svg
              class="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </header>

      {/* Main Stage: Editorial Hero (Left) + Frosted Live & Up Next Schedule Card (Right) */}
      <main class="my-auto grid grid-cols-12 items-end gap-10 py-6">
        {/* Left Editorial Hero */}
        <section class="col-span-7 flex flex-col justify-end pb-2">
          <div class="mb-3 flex items-center gap-3 text-xs font-medium uppercase tracking-[0.22em] text-white/70">
            <span class="tabular-nums text-white">{formattedTime()}</span>
            <span class="text-white/35">·</span>
            <span>{formattedDate()}</span>
            <Show when={featuredChannel()}>
              {(ch) => (
                <>
                  <span class="text-white/35">·</span>
                  <span class="inline-flex items-center gap-1.5 text-white">
                    <span class="live-beacon h-1.5 w-1.5 rounded-full" />
                    {ch().name}
                  </span>
                </>
              )}
            </Show>
          </div>

          <h1 class="line-clamp-2 text-5xl font-light leading-[1.05] tracking-[-0.035em] text-white lg:text-6xl">
            {heroTitle()}
          </h1>

          <p class="mt-4 line-clamp-2 max-w-xl text-sm leading-relaxed text-white/78">
            {heroDescription()}
          </p>

          <div class="mt-7 flex items-center gap-3.5">
            <button
              ref={(el) =>
                onCleanup(registerFocusable("home-cta-watch", el, handleWatchLive))
              }
              type="button"
              data-focus-id="home-cta-watch"
              data-focus-radius="9999px"
              onClick={handleWatchLive}
              class="pill-cta-white flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold"
            >
              <span>Watch Live</span>
              <span aria-hidden="true">→</span>
            </button>

            <button
              ref={(el) =>
                onCleanup(
                  registerFocusable("home-cta-epg", el, () =>
                    sendCommand({ type: "SetOverlay", overlay: "FullEpg" })
                  )
                )
              }
              type="button"
              data-focus-id="home-cta-epg"
              data-focus-radius="9999px"
              onClick={() =>
                sendCommand({ type: "SetOverlay", overlay: "FullEpg" })
              }
              class={`flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-medium transition ${
                isFocused("home-cta-epg")
                  ? "pill-cta-white"
                  : "fluted-pill text-white"
              }`}
            >
              <span>Program Guide</span>
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </section>

        {/* Right Frosted Schedule Card (Pelmatech Schedule Card Inspiration) */}
        <section class="col-span-5 flex flex-col justify-center">
          <div class="fluted-card rounded-3xl p-5">
            <div class="mb-3.5 flex items-center justify-between text-xs text-white/75">
              <div class="flex items-center gap-2 truncate">
                <svg
                  class="h-3.5 w-3.5 shrink-0 text-white/80"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10z" />
                  <circle cx="12" cy="11" r="2" />
                </svg>
                <span class="truncate font-medium tracking-wide">
                  Live &amp; Up Next Schedule
                </span>
              </div>
              <span class="shrink-0 tabular-nums text-white/55">
                {melangeState().channels.length} ch
              </span>
            </div>

            <div class="space-y-2.5">
              <For
                each={scheduleChannels()}
                fallback={
                  <div class="frosted-subcard rounded-2xl p-4 text-xs text-white/65">
                    No live channels configured yet.
                  </div>
                }
              >
                {(ch) => {
                  const nn = () => melangeState().epg_now_next[ch.tvg_id];
                  const isActive = () => melangeState().playback.channel_id === ch.id;
                  const nowProg = () => nn()?.now;
                  const startStr = () =>
                    nowProg() ? formatXmltvTime(nowProg()!.start_time) : formattedTime();
                  const stopStr = () =>
                    nowProg() ? formatXmltvTime(nowProg()!.stop_time) : "Live";
                  const durStr = () =>
                    formatDurationMinutes(nowProg()?.start_time, nowProg()?.stop_time);

                  return (
                    <button
                      ref={(el) =>
                        onCleanup(
                          registerFocusable(`home-sched-${ch.id}`, el, () =>
                            sendCommand({ type: "SelectChannel", channel_id: ch.id })
                          )
                        )
                      }
                      type="button"
                      data-focus-id={`home-sched-${ch.id}`}
                      data-focus-radius="16px"
                      onClick={() =>
                        sendCommand({ type: "SelectChannel", channel_id: ch.id })
                      }
                      class="frosted-subcard flex w-full flex-col gap-2.5 rounded-2xl px-4 py-3.5 text-left"
                    >
                      <div class="flex items-center justify-between gap-3">
                        <div class="min-w-0 truncate text-sm font-medium text-white">
                          <span class="mr-2 tabular-nums text-white/60">
                            {ch.number}
                          </span>
                          {ch.name}
                          <Show when={nowProg()?.title}>
                            <span class="ml-2 font-normal text-white/65">
                              — {nowProg()!.title}
                            </span>
                          </Show>
                        </div>
                        <Show
                          when={isActive()}
                          fallback={
                            <span class="shrink-0 text-[11px] text-white/60">
                              {ch.group_title}
                            </span>
                          }
                        >
                          <span class="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-white">
                            <span class="live-beacon h-1.5 w-1.5 rounded-full" />
                            Live
                          </span>
                        </Show>
                      </div>

                      <div class="flex items-center justify-between gap-3 text-base font-light tracking-tight tabular-nums text-white">
                        <span>{startStr()}</span>
                        <span class="flex items-center gap-2">
                          <span class="h-px w-5 bg-white/25" />
                          <span class="rounded-full border border-white/20 bg-white/10 px-2.5 py-0.5 text-[10px] font-medium text-white/85">
                            {durStr()}
                          </span>
                          <span class="h-px w-5 bg-white/25" />
                        </span>
                        <span>{stopStr()}</span>
                      </div>
                    </button>
                  );
                }}
              </For>
            </div>
          </div>
        </section>
      </main>

      {/* Bottom 5-Column Hairline Strip (Live Channels & Continue Watching) */}
      <footer class="border-t border-white/15 pt-4">
        <div class="grid grid-cols-5 gap-4">
          <For each={bottomStripItems()}>
            {(item) => {
              const onActivate = () => {
                if (item.kind === "cw") {
                  const cw = item.entry;
                  sendCommand({
                    type: "PlayMedia",
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
                      published_at: null
                    },
                    resume: true
                  });
                } else {
                  sendCommand({ type: "SelectChannel", channel_id: item.ch.id });
                }
              };

              return (
                <button
                  ref={(el) =>
                    onCleanup(registerFocusable(item.id, el, onActivate))
                  }
                  type="button"
                  data-focus-id={item.id}
                  data-focus-radius="16px"
                  onClick={onActivate}
                  class="strip-item flex flex-col items-start rounded-2xl p-3 text-left"
                >
                  <HairlineIcon kind={item.icon} />
                  <div class="mt-2.5 w-full truncate text-xs font-medium tracking-tight text-white">
                    {item.title}
                  </div>
                  <div class="mt-0.5 line-clamp-2 w-full text-[11px] leading-snug text-white/60">
                    {item.meta}
                  </div>
                </button>
              );
            }}
          </For>
        </div>
      </footer>
    </div>
  );
};
