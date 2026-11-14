import { Show, createEffect, onCleanup } from "solid-js";
import { melangeState, sendCommand } from "../bridge/ws";
import { ensureValidFocus, isFocused, registerFocusable } from "../spatial/nav";

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
      <div class="pointer-events-none fixed inset-x-0 bottom-0 z-30 p-8">
        <div class="fluted-surface pointer-events-auto mx-auto flex max-w-4xl flex-col gap-4 rounded-3xl px-8 py-5">
          <div class="flex items-center justify-between gap-4">
            <div class="min-w-0">
              <div class="flex items-center gap-2 truncate text-xs uppercase tracking-[0.22em] text-white/65">
                <span class="live-beacon h-1.5 w-1.5 rounded-full" />
                <span>{playback().subtitle ?? "On Demand"}</span>
              </div>
              <div class="mt-0.5 truncate text-2xl font-light tracking-editorial text-white">
                {playback().title ?? "Playing"}
              </div>
            </div>

            <div class="flex shrink-0 items-center gap-2.5">
              <button
                ref={(el) => onCleanup(registerFocusable("osd-seek-back", el, () => seek(-15)))}
                type="button"
                data-focus-radius="9999px"
                onClick={() => seek(-15)}
                class={`rounded-full px-4 py-2 text-sm font-medium tabular-nums transition ${
                  isFocused("osd-seek-back") ? "pill-cta-white" : "fluted-pill text-white"
                }`}
              >
                -15s
              </button>
              <button
                ref={(el) => onCleanup(registerFocusable("osd-toggle-pause", el, togglePause))}
                type="button"
                data-focus-radius="9999px"
                onClick={togglePause}
                class="pill-cta-white rounded-full px-6 py-2 text-sm font-semibold"
              >
                {playback().paused ? "Play" : "Pause"}
              </button>
              <button
                ref={(el) => onCleanup(registerFocusable("osd-seek-fwd", el, () => seek(30)))}
                type="button"
                data-focus-radius="9999px"
                onClick={() => seek(30)}
                class={`rounded-full px-4 py-2 text-sm font-medium tabular-nums transition ${
                  isFocused("osd-seek-fwd") ? "pill-cta-white" : "fluted-pill text-white"
                }`}
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
                class={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  isFocused("osd-back") ? "pill-cta-white" : "fluted-pill text-white/90"
                }`}
              >
                ← Back
              </button>
            </div>
          </div>

          <div class="flex items-center gap-4">
            <span class="w-14 text-right text-xs font-medium tabular-nums text-white/80">
              {formatTime(playback().position_sec)}
            </span>
            <div class="relative h-2 flex-1 overflow-hidden rounded-full bg-white/15">
              <div
                class="crimson-progress-fill h-full rounded-full transition-all duration-300"
                style={{ width: `${progressPct()}%` }}
              />
            </div>
            <span class="w-14 text-xs font-medium tabular-nums text-white/60">
              {formatTime(playback().duration_sec)}
            </span>
          </div>
        </div>
      </div>
    </Show>
  );
}
