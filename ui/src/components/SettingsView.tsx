import { For, Show, createSignal, onMount } from "solid-js";
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
  const [presets, setPresets] = createSignal<string[]>([]);

  const goBack = () => sendCommand({ type: "SetMode", mode: "Home" });
  const activeWallpaper = () => props.activeProfile?.wallpaper_path ?? "/wallpapers/1.jpg";

  const selectPreset = (filename: string) => {
    const profileId = props.activeProfile?.id ?? 1;
    sendCommand({ type: "SetPresetWallpaper", profile_id: profileId, filename });
  };

  onMount(async () => {
    requestAnimationFrame(() => ensureValidFocus("settings-back"));

    const [infoRes, wallpapersRes] = await Promise.allSettled([
      fetch("/api/companion/info"),
      fetch("/api/wallpapers")
    ]);

    if (infoRes.status === "fulfilled" && infoRes.value.ok) {
      try {
        setInfo(await infoRes.value.json());
      } catch {
        // ignore
      }
    }

    if (wallpapersRes.status === "fulfilled" && wallpapersRes.value.ok) {
      try {
        const list = (await wallpapersRes.value.json()) as unknown;
        if (Array.isArray(list)) {
          setPresets(list.filter((item): item is string => typeof item === "string"));
        }
      } catch {
        // ignore
      }
    }
  });

  return (
    <div class="no-scrollbar relative z-20 flex h-full w-full flex-col overflow-y-auto px-10 py-8 text-white xl:px-14 xl:py-10">
      <div class="mx-auto mb-8 flex w-full max-w-5xl items-end justify-between">
        <div>
          <div class="text-[13px] font-medium text-white/[0.62]">System</div>
          <h1 class="view-title mt-1">Settings</h1>
        </div>
        <HapticTile
          id="settings-back"
          variant="pill"
          radius="9999px"
          onSelect={goBack}
        >
          ← Back
        </HapticTile>
      </div>

      <div class="mx-auto my-auto grid w-full max-w-5xl grid-cols-1 gap-6 md:grid-cols-2">
        {/* Smartphone Companion QR Card */}
        <GlassPanel
          variant="heavy"
          class="flex flex-col items-center justify-center gap-6 rounded-[24px] p-8 text-center"
        >
          <div>
            <h2 class="text-[18px] font-semibold tracking-[-0.02em] text-white">
              Smartphone Companion
            </h2>
            <p class="mx-auto mt-1.5 max-w-[42ch] text-[13px] font-medium leading-relaxed text-white/[0.62]">
              Scan with your phone camera to control melange, reorder channels, or upload a custom
              wallpaper.
            </p>
          </div>
          <Show
            when={info()}
            fallback={
              <div class="aspect-square w-full max-w-[200px] animate-pulse rounded-[20px] border border-white/[0.11] bg-white/[0.05]" />
            }
          >
            {(data) => (
              <>
                <div class="mx-auto w-full max-w-[200px]">
                  <div class="rounded-[20px] bg-white p-3.5 shadow-[0_16px_40px_rgba(0,0,0,0.45)] [&_svg]:mx-auto [&_svg]:block [&_svg]:h-40 [&_svg]:w-40">
                    <div innerHTML={data().qr_svg} />
                  </div>
                </div>
                <div class="chip h-8 px-4 font-mono text-[12px] font-semibold tabular-nums text-white/90">
                  {data().url}
                </div>
              </>
            )}
          </Show>
        </GlassPanel>

        <div class="space-y-6">
          {/* Active Providers */}
          <GlassPanel variant="heavy" class="rounded-[24px] p-6">
            <h3 class="mb-3.5 text-[15px] font-semibold tracking-[-0.015em] text-white/95">
              Active providers
            </h3>
            <div class="divide-y divide-white/[0.10] rounded-[16px] border border-white/[0.16] bg-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]">
              <div>
                <HapticTile
                  id="settings-epg"
                  variant="grouped"
                  radius="14px"
                  onSelect={() => sendCommand({ type: "SetOverlay", overlay: "FullEpg" })}
                  class="flex w-full items-center justify-between rounded-[14px] px-4 py-3.5 text-left"
                >
                  <div class="min-w-0">
                    <div class="flex items-center gap-2 text-[14px] font-semibold text-white">
                      <span class="live-dot" />
                      <span>Live TV</span>
                    </div>
                    <div class="mt-0.5 text-[12px] font-medium text-white/[0.62]">
                      M3U / Tvheadend · {props.channelCount} channels
                    </div>
                  </div>
                  <span class="shrink-0 text-[12px] font-medium text-white/[0.62]">Guide ›</span>
                </HapticTile>
              </div>

              <div>
                <HapticTile
                  id="settings-ondemand"
                  variant="grouped"
                  radius="14px"
                  onSelect={() => sendCommand({ type: "SetMode", mode: "Mediathek" })}
                  class="flex w-full items-center justify-between rounded-[14px] px-4 py-3.5 text-left"
                >
                  <div class="min-w-0">
                    <div class="flex items-center gap-2 text-[14px] font-semibold text-white">
                      <span class="h-1.5 w-1.5 rounded-full bg-white/85" />
                      <span>On Demand</span>
                    </div>
                    <div class="mt-0.5 text-[12px] font-medium text-white/[0.62]">
                      Mediathek · YouTube · Local Media
                    </div>
                  </div>
                  <span class="shrink-0 text-[12px] font-medium text-white/[0.62]">Browse ›</span>
                </HapticTile>
              </div>
            </div>
          </GlassPanel>

          {/* Profile & Wallpaper */}
          <GlassPanel variant="heavy" class="space-y-4 rounded-[24px] p-6">
            <div class="flex items-center justify-between">
              <h3 class="text-[15px] font-semibold tracking-[-0.015em] text-white/95">
                Profile &amp; wallpaper
              </h3>
              <HapticTile
                id="settings-profile"
                variant="pill"
                radius="9999px"
                active={true}
                onSelect={() => sendCommand({ type: "SetOverlay", overlay: "ProfileSwitcher" })}
                class="h-8 px-3.5 text-[12px]"
              >
                {props.activeProfile?.name ?? "Default"}
              </HapticTile>
            </div>
            <img
              src={activeWallpaper()}
              alt="Profile Wallpaper"
              class="h-36 w-full rounded-[16px] border border-white/[0.18] object-cover shadow-[0_12px_28px_rgba(0,0,0,0.35)]"
            />

            <Show when={presets().length > 0}>
              <div class="space-y-2.5 pt-1">
                <div class="text-[12px] font-medium text-white/[0.62]">Alpine presets</div>
                <div class="grid grid-cols-4 gap-2.5">
                  <For each={presets()}>
                    {(file) => {
                      const isActive = () => activeWallpaper() === `/wallpapers/${file}`;
                      return (
                        <HapticTile
                          id={`settings-wp-${file}`}
                          variant="card"
                          radius="12px"
                          active={isActive()}
                          ariaLabel={`Select wallpaper ${file}`}
                          onSelect={() => selectPreset(file)}
                          class={`group relative aspect-video w-full overflow-hidden rounded-[12px] p-0 ${
                            isActive()
                              ? "ring-2 ring-white ring-offset-2 ring-offset-black/40"
                              : ""
                          }`}
                        >
                          <img
                            src={`/wallpapers/${file}`}
                            alt={`Preset ${file}`}
                            class="h-full w-full object-cover"
                            loading="lazy"
                          />
                          <Show when={isActive()}>
                            <span class="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-white text-[10px] font-bold text-[#111318] shadow">
                              ✓
                            </span>
                          </Show>
                        </HapticTile>
                      );
                    }}
                  </For>
                </div>
              </div>
            </Show>
          </GlassPanel>
        </div>
      </div>
    </div>
  );
}
