import { For, Show, createEffect, onCleanup } from "solid-js";
import { melangeState, sendCommand } from "../bridge/ws";
import { ensureValidFocus, setFocus } from "../spatial/nav";
import { GlassPanel, HapticTile } from "./primitives";

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function PlayerOsd() {
  const playback = () => melangeState().playback;
  const visible = () => melangeState().overlay === "PlayerOsd";

  let hideTimer: number | undefined;

  const resetHideTimer = () => {
    if (hideTimer !== undefined) {
      window.clearTimeout(hideTimer);
    }
    hideTimer = window.setTimeout(() => {
      if (melangeState().overlay === "PlayerOsd") {
        sendCommand({ type: "SetOverlay", overlay: "None" });
      }
    }, 4000);
  };

  createEffect(() => {
    if (visible()) {
      resetHideTimer();
      requestAnimationFrame(() => {
        setFocus("osd-toggle-pause", false);
        ensureValidFocus("osd-toggle-pause");
      });
    } else if (hideTimer !== undefined) {
      window.clearTimeout(hideTimer);
      hideTimer = undefined;
    }
  });

  onCleanup(() => {
    if (hideTimer !== undefined) {
      window.clearTimeout(hideTimer);
    }
  });

  const progressPct = () => {
    const dur = playback().duration_sec;
    const pos = playback().position_sec;
    if (!dur || dur <= 0) return 0;
    return Math.min(100, Math.max(0, (pos / dur) * 100));
  };

  const seek = (offset: number) => {
    resetHideTimer();
    sendCommand({ type: "SeekRelative", offset_sec: offset });
  };

  const togglePause = () => {
    resetHideTimer();
    sendCommand({ type: "TogglePause" });
  };

  const sponsorMarkers = () => {
    const dur = playback().duration_sec;
    const segs = playback().sponsor_segments ?? [];
    if (!dur || dur <= 0 || segs.length === 0) return [];
    return segs
      .map((seg) => {
        const left = Math.min(100, Math.max(0, (seg.start_sec / dur) * 100));
        const right = Math.min(100, Math.max(left, (seg.end_sec / dur) * 100));
        return {
          uuid: seg.uuid,
          leftPct: left,
          widthPct: Math.max(0.6, right - left)
        };
      })
      .filter((m) => m.widthPct > 0);
  };

  return (
    <>
      <Show when={playback().osd_notice}>
        {(notice) => (
          <div class="pointer-events-none fixed right-8 top-8 z-40">
            <GlassPanel
              variant="heavy"
              class="flex items-center gap-2.5 rounded-full px-4 py-2 text-[13px] font-semibold tracking-tight text-white shadow-xl"
            >
              <span class="h-2 w-2 rounded-full bg-[#22C55E]" />
              <span>{notice()}</span>
            </GlassPanel>
          </div>
        )}
      </Show>

      <Show when={visible()}>
        <div class="pointer-events-none fixed inset-x-0 bottom-0 z-30 p-8">
          <GlassPanel
            variant="heavy"
            class="pointer-events-auto mx-auto flex max-w-4xl flex-col gap-4 rounded-[24px] px-7 py-5"
            onClick={(e: MouseEvent) => e.stopPropagation()}
          >
            <div class="flex items-center justify-between gap-4">
              <div class="min-w-0">
                <div class="flex items-center gap-2 truncate text-[12px] font-medium text-white/80">
                  <span class="live-dot" />
                  <span>{playback().subtitle ?? "On Demand"}</span>
                </div>
                <div class="mt-1 truncate text-[20px] font-semibold leading-tight tracking-[-0.025em] text-white">
                  {playback().title ?? "Playing"}
                </div>
              </div>

              <div class="flex shrink-0 items-center gap-2.5">
                <HapticTile
                  id="osd-seek-back"
                  variant="pill"
                  radius="9999px"
                  onSelect={() => seek(-15)}
                  class="tabular-nums"
                >
                  -15s
                </HapticTile>
                <HapticTile
                  id="osd-toggle-pause"
                  variant="pill"
                  radius="9999px"
                  active={true}
                  onSelect={togglePause}
                  class="min-w-[5.5rem]"
                >
                  {playback().paused ? "Play" : "Pause"}
                </HapticTile>
                <HapticTile
                  id="osd-seek-fwd"
                  variant="pill"
                  radius="9999px"
                  onSelect={() => seek(30)}
                  class="tabular-nums"
                >
                  +30s
                </HapticTile>
                <HapticTile
                  id="osd-back"
                  variant="pill"
                  radius="9999px"
                  onSelect={() => sendCommand({ type: "SetMode", mode: "Home" })}
                >
                  ← Back
                </HapticTile>
              </div>
            </div>

            <div class="flex items-center gap-4">
              <span class="w-14 text-right text-[12px] font-semibold tabular-nums text-white/90">
                {formatTime(playback().position_sec)}
              </span>
              <div class="progress-track relative flex-1 overflow-hidden">
                <div
                  class="progress-fill transition-all duration-300"
                  style={{ width: `${progressPct()}%` }}
                />
                <For each={sponsorMarkers()}>
                  {(marker) => (
                    <div
                      class="pointer-events-none absolute inset-y-0 bg-[#22C55E]/75"
                      style={{
                        left: `${marker.leftPct}%`,
                        width: `${marker.widthPct}%`
                      }}
                    />
                  )}
                </For>
              </div>
              <span class="w-14 text-[12px] font-medium tabular-nums text-white/80">
                {formatTime(playback().duration_sec)}
              </span>
            </div>
          </GlassPanel>
        </div>
      </Show>
    </>
  );
}
