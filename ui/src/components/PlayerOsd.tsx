import { Show, createEffect, onCleanup } from "solid-js";
import { melangeState, sendCommand } from "../bridge/ws";
import { ensureValidFocus, registerFocusable } from "../spatial/nav";

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
      requestAnimationFrame(() => ensureValidFocus("osd-toggle-pause"));
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
      <div class="fixed inset-x-0 bottom-0 z-30 p-8 pointer-events-none">
        <div class="glass-panel max-w-4xl mx-auto rounded-3xl px-7 py-5 pointer-events-auto flex flex-col gap-4">
          <div class="flex items-center justify-between gap-4">
            <div class="min-w-0">
              <div class="text-xs uppercase tracking-[0.2em] text-white/55 truncate">
                {playback().subtitle ?? "On Demand"}
              </div>
              <div class="text-xl font-semibold text-white truncate">
                {playback().title ?? "Playing"}
              </div>
            </div>

            <div class="flex items-center gap-2.5 shrink-0">
              <button
                ref={(el) => onCleanup(registerFocusable("osd-seek-back", el, () => seek(-15)))}
                onClick={() => seek(-15)}
                class="glass-card px-4 py-2 rounded-full text-sm font-medium text-white"
              >
                -15s
              </button>
              <button
                ref={(el) => onCleanup(registerFocusable("osd-toggle-pause", el, togglePause))}
                onClick={togglePause}
                class="px-5 py-2 rounded-full text-sm font-semibold bg-white text-black"
              >
                {playback().paused ? "Play" : "Pause"}
              </button>
              <button
                ref={(el) => onCleanup(registerFocusable("osd-seek-fwd", el, () => seek(30)))}
                onClick={() => seek(30)}
                class="glass-card px-4 py-2 rounded-full text-sm font-medium text-white"
              >
                +30s
              </button>
              <button
                ref={(el) =>
                  onCleanup(
                    registerFocusable("osd-back", el, () =>
                      sendCommand({ type: "SetMode", mode: "Home" })
                    )
                  )
                }
                onClick={() => sendCommand({ type: "SetMode", mode: "Home" })}
                class="glass-card px-4 py-2 rounded-full text-sm font-medium text-white/85"
              >
                ← Back
              </button>
            </div>
          </div>

          <div class="flex items-center gap-4">
            <span class="text-xs font-mono text-white/75 w-14 text-right">
              {formatTime(playback().position_sec)}
            </span>
            <div class="flex-1 h-2 rounded-full bg-white/15 overflow-hidden">
              <div
                class="h-full bg-white rounded-full transition-all duration-300"
                style={{ width: `${progressPct()}%` }}
              />
            </div>
            <span class="text-xs font-mono text-white/55 w-14">
              {formatTime(playback().duration_sec)}
            </span>
          </div>
        </div>
      </div>
    </Show>
  );
}
