import { onCleanup, onMount } from "solid-js";
import { melangeState, sendCommand } from "../bridge/ws";
import { ensureValidFocus, registerFocusable, setFocus } from "../spatial/nav";

export const LeaveMenu = () => {
  const closeMenu = () => {
    sendCommand({ type: "SetOverlay", overlay: "None" });
  };

  const toggleFullscreenAndClose = () => {
    sendCommand({ type: "ToggleFullscreen" });
    sendCommand({ type: "SetOverlay", overlay: "None" });
  };

  const quitMelange = () => {
    sendCommand({ type: "QuitApp" });
  };

  onMount(() => {
    requestAnimationFrame(() => {
      setFocus("leave-stay", false);
      ensureValidFocus("leave-stay");
    });

    onCleanup(() => {
      requestAnimationFrame(() => ensureValidFocus("home-cta-watch"));
    });
  });

  return (
    <div
      class="modal-scrim fixed inset-0 z-50 flex items-center justify-center px-8"
      onClick={closeMenu}
    >
      <div
        class="glass-card relative w-full max-w-md rounded-[24px] p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <div class="eyebrow">Session</div>
          <h2 class="mt-2 pb-0.5 text-[28px] font-medium leading-[1.12] tracking-[-0.035em] text-white">
            Leave melange?
          </h2>
          <p class="mt-2 max-w-[44ch] text-[13px] font-normal leading-relaxed text-white/[0.82]">
            Stay to keep watching, switch window fullscreen, or quit the application cleanly.
          </p>
        </div>

        <div class="mt-7 grid grid-cols-1 gap-2.5">
          <button
            ref={(el) => onCleanup(registerFocusable("leave-stay", el, closeMenu))}
            type="button"
            data-focus-id="leave-stay"
            data-focus-radius="16px"
            onClick={closeMenu}
            class="glass-inner flex items-center justify-between rounded-2xl px-4 py-3.5 text-left"
          >
            <div>
              <div class="text-[14px] font-medium tracking-[-0.01em] text-white">
                Stay in Melange
              </div>
              <div class="mt-0.5 text-[12px] font-normal text-white/[0.78]">
                Return to the home screen
              </div>
            </div>
            <span class="chip">Esc</span>
          </button>

          <button
            ref={(el) =>
              onCleanup(registerFocusable("leave-fullscreen", el, toggleFullscreenAndClose))
            }
            type="button"
            data-focus-id="leave-fullscreen"
            data-focus-radius="16px"
            onClick={toggleFullscreenAndClose}
            class="glass-inner flex items-center justify-between rounded-2xl px-4 py-3.5 text-left"
          >
            <div>
              <div class="text-[14px] font-medium tracking-[-0.01em] text-white">
                Toggle Fullscreen
              </div>
              <div class="mt-0.5 text-[12px] font-normal text-white/[0.78]">
                {melangeState().is_fullscreen ? "Exit fullscreen window" : "Expand to fullscreen"}
              </div>
            </div>
            <span class="chip">F11</span>
          </button>

          <button
            ref={(el) => onCleanup(registerFocusable("leave-quit", el, quitMelange))}
            type="button"
            data-focus-id="leave-quit"
            data-focus-radius="16px"
            onClick={quitMelange}
            class="glass-inner flex items-center justify-between rounded-2xl px-4 py-3.5 text-left"
          >
            <div>
              <div class="text-[14px] font-medium tracking-[-0.01em] text-white">
                Quit Melange
              </div>
              <div class="mt-0.5 text-[12px] font-normal text-white/[0.78]">
                Close the player and exit
              </div>
            </div>
            <span class="live-dot" />
          </button>
        </div>
      </div>
    </div>
  );
};
