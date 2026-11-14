import { For, onCleanup, onMount } from "solid-js";
import { melangeState, sendCommand } from "../bridge/ws";
import { ensureValidFocus, registerFocusable } from "../spatial/nav";

export const ProfileSwitcher = () => {
  onMount(() => {
    const first = melangeState().profiles[0];
    requestAnimationFrame(() =>
      ensureValidFocus(first ? `profile-${first.id}` : undefined)
    );
  });

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-8">
      <div class="glass-panel-heavy w-full max-w-lg rounded-3xl p-8">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-2xl font-semibold tracking-tight text-white">
              Switch Profile
            </h2>
            <p class="mt-1 text-sm text-white/60">
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
            onClick={() => sendCommand({ type: "SetOverlay", overlay: "None" })}
            class="glass-card rounded-full px-4 py-1.5 text-xs font-medium text-white"
          >
            ← Back
          </button>
        </div>

        <div class="mt-6 grid grid-cols-1 gap-3">
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
                  class="flex items-center justify-between rounded-2xl bg-white/8 px-5 py-4 text-left transition hover:bg-white/12"
                >
                  <div class="flex items-center gap-4">
                    <div class="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-indigo-500 text-lg font-bold text-white">
                      {profile.name.slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <div class="text-base font-semibold text-white">
                        {profile.name}
                      </div>
                      <div class="text-xs text-white/50">Local Profile</div>
                    </div>
                  </div>
                  {isActive() && (
                    <span class="rounded-full bg-sky-400/20 px-3 py-1 text-xs font-semibold text-sky-300">
                      Active
                    </span>
                  )}
                </button>
              );
            }}
          </For>
        </div>
      </div>
    </div>
  );
};
