import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { computeEpgProgress, formatXmltvTime } from "../bridge/epgTime";
import { melangeState, sendCommand } from "../bridge/ws";
import { ensureValidFocus } from "../spatial/nav";
import {
  GlassPanel,
  HapticTile,
  SegmentedPill,
  SquircleIcon,
  type SegmentedItem
} from "./primitives";

export const HomeView = () => {
  const [now, setNow] = createSignal(new Date());

  const clockTimer = window.setInterval(() => setNow(new Date()), 1000);
  onCleanup(() => window.clearInterval(clockTimer));

  onMount(() => {
    requestAnimationFrame(() => ensureValidFocus("home-live-pill"));
  });

  const formattedTime = () =>
    now().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

  const formattedDate = () =>
    now()
      .toLocaleDateString([], {
        weekday: "long",
        month: "long",
        day: "numeric"
      })
      .toUpperCase();

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

  const livePillLabel = () => {
    const ch = featuredChannel();
    if (!ch) return "Open Live TV";
    const prog = featuredNowNext()?.now?.title;
    return prog ? `${ch.name} — ${prog}` : ch.name;
  };

  const profileItems = createMemo<SegmentedItem[]>(() => {
    const activeId = melangeState().active_profile?.id;
    return melangeState().profiles.map((p) => ({
      id: String(p.id),
      focusId: `home-profile-${p.id}`,
      label: p.name,
      active: p.id === activeId,
      onSelect: () => sendCommand({ type: "SelectProfile", profile_id: p.id })
    }));
  });

  const handleWatchLive = () => {
    const ch = featuredChannel();
    if (ch) {
      sendCommand({ type: "SelectChannel", channel_id: ch.id });
    } else {
      sendCommand({ type: "SetMode", mode: "LiveTv" });
    }
  };

  const keepWatchingItems = createMemo(() => melangeState().continue_watching.slice(0, 6));
  const liveChannels = createMemo(() => melangeState().channels.slice(0, 12));

  return (
    <div class="relative flex h-full w-full flex-col justify-between overflow-hidden px-10 py-6 xl:px-14 xl:py-8">
      {/* Top Bar: Left couch-tv profile segmented pill · Right utility icon tiles */}
      <header class="flex items-center justify-between gap-4">
        <div class="flex items-center gap-4">
          <div class="flex items-center gap-2 text-white">
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
            <span class="text-[14px] font-semibold tracking-[-0.02em]">melange</span>
          </div>

          <Show when={profileItems().length > 0}>
            <SegmentedPill
              items={profileItems()}
              trailingAction={{
                focusId: "home-profile-manage",
                label: "+",
                ariaLabel: "Manage profiles",
                title: "Switch or manage profiles",
                onSelect: () => sendCommand({ type: "SetOverlay", overlay: "ProfileSwitcher" })
              }}
            />
          </Show>
        </div>

        <div class="flex items-center gap-2.5">
          <HapticTile
            id="home-fullscreen"
            variant="icon"
            radius="9999px"
            ariaLabel={melangeState().is_fullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
            title={melangeState().is_fullscreen ? "Exit Fullscreen (F11)" : "Fullscreen (F11)"}
            onSelect={() => sendCommand({ type: "ToggleFullscreen" })}
            class="h-10 w-10 rounded-full text-white"
          >
            <Show
              when={melangeState().is_fullscreen}
              fallback={
                <svg
                  class="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
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
                class="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M8 3v3a2 2 0 0 1-2 2H3" />
                <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
                <path d="M3 16h3a2 2 0 0 1 2 2v3" />
                <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
              </svg>
            </Show>
          </HapticTile>

          <HapticTile
            id="home-settings"
            variant="icon"
            radius="9999px"
            ariaLabel="Settings"
            title="Settings"
            onSelect={() => sendCommand({ type: "SetMode", mode: "Settings" })}
            class="h-10 w-10 rounded-full text-white"
          >
            <svg
              class="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </HapticTile>

          <HapticTile
            id="home-leave"
            variant="icon"
            radius="9999px"
            ariaLabel="Power / Leave Menu"
            title="Leave Melange (Esc)"
            onSelect={() => sendCommand({ type: "SetOverlay", overlay: "LeaveMenu" })}
            class="h-10 w-10 rounded-full text-white"
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
          </HapticTile>
        </div>
      </header>

      {/* Center Stage: Monumental couch-tv lockscreen clock + Now Playing Live Pill */}
      <section class="my-auto flex flex-col items-center justify-center py-2 text-center">
        <div class="eyebrow hero-text-shadow">{formattedDate()}</div>
        <div class="lockscreen-clock mt-1.5">{formattedTime()}</div>

        <div class="mt-4">
          <HapticTile
            id="home-live-pill"
            variant="pill"
            radius="9999px"
            onSelect={handleWatchLive}
            class="px-5 text-[13px] font-semibold text-white"
          >
            <span class="live-dot" />
            <span class="text-white/[0.74]">LIVE</span>
            <span class="max-w-[34ch] truncate text-white">{livePillLabel()}</span>
            <span class="text-white/75" aria-hidden="true">
              Watch →
            </span>
          </HapticTile>
        </div>
      </section>

      {/* Horizontal Haptic Rows: Keep Watching + Live TV */}
      <section class="mx-auto flex w-full max-w-[1380px] flex-col gap-3">
        <Show when={keepWatchingItems().length > 0}>
          <div>
            <div class="eyebrow hero-text-shadow mb-1.5 px-1">Keep Watching</div>
            <div class="no-scrollbar flex gap-3.5 overflow-x-auto px-1 py-1.5">
              <For each={keepWatchingItems()}>
                {(cw) => {
                  const pct = () =>
                    cw.duration_sec > 0
                      ? Math.round(
                          Math.min(100, Math.max(0, (cw.position_sec / cw.duration_sec) * 100))
                        )
                      : 0;

                  const resumeItem = () =>
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

                  return (
                    <HapticTile
                      id={`home-cw-${cw.item_id}`}
                      variant="row"
                      radius="20px"
                      onSelect={resumeItem}
                      class="flex h-[84px] w-[285px] shrink-0 items-center gap-3 rounded-[20px] p-2.5 text-left xl:h-[90px]"
                    >
                      <div class="relative h-[62px] w-[86px] shrink-0 overflow-hidden rounded-[12px] border border-white/10 bg-[#140203]">
                        <Show
                          when={cw.thumbnail_url}
                          fallback={
                            <div
                              class="flex h-full w-full items-center justify-center text-[13px] font-bold uppercase tracking-[0.12em] text-white/85"
                              style={{
                                background:
                                  "linear-gradient(145deg, rgba(131,22,19,0.72) 0%, rgba(16,2,3,0.95) 100%)"
                              }}
                            >
                              {cw.provider.slice(0, 2)}
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

                      <div class="flex min-w-0 flex-1 flex-col justify-between self-stretch py-0.5">
                        <div>
                          <div class="truncate text-[13.5px] font-semibold tracking-[-0.015em] text-white">
                            {cw.title}
                          </div>
                          <div class="mt-0.5 truncate text-[12px] font-medium text-white/[0.74]">
                            {cw.provider} · {pct()}%
                          </div>
                        </div>
                        <div class="progress-track">
                          <div class="progress-fill" style={{ width: `${pct()}%` }} />
                        </div>
                      </div>
                    </HapticTile>
                  );
                }}
              </For>
            </div>
          </div>
        </Show>

        <div>
          <div class="mb-1.5 flex items-center justify-between px-1">
            <span class="eyebrow hero-text-shadow">Live TV</span>
            <span class="text-[12px] font-medium tabular-nums text-white/[0.72]">
              {melangeState().channels.length} channels
            </span>
          </div>

          <Show
            when={liveChannels().length > 0}
            fallback={
              <GlassPanel variant="surface" class="rounded-[20px] px-5 py-4 text-[13px] font-medium text-white/[0.74]">
                No live channels configured yet. Open Settings or the Companion app to sync your lineup.
              </GlassPanel>
            }
          >
            <div class="no-scrollbar flex gap-3.5 overflow-x-auto px-1 py-1.5">
              <For each={liveChannels()}>
                {(ch) => {
                  const nn = () => melangeState().epg_now_next[ch.tvg_id];
                  const isActive = () => melangeState().playback.channel_id === ch.id;
                  const nowProg = () => nn()?.now;
                  const progressPct = () => {
                    const p = nowProg();
                    if (!p) return 0;
                    return computeEpgProgress(p.start_time, p.stop_time);
                  };
                  const subtitle = () => {
                    const p = nowProg();
                    if (p) {
                      return `${p.title} · ${formatXmltvTime(p.start_time)}`;
                    }
                    return ch.group_title || "Live Broadcast";
                  };

                  return (
                    <HapticTile
                      id={`home-ch-${ch.id}`}
                      variant="row"
                      radius="20px"
                      active={isActive()}
                      onSelect={() => sendCommand({ type: "SelectChannel", channel_id: ch.id })}
                      class="flex h-[84px] w-[285px] shrink-0 items-center gap-3 rounded-[20px] p-2.5 text-left xl:h-[90px]"
                    >
                      <div
                        class="relative flex h-[62px] w-[86px] shrink-0 items-center justify-center overflow-hidden rounded-[12px] border border-white/10"
                        style={{
                          background: isActive()
                            ? "linear-gradient(145deg, rgba(225,58,38,0.68) 0%, rgba(131,22,19,0.85) 100%)"
                            : "linear-gradient(145deg, rgba(131,22,19,0.52) 0%, rgba(16,2,3,0.92) 100%)"
                        }}
                      >
                        <Show
                          when={ch.logo_url}
                          fallback={
                            <span class="text-[20px] font-bold tracking-[-0.03em] tabular-nums text-white">
                              {ch.number}
                            </span>
                          }
                        >
                          {(logo) => (
                            <img
                              src={logo()}
                              alt={ch.name}
                              class="max-h-10 max-w-[68px] object-contain"
                              loading="lazy"
                            />
                          )}
                        </Show>
                        <Show when={isActive()}>
                          <span class="live-dot absolute right-2 top-2" />
                        </Show>
                      </div>

                      <div class="flex min-w-0 flex-1 flex-col justify-between self-stretch py-0.5">
                        <div>
                          <div class="flex items-center gap-1.5">
                            <span class="truncate text-[13.5px] font-semibold tracking-[-0.015em] text-white">
                              {ch.name}
                            </span>
                          </div>
                          <div class="mt-0.5 truncate text-[12px] font-medium text-white/[0.74]">
                            {subtitle()}
                          </div>
                        </div>

                        <div class="progress-track">
                          <div
                            class="progress-fill"
                            style={{ width: `${nowProg() ? progressPct() : isActive() ? 100 : 0}%` }}
                          />
                        </div>
                      </div>
                    </HapticTile>
                  );
                }}
              </For>
            </div>
          </Show>
        </div>
      </section>

      {/* Bottom centered tvOS Squircle App Dock */}
      <footer class="flex justify-center pt-2">
        <GlassPanel variant="dock" as="nav" class="flex items-center gap-2 px-3 py-2">
          <HapticTile
            id="dock-livetv"
            variant="dock"
            radius="18px"
            onSelect={handleWatchLive}
            class="rounded-[18px] px-1.5 py-1"
          >
            <SquircleIcon
              app="LiveTv"
              label="Live TV"
              focusId="dock-livetv"
              active={melangeState().playback.channel_id !== null}
            />
          </HapticTile>

          <HapticTile
            id="dock-epg"
            variant="dock"
            radius="18px"
            onSelect={() => sendCommand({ type: "SetOverlay", overlay: "FullEpg" })}
            class="rounded-[18px] px-1.5 py-1"
          >
            <SquircleIcon
              app="FullEpg"
              label="Guide"
              focusId="dock-epg"
              active={melangeState().overlay === "FullEpg"}
            />
          </HapticTile>

          <HapticTile
            id="dock-mediathek"
            variant="dock"
            radius="18px"
            onSelect={() => sendCommand({ type: "SetMode", mode: "Mediathek" })}
            class="rounded-[18px] px-1.5 py-1"
          >
            <SquircleIcon app="Mediathek" label="Mediathek" focusId="dock-mediathek" />
          </HapticTile>

          <HapticTile
            id="dock-youtube"
            variant="dock"
            radius="18px"
            onSelect={() => sendCommand({ type: "SetMode", mode: "YouTube" })}
            class="rounded-[18px] px-1.5 py-1"
          >
            <SquircleIcon app="YouTube" label="YouTube" focusId="dock-youtube" />
          </HapticTile>

          <HapticTile
            id="dock-media"
            variant="dock"
            radius="18px"
            onSelect={() => sendCommand({ type: "SetMode", mode: "Media" })}
            class="rounded-[18px] px-1.5 py-1"
          >
            <SquircleIcon app="Media" label="Media" focusId="dock-media" />
          </HapticTile>

          <HapticTile
            id="dock-settings"
            variant="dock"
            radius="18px"
            onSelect={() => sendCommand({ type: "SetMode", mode: "Settings" })}
            class="rounded-[18px] px-1.5 py-1"
          >
            <SquircleIcon app="Settings" label="Settings" focusId="dock-settings" />
          </HapticTile>
        </GlassPanel>
      </footer>
    </div>
  );
};
