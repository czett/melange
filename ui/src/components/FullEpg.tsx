import { For, Show, onCleanup, onMount } from "solid-js";
import { computeEpgProgress, formatXmltvTime } from "../bridge/epgTime";
import { epgEntries, melangeState, sendCommand } from "../bridge/ws";
import { ensureValidFocus, registerFocusable } from "../spatial/nav";

export const FullEpg = () => {
  onMount(() => {
    const activeCh = melangeState().playback.channel_id;
    const firstCh = melangeState().channels[0]?.id;
    const targetId = activeCh ?? firstCh;
    requestAnimationFrame(() =>
      ensureValidFocus(targetId ? `epg-ch-${targetId}` : undefined)
    );
  });

  const programsForChannel = (tvgId: string) => {
    const list = epgEntries().filter((e) => e.channel_tvg_id === tvgId);
    if (list.length > 0) return list.slice(0, 4);
    const nowNext = melangeState().epg_now_next[tvgId];
    return [nowNext?.now, nowNext?.next].filter((x): x is NonNullable<typeof x> => Boolean(x));
  };

  return (
    <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-10">
      <div class="glass-panel-heavy flex h-full max-h-[82vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl">
        <header class="flex items-center justify-between border-b border-white/10 px-8 py-5">
          <div class="flex items-center gap-4">
            <h1 class="text-2xl font-semibold tracking-tight text-white">
              Program Guide
            </h1>
            <span class="glass-pill rounded-full px-3 py-1 text-xs font-medium text-white/75">
              {melangeState().channels.length} Channels
            </span>
          </div>
          <div class="flex items-center gap-3 text-xs text-white/60">
            <span class="glass-pill rounded-full px-3 py-1">Arrows Navigate</span>
            <span class="glass-pill rounded-full px-3 py-1">Enter Tune</span>
            <span class="glass-pill rounded-full px-3 py-1">E / Esc Close</span>
          </div>
        </header>

        <div class="no-scrollbar flex-1 space-y-3 overflow-y-auto px-8 py-6">
          <For each={melangeState().channels}>
            {(ch) => {
              let channelBtn!: HTMLButtonElement;
              const isPlaying = () => melangeState().playback.channel_id === ch.id;
              const programs = () => programsForChannel(ch.tvg_id);

              onMount(() => {
                const cleanup = registerFocusable(`epg-ch-${ch.id}`, channelBtn, () =>
                  sendCommand({ type: "SelectChannel", channel_id: ch.id })
                );
                onCleanup(cleanup);
              });

              return (
                <div class="flex items-stretch gap-3">
                  <button
                    ref={channelBtn}
                    type="button"
                    data-focus-id={`epg-ch-${ch.id}`}
                    onClick={() =>
                      sendCommand({ type: "SelectChannel", channel_id: ch.id })
                    }
                    class="flex w-60 shrink-0 items-center gap-3.5 rounded-2xl bg-white/8 px-4 py-3.5 text-left transition hover:bg-white/12"
                  >
                    <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/12 text-sm font-bold tabular-nums text-white">
                      {ch.number}
                    </span>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <span class="truncate text-sm font-semibold text-white">
                          {ch.name}
                        </span>
                        <Show when={isPlaying()}>
                          <span class="h-2 w-2 shrink-0 rounded-full bg-red-500" />
                        </Show>
                      </div>
                      <span class="text-xs text-white/50">{ch.group_title}</span>
                    </div>
                  </button>

                  <div class="no-scrollbar flex flex-1 gap-3 overflow-x-auto">
                    <For each={programs()}>
                      {(prog, idx) => {
                        let progBtn!: HTMLButtonElement;
                        const focusId = `epg-prog-${ch.id}-${prog.id}`;

                        onMount(() => {
                          const cleanup = registerFocusable(focusId, progBtn, () =>
                            sendCommand({ type: "SelectChannel", channel_id: ch.id })
                          );
                          onCleanup(cleanup);
                        });

                        return (
                          <button
                            ref={progBtn}
                            type="button"
                            data-focus-id={focusId}
                            onClick={() =>
                              sendCommand({ type: "SelectChannel", channel_id: ch.id })
                            }
                            class="flex min-w-[230px] flex-1 flex-col justify-between rounded-2xl bg-white/6 px-4 py-3 text-left transition hover:bg-white/12"
                          >
                            <div>
                              <div class="flex items-center justify-between gap-2 text-xs text-white/55 tabular-nums">
                                <span>
                                  {formatXmltvTime(prog.start_time)} –{" "}
                                  {formatXmltvTime(prog.stop_time)}
                                </span>
                                <Show when={idx() === 0}>
                                  <span class="rounded bg-sky-400/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-300">
                                    Now
                                  </span>
                                </Show>
                              </div>
                              <div class="mt-1 truncate text-sm font-semibold text-white">
                                {prog.title}
                              </div>
                              <div class="mt-0.5 line-clamp-1 text-xs text-white/55">
                                {prog.description}
                              </div>
                            </div>

                            <Show when={idx() === 0}>
                              <div class="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-white/10">
                                <div
                                  class="h-full rounded-full bg-sky-400"
                                  style={{
                                    width: `${computeEpgProgress(prog.start_time, prog.stop_time)}%`
                                  }}
                                />
                              </div>
                            </Show>
                          </button>
                        );
                      }}
                    </For>

                    <Show when={programs().length === 0}>
                      <div class="flex flex-1 items-center rounded-2xl bg-white/4 px-5 text-sm text-white/45">
                        No schedule entries available
                      </div>
                    </Show>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </div>
    </div>
  );
};
