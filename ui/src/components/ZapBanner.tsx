import { Show, createEffect, createSignal, onCleanup } from "solid-js";
import { computeEpgProgress, formatXmltvTime } from "../bridge/epgTime";
import { melangeState, sendCommand } from "../bridge/ws";

export const ZapBanner = () => {
  const [tick, setTick] = createSignal(0);
  let dismissTimer: number | null = null;

  const isVisible = () =>
    melangeState().overlay === "ZapBanner" || melangeState().playback.is_zapping;

  createEffect(() => {
    const pb = melangeState().playback;
    const overlay = melangeState().overlay;
    const digits = melangeState().digit_buffer;

    // Reset 4s auto-dismiss timer whenever channel, zapping state, or digits change.
    if (dismissTimer !== null) {
      window.clearTimeout(dismissTimer);
      dismissTimer = null;
    }

    if (overlay === "ZapBanner" || pb.is_zapping || digits.length > 0) {
      dismissTimer = window.setTimeout(() => {
        if (melangeState().overlay === "ZapBanner") {
          sendCommand({ type: "SetOverlay", overlay: "None" });
        }
      }, 4000);
    }
  });

  const interval = window.setInterval(() => setTick((t) => t + 1), 10000);
  onCleanup(() => {
    window.clearInterval(interval);
    if (dismissTimer !== null) {
      window.clearTimeout(dismissTimer);
    }
  });

  const activeChannel = () => {
    const chId = melangeState().playback.channel_id;
    return melangeState().channels.find((c) => c.id === chId) ?? null;
  };

  const nowNext = () => {
    const ch = activeChannel();
    if (!ch) return null;
    return melangeState().epg_now_next[ch.tvg_id] ?? null;
  };

  const progress = () => {
    void tick();
    const now = nowNext()?.now;
    if (!now) return 0;
    return computeEpgProgress(now.start_time, now.stop_time);
  };

  return (
    <div
      class="pointer-events-none fixed inset-x-0 bottom-8 z-40 flex justify-center px-10 transition-all duration-300 ease-out"
      style={{
        opacity: isVisible() ? "1" : "0",
        transform: isVisible() ? "translate3d(0, 0, 0)" : "translate3d(0, 36px, 0)"
      }}
    >
      <div class="glass-panel-heavy w-full max-w-4xl rounded-3xl px-7 py-5">
        <div class="flex items-center justify-between gap-6">
          <div class="flex items-center gap-5">
            <div class="flex h-14 min-w-[3.75rem] items-center justify-center rounded-2xl bg-white/12 px-3 text-2xl font-bold tracking-tight tabular-nums text-white">
              {melangeState().digit_buffer || melangeState().playback.channel_number || "—"}
            </div>
            <div>
              <div class="flex items-center gap-3">
                <h2 class="text-xl font-semibold tracking-tight text-white">
                  {activeChannel()?.name ?? melangeState().playback.title ?? "Live TV"}
                </h2>
                <Show when={melangeState().playback.is_zapping}>
                  <span class="inline-flex items-center gap-1.5 rounded-full bg-sky-400/20 px-2.5 py-0.5 text-xs font-medium text-sky-300">
                    <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />
                    Tuning
                  </span>
                </Show>
                <Show when={!melangeState().playback.is_zapping && melangeState().playback.state === "Playing"}>
                  <span class="inline-flex items-center gap-1.5 rounded-full bg-red-500/20 px-2.5 py-0.5 text-xs font-medium text-red-300">
                    <span class="h-1.5 w-1.5 rounded-full bg-red-500" />
                    LIVE
                  </span>
                </Show>
              </div>
              <p class="mt-0.5 text-sm text-white/60">
                {activeChannel()?.group_title || "Television"}
              </p>
            </div>
          </div>

          <div class="text-right text-xs font-medium text-white/55 tabular-nums">
            <Show when={nowNext()?.now}>
              {(now) => (
                <span>
                  {formatXmltvTime(now().start_time)} – {formatXmltvTime(now().stop_time)}
                </span>
              )}
            </Show>
          </div>
        </div>

        <div class="mt-4 space-y-2.5">
          <div class="flex items-baseline justify-between gap-4">
            <p class="truncate text-base font-medium text-white">
              {nowNext()?.now?.title ?? "Program information unavailable"}
            </p>
            <Show when={nowNext()?.next}>
              {(next) => (
                <p class="shrink-0 text-sm text-white/60">
                  Next: <span class="text-white/85">{next().title}</span>{" "}
                  <span class="tabular-nums text-white/45">
                    ({formatXmltvTime(next().start_time)})
                  </span>
                </p>
              )}
            </Show>
          </div>

          <div class="h-1.5 w-full overflow-hidden rounded-full bg-white/12">
            <div
              class="h-full rounded-full bg-gradient-to-r from-sky-400 to-cyan-300 transition-all duration-500"
              style={{ width: `${progress()}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
