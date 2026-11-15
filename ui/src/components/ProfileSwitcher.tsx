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
        requestAnimationFrame(() => ensureValidFocus("home-live-pill"));
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
        class="relative w-full max-w-md rounded-[26px] p-7"
        onClick={(e: MouseEvent) => e.stopPropagation()}
      >
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="eyebrow">Who&apos;s watching</div>
            <h2 class="view-title mt-2 text-[28px]">Switch profile</h2>
            <p class="mt-2 max-w-[44ch] text-[13px] font-medium leading-relaxed text-white/[0.74]">
              Personal history, favourites and wallpaper follow each profile.
            </p>
          </div>
          <HapticTile
            id="profile-close"
            variant="pill"
            radius="9999px"
            onSelect={() => sendCommand({ type: "SetOverlay", overlay: "None" })}
            class="shrink-0 text-white"
          >
            ← Back
          </HapticTile>
        </div>

        <div class="mt-7 grid grid-cols-1 gap-2.5">
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
                  class="flex items-center justify-between rounded-2xl px-4 py-3.5 text-left"
                >
                  <div class="flex items-center gap-3.5">
                    <div
                      class={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold ${
                        isActive()
                          ? "bg-white text-[#120202]"
                          : "border border-white/15 bg-white/[0.08] text-white"
                      }`}
                    >
                      {profile.name.slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <div class="text-[14px] font-semibold tracking-[-0.01em] text-white">
                        {profile.name}
                      </div>
                      <div class="text-[12px] font-medium text-white/[0.74]">Local profile</div>
                    </div>
                  </div>
                  <Show when={isActive()}>
                    <span class="inline-flex items-center gap-1.5 text-[12px] font-semibold text-white">
                      <span class="live-dot" />
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
