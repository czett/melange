import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { computeEpgProgress, formatXmltvTime } from "../bridge/epgTime";
import { epgEntries, melangeState, sendCommand } from "../bridge/ws";
import { ensureValidFocus, setFocus } from "../spatial/nav";
import { GlassPanel, HapticTile, SegmentedPill, type SegmentedItem } from "./primitives";

export const FullEpg = () => {
  const [selectedGroup, setSelectedGroup] = createSignal<string>("All");

  const groups = createMemo(() => {
    const seen = new Set<string>();
    const list: string[] = ["All"];
    for (const ch of melangeState().channels) {
      const g = (ch.group_title || "").trim();
      if (g && !seen.has(g)) {
        seen.add(g);
        list.push(g);
      }
    }
    return list.slice(0, 6);
  });

  const visibleChannels = createMemo(() => {
    const grp = selectedGroup();
    if (grp === "All") return melangeState().channels;
    return melangeState().channels.filter((c) => c.group_title === grp);
  });

  const groupSegments = createMemo<SegmentedItem[]>(() =>
    groups().map((grp, idx) => ({
      id: grp,
      focusId: `epg-grp-${idx}`,
      label: grp,
      active: selectedGroup() === grp,
      onSelect: () => setSelectedGroup(grp)
    }))
  );

  onMount(() => {
    const activeCh = melangeState().playback.channel_id;
    const firstCh = visibleChannels()[0]?.id;
    const targetId = activeCh ?? firstCh;
    const focusId = targetId ? `epg-ch-${targetId}` : "epg-close";
    requestAnimationFrame(() => {
      setFocus(focusId, false);
      ensureValidFocus(focusId);
    });

    onCleanup(() => {
      if (melangeState().mode === "Home") {
        requestAnimationFrame(() => ensureValidFocus("home-live-pill"));
      }
    });
  });

  const programsForChannel = (tvgId: string) => {
    const list = epgEntries().filter((e) => e.channel_tvg_id === tvgId);
    if (list.length > 0) return list.slice(0, 4);
    const nowNext = melangeState().epg_now_next[tvgId];
    return [nowNext?.now, nowNext?.next].filter((x): x is NonNullable<typeof x> => Boolean(x));
  };

  return (
    <GlassPanel
      variant="scrim"
      class="fixed inset-0 z-40 flex items-center justify-center p-8 xl:p-12"
      onClick={() => sendCommand({ type: "SetOverlay", overlay: "None" })}
    >
      <GlassPanel
        variant="heavy"
        class="flex h-full max-h-[86vh] w-full max-w-6xl flex-col overflow-hidden rounded-[26px]"
        onClick={(e: MouseEvent) => e.stopPropagation()}
      >
        <header class="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-8 py-5">
          <div class="flex items-center gap-4">
            <h1 class="view-title text-[28px]">Program Guide</h1>
            <span class="text-[12px] font-medium tabular-nums text-white/[0.74]">
              {visibleChannels().length} channels
            </span>
          </div>

          <div class="flex flex-wrap items-center gap-3">
            <Show when={groupSegments().length > 1}>
              <SegmentedPill items={groupSegments()} />
            </Show>

            <HapticTile
              id="epg-close"
              variant="pill"
              radius="9999px"
              onSelect={() => sendCommand({ type: "SetOverlay", overlay: "None" })}
              class="text-white"
            >
              ← Back
            </HapticTile>
          </div>
        </header>

        <div class="no-scrollbar flex-1 space-y-2.5 overflow-y-auto px-8 py-6">
          <For each={visibleChannels()}>
            {(ch) => {
              const isPlaying = () => melangeState().playback.channel_id === ch.id;
              const programs = () => programsForChannel(ch.tvg_id);

              return (
                <div class="flex items-stretch gap-2.5">
                  <HapticTile
                    id={`epg-ch-${ch.id}`}
                    variant="row"
                    radius="16px"
                    active={isPlaying()}
                    onSelect={() => sendCommand({ type: "SelectChannel", channel_id: ch.id })}
                    class="flex w-60 shrink-0 items-center gap-3.5 rounded-[16px] px-4 py-3 text-left"
                  >
                    <span
                      class={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold tabular-nums ${
                        isPlaying()
                          ? "bg-white text-[#120202]"
                          : "border border-white/15 bg-white/[0.06] text-white"
                      }`}
                    >
                      {ch.number}
                    </span>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <span class="truncate text-[14px] font-semibold text-white">
                          {ch.name}
                        </span>
                        <Show when={isPlaying()}>
                          <span class="live-dot" />
                        </Show>
                      </div>
                      <span class="text-[12px] font-medium text-white/[0.74]">
                        {ch.group_title}
                      </span>
                    </div>
                  </HapticTile>

                  <div class="no-scrollbar flex flex-1 gap-2.5 overflow-x-auto">
                    <For each={programs()}>
                      {(prog, idx) => (
                        <HapticTile
                          id={`epg-prog-${ch.id}-${prog.id}`}
                          variant="row"
                          radius="16px"
                          onSelect={() => sendCommand({ type: "SelectChannel", channel_id: ch.id })}
                          class="flex min-w-[240px] flex-1 flex-col justify-between rounded-[16px] px-4 py-3 text-left"
                        >
                          <div>
                            <div class="flex items-center justify-between gap-2 text-[12px] font-medium tabular-nums text-white/[0.74]">
                              <span>
                                {formatXmltvTime(prog.start_time)} — {formatXmltvTime(prog.stop_time)}
                              </span>
                              <Show when={idx() === 0}>
                                <span class="inline-flex items-center gap-1.5 font-semibold text-white">
                                  <span class="live-dot" />
                                  Now
                                </span>
                              </Show>
                            </div>
                            <div class="mt-1.5 truncate text-[14px] font-semibold text-white">
                              {prog.title}
                            </div>
                            <div class="mt-0.5 line-clamp-1 text-[12px] font-medium text-white/[0.74]">
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
                        </HapticTile>
                      )}
                    </For>

                    <Show when={programs().length === 0}>
                      <div class="flex flex-1 items-center rounded-[16px] border border-white/10 bg-[rgba(12,2,2,0.5)] px-5 text-[13px] font-medium text-white/60">
                        No schedule entries available
                      </div>
                    </Show>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </GlassPanel>
    </GlassPanel>
  );
};
