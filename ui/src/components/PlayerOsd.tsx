import { Show, createEffect, onCleanup } from "solid-js";
import { melangeState, sendCommand } from "../bridge/ws";
import { ensureValidFocus, registerFocusable, setFocus } from "../spatial/nav";

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
        <div class="glass-card pointer-events-auto mx-auto flex max-w-4xl flex-col gap-4 rounded-[22px] px-7 py-5">
          <div class="flex items-center justify-between gap-4">
            <div class="min-w-0">
              <div class="eyebrow flex items-center gap-2 truncate">
                <span class="live-dot" />
                <span>{playback().subtitle ?? "On Demand"}</span>
              </div>
              <div class="mt-1.5 truncate text-[22px] font-normal leading-tight tracking-[-0.03em] text-white">
                {playback().title ?? "Playing"}
              </div>
            </div>

            <div class="flex shrink-0 items-center gap-2">
              <button
                ref={(el) => onCleanup(registerFocusable("osd-seek-back", el, () => seek(-15)))}
                type="button"
                data-focus-radius="9999px"
                onClick={() => seek(-15)}
                class="pill pill-secondary tabular-nums"
              >
                -15s
              </button>
              <button
                ref={(el) => onCleanup(registerFocusable("osd-toggle-pause", el, togglePause))}
                type="button"
                data-focus-radius="9999px"
                onClick={togglePause}
                class="pill pill-primary min-w-[5.5rem]"
              >
                {playback().paused ? "Play" : "Pause"}
              </button>
              <button
                ref={(el) => onCleanup(registerFocusable("osd-seek-fwd", el, () => seek(30)))}
                type="button"
                data-focus-radius="9999px"
                onClick={() => seek(30)}
                class="pill pill-secondary tabular-nums"
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
                type="button"
                data-focus-radius="9999px"
                onClick={() => sendCommand({ type: "SetMode", mode: "Home" })}
                class="pill pill-secondary tabular-nums"
              >
                ← Back
              </button>
            </div>
          </div>

          <div class="flex items-center gap-4">
            <span class="w-14 text-right text-[11px] tabular-nums text-white/70">
              {formatTime(playback().position_sec)}
            </span>
            <div class="progress-track flex-1">
              <div
                class="progress-fill transition-all duration-300"
                style={{ width: `${progressPct()}%` }}
              />
            </div>
            <span class="w-14 text-[11px] tabular-nums text-white/45">
              {formatTime(playback().duration_sec)}
            </span>
          </div>
        </div>
      </div>
    </Show>
  );
}
