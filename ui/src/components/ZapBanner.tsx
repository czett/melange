import { Show, createEffect, createSignal, onCleanup } from "solid-js";
import { computeEpgProgress, formatXmltvTime } from "../bridge/epgTime";
import { melangeState, sendCommand } from "../bridge/ws";
import { GlassPanel } from "./primitives";

export const ZapBanner = () => {
  const [tick, setTick] = createSignal(0);
  let dismissTimer: number | null = null;

  const isVisible = () =>
    melangeState().overlay === "ZapBanner" || melangeState().playback.is_zapping;

  createEffect(() => {
    const pb = melangeState().playback;
    const overlay = melangeState().overlay;
    const digits = melangeState().digit_buffer;

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
      class="pointer-events-none fixed inset-x-0 bottom-8 z-40 flex justify-center px-10 transition-all duration-300 ease-spring"
      style={{
        opacity: isVisible() ? "1" : "0",
        transform: isVisible() ? "translate3d(0, 0, 0)" : "translate3d(0, 36px, 0)"
      }}
    >
      <GlassPanel
        variant="heavy"
        class="w-full max-w-4xl rounded-[24px] bg-[#141418]/[0.65] px-7 py-5"
      >
        <div class="flex items-center justify-between gap-6">
          <div class="flex items-center gap-5">
            <div class="flex h-12 min-w-[3.25rem] items-center justify-center rounded-2xl border border-white/[0.16] bg-white/[0.10] px-3 text-2xl font-bold tracking-[-0.035em] tabular-nums text-white">
              {melangeState().digit_buffer || melangeState().playback.channel_number || "—"}
            </div>
            <div>
              <div class="flex items-center gap-3">
                <h2 class="text-[22px] font-semibold leading-tight tracking-[-0.03em] text-white">
                  {activeChannel()?.name ?? melangeState().playback.title ?? "Live TV"}
                </h2>
                <Show when={melangeState().playback.is_zapping}>
                  <span class="chip font-semibold">
                    <span class="nav-dot animate-pulse" />
                    Tuning
                  </span>
                </Show>
                <Show
                  when={
                    !melangeState().playback.is_zapping &&
                    melangeState().playback.state === "Playing"
                  }
                >
                  <span class="chip font-semibold">
                    <span class="live-dot" />
                    Live
                  </span>
                </Show>
              </div>
              <p class="mt-0.5 text-[13px] font-medium text-white/65">
                {activeChannel()?.group_title || "Television"}
              </p>
            </div>
          </div>

          <div class="text-right text-[12px] font-medium tabular-nums text-white/75">
            <Show when={nowNext()?.now}>
              {(now) => (
                <span>
                  {formatXmltvTime(now().start_time)} — {formatXmltvTime(now().stop_time)}
                </span>
              )}
            </Show>
          </div>
        </div>

        <div class="mt-4 space-y-2.5">
          <div class="flex items-baseline justify-between gap-4">
            <p class="truncate text-[14px] font-semibold text-white">
              {nowNext()?.now?.title ?? "Program information unavailable"}
            </p>
            <Show when={nowNext()?.next}>
              {(next) => (
                <p class="shrink-0 text-[12px] font-medium text-white/70">
                  Next: <span class="font-semibold text-white">{next().title}</span>{" "}
                  <span class="tabular-nums text-white/60">
                    ({formatXmltvTime(next().start_time)})
                  </span>
                </p>
              )}
            </Show>
          </div>

          <div class="progress-track">
            <div
              class="progress-fill transition-all duration-500"
              style={{ width: `${progress()}%` }}
            />
          </div>
        </div>
      </GlassPanel>
    </div>
  );
};
