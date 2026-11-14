import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { formatXmltvTime, parseXmltvDate } from "../bridge/epgTime";
import type { AppMode, Channel, WatchHistoryEntry } from "../bridge/types";
import { melangeState, sendCommand } from "../bridge/ws";
import { ensureValidFocus, registerFocusable } from "../spatial/nav";

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
        <svg class="h-[18px] w-[18px] text-white/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="6 4 20 12 6 20 6 4" />
        </svg>
      );
    case "signal":
      return (
        <svg class="h-[18px] w-[18px] text-white/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">
          <path d="M2 12a10 10 0 0 1 20 0" />
          <path d="M5.5 15.5a6 6 0 0 1 13 0" />
          <circle cx="12" cy="18" r="1.2" />
        </svg>
      );
    case "sparkles":
      return (
        <svg class="h-[18px] w-[18px] text-white/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M7 15h4M15 9h2M15 12h2" />
        </svg>
      );
    case "clock":
      return (
        <svg class="h-[18px] w-[18px] text-white/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    default:
      return (
        <svg class="h-[18px] w-[18px] text-white/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">
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

  const heroContext = () => {
    const ch = featuredChannel();
    if (!ch) return null;
    const nowProg = featuredNowNext()?.now;
    if (!nowProg) return `${ch.name} · Live`;
    return `${ch.name} · ${formatXmltvTime(nowProg.start_time)}–${formatXmltvTime(nowProg.stop_time)}`;
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
        meta: `Resume · ${pct}%`,
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
    <div class="relative flex h-full w-full flex-col justify-between overflow-hidden px-14 py-9">
      {/* Top bar: wordmark · translucent text nav · profile + settings */}
      <header class="grid grid-cols-[1fr_auto_1fr] items-center gap-6">
        <div class="flex items-center gap-2.5 text-white">
          <svg
            class="h-[18px] w-[18px]"
            viewBox="0 0 28 20"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M8.5 15.5c-3 0-5.5-2.4-5.5-5.5S5.5 4.5 8.5 4.5c4.2 0 6.8 11 11 11 3 0 5.5-2.4 5.5-5.5s-2.5-5.5-5.5-5.5c-4.2 0-6.8 11-11 11z" />
          </svg>
          <span class="text-sm font-medium tracking-[-0.02em]">melange</span>
        </div>

        <nav class="nav-bar">
          <For each={TOP_NAV_ITEMS}>
            {(item) => {
              const isCurrent = () => melangeState().mode === item.mode;
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
                  data-active={isCurrent() ? "true" : undefined}
                  onClick={() => sendCommand({ type: "SetMode", mode: item.mode })}
                  class="nav-link"
                >
                  <Show when={isCurrent()}>
                    <span class="nav-dot" />
                  </Show>
                  <span>{item.label}</span>
                </button>
              );
            }}
          </For>
        </nav>

        <div class="flex items-center justify-end gap-2">
          <button
            ref={(el) =>
              onCleanup(
                registerFocusable("home-fullscreen", el, () =>
                  sendCommand({ type: "ToggleFullscreen" })
                )
              )
            }
            type="button"
            data-focus-id="home-fullscreen"
            data-focus-radius="9999px"
            onClick={() => sendCommand({ type: "ToggleFullscreen" })}
            title={melangeState().is_fullscreen ? "Exit Fullscreen (F11)" : "Fullscreen (F11)"}
            aria-label={melangeState().is_fullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
            class="pill pill-secondary pill-icon"
          >
            <Show
              when={melangeState().is_fullscreen}
              fallback={
                <svg
                  class="h-[14px] w-[14px]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M8 3H5a2 2 0 0 0-2 2v3" />
                  <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
                  <path d="M3 16v3a2 2 0 0 0 2 2h3" />
                  <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
                </svg>
              }
            >
              <svg
                class="h-[14px] w-[14px]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M8 3v3a2 2 0 0 1-2 2H3" />
                <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
                <path d="M3 16h3a2 2 0 0 1 2 2v3" />
                <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
              </svg>
            </Show>
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
            class="pill pill-secondary pill-icon"
          >
            <svg
              class="h-[14px] w-[14px]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>

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
            onClick={() => sendCommand({ type: "SetOverlay", overlay: "ProfileSwitcher" })}
            title={`Profile: ${melangeState().active_profile?.name ?? "Default"}`}
            class="pill pill-primary pill-icon text-xs font-medium"
          >
            {(melangeState().active_profile?.name ?? "D").slice(0, 1).toUpperCase()}
          </button>
        </div>
      </header>

      {/* Main stage: editorial hero (left) + smoky schedule card & bottom-right CTAs (right) */}
      <main class="my-auto grid grid-cols-12 items-end gap-12 py-4">
        <section class="col-span-7 flex flex-col justify-end">
          <div class="hero-text-shadow mb-4 flex items-center gap-2.5 text-[12px] font-medium uppercase tracking-[0.14em] text-white/[0.82]">
            <span class="tabular-nums text-white">{formattedTime()}</span>
            <span class="text-white/40">/</span>
            <span>{formattedDate()}</span>
            <Show when={heroContext()}>
              {(ctx) => (
                <>
                  <span class="text-white/40">/</span>
                  <span class="inline-flex items-center gap-1.5 text-white">
                    <span class="live-dot" />
                    {ctx()}
                  </span>
                </>
              )}
            </Show>
          </div>

          <h1 class="hero-text-shadow line-clamp-2 max-w-[14ch] pb-1.5 text-[56px] font-medium leading-[1.12] tracking-[-0.04em] text-white xl:text-[60px]">
            {heroTitle()}
          </h1>

          <p class="hero-text-shadow mt-4 line-clamp-2 max-w-[44ch] text-[14px] font-normal leading-relaxed text-white/[0.84]">
            {heroDescription()}
          </p>
        </section>

        <section class="col-span-5 flex flex-col justify-end gap-5">
          <div class="glass-card glass-card-home rounded-[22px] p-4">
            <div class="mb-3.5 flex items-center justify-between px-1">
              <span class="eyebrow">Live &amp; Up Next</span>
              <span class="text-[12px] font-normal tabular-nums text-white/[0.78]">
                {melangeState().channels.length} channels
              </span>
            </div>

            <div class="space-y-2">
              <For
                each={scheduleChannels()}
                fallback={
                  <div class="glass-inner rounded-2xl p-4 text-[13px] font-normal text-white/[0.82]">
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
                      onClick={() => sendCommand({ type: "SelectChannel", channel_id: ch.id })}
                      class="glass-inner flex w-full flex-col gap-2.5 rounded-2xl px-4 py-3 text-left"
                    >
                      <div class="flex items-center justify-between gap-3">
                        <div class="min-w-0 truncate text-[13px] text-white">
                          <span class="mr-2 font-medium tabular-nums text-white/75">{ch.number}</span>
                          <span class="font-medium">{ch.name}</span>
                          <Show when={nowProg()?.title}>
                            <span class="ml-2 font-normal text-white/[0.82]">{nowProg()!.title}</span>
                          </Show>
                        </div>
                        <Show
                          when={isActive()}
                          fallback={
                            <span class="shrink-0 text-[12px] font-normal text-white/[0.78]">{ch.group_title}</span>
                          }
                        >
                          <span class="inline-flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-white">
                            <span class="live-dot" />
                            Live
                          </span>
                        </Show>
                      </div>

                      <div class="flex items-center gap-3 text-[13px] font-medium tabular-nums tracking-[-0.01em] text-white/95">
                        <span>{startStr()}</span>
                        <span class="h-px flex-1 bg-white/15" />
                        <span class="text-[12px] font-normal text-white/[0.82]">{durStr()}</span>
                        <span class="h-px flex-1 bg-white/15" />
                        <span>{stopStr()}</span>
                      </div>
                    </button>
                  );
                }}
              </For>
            </div>
          </div>

          <div class="flex items-center gap-3">
            <button
              ref={(el) => onCleanup(registerFocusable("home-cta-watch", el, handleWatchLive))}
              type="button"
              data-focus-id="home-cta-watch"
              data-focus-radius="9999px"
              onClick={handleWatchLive}
              class="pill pill-primary"
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
              onClick={() => sendCommand({ type: "SetOverlay", overlay: "FullEpg" })}
              class="text-link"
            >
              <span>Program Guide</span>
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </section>
      </main>

      {/* Bottom 5-column hairline strip (continue watching + live channels) */}
      <footer class="border-t border-white/10 pt-4">
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
                  ref={(el) => onCleanup(registerFocusable(item.id, el, onActivate))}
                  type="button"
                  data-focus-id={item.id}
                  data-focus-radius="14px"
                  onClick={onActivate}
                  class="strip-item flex flex-col items-start rounded-[14px] px-3 py-3 text-left"
                >
                  <HairlineIcon kind={item.icon} />
                  <div class="hero-text-shadow mt-3 w-full truncate text-[13px] font-medium tracking-[-0.01em] text-white">
                    {item.title}
                  </div>
                  <div class="hero-text-shadow mt-0.5 line-clamp-2 w-full text-[12px] font-normal leading-snug text-white/[0.82]">
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
