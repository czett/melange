import { For, Show, onCleanup, onMount } from "solid-js";
import { computeEpgProgress, formatXmltvTime } from "../bridge/epgTime";
import { epgEntries, melangeState, sendCommand } from "../bridge/ws";
import { ensureValidFocus, registerFocusable, setFocus } from "../spatial/nav";

export const FullEpg = () => {
  onMount(() => {
    const activeCh = melangeState().playback.channel_id;
    const firstCh = melangeState().channels[0]?.id;
    const targetId = activeCh ?? firstCh;
    const focusId = targetId ? `epg-ch-${targetId}` : "epg-close";
    requestAnimationFrame(() => {
      setFocus(focusId, false);
      ensureValidFocus(focusId);
    });
  });

  const programsForChannel = (tvgId: string) => {
    const list = epgEntries().filter((e) => e.channel_tvg_id === tvgId);
    if (list.length > 0) return list.slice(0, 4);
    const nowNext = melangeState().epg_now_next[tvgId];
    return [nowNext?.now, nowNext?.next].filter((x): x is NonNullable<typeof x> => Boolean(x));
  };

  return (
    <div class="modal-scrim fixed inset-0 z-40 flex items-center justify-center p-12">
      <div class="glass-card flex h-full max-h-[84vh] w-full max-w-6xl flex-col overflow-hidden rounded-[24px]">
        <header class="flex items-center justify-between border-b border-white/[0.13] px-8 py-5">
          <div class="flex items-baseline gap-4">
            <h1 class="text-[28px] font-normal leading-none tracking-[-0.035em] text-white">
              Program Guide
            </h1>
            <span class="text-[11px] tabular-nums text-white/45">
              {melangeState().channels.length} channels
            </span>
          </div>
          <div class="flex items-center gap-2">
            <span class="chip">Arrows navigate</span>
            <span class="chip">OK tunes</span>
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
              class="pill pill-secondary ml-2"
            >
              ← Back
            </button>
          </div>
        </header>

        <div class="no-scrollbar flex-1 space-y-2 overflow-y-auto px-8 py-6">
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
                <div class="flex items-stretch gap-2">
                  <button
                    ref={channelBtn}
                    type="button"
                    data-focus-id={`epg-ch-${ch.id}`}
                    data-focus-radius="14px"
                    onClick={() => sendCommand({ type: "SelectChannel", channel_id: ch.id })}
                    class="glass-inner flex w-60 shrink-0 items-center gap-3.5 rounded-[14px] px-4 py-3 text-left"
                  >
                    <span
                      class={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-medium tabular-nums ${
                        isPlaying()
                          ? "bg-white text-[#160303]"
                          : "border border-white/[0.13] text-white/70"
                      }`}
                    >
                      {ch.number}
                    </span>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <span class="truncate text-[13px] font-medium text-white">{ch.name}</span>
                        <Show when={isPlaying()}>
                          <span class="live-dot" />
                        </Show>
                      </div>
                      <span class="text-[11px] text-white/45">{ch.group_title}</span>
                    </div>
                  </button>

                  <div class="no-scrollbar flex flex-1 gap-2 overflow-x-auto">
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
                            data-focus-radius="14px"
                            onClick={() => sendCommand({ type: "SelectChannel", channel_id: ch.id })}
                            class="glass-inner flex min-w-[235px] flex-1 flex-col justify-between rounded-[14px] px-4 py-3 text-left"
                          >
                            <div>
                              <div class="flex items-center justify-between gap-2 text-[11px] tabular-nums text-white/50">
                                <span>
                                  {formatXmltvTime(prog.start_time)} — {formatXmltvTime(prog.stop_time)}
                                </span>
                                <Show when={idx() === 0}>
                                  <span class="inline-flex items-center gap-1.5 text-white/80">
                                    <span class="live-dot" />
                                    Now
                                  </span>
                                </Show>
                              </div>
                              <div class="mt-1.5 truncate text-[13px] font-medium text-white">
                                {prog.title}
                              </div>
                              <div class="mt-0.5 line-clamp-1 text-[11px] text-white/50">
                                {prog.description}
                              </div>
                            </div>

                            <Show when={idx() === 0}>
                              <div class="progress-track mt-3">
                                <div
                                  class="progress-fill"
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
                      <div class="glass-inner flex flex-1 items-center rounded-[14px] px-5 text-[13px] text-white/45">
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
