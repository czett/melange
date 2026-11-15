import { Show, createEffect, onCleanup } from "solid-js";
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

  return (
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
            <div class="progress-track flex-1">
              <div
                class="progress-fill transition-all duration-300"
                style={{ width: `${progressPct()}%` }}
              />
            </div>
            <span class="w-14 text-[12px] font-medium tabular-nums text-white/80">
              {formatTime(playback().duration_sec)}
            </span>
          </div>
        </GlassPanel>
      </div>
    </Show>
  );
}
