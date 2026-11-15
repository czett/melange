import { Show, createSignal, onMount } from "solid-js";
import { sendCommand } from "../bridge/ws";
import { ensureValidFocus } from "../spatial/nav";
import { GlassPanel, HapticTile } from "./primitives";

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

  const goBack = () => sendCommand({ type: "SetMode", mode: "Home" });

  onMount(async () => {
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
    <div class="no-scrollbar relative z-20 flex h-full w-full flex-col overflow-y-auto px-10 py-8 text-white xl:px-14 xl:py-10">
      <div class="mx-auto mb-8 flex w-full max-w-5xl items-end justify-between">
        <div>
          <div class="eyebrow">System</div>
          <h1 class="view-title mt-2">Settings</h1>
        </div>
        <HapticTile
          id="settings-back"
          variant="pill"
          radius="9999px"
          onSelect={goBack}
          class="text-white"
        >
          ← Back
        </HapticTile>
      </div>

      <div class="mx-auto my-auto grid w-full max-w-5xl grid-cols-1 gap-6 md:grid-cols-2">
        <GlassPanel variant="heavy" class="flex flex-col items-center gap-6 rounded-[24px] p-8 text-center">
          <div>
            <h2 class="text-xl font-semibold tracking-[-0.02em] text-white">
              Smartphone Companion
            </h2>
            <p class="mx-auto mt-2 max-w-[44ch] text-[13px] font-medium leading-relaxed text-white/[0.74]">
              Scan with your phone camera to control melange, reorder channels, or upload a custom
              wallpaper.
            </p>
          </div>
          <Show
            when={info()}
            fallback={
              <div class="aspect-square w-full max-w-[200px] animate-pulse rounded-2xl border border-white/10 bg-white/[0.04]" />
            }
          >
            {(data) => (
              <>
                <div class="mx-auto w-full max-w-[200px]">
                  <div class="rounded-2xl bg-white p-3.5 shadow-lg [&_svg]:mx-auto [&_svg]:block [&_svg]:h-40 [&_svg]:w-40">
                    <div innerHTML={data().qr_svg} />
                  </div>
                </div>
                <div class="chip h-8 px-4 font-mono text-xs font-semibold tabular-nums text-white/90">
                  {data().url}
                </div>
              </>
            )}
          </Show>
        </GlassPanel>

        <div class="space-y-6">
          <GlassPanel variant="heavy" class="space-y-4 rounded-[24px] p-6">
            <h3 class="eyebrow">Active Providers</h3>
            <div class="grid grid-cols-2 gap-3">
              <HapticTile
                id="settings-epg"
                variant="row"
                radius="16px"
                onSelect={() => sendCommand({ type: "SetOverlay", overlay: "FullEpg" })}
                class="rounded-2xl p-4 text-left"
              >
                <div class="flex items-center gap-2 text-[12px] font-medium text-white/[0.74]">
                  <span class="live-dot" />
                  <span>Live TV</span>
                </div>
                <div class="mt-2 text-[13.5px] font-semibold text-white">
                  M3U / Tvheadend · {props.channelCount} ch
                </div>
              </HapticTile>

              <HapticTile
                id="settings-ondemand"
                variant="row"
                radius="16px"
                onSelect={() => sendCommand({ type: "SetMode", mode: "Mediathek" })}
                class="rounded-2xl p-4 text-left"
              >
                <div class="flex items-center gap-2 text-[12px] font-medium text-white/[0.74]">
                  <span class="nav-dot" />
                  <span>On Demand</span>
                </div>
                <div class="mt-2 text-[13.5px] font-semibold text-white">
                  Mediathek / YouTube / Local
                </div>
              </HapticTile>
            </div>
          </GlassPanel>

          <GlassPanel variant="heavy" class="space-y-4 rounded-[24px] p-6">
            <div class="flex items-center justify-between">
              <h3 class="eyebrow">Profile &amp; Wallpaper</h3>
              <HapticTile
                id="settings-profile"
                variant="pill"
                radius="9999px"
                active={true}
                onSelect={() => sendCommand({ type: "SetOverlay", overlay: "ProfileSwitcher" })}
                class="h-7 px-3 text-[11.5px]"
              >
                {props.activeProfile?.name ?? "Default"}
              </HapticTile>
            </div>
            <Show
              when={props.activeProfile?.wallpaper_path}
              fallback={
                <div class="flex h-36 items-center justify-center rounded-2xl border border-dashed border-white/15 bg-[rgba(10,1,2,0.5)] px-6 text-center text-[13px] font-medium text-white/[0.72]">
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
          </GlassPanel>
        </div>
      </div>
    </div>
  );
}
