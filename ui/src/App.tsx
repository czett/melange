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
import { LeaveMenu } from "./components/LeaveMenu";
import { OnDemandView } from "./components/OnDemandView";
import { PlayerOsd } from "./components/PlayerOsd";
import { ProfileSwitcher } from "./components/ProfileSwitcher";
import { ScenicBackdrop } from "./components/ScenicBackdrop";
import { SettingsView } from "./components/SettingsView";
import { ZapBanner } from "./components/ZapBanner";
import { loadKeymap, resolveBrowserKeyAction } from "./spatial/keymap";
import { handleSpatialNav, measureFocused, setInputModality } from "./spatial/nav";

function mapSearchFallbackKey(key: string): NavEvent | null {
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
    default:
      return null;
  }
}

export const App = () => {
  onMount(() => {
    connectBridge();
    void loadKeymap();

    const unsubNav = onNavEvent((ev) => {
      const state = melangeState();
      const hasInteractiveUi =
        state.mode !== "LiveTv" ||
        state.overlay === "FullEpg" ||
        state.overlay === "ProfileSwitcher" ||
        state.overlay === "PlayerOsd" ||
        state.overlay === "SearchKeyboard" ||
        state.overlay === "LeaveMenu";

      if (hasInteractiveUi) {
        const handled = handleSpatialNav(ev);
        if (!handled && ev === "Back") {
          if (state.overlay !== "None") {
            sendCommand({ type: "SetOverlay", overlay: "None" });
          } else if (state.mode !== "Home") {
            sendCommand({ type: "SetMode", mode: "Home" });
          } else {
            sendCommand({ type: "SetOverlay", overlay: "LeaveMenu" });
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
    window.addEventListener("scroll", onResize, true);

    let lastPointerX: number | null = null;
    let lastPointerY: number | null = null;

    const onPointerMove = (e: MouseEvent) => {
      if (lastPointerX === null || lastPointerY === null) {
        lastPointerX = e.clientX;
        lastPointerY = e.clientY;
        return;
      }
      const dist = Math.hypot(e.clientX - lastPointerX, e.clientY - lastPointerY);
      if (dist >= 2) {
        lastPointerX = e.clientX;
        lastPointerY = e.clientY;
        setInputModality("pointer");
      }
    };

    const onPointerDown = (e: MouseEvent) => {
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;
      setInputModality("pointer");
    };

    window.addEventListener("mousemove", onPointerMove, { passive: true });
    window.addEventListener("mousedown", onPointerDown, { passive: true });

    // Browser-only keyboard fallback when inspecting http://127.0.0.1:9000 outside melange-shell.
    const onKeyDown = (e: KeyboardEvent) => {
      const noAccel = !e.ctrlKey && !e.altKey && !e.metaKey;
      if (!noAccel) return;

      const state = melangeState();
      const searchOpen = state.overlay === "SearchKeyboard";
      if (searchOpen) {
        const searchEv = mapSearchFallbackKey(e.key);
        if (searchEv) {
          e.preventDefault();
          emitLocalNavEvent(searchEv);
        }
        return;
      }

      const action = resolveBrowserKeyAction(e.key);
      if (action) {
        e.preventDefault();
        if (action === "ToggleFullscreen") {
          sendCommand({ type: "ToggleFullscreen" });
        } else if (action === "ToggleEpg") {
          sendCommand({
            type: "SetOverlay",
            overlay: state.overlay === "FullEpg" ? "None" : "FullEpg"
          });
        } else if (action === "ToggleOsd") {
          if (state.mode === "LiveTv") {
            const isOsd = state.overlay === "PlayerOsd" || state.overlay === "ZapBanner";
            const target = state.playback.current_media ? "PlayerOsd" : "ZapBanner";
            sendCommand({ type: "SetOverlay", overlay: isOsd ? "None" : target });
          }
        } else if (action === "ToggleMute") {
          sendCommand({ type: "PlaySound", sound: "select" });
        } else {
          emitLocalNavEvent(action);
        }
        return;
      }

      if (e.key === "h" || e.key === "H") {
        e.preventDefault();
        emitLocalNavEvent("Home");
      }
    };
    window.addEventListener("keydown", onKeyDown);

    onCleanup(() => {
      unsubNav();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
      window.removeEventListener("mousemove", onPointerMove);
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    });
  });

  createEffect(() => {
    void melangeState().mode;
    void melangeState().overlay;
    requestAnimationFrame(() => measureFocused());
  });

  const isVideoActive = () => {
    const s = melangeState().playback.state;
    return s === "Playing" || s === "Buffering";
  };

  // Every mode except LiveTv sits opaquely on the nocturnal alpine twilight horizon
  // (plus ProfileSwitcher / LeaveMenu if opened over LiveTv). LiveTv stays 100% transparent
  // so raw libmpv video renders cleanly underneath.
  const showBackdrop = () =>
    melangeState().mode !== "LiveTv" ||
    melangeState().overlay === "ProfileSwitcher" ||
    melangeState().overlay === "LeaveMenu";

  const backdropOpacity = () => (showBackdrop() ? "1" : "0");

  const showLiveTvScrim = () =>
    melangeState().mode === "LiveTv" && isVideoActive();

  const goHome = () => sendCommand({ type: "SetMode", mode: "Home" });

  const handleStageClick = () => {
    const state = melangeState();
    if (state.mode !== "LiveTv" || state.overlay !== "None") return;
    const nextOverlay = state.playback.current_media ? "PlayerOsd" : "ZapBanner";
    sendCommand({ type: "SetOverlay", overlay: nextOverlay });
  };

  return (
    <div
      class="relative h-screen w-screen overflow-hidden bg-transparent text-white"
      onClick={handleStageClick}
    >
      {/* Atmospheric alpine twilight horizon (or full-bleed custom profile wallpaper) */}
      <ScenicBackdrop
        active={showBackdrop()}
        wallpaperUrl={melangeState().active_profile?.wallpaper_path ?? "/wallpapers/1.jpg"}
        class="-z-30 transition-opacity duration-500 ease-out"
        style={{ opacity: backdropOpacity() }}
      />

      {/* LiveTv HUD over raw libmpv video: subtle top/bottom vignette only */}
      <div
        class="video-scrim pointer-events-none fixed inset-0 -z-10 transition-opacity duration-500"
        style={{
          opacity:
            showLiveTvScrim() && melangeState().overlay !== "None" ? "1" : "0"
        }}
      />

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

      <Show when={melangeState().overlay === "LeaveMenu"}>
        <LeaveMenu />
      </Show>

      <FocusRing />
    </div>
  );
};
