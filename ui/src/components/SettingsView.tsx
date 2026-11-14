import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { sendCommand } from "../bridge/ws";
import { ensureValidFocus, registerFocusable } from "../spatial/nav";

interface Profile {
  id: number;
  name: string;
  wallpaper_path?: string | null;
}

interface CompanionInfo {
  url: string;
  qr_svg: string;
}

interface SettingsViewProps {
  activeProfile: Profile | null;
  channelCount: number;
}

export function SettingsView(props: SettingsViewProps) {
  const [info, setInfo] = createSignal<CompanionInfo | null>(null);
  let backBtn!: HTMLButtonElement;

  const goBack = () => sendCommand({ type: "SetMode", mode: "Home" });

  onMount(async () => {
    const cleanup = registerFocusable("settings-back", backBtn, goBack);
    onCleanup(cleanup);
    requestAnimationFrame(() => ensureValidFocus("settings-back"));

    try {
      const resp = await fetch("/api/companion/info");
      if (resp.ok) {
        setInfo(await resp.json());
      }
    } catch {
      // ignore
    }
  });

  return (
    <div class="no-scrollbar relative z-20 flex h-full w-full flex-col overflow-y-auto px-14 py-10 text-white">
      <div class="mx-auto mb-8 flex w-full max-w-5xl items-end justify-between">
        <div>
          <div class="eyebrow">System</div>
          <h1 class="mt-2 pb-0.5 text-[40px] font-normal leading-[1.12] tracking-[-0.035em] text-white">
            Settings
          </h1>
        </div>
        <button
          ref={backBtn}
          type="button"
          data-focus-id="settings-back"
          data-focus-radius="9999px"
          onClick={goBack}
          class="pill pill-secondary"
        >
          ← Back
        </button>
      </div>

      <div class="mx-auto my-auto grid w-full max-w-5xl grid-cols-1 gap-6 md:grid-cols-2">
        <div class="glass-card flex flex-col items-center gap-6 rounded-[22px] p-8 text-center">
          <div>
            <h2 class="text-xl font-normal tracking-[-0.02em] text-white">Smartphone Companion</h2>
            <p class="mx-auto mt-2 max-w-[44ch] text-[13px] leading-relaxed text-white/65">
              Scan with your phone camera to control melange, reorder channels, or upload a custom
              wallpaper.
            </p>
          </div>
          <Show
            when={info()}
            fallback={
              <div class="glass-inner aspect-square w-full max-w-[200px] animate-pulse rounded-2xl" />
            }
          >
            {(data) => (
              <>
                <div class="mx-auto w-full max-w-[200px]">
                  <div class="rounded-2xl bg-white p-3.5 shadow-lg [&_svg]:mx-auto [&_svg]:block [&_svg]:h-40 [&_svg]:w-40">
                    <div innerHTML={data().qr_svg} />
                  </div>
                </div>
                <div class="chip h-8 px-4 font-mono text-xs tabular-nums text-white/80">
                  {data().url}
                </div>
              </>
            )}
          </Show>
        </div>

        <div class="space-y-6">
          <div class="glass-card space-y-4 rounded-[22px] p-6">
            <h3 class="eyebrow">Active Providers</h3>
            <div class="grid grid-cols-2 gap-2.5">
              <div class="glass-inner rounded-2xl p-4">
                <div class="flex items-center gap-2 text-[11px] text-white/55">
                  <span class="live-dot" />
                  <span>Live TV</span>
                </div>
                <div class="mt-2 text-[13px] font-medium text-white">
                  M3U / Tvheadend · {props.channelCount} ch
                </div>
              </div>
              <div class="glass-inner rounded-2xl p-4">
                <div class="flex items-center gap-2 text-[11px] text-white/55">
                  <span class="nav-dot" />
                  <span>On Demand</span>
                </div>
                <div class="mt-2 text-[13px] font-medium text-white">
                  Mediathek / YouTube / Local
                </div>
              </div>
            </div>
          </div>

          <div class="glass-card space-y-4 rounded-[22px] p-6">
            <div class="flex items-center justify-between">
              <h3 class="eyebrow">Profile &amp; Wallpaper</h3>
              <span class="chip chip-solid">{props.activeProfile?.name ?? "Default"}</span>
            </div>
            <Show
              when={props.activeProfile?.wallpaper_path}
              fallback={
                <div class="glass-inner flex h-36 items-center justify-center rounded-2xl border-dashed px-6 text-center text-xs text-white/55">
                  No custom wallpaper set — upload one from the Companion app
                </div>
              }
            >
              {(wp) => (
                <img
                  src={wp()}
                  alt="Profile Wallpaper"
                  class="h-40 w-full rounded-2xl border border-white/10 object-cover"
                />
              )}
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}
