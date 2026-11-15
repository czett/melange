import { For, Show, createMemo, createSignal, onMount } from "solid-js";
import { sendCommand } from "../bridge/ws";
import { ensureValidFocus, setFocus } from "../spatial/nav";
import { HapticTile } from "./primitives";

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

type SettingsCategory = "look" | "companion" | "providers" | "about";

const DEFAULT_PRESETS = ["1.jpg", "2.jpg", "3.jpg", "4.jpg", "5.jpg", "6.jpg", "7.jpg"];

const PRESET_TITLES: Record<string, string> = {
  "1.jpg": "Nocturnal Horizon",
  "2.jpg": "Alpine Dusk",
  "3.jpg": "Midnight Ridge",
  "4.jpg": "Glacier Twilight",
  "5.jpg": "Timberline Mist",
  "6.jpg": "Summit Ember",
  "7.jpg": "Starlight Valley"
};

function presetLabel(filename: string): string {
  return PRESET_TITLES[filename] ?? filename.replace(/\.[^.]+$/, "");
}

function ActiveCheckmark() {
  return (
    <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#22C55E] text-white shadow-sm">
      <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </span>
  );
}

export function SettingsView(props: SettingsViewProps) {
  const [category, setCategory] = createSignal<SettingsCategory>("look");
  const [info, setInfo] = createSignal<CompanionInfo | null>(null);
  const [presets, setPresets] = createSignal<string[]>(DEFAULT_PRESETS);

  const goBack = () => sendCommand({ type: "SetMode", mode: "Home" });
  const activeWallpaper = () => props.activeProfile?.wallpaper_path ?? "/wallpapers/1.jpg";

  const selectPreset = (filename: string) => {
    const profileId = props.activeProfile?.id ?? 1;
    sendCommand({ type: "SetPresetWallpaper", profile_id: profileId, filename });
  };

  const categories: { id: SettingsCategory; label: string }[] = [
    { id: "look", label: "Look & scenes" },
    { id: "companion", label: "Companion" },
    { id: "providers", label: "Providers" },
    { id: "about", label: "About" }
  ];

  const categoryTitle = createMemo(() => {
    switch (category()) {
      case "look":
        return "Look & scenes";
      case "companion":
        return "Companion";
      case "providers":
        return "Providers";
      case "about":
        return "About";
    }
  });

  onMount(async () => {
    requestAnimationFrame(() => {
      setFocus("settings-cat-look", false);
      ensureValidFocus("settings-cat-look");
    });

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
          const valid = list.filter((item): item is string => typeof item === "string");
          if (valid.length > 0) {
            setPresets(valid);
          }
        }
      } catch {
        // ignore
      }
    }
  });

  return (
    <div class="fixed inset-0 z-20 flex h-full w-full bg-[#0B0D11]/[0.82] text-white backdrop-blur-3xl">
      <div class="mx-auto flex h-full w-full max-w-6xl gap-10 px-10 py-10 xl:px-14 xl:py-12">
        {/* Left Sidebar */}
        <aside class="flex w-72 shrink-0 flex-col justify-between border-r border-white/[0.08] pr-8">
          <div>
            <div class="mb-6 flex items-center justify-between gap-3">
              <h1 class="text-3xl font-bold tracking-tight text-white">Settings</h1>
              <HapticTile
                id="settings-back"
                variant="pill"
                radius="9999px"
                onSelect={goBack}
                class="h-8 px-3.5 text-[12px]"
              >
                ← Back
              </HapticTile>
            </div>

            <nav class="flex flex-col gap-1.5" aria-label="Settings categories">
              <For each={categories}>
                {(cat) => {
                  const isActive = () => category() === cat.id;
                  return (
                    <HapticTile
                      id={`settings-cat-${cat.id}`}
                      variant="sidebar"
                      radius="14px"
                      active={isActive()}
                      onSelect={() => setCategory(cat.id)}
                      class={`flex h-12 w-full items-center justify-between rounded-[14px] px-4 text-left text-[15px] font-medium ${
                        isActive() ? "bg-white/[0.12] text-white" : "text-white/70"
                      }`}
                    >
                      <span>{cat.label}</span>
                      <Show when={isActive()}>
                        <span class="h-1.5 w-1.5 rounded-full bg-white" />
                      </Show>
                    </HapticTile>
                  );
                }}
              </For>
            </nav>
          </div>

          <div class="pt-6">
            <HapticTile
              id="settings-profile-footer"
              variant="grouped"
              radius="16px"
              onSelect={() => sendCommand({ type: "SetOverlay", overlay: "ProfileSwitcher" })}
              class="flex h-14 w-full items-center justify-between rounded-[16px] px-4 text-left"
            >
              <div class="flex min-w-0 items-center gap-3">
                <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-[12px] font-bold text-[#111318]">
                  {(props.activeProfile?.name ?? "D").slice(0, 1).toUpperCase()}
                </span>
                <div class="min-w-0">
                  <div class="truncate text-[14px] font-semibold">
                    {props.activeProfile?.name ?? "Default"}
                  </div>
                  <div class="row-muted text-[11px] font-medium">Switch profile</div>
                </div>
              </div>
              <span class="row-muted text-[14px]">›</span>
            </HapticTile>
          </div>
        </aside>

        {/* Right Content Pane */}
        <main class="no-scrollbar min-w-0 flex-1 overflow-y-auto py-1 pr-2">
          <div class="mb-6 flex items-center justify-between">
            <div>
              <div class="text-[12px] font-medium uppercase tracking-wider text-white/50">
                Preferences
              </div>
              <h2 class="mt-0.5 text-2xl font-semibold tracking-tight text-white">
                {categoryTitle()}
              </h2>
            </div>
          </div>

          {/* Look & scenes */}
          <Show when={category() === "look"}>
            <div class="space-y-6">
              <div class="space-y-2">
                <div class="px-1 text-[13px] font-medium text-white/60">Profile</div>
                <HapticTile
                  id="settings-look-profile"
                  variant="grouped"
                  radius="16px"
                  onSelect={() => sendCommand({ type: "SetOverlay", overlay: "ProfileSwitcher" })}
                  class="flex h-14 w-full items-center justify-between rounded-[16px] px-4 text-left"
                >
                  <div class="flex items-center gap-3">
                    <span class="text-[15px] font-semibold">Active profile</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="row-muted text-[13px] font-medium">
                      {props.activeProfile?.name ?? "Default"}
                    </span>
                    <span class="row-muted text-[15px]">›</span>
                  </div>
                </HapticTile>
              </div>

              <div class="space-y-2">
                <div class="px-1 text-[13px] font-medium text-white/60">Alpine scenes</div>
                <div class="flex flex-col gap-2">
                  <For each={presets()}>
                    {(file) => {
                      const isActive = () => activeWallpaper() === `/wallpapers/${file}`;
                      return (
                        <HapticTile
                          id={`settings-wp-${file}`}
                          variant="grouped"
                          radius="16px"
                          active={isActive()}
                          ariaLabel={`Select wallpaper ${presetLabel(file)}`}
                          onSelect={() => selectPreset(file)}
                          class="flex h-14 w-full items-center justify-between rounded-[16px] px-4 text-left"
                        >
                          <div class="flex min-w-0 items-center gap-3.5">
                            <div class="h-9 w-16 shrink-0 overflow-hidden rounded-[8px] border border-white/15 bg-black/30">
                              <img
                                src={`/wallpapers/${file}`}
                                alt={presetLabel(file)}
                                class="h-full w-full object-cover"
                                loading="lazy"
                              />
                            </div>
                            <div class="min-w-0">
                              <div class="truncate text-[15px] font-semibold">
                                {presetLabel(file)}
                              </div>
                              <div class="row-muted truncate text-[12px] font-medium">
                                Alpine preset · {file}
                              </div>
                            </div>
                          </div>

                          <Show when={isActive()}>
                            <ActiveCheckmark />
                          </Show>
                        </HapticTile>
                      );
                    }}
                  </For>
                </div>
              </div>
            </div>
          </Show>

          {/* Companion */}
          <Show when={category() === "companion"}>
            <div class="space-y-5">
              <div class="flex flex-col items-start gap-6 rounded-[20px] border border-white/[0.1] bg-white/[0.04] p-6 sm:flex-row sm:items-center">
                <Show
                  when={info()}
                  fallback={
                    <div class="h-44 w-44 shrink-0 animate-pulse rounded-[16px] bg-white/[0.08]" />
                  }
                >
                  {(data) => (
                    <div class="shrink-0 rounded-[18px] bg-white p-3 [&_svg]:block [&_svg]:h-40 [&_svg]:w-40">
                      <div innerHTML={data().qr_svg} />
                    </div>
                  )}
                </Show>

                <div class="min-w-0 flex-1 space-y-2">
                  <div class="text-[18px] font-semibold tracking-tight text-white">
                    Smartphone Remote &amp; Watch Companion
                  </div>
                  <p class="max-w-[46ch] text-[13px] font-medium leading-relaxed text-white/70">
                    Scan the QR code with your phone camera to use the touch trackpad remote,
                    switch Live TV channels, launch apps, and customize scenes.
                  </p>
                </div>
              </div>

              <div class="space-y-2">
                <div class="px-1 text-[13px] font-medium text-white/60">Connection details</div>
                <HapticTile
                  id="settings-companion-url"
                  variant="grouped"
                  radius="16px"
                  onSelect={() => setCategory("companion")}
                  class="flex h-14 w-full items-center justify-between rounded-[16px] px-4 text-left"
                >
                  <span class="text-[15px] font-semibold">Companion URL</span>
                  <span class="row-muted font-mono text-[13px] font-medium tabular-nums">
                    {info()?.url ?? "Starting server..."}
                  </span>
                </HapticTile>
                <HapticTile
                  id="settings-companion-status"
                  variant="grouped"
                  radius="16px"
                  onSelect={() => setCategory("companion")}
                  class="flex h-14 w-full items-center justify-between rounded-[16px] px-4 text-left"
                >
                  <span class="text-[15px] font-semibold">WebSocket Bridge</span>
                  <div class="flex items-center gap-2">
                    <span class="h-2 w-2 rounded-full bg-[#22C55E]" />
                    <span class="row-muted text-[13px] font-medium">Ready</span>
                  </div>
                </HapticTile>
              </div>
            </div>
          </Show>

          {/* Providers */}
          <Show when={category() === "providers"}>
            <div class="space-y-2">
              <div class="px-1 text-[13px] font-medium text-white/60">Configured sources</div>

              <HapticTile
                id="settings-prov-livetv"
                variant="grouped"
                radius="16px"
                onSelect={() => sendCommand({ type: "SetOverlay", overlay: "FullEpg" })}
                class="flex h-14 w-full items-center justify-between rounded-[16px] px-4 text-left"
              >
                <div class="flex items-center gap-3">
                  <span class="live-dot" />
                  <div>
                    <div class="text-[15px] font-semibold">Live TV</div>
                    <div class="row-muted text-[12px] font-medium">
                      M3U / Tvheadend · {props.channelCount} channels
                    </div>
                  </div>
                </div>
                <span class="row-muted text-[13px] font-medium">Open Guide ›</span>
              </HapticTile>

              <HapticTile
                id="settings-prov-mediathek"
                variant="grouped"
                radius="16px"
                onSelect={() => sendCommand({ type: "SetMode", mode: "Mediathek" })}
                class="flex h-14 w-full items-center justify-between rounded-[16px] px-4 text-left"
              >
                <div class="flex items-center gap-3">
                  <span class="h-2 w-2 rounded-full bg-[#0284C7]" />
                  <div>
                    <div class="text-[15px] font-semibold">Mediathek</div>
                    <div class="row-muted text-[12px] font-medium">ARD / ZDF On Demand</div>
                  </div>
                </div>
                <span class="row-muted text-[13px] font-medium">Browse ›</span>
              </HapticTile>

              <HapticTile
                id="settings-prov-youtube"
                variant="grouped"
                radius="16px"
                onSelect={() => sendCommand({ type: "SetMode", mode: "YouTube" })}
                class="flex h-14 w-full items-center justify-between rounded-[16px] px-4 text-left"
              >
                <div class="flex items-center gap-3">
                  <span class="h-2 w-2 rounded-full bg-[#DC2626]" />
                  <div>
                    <div class="text-[15px] font-semibold">YouTube</div>
                    <div class="row-muted text-[12px] font-medium">Piped On Demand</div>
                  </div>
                </div>
                <span class="row-muted text-[13px] font-medium">Browse ›</span>
              </HapticTile>

              <HapticTile
                id="settings-prov-local"
                variant="grouped"
                radius="16px"
                onSelect={() => sendCommand({ type: "SetMode", mode: "Media" })}
                class="flex h-14 w-full items-center justify-between rounded-[16px] px-4 text-left"
              >
                <div class="flex items-center gap-3">
                  <span class="h-2 w-2 rounded-full bg-[#4F46E5]" />
                  <div>
                    <div class="text-[15px] font-semibold">Local Media</div>
                    <div class="row-muted text-[12px] font-medium">Mounted library folders</div>
                  </div>
                </div>
                <span class="row-muted text-[13px] font-medium">Browse ›</span>
              </HapticTile>
            </div>
          </Show>

          {/* About */}
          <Show when={category() === "about"}>
            <div class="space-y-2">
              <div class="px-1 text-[13px] font-medium text-white/60">Appliance</div>

              <HapticTile
                id="settings-about-app"
                variant="grouped"
                radius="16px"
                onSelect={() => setCategory("about")}
                class="flex h-14 w-full items-center justify-between rounded-[16px] px-4 text-left"
              >
                <span class="text-[15px] font-semibold">Melange</span>
                <span class="row-muted text-[13px] font-medium">Couch TV Edition</span>
              </HapticTile>

              <HapticTile
                id="settings-about-video"
                variant="grouped"
                radius="16px"
                onSelect={() => sendCommand({ type: "ToggleFullscreen" })}
                class="flex h-14 w-full items-center justify-between rounded-[16px] px-4 text-left"
              >
                <div>
                  <div class="text-[15px] font-semibold">Display &amp; Window</div>
                  <div class="row-muted text-[12px] font-medium">
                    Toggle fullscreen presentation
                  </div>
                </div>
                <span class="row-muted text-[13px] font-medium">F11 ›</span>
              </HapticTile>

              <HapticTile
                id="settings-about-input"
                variant="grouped"
                radius="16px"
                onSelect={() => setCategory("companion")}
                class="flex h-14 w-full items-center justify-between rounded-[16px] px-4 text-left"
              >
                <div>
                  <div class="text-[15px] font-semibold">Control Inputs</div>
                  <div class="row-muted text-[12px] font-medium">
                    HDMI-CEC · Gamepad · Evdev · Companion Touchpad
                  </div>
                </div>
                <span class="row-muted text-[13px] font-medium">Active</span>
              </HapticTile>

              <HapticTile
                id="settings-about-leave"
                variant="grouped"
                radius="16px"
                onSelect={() => sendCommand({ type: "SetOverlay", overlay: "LeaveMenu" })}
                class="flex h-14 w-full items-center justify-between rounded-[16px] px-4 text-left"
              >
                <div>
                  <div class="text-[15px] font-semibold">Session</div>
                  <div class="row-muted text-[12px] font-medium">Open leave or exit menu</div>
                </div>
                <span class="row-muted text-[13px] font-medium">Esc ›</span>
              </HapticTile>
            </div>
          </Show>
        </main>
      </div>
    </div>
  );
}
