import { Show, createSignal, onMount } from "solid-js";

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

  onMount(async () => {
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
    <div class="fixed inset-0 z-20 flex items-center justify-center bg-zinc-950/90 backdrop-blur-xl p-10 text-zinc-100">
      <div class="w-full max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-8">
        <div class="rounded-3xl bg-zinc-900/90 border border-white/10 p-8 flex flex-col items-center text-center space-y-5">
          <h2 class="text-2xl font-semibold tracking-tight">Smartphone Companion</h2>
          <p class="text-sm text-zinc-400">
            Scan with your phone camera to control Melange, reorder channels, or upload a custom wallpaper.
          </p>
          <Show
            when={info()}
            fallback={<div class="w-52 h-52 rounded-2xl bg-zinc-800 animate-pulse" />}
          >
            {(data) => (
              <>
                <div
                  class="p-3 bg-white rounded-2xl shadow-lg [&>svg]:w-48 [&>svg]:h-48"
                  innerHTML={data().qr_svg}
                />
                <div class="px-4 py-2 rounded-xl bg-zinc-800/80 border border-white/10 font-mono text-sm text-amber-300">
                  {data().url}
                </div>
              </>
            )}
          </Show>
        </div>

        <div class="space-y-6">
          <div class="rounded-3xl bg-zinc-900/90 border border-white/10 p-6 space-y-3">
            <h3 class="text-lg font-semibold">Active Providers</h3>
            <div class="grid grid-cols-2 gap-3 text-sm">
              <div class="p-3 rounded-xl bg-zinc-800/60 border border-white/5">
                <div class="text-zinc-400 text-xs">Live TV</div>
                <div class="font-medium mt-0.5">M3U / Tvheadend ({props.channelCount} ch)</div>
              </div>
              <div class="p-3 rounded-xl bg-zinc-800/60 border border-white/5">
                <div class="text-zinc-400 text-xs">On-Demand</div>
                <div class="font-medium mt-0.5">Mediathek / YouTube / Local</div>
              </div>
            </div>
          </div>

          <div class="rounded-3xl bg-zinc-900/90 border border-white/10 p-6 space-y-3">
            <h3 class="text-lg font-semibold">Profile & Wallpaper</h3>
            <div class="text-sm text-zinc-300">
              Active Profile: <span class="font-semibold text-white">{props.activeProfile?.name ?? "Default"}</span>
            </div>
            <Show
              when={props.activeProfile?.wallpaper_path}
              fallback={
                <div class="h-32 rounded-2xl bg-zinc-800/60 border border-dashed border-white/15 flex items-center justify-center text-xs text-zinc-400">
                  No custom wallpaper set — upload one from the Companion app
                </div>
              }
            >
              {(wp) => (
                <img
                  src={wp()}
                  alt="Profile Wallpaper"
                  class="w-full h-36 object-cover rounded-2xl border border-white/10"
                />
              )}
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}
