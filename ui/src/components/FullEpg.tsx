import { For, Show, onCleanup, onMount } from "solid-js";
import { computeEpgProgress, formatXmltvTime } from "../bridge/epgTime";
import { epgEntries, melangeState, sendCommand } from "../bridge/ws";
import { ensureValidFocus, isFocused, registerFocusable } from "../spatial/nav";

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
    <div class="fixed inset-0 z-40 flex items-center justify-center bg-[#120303]/75 p-10 backdrop-blur-md">
      <div class="fluted-surface flex h-full max-h-[84vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl">
        <header class="flex items-center justify-between border-b border-white/15 px-8 py-5">
          <div class="flex items-center gap-4">
            <h1 class="text-3xl font-light tracking-editorial text-white">
              Program Guide
            </h1>
            <span class="fluted-pill rounded-full px-3.5 py-1 text-xs font-medium text-white/80">
              {melangeState().channels.length} Channels
            </span>
          </div>
          <div class="flex items-center gap-3 text-xs text-white/65">
            <span class="fluted-pill rounded-full px-3.5 py-1.5">Arrows Navigate</span>
            <span class="fluted-pill rounded-full px-3.5 py-1.5">Enter Tune</span>
            <button
              ref={(el) =>
                onCleanup(
                  registerFocusable("epg-close", el, () =>
                    sendCommand({ type: "SetOverlay", overlay: "None" })
                  )
                )
              }
              type="button"
              data-focus-radius="9999px"
              onClick={() => sendCommand({ type: "SetOverlay", overlay: "None" })}
              class={`rounded-full px-5 py-1.5 text-xs font-semibold transition ${
                isFocused("epg-close") ? "pill-cta-white" : "fluted-pill text-white"
              }`}
            >
              ← Back
            </button>
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
                    class="fluted-card flex w-60 shrink-0 items-center gap-3.5 rounded-2xl px-4 py-3.5 text-left"
                  >
                    <span
                      class={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-semibold tabular-nums ${
                        isPlaying()
                          ? "bg-white text-[#140404]"
                          : "border border-white/20 bg-[#120303]/75 text-white"
                      }`}
                    >
                      {ch.number}
                    </span>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <span class="truncate text-sm font-medium text-white">
                          {ch.name}
                        </span>
                        <Show when={isPlaying()}>
                          <span class="live-beacon h-2 w-2 shrink-0 rounded-full" />
                        </Show>
                      </div>
                      <span class="text-xs text-white/50">{ch.group_title}</span>
                    </div>
                  </button>

                  <div class="no-scrollbar flex flex-1 gap-3 overflow-x-auto py-0.5">
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
                            class={`fluted-card flex min-w-[235px] flex-1 flex-col justify-between rounded-2xl px-4 py-3 text-left ${
                              idx() === 0 ? "border-[#E13A26]/45" : ""
                            }`}
                          >
                            <div>
                              <div class="flex items-center justify-between gap-2 text-xs tabular-nums text-white/60">
                                <span>
                                  {formatXmltvTime(prog.start_time)} –{" "}
                                  {formatXmltvTime(prog.stop_time)}
                                </span>
                                <Show when={idx() === 0}>
                                  <span class="rounded-full bg-[#E13A26] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                                    Now
                                  </span>
                                </Show>
                              </div>
                              <div class="mt-1.5 truncate text-sm font-medium text-white">
                                {prog.title}
                              </div>
                              <div class="mt-0.5 line-clamp-1 text-xs text-white/55">
                                {prog.description}
                              </div>
                            </div>

                            <Show when={idx() === 0}>
                              <div class="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-white/15">
                                <div
                                  class="crimson-progress-fill h-full rounded-full"
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
                      <div class="fluted-card flex flex-1 items-center rounded-2xl px-5 text-sm text-white/45">
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
