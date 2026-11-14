import { Show, createEffect, onCleanup, onMount } from "solid-js";
import type { NavEvent } from "./bridge/types";
import {
  connectBridge,
  emitLocalNavEvent,
  melangeState,
  onNavEvent,
  sendCommand
} from "./bridge/ws";
import { FocusRing } from "./components/FocusRing";
import { FullEpg } from "./components/FullEpg";
import { HomeView } from "./components/HomeView";
import { OnDemandView } from "./components/OnDemandView";
import { PlayerOsd } from "./components/PlayerOsd";
import { ProfileSwitcher } from "./components/ProfileSwitcher";
import { SettingsView } from "./components/SettingsView";
import { ZapBanner } from "./components/ZapBanner";
import { handleSpatialNav, measureFocused } from "./spatial/nav";

function mapBrowserKey(key: string): NavEvent | null {
  switch (key) {
    case "ArrowUp":
      return "Up";
    case "ArrowDown":
      return "Down";
    case "ArrowLeft":
      return "Left";
    case "ArrowRight":
      return "Right";
    case "Enter":
      return "Select";
    case "Escape":
      return "Back";
    case "h":
    case "H":
      return "Home";
    case "e":
    case "E":
      return "ToggleEpg";
    case "PageUp":
      return "ChannelUp";
    case "PageDown":
      return "ChannelDown";
    default:
      return null;
  }
}

export const App = () => {
  onMount(() => {
    connectBridge();

    const unsubNav = onNavEvent((ev) => {
      const state = melangeState();
      const hasInteractiveUi =
        state.mode !== "LiveTv" ||
        state.overlay === "FullEpg" ||
        state.overlay === "ProfileSwitcher" ||
        state.overlay === "PlayerOsd" ||
        state.overlay === "SearchKeyboard";

      if (hasInteractiveUi) {
        const handled = handleSpatialNav(ev);
        if (!handled && ev === "Back") {
          if (state.overlay !== "None") {
            sendCommand({ type: "SetOverlay", overlay: "None" });
          } else if (state.mode !== "Home") {
            sendCommand({ type: "SetMode", mode: "Home" });
          }
        }
      } else if (ev === "Back") {
        if (state.overlay !== "None") {
          sendCommand({ type: "SetOverlay", overlay: "None" });
        } else {
          sendCommand({ type: "SetMode", mode: "Home" });
        }
      }
    });

    const onResize = () => measureFocused();
    window.addEventListener("resize", onResize);

    // Browser-only keyboard fallback when inspecting http://127.0.0.1:9000 outside melange-shell.
    const onKeyDown = (e: KeyboardEvent) => {
      const ev = mapBrowserKey(e.key);
      if (ev) {
        e.preventDefault();
        emitLocalNavEvent(ev);
      }
    };
    window.addEventListener("keydown", onKeyDown);

    onCleanup(() => {
      unsubNav();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKeyDown);
    });
  });

  createEffect(() => {
    void melangeState().mode;
    void melangeState().overlay;
    requestAnimationFrame(() => measureFocused());
  });

  const showFocusRing = () =>
    melangeState().mode !== "LiveTv" ||
    melangeState().overlay === "FullEpg" ||
    melangeState().overlay === "ProfileSwitcher" ||
    melangeState().overlay === "PlayerOsd" ||
    melangeState().overlay === "SearchKeyboard";

  const goHome = () => sendCommand({ type: "SetMode", mode: "Home" });

  return (
    <div class="relative h-screen w-screen overflow-hidden bg-transparent">
      <Show when={melangeState().mode === "Home"}>
        <HomeView />
      </Show>

      <Show when={melangeState().mode === "Mediathek"}>
        <OnDemandView
          provider="mediathek"
          title="Mediathek"
          subtitle="ARD / ZDF"
          onBack={goHome}
        />
      </Show>

      <Show when={melangeState().mode === "YouTube"}>
        <OnDemandView
          provider="youtube"
          title="YouTube"
          subtitle="On Demand"
          onBack={goHome}
        />
      </Show>

      <Show when={melangeState().mode === "Media"}>
        <OnDemandView
          provider="local"
          title="Media"
          subtitle="Local Library"
          onBack={goHome}
        />
      </Show>

      <Show when={melangeState().mode === "Settings"}>
        <SettingsView
          activeProfile={melangeState().active_profile}
          channelCount={melangeState().channels.length}
        />
      </Show>

      <ZapBanner />
      <PlayerOsd />

      <Show when={melangeState().overlay === "FullEpg"}>
        <FullEpg />
      </Show>

      <Show when={melangeState().overlay === "ProfileSwitcher"}>
        <ProfileSwitcher />
      </Show>

      <Show when={showFocusRing()}>
        <FocusRing />
      </Show>
    </div>
  );
};
