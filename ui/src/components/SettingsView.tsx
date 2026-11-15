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
          <div class="text-[13px] font-medium text-white/65">System</div>
          <h1 class="view-title mt-1">Settings</h1>
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
        {/* Smartphone Companion QR Card */}
        <GlassPanel
          variant="surface"
          class="flex flex-col items-center justify-center gap-6 rounded-[24px] border border-white/[0.16] bg-white/[0.09] p-8 text-center backdrop-blur-3xl"
        >
          <div>
            <h2 class="text-xl font-semibold tracking-[-0.02em] text-white">
              Smartphone Companion
            </h2>
            <p class="mx-auto mt-2 max-w-[42ch] text-[13px] font-medium leading-relaxed text-white/70">
              Scan with your phone camera to control melange, reorder channels, or upload a custom
              wallpaper.
            </p>
          </div>
          <Show
            when={info()}
            fallback={
              <div class="aspect-square w-full max-w-[200px] animate-pulse rounded-[20px] border border-white/[0.14] bg-white/[0.08]" />
            }
          >
            {(data) => (
              <>
                <div class="mx-auto w-full max-w-[200px]">
                  <div class="rounded-[20px] bg-white p-3.5 shadow-[0_16px_40px_rgba(0,0,0,0.35)] [&_svg]:mx-auto [&_svg]:block [&_svg]:h-40 [&_svg]:w-40">
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
          {/* Apple-style grouped rows for Active Providers */}
          <GlassPanel
            variant="surface"
            class="rounded-[24px] border border-white/[0.16] bg-white/[0.09] p-6 backdrop-blur-3xl"
          >
            <h3 class="mb-3.5 text-[14px] font-medium text-white/90">Active Providers</h3>
            <div class="divide-y divide-white/[0.08] rounded-[16px] border border-white/[0.14] bg-white/[0.05]">
              <HapticTile
                id="settings-epg"
                variant="grouped"
                radius="14px"
                onSelect={() => sendCommand({ type: "SetOverlay", overlay: "FullEpg" })}
                class="flex w-full items-center justify-between rounded-t-[15px] px-4 py-3.5 text-left"
              >
                <div class="min-w-0">
                  <div class="flex items-center gap-2 text-[14px] font-semibold text-white">
                    <span class="live-dot" />
                    <span>Live TV</span>
                  </div>
                  <div class="mt-0.5 text-[12px] font-medium text-white/65">
                    M3U / Tvheadend · {props.channelCount} channels
                  </div>
                </div>
                <span class="shrink-0 text-[12px] font-medium text-white/60">Guide ›</span>
              </HapticTile>

              <HapticTile
                id="settings-ondemand"
                variant="grouped"
                radius="14px"
                onSelect={() => sendCommand({ type: "SetMode", mode: "Mediathek" })}
                class="flex w-full items-center justify-between rounded-b-[15px] px-4 py-3.5 text-left"
              >
                <div class="min-w-0">
                  <div class="flex items-center gap-2 text-[14px] font-semibold text-white">
                    <span class="h-1.5 w-1.5 rounded-full bg-white/80" />
                    <span>On Demand</span>
                  </div>
                  <div class="mt-0.5 text-[12px] font-medium text-white/65">
                    Mediathek · YouTube · Local Media
                  </div>
                </div>
                <span class="shrink-0 text-[12px] font-medium text-white/60">Browse ›</span>
              </HapticTile>
            </div>
          </GlassPanel>

          {/* Apple-style Profile & Wallpaper panel */}
          <GlassPanel
            variant="surface"
            class="space-y-4 rounded-[24px] border border-white/[0.16] bg-white/[0.09] p-6 backdrop-blur-3xl"
          >
            <div class="flex items-center justify-between">
              <h3 class="text-[14px] font-medium text-white/90">Profile &amp; Wallpaper</h3>
              <HapticTile
                id="settings-profile"
                variant="pill"
                radius="9999px"
                active={true}
                onSelect={() => sendCommand({ type: "SetOverlay", overlay: "ProfileSwitcher" })}
                class="h-7 px-3.5 text-[12px]"
              >
                {props.activeProfile?.name ?? "Default"}
              </HapticTile>
            </div>
            <Show
              when={props.activeProfile?.wallpaper_path}
              fallback={
                <div class="flex h-36 items-center justify-center rounded-[16px] border border-dashed border-white/[0.18] bg-white/[0.05] px-6 text-center text-[13px] font-medium text-white/65">
                  No custom wallpaper set — upload one from the Companion app
                </div>
              }
            >
              {(wp) => (
                <img
                  src={wp()}
                  alt="Profile Wallpaper"
                  class="h-40 w-full rounded-[16px] border border-white/[0.14] object-cover"
                />
              )}
            </Show>
          </GlassPanel>
        </div>
      </div>
    </div>
  );
}
