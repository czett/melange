import { For, Show, onCleanup, onMount } from "solid-js";
import { melangeState, sendCommand } from "../bridge/ws";
import { ensureValidFocus, registerFocusable, setFocus } from "../spatial/nav";
import { FlutedBackdrop } from "./FlutedBackdrop";

export const ProfileSwitcher = () => {
  onMount(() => {
    const first = melangeState().profiles[0];
    const focusId = first ? `profile-${first.id}` : "profile-close";
    requestAnimationFrame(() => {
      setFocus(focusId, false);
      ensureValidFocus(focusId);
    });
  });

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center px-8">
      <FlutedBackdrop class="-z-10" still />
      <div class="glass-card relative w-full max-w-md rounded-[24px] p-7">
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="eyebrow">Who's watching</div>
            <h2 class="mt-2 text-[28px] font-normal leading-[1.05] tracking-[-0.035em] text-white">
              Switch profile
            </h2>
            <p class="mt-2 max-w-[44ch] text-[13px] leading-relaxed text-white/65">
              Personal history, favourites and wallpaper follow each profile.
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
            class="pill pill-secondary shrink-0"
          >
            ← Back
          </button>
        </div>

        <div class="mt-7 grid grid-cols-1 gap-2">
          <For each={melangeState().profiles}>
            {(profile) => {
              let el!: HTMLButtonElement;
              const isActive = () => melangeState().active_profile?.id === profile.id;

              onMount(() => {
                const cleanup = registerFocusable(`profile-${profile.id}`, el, () =>
                  sendCommand({ type: "SelectProfile", profile_id: profile.id })
                );
                onCleanup(cleanup);
              });

              return (
                <button
                  ref={el}
                  type="button"
                  data-focus-id={`profile-${profile.id}`}
                  data-focus-radius="16px"
                  onClick={() => sendCommand({ type: "SelectProfile", profile_id: profile.id })}
                  class="glass-inner flex items-center justify-between rounded-2xl px-4 py-3.5 text-left"
                >
                  <div class="flex items-center gap-3.5">
                    <div
                      class={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-medium ${
                        isActive()
                          ? "bg-white text-[#160303]"
                          : "border border-white/[0.14] bg-white/[0.06] text-white/85"
                      }`}
                    >
                      {profile.name.slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <div class="text-[13px] font-medium tracking-[-0.01em] text-white">
                        {profile.name}
                      </div>
                      <div class="text-[11px] text-white/45">Local profile</div>
                    </div>
                  </div>
                  <Show when={isActive()}>
                    <span class="inline-flex items-center gap-1.5 text-[11px] text-white/70">
                      <span class="nav-dot" />
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
