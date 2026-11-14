import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { sendCommand } from "../bridge/ws";
import { ensureValidFocus, isFocused, registerFocusable } from "../spatial/nav";

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
    <div class="no-scrollbar relative z-20 flex h-full w-full flex-col overflow-y-auto p-10 text-white">
      <div class="mx-auto mb-6 flex w-full max-w-5xl items-center justify-between">
        <div>
          <div class="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.25em] text-white/65">
            <span class="h-1.5 w-1.5 rounded-full bg-white" />
            <span>System</span>
          </div>
          <h1 class="mt-1.5 text-4xl font-light tracking-editorial text-white">
            Settings
          </h1>
        </div>
        <button
          ref={backBtn}
          type="button"
          data-focus-id="settings-back"
          data-focus-radius="9999px"
          onClick={goBack}
          class={`rounded-full px-5 py-2.5 text-sm font-semibold transition ${
            isFocused("settings-back") ? "pill-cta-white" : "fluted-pill text-white"
          }`}
        >
          ← Back
        </button>
      </div>

      <div class="mx-auto my-auto grid w-full max-w-5xl grid-cols-1 gap-8 md:grid-cols-2">
        <div class="fluted-card flex flex-col items-center space-y-5 rounded-3xl p-8 text-center">
          <div>
            <h2 class="text-2xl font-light tracking-editorial text-white">
              Smartphone Companion
            </h2>
            <p class="mt-2 text-sm text-white/75">
              Scan with your phone camera to control Melange, reorder channels, or upload a custom wallpaper.
            </p>
          </div>
          <Show
            when={info()}
            fallback={
              <div class="h-52 w-52 animate-pulse rounded-2xl border border-white/20 bg-white/10" />
            }
          >
            {(data) => (
              <>
                <div class="rounded-2xl bg-white p-3.5 shadow-[0_20px_50px_rgba(18,3,3,0.45)] [&>svg]:h-48 [&>svg]:w-48">
                  <div innerHTML={data().qr_svg} />
                </div>
                <div class="fluted-pill rounded-full px-5 py-2 font-mono text-sm tabular-nums text-white">
                  {data().url}
                </div>
              </>
            )}
          </Show>
        </div>

        <div class="space-y-6">
          <div class="fluted-card space-y-4 rounded-3xl p-6">
            <h3 class="text-lg font-medium tracking-tight text-white">
              Active Providers
            </h3>
            <div class="grid grid-cols-2 gap-3 text-sm">
              <div class="frosted-subcard rounded-2xl p-4">
                <div class="flex items-center gap-2 text-xs uppercase tracking-wider text-white/65">
                  <span class="live-beacon h-1.5 w-1.5 rounded-full" />
                  <span>Live TV</span>
                </div>
                <div class="mt-1.5 font-medium text-white">
                  M3U / Tvheadend ({props.channelCount} ch)
                </div>
              </div>
              <div class="frosted-subcard rounded-2xl p-4">
                <div class="flex items-center gap-2 text-xs uppercase tracking-wider text-white/65">
                  <span class="h-1.5 w-1.5 rounded-full bg-white" />
                  <span>On-Demand</span>
                </div>
                <div class="mt-1.5 font-medium text-white">
                  Mediathek / YouTube / Local
                </div>
              </div>
            </div>
          </div>

          <div class="fluted-card space-y-4 rounded-3xl p-6">
            <div class="flex items-center justify-between">
              <h3 class="text-lg font-medium tracking-tight text-white">
                Profile &amp; Wallpaper
              </h3>
              <span class="pill-cta-white rounded-full px-3.5 py-1 text-xs font-semibold">
                {props.activeProfile?.name ?? "Default"}
              </span>
            </div>
            <Show
              when={props.activeProfile?.wallpaper_path}
              fallback={
                <div class="frosted-subcard flex h-36 items-center justify-center rounded-2xl border-dashed px-6 text-center text-xs text-white/65">
                  No custom wallpaper set — upload one from the Companion app
                </div>
              }
            >
              {(wp) => (
                <img
                  src={wp()}
                  alt="Profile Wallpaper"
                  class="h-40 w-full rounded-2xl border border-white/20 object-cover shadow-lg"
                />
              )}
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}
