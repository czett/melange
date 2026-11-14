import { onCleanup, onMount } from "solid-js";
import type { AppMode } from "../bridge/types";
import { sendCommand } from "../bridge/ws";
import { ensureValidFocus, registerFocusable } from "../spatial/nav";

export const PlaceholderModeView = (props: { mode: AppMode }) => {
  let backBtn!: HTMLButtonElement;

  onMount(() => {
    const cleanup = registerFocusable("mode-back-home", backBtn, () =>
      sendCommand({ type: "SetMode", mode: "Home" })
    );
    requestAnimationFrame(() => ensureValidFocus("mode-back-home"));
    onCleanup(cleanup);
  });

  const subtitle = () => {
    switch (props.mode) {
      case "Mediathek":
        return "ARD / ZDF Mediathek integration arrives in Milestone 3.";
      case "Media":
        return "Local media library browser arrives in Milestone 3.";
      case "Settings":
        return "System, audio, and playlist settings arrive in Milestone 4.";
      default:
        return "";
    }
  };

  return (
    <div class="flex h-full w-full items-center justify-center p-12">
      <div class="glass-panel-heavy max-w-lg rounded-3xl p-8 text-center">
        <span class="glass-pill rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-widest text-sky-300">
          {props.mode}
        </span>
        <h1 class="mt-4 text-3xl font-semibold tracking-tight text-white">
          {props.mode}
        </h1>
        <p class="mt-2 text-sm text-white/65">{subtitle()}</p>
        <div class="mt-7 flex justify-center">
          <button
            ref={backBtn}
            type="button"
            data-focus-id="mode-back-home"
            onClick={() => sendCommand({ type: "SetMode", mode: "Home" })}
            class="rounded-2xl bg-white/14 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/20"
          >
            Back to Home
          </button>
        </div>
      </div>
    </div>
  );
};
