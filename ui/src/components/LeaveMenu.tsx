import { onCleanup, onMount } from "solid-js";
import { melangeState, sendCommand } from "../bridge/ws";
import { ensureValidFocus, setFocus } from "../spatial/nav";
import { GlassPanel, HapticTile } from "./primitives";

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
      requestAnimationFrame(() => ensureValidFocus("dock-livetv"));
    });
  });

  return (
    <GlassPanel
      variant="scrim"
      class="fixed inset-0 z-50 flex items-center justify-center px-8"
      onClick={closeMenu}
    >
      <GlassPanel
        variant="heavy"
        class="relative w-full max-w-md rounded-[24px] p-7"
        onClick={(e: MouseEvent) => e.stopPropagation()}
      >
        <div>
          <div class="text-[12px] font-medium text-white/[0.62]">Session</div>
          <h2 class="view-title mt-1 text-[26px]">Leave melange?</h2>
          <p class="mt-2 max-w-[44ch] text-[13px] font-medium leading-relaxed text-white/[0.62]">
            Stay to keep watching, switch window fullscreen, or quit the application cleanly.
          </p>
        </div>

        <div class="mt-6 grid grid-cols-1 gap-2.5">
          <HapticTile
            id="leave-stay"
            variant="row"
            radius="16px"
            onSelect={closeMenu}
            class="flex items-center justify-between rounded-[16px] px-4 py-3.5 text-left"
          >
            <div>
              <div class="text-[14px] font-semibold tracking-[-0.01em] text-white">
                Stay in Melange
              </div>
              <div class="mt-0.5 text-[12px] font-medium text-white/[0.62]">
                Return to the home screen
              </div>
            </div>
            <span class="chip font-semibold">Esc</span>
          </HapticTile>

          <HapticTile
            id="leave-fullscreen"
            variant="row"
            radius="16px"
            onSelect={toggleFullscreenAndClose}
            class="flex items-center justify-between rounded-[16px] px-4 py-3.5 text-left"
          >
            <div>
              <div class="text-[14px] font-semibold tracking-[-0.01em] text-white">
                Toggle Fullscreen
              </div>
              <div class="mt-0.5 text-[12px] font-medium text-white/[0.62]">
                {melangeState().is_fullscreen ? "Exit fullscreen window" : "Expand to fullscreen"}
              </div>
            </div>
            <span class="chip font-semibold">F11</span>
          </HapticTile>

          <HapticTile
            id="leave-quit"
            variant="row"
            radius="16px"
            onSelect={quitMelange}
            class="flex items-center justify-between rounded-[16px] px-4 py-3.5 text-left"
          >
            <div>
              <div class="text-[14px] font-semibold tracking-[-0.01em] text-white">
                Quit Melange
              </div>
              <div class="mt-0.5 text-[12px] font-medium text-white/[0.62]">
                Close the player and exit
              </div>
            </div>
            <span class="live-dot" />
          </HapticTile>
        </div>
      </GlassPanel>
    </GlassPanel>
  );
};
