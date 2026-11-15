import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { computeEpgProgress, formatXmltvTime } from "../bridge/epgTime";
import { melangeState, sendCommand } from "../bridge/ws";
import { ensureValidFocus, setFocus } from "../spatial/nav";
import {
  GlassPanel,
  HapticTile,
  SegmentedPill,
  SquircleIcon,
  type SegmentedItem
} from "./primitives";

function providerLabel(provider: string): string {
  switch (provider.toLowerCase()) {
    case "mediathek":
      return "Mediathek";
    case "youtube":
      return "YouTube";
    case "local":
      return "Media";
    default:
      return provider;
  }
}

function formatRemaining(positionSec: number, durationSec: number): string {
  if (durationSec <= 0) return "Resume";
  const remMin = Math.max(1, Math.round((durationSec - positionSec) / 60));
  if (remMin >= 60) {
    const h = Math.floor(remMin / 60);
    const m = remMin % 60;
    return m > 0 ? `${h}h ${m}m left` : `${h}h left`;
  }
  return `${remMin}m left`;
}

export const HomeView = () => {
  const [now, setNow] = createSignal(new Date());

  const clockTimer = window.setInterval(() => setNow(new Date()), 1000);
  onCleanup(() => window.clearInterval(clockTimer));

  onMount(() => {
    requestAnimationFrame(() => {
      setFocus("dock-livetv", false);
      ensureValidFocus("dock-livetv");
    });
  });

  const formattedTime = () =>
    now().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

  const formattedDate = () => {
    const d = now();
    const weekday = d.toLocaleDateString("en-GB", { weekday: "long" });
    const day = d.getDate();
    const month = d.toLocaleDateString("en-GB", { month: "long" });
    return `${weekday} ${day} ${month}`;
  };

  const featuredChannel = createMemo(() => {
    const state = melangeState();
    return (
      state.channels.find((c) => c.id === state.playback.channel_id) ??
      state.channels[0] ??
      null
    );
  });

  const profileItems = createMemo<SegmentedItem[]>(() => {
    const profiles = melangeState().profiles;
    const activeId = melangeState().active_profile?.id;
    if (profiles.length === 0) {
      return [
        {
          id: "default",
          focusId: "home-profile-default",
          label: melangeState().active_profile?.name ?? "Default",
          active: true,
          onSelect: () => sendCommand({ type: "SetOverlay", overlay: "ProfileSwitcher" })
        }
      ];
    }
    return profiles.map((p) => ({
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
      {/* Top Bar: Left profile pill · Right utility circles */}
      <header class="flex items-center justify-between gap-4">
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

        <div class="flex items-center gap-2.5">
          <HapticTile
            id="home-fullscreen"
            variant="icon"
            radius="9999px"
            ariaLabel={melangeState().is_fullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
            title={melangeState().is_fullscreen ? "Exit Fullscreen (F11)" : "Fullscreen (F11)"}
            onSelect={() => sendCommand({ type: "ToggleFullscreen" })}
            class="h-10 w-10 rounded-full text-white/90"
          >
            <Show
              when={melangeState().is_fullscreen}
              fallback={
                <svg
                  class="h-4 w-4 drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.9"
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
                class="h-4 w-4 drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.9"
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
            class="h-10 w-10 rounded-full text-white/90"
          >
            <svg
              class="h-4 w-4 drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]"
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
          </HapticTile>

          <HapticTile
            id="home-leave"
            variant="icon"
            radius="9999px"
            ariaLabel="Leave Menu"
            title="Leave Melange (Esc)"
            onSelect={() => sendCommand({ type: "SetOverlay", overlay: "LeaveMenu" })}
            class="h-10 w-10 rounded-full text-white/90"
          >
            <svg
              class="h-4 w-4 drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]"
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

      {/* Center Stage: Date + Tall Slender Fading Couch TV Lockscreen Clock */}
      <section
        class={`my-auto flex flex-col items-center justify-center py-3 text-center transition-opacity duration-150 ${
          melangeState().overlay !== "None" ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        <div class="hero-text-shadow text-[15px] font-medium tracking-[-0.01em] text-white/90">
          {formattedDate()}
        </div>
        <div class="lockscreen-clock mt-3 select-none text-[168px] font-normal leading-[0.88] tracking-[-0.04em] tabular-nums xl:text-[188px]">
          {formattedTime()}
        </div>
      </section>

      {/* Lower Stage: Keep watching & Live TV dark smoke-glass rows */}
      <section class="mx-auto flex w-full max-w-[1420px] flex-col gap-4">
        <Show when={keepWatchingItems().length > 0}>
          <div>
            <div class="mb-1.5 px-1 text-[15px] font-semibold tracking-[-0.015em] text-white/95">
              Keep watching
            </div>
            <div class="no-scrollbar -mx-2 flex gap-3.5 overflow-x-auto px-2 py-2">
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
                      radius="16px"
                      onSelect={resumeItem}
                      class="flex h-[76px] w-[288px] shrink-0 items-center gap-3 rounded-[16px] p-2 text-left"
                    >
                      <div class="relative h-[58px] w-[92px] shrink-0 overflow-hidden rounded-[10px] bg-white/[0.07] ring-1 ring-inset ring-white/[0.08]">
                        <Show
                          when={cw.thumbnail_url}
                          fallback={
                            <div class="flex h-full w-full items-center justify-center bg-white/[0.05] text-white/75">
                              <svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
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

                      <div class="flex h-[58px] min-w-0 flex-1 flex-col justify-between py-[2px]">
                        <div class="min-w-0">
                          <div class="truncate text-[14px] font-semibold leading-[1.2] tracking-[-0.015em] text-white">
                            {cw.title}
                          </div>
                          <div class="mt-1 flex items-center gap-1.5 min-w-0">
                            <span class="shrink-0 rounded-[5px] bg-white/[0.10] px-1.5 py-[1px] text-[10.5px] font-semibold leading-tight text-white/85">
                              {providerLabel(cw.provider)}
                            </span>
                            <span class="truncate text-[12px] font-medium leading-[1.2] text-white/80">
                              {formatRemaining(cw.position_sec, cw.duration_sec)}
                            </span>
                          </div>
                        </div>
                        <div class="h-[3px] w-full overflow-hidden rounded-full bg-white/20">
                          <div
                            class="h-full rounded-full bg-white"
                            style={{ width: `${pct()}%` }}
                          />
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
            <span class="text-[15px] font-semibold tracking-[-0.015em] text-white/95">Live TV</span>
            <Show when={melangeState().channels.length > 0}>
              <span class="text-[12px] font-medium tabular-nums text-white/80">
                {melangeState().channels.length} channels
              </span>
            </Show>
          </div>

          <Show
            when={liveChannels().length > 0}
            fallback={
              <GlassPanel
                variant="surface"
                class="rounded-[18px] px-5 py-4 text-[13px] font-medium text-white/80"
              >
                No live channels configured yet. Open Settings or the Companion app to sync your
                lineup.
              </GlassPanel>
            }
          >
            <div class="no-scrollbar -mx-2 flex gap-3.5 overflow-x-auto px-2 py-2">
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
                    return ch.group_title || "Live broadcast";
                  };

                  return (
                    <HapticTile
                      id={`home-ch-${ch.id}`}
                      variant="row"
                      radius="16px"
                      active={isActive()}
                      onSelect={() => sendCommand({ type: "SelectChannel", channel_id: ch.id })}
                      class="flex h-[76px] w-[288px] shrink-0 items-center gap-3 rounded-[16px] p-2 text-left"
                    >
                      <div
                        class={`relative flex h-[58px] w-[92px] shrink-0 items-center justify-center overflow-hidden rounded-[10px] ring-1 ring-inset ${
                          isActive()
                            ? "bg-white/[0.12] ring-white/25"
                            : "bg-white/[0.07] ring-white/[0.08]"
                        }`}
                      >
                        <Show
                          when={ch.logo_url}
                          fallback={
                            <span class="text-[18px] font-semibold tracking-[-0.02em] tabular-nums text-white">
                              {ch.number}
                            </span>
                          }
                        >
                          {(logo) => (
                            <>
                              <span class="absolute left-2 top-1.5 text-[10px] font-semibold leading-none tabular-nums text-white/80">
                                {ch.number}
                              </span>
                              <img
                                src={logo()}
                                alt={ch.name}
                                class="max-h-8 max-w-[70px] object-contain"
                                loading="lazy"
                              />
                            </>
                          )}
                        </Show>
                        <span
                          class={`live-dot absolute right-2 top-2 ${
                            isActive() ? "" : "opacity-80"
                          }`}
                        />
                      </div>

                      <div class="flex h-[58px] min-w-0 flex-1 flex-col justify-between py-[2px]">
                        <div class="min-w-0">
                          <div class="truncate text-[14px] font-semibold leading-[1.2] tracking-[-0.015em] text-white">
                            {ch.name}
                          </div>
                          <div class="mt-1 truncate text-[12px] font-medium leading-[1.2] text-white/80">
                            {subtitle()}
                          </div>
                        </div>

                        <div class="h-[3px] w-full overflow-hidden rounded-full bg-white/20">
                          <div
                            class="h-full rounded-full bg-white"
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

      {/* Bottom centered Couch TV App Dock */}
      <footer class="flex justify-center pt-4">
        <GlassPanel as="nav" variant="dock" class="flex items-center gap-2.5 rounded-[22px] p-2">
          <HapticTile
            id="dock-livetv"
            variant="dock"
            radius="14px"
            ariaLabel="Live TV"
            onSelect={handleWatchLive}
            class="relative"
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
            radius="14px"
            ariaLabel="Guide"
            onSelect={() => sendCommand({ type: "SetOverlay", overlay: "FullEpg" })}
            class="relative"
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
            radius="14px"
            ariaLabel="Mediathek"
            onSelect={() => sendCommand({ type: "SetMode", mode: "Mediathek" })}
            class="relative"
          >
            <SquircleIcon app="Mediathek" label="Mediathek" focusId="dock-mediathek" />
          </HapticTile>

          <HapticTile
            id="dock-youtube"
            variant="dock"
            radius="14px"
            ariaLabel="YouTube"
            onSelect={() => sendCommand({ type: "SetMode", mode: "YouTube" })}
            class="relative"
          >
            <SquircleIcon app="YouTube" label="YouTube" focusId="dock-youtube" />
          </HapticTile>

          <HapticTile
            id="dock-media"
            variant="dock"
            radius="14px"
            ariaLabel="Media"
            onSelect={() => sendCommand({ type: "SetMode", mode: "Media" })}
            class="relative"
          >
            <SquircleIcon app="Media" label="Media" focusId="dock-media" />
          </HapticTile>

          <HapticTile
            id="dock-settings"
            variant="dock"
            radius="14px"
            ariaLabel="Settings"
            onSelect={() => sendCommand({ type: "SetMode", mode: "Settings" })}
            class="relative"
          >
            <SquircleIcon app="Settings" label="Settings" focusId="dock-settings" />
          </HapticTile>
        </GlassPanel>
      </footer>
    </div>
  );
};
