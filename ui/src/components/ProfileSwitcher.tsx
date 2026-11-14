import { For, Show, onCleanup, onMount } from "solid-js";
import { melangeState, sendCommand } from "../bridge/ws";
import { ensureValidFocus, isFocused, registerFocusable } from "../spatial/nav";

export const ProfileSwitcher = () => {
  onMount(() => {
    const first = melangeState().profiles[0];
    requestAnimationFrame(() =>
      ensureValidFocus(first ? `profile-${first.id}` : undefined)
    );
  });

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-[#120303]/78 px-8 backdrop-blur-md">
      <div class="fluted-surface w-full max-w-lg rounded-3xl p-8">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 class="text-3xl font-light tracking-editorial text-white">
              Switch Profile
            </h2>
            <p class="mt-1.5 text-sm text-white/65">
              Select a viewer profile for personalized history and channels
            </p>
          </div>
          <button
            ref={(el) =>
              onCleanup(
                registerFocusable("profile-close", el, () =>
                  sendCommand({ type: "SetOverlay", overlay: "None" })
                )
              )
            }
            type="button"
            data-focus-radius="9999px"
            onClick={() => sendCommand({ type: "SetOverlay", overlay: "None" })}
            class={`shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition ${
              isFocused("profile-close") ? "pill-cta-white" : "fluted-pill text-white"
            }`}
          >
            ← Back
          </button>
        </div>

        <div class="mt-7 grid grid-cols-1 gap-3">
          <For each={melangeState().profiles}>
            {(profile) => {
              let el!: HTMLButtonElement;
              const isActive = () =>
                melangeState().active_profile?.id === profile.id;

              onMount(() => {
                const cleanup = registerFocusable(
                  `profile-${profile.id}`,
                  el,
                  () => sendCommand({ type: "SelectProfile", profile_id: profile.id })
                );
                onCleanup(cleanup);
              });

              return (
                <button
                  ref={el}
                  type="button"
                  data-focus-id={`profile-${profile.id}`}
                  onClick={() =>
                    sendCommand({ type: "SelectProfile", profile_id: profile.id })
                  }
                  class="fluted-card flex items-center justify-between rounded-2xl px-5 py-4 text-left"
                >
                  <div class="flex items-center gap-4">
                    <div class="flex h-11 w-11 items-center justify-center rounded-full border border-white/30 bg-gradient-to-br from-[#E13A26] to-[#831613] text-lg font-semibold text-white shadow-inner">
                      {profile.name.slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <div class="text-base font-medium tracking-tight text-white">
                        {profile.name}
                      </div>
                      <div class="text-xs text-white/50">Local Profile</div>
                    </div>
                  </div>
                  <Show when={isActive()}>
                    <span class="pill-cta-white rounded-full px-3.5 py-1 text-xs font-semibold">
                      Active
                    </span>
                  </Show>
                </button>
              );
            }}
          </For>
        </div>
      </div>
    </div>
  );
};
