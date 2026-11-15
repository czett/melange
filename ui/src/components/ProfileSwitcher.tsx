import { For, Show, onCleanup, onMount } from "solid-js";
import { melangeState, sendCommand } from "../bridge/ws";
import { ensureValidFocus, setFocus } from "../spatial/nav";
import { GlassPanel, HapticTile } from "./primitives";

export const ProfileSwitcher = () => {
  onMount(() => {
    const first = melangeState().profiles[0];
    const focusId = first ? `profile-${first.id}` : "profile-close";
    requestAnimationFrame(() => {
      setFocus(focusId, false);
      ensureValidFocus(focusId);
    });

    onCleanup(() => {
      if (melangeState().mode === "Home") {
        requestAnimationFrame(() => ensureValidFocus("dock-livetv"));
      }
    });
  });

  return (
    <GlassPanel
      variant="scrim"
      class="fixed inset-0 z-50 flex items-center justify-center px-8"
      onClick={() => sendCommand({ type: "SetOverlay", overlay: "None" })}
    >
      <GlassPanel
        variant="heavy"
        class="relative w-full max-w-md rounded-[24px] p-7"
        onClick={(e: MouseEvent) => e.stopPropagation()}
      >
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="text-[12px] font-medium text-white/80">Who&apos;s watching</div>
            <h2 class="view-title mt-1 text-[26px]">Switch profile</h2>
            <p class="mt-2 max-w-[44ch] text-[13px] font-medium leading-relaxed text-white/80">
              Personal watch history, channel order, and custom wallpaper follow each profile.
            </p>
          </div>
          <HapticTile
            id="profile-close"
            variant="pill"
            radius="9999px"
            onSelect={() => sendCommand({ type: "SetOverlay", overlay: "None" })}
            class="shrink-0"
          >
            ← Back
          </HapticTile>
        </div>

        <div class="-mx-2 mt-6 grid grid-cols-1 gap-2.5 px-2 py-1">
          <For each={melangeState().profiles}>
            {(profile) => {
              const isActive = () => melangeState().active_profile?.id === profile.id;

              return (
                <HapticTile
                  id={`profile-${profile.id}`}
                  variant="row"
                  radius="16px"
                  active={isActive()}
                  onSelect={() => sendCommand({ type: "SelectProfile", profile_id: profile.id })}
                  class="flex items-center justify-between rounded-[16px] px-4 py-3.5 text-left"
                >
                  <div class="flex items-center gap-3.5">
                    <div
                      data-active={isActive() ? "true" : undefined}
                      class="row-avatar flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-bold"
                    >
                      {profile.name.slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <div class="text-[14px] font-semibold tracking-[-0.01em]">
                        {profile.name}
                      </div>
                      <div class="row-muted text-[12px] font-medium">Local profile</div>
                    </div>
                  </div>
                  <Show when={isActive()}>
                    <span class="row-pill-active rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none">
                      Active
                    </span>
                  </Show>
                </HapticTile>
              );
            }}
          </For>
        </div>
      </GlassPanel>
    </GlassPanel>
  );
};
