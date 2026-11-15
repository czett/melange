import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { computeEpgProgress, formatXmltvTime } from "../bridge/epgTime";
import { epgEntries, melangeState, sendCommand } from "../bridge/ws";
import { ensureValidFocus, setFocus } from "../spatial/nav";
import { GlassPanel, HapticTile, SegmentedPill, type SegmentedItem } from "./primitives";

export const FullEpg = () => {
  const [selectedGroup, setSelectedGroup] = createSignal<string>("All");
  const [now, setNow] = createSignal(new Date());

  const clockTimer = window.setInterval(() => setNow(new Date()), 30000);
  onCleanup(() => window.clearInterval(clockTimer));

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

  const rulerSlots = createMemo(() => {
    const base = new Date(now().getTime());
    base.setSeconds(0, 0);
    base.setMinutes(base.getMinutes() < 30 ? 0 : 30);
    return [0, 30, 60, 90].map((offsetMin, idx) => {
      const slotDate = new Date(base.getTime() + offsetMin * 60_000);
      return {
        isNow: idx === 0,
        label: slotDate.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false
        })
      };
    });
  });

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
        requestAnimationFrame(() => ensureValidFocus("dock-livetv"));
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
        class="flex h-full max-h-[86vh] w-full max-w-6xl flex-col overflow-hidden rounded-[24px]"
        onClick={(e: MouseEvent) => e.stopPropagation()}
      >
        <header class="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.08] px-7 py-5">
          <div class="flex items-baseline gap-3.5">
            <h1 class="view-title text-[24px]">Program Guide</h1>
            <span class="text-[12px] font-medium tabular-nums text-white/[0.62]">
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
            >
              ← Back
            </HapticTile>
          </div>
        </header>

        {/* Timeline ruler */}
        <div class="flex shrink-0 items-center border-b border-white/[0.08] bg-black/25">
          <div class="w-60 shrink-0 border-r border-white/[0.08] px-5 py-2.5 text-[12px] font-semibold text-white/[0.62]">
            Channel
          </div>
          <div class="grid flex-1 grid-cols-4 divide-x divide-white/[0.08]">
            <For each={rulerSlots()}>
              {(slot) => (
                <div class="flex items-center gap-2 px-4 py-2.5 text-[12px] font-medium tabular-nums text-white/75">
                  <Show when={slot.isNow}>
                    <span class="live-dot" />
                  </Show>
                  <span>{slot.isNow ? `Now · ${slot.label}` : slot.label}</span>
                </div>
              )}
            </For>
          </div>
        </div>

        {/* Dark-glass timeline grid with crisp 1px cell dividers & 2px white focus rim */}
        <div class="no-scrollbar flex-1 divide-y divide-white/[0.08] overflow-y-auto">
          <For each={visibleChannels()}>
            {(ch) => {
              const isPlaying = () => melangeState().playback.channel_id === ch.id;
              const programs = () => programsForChannel(ch.tvg_id);

              return (
                <div class="flex items-stretch">
                  <div
                    class={`w-60 shrink-0 border-r border-white/[0.08] ${
                      isPlaying() ? "bg-white/[0.06]" : "bg-black/15"
                    }`}
                  >
                    <HapticTile
                      id={`epg-ch-${ch.id}`}
                      variant="epg"
                      radius="10px"
                      active={isPlaying()}
                      onSelect={() => sendCommand({ type: "SelectChannel", channel_id: ch.id })}
                      class="flex h-full w-full items-center gap-3.5 rounded-[10px] px-4 py-3 text-left"
                    >
                      <span
                        class={`flex h-8 min-w-[2.15rem] shrink-0 items-center justify-center rounded-[9px] px-2 text-[12px] font-semibold tabular-nums ${
                          isPlaying()
                            ? "bg-white text-[#111318]"
                            : "bg-white/[0.08] text-white"
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
                        <span class="block truncate text-[12px] font-medium text-white/[0.62]">
                          {ch.group_title || "Live TV"}
                        </span>
                      </div>
                    </HapticTile>
                  </div>

                  <div class="no-scrollbar flex flex-1 divide-x divide-white/[0.08] overflow-x-auto">
                    <For each={programs()}>
                      {(prog, idx) => (
                        <div class="flex min-w-[225px] flex-1">
                          <HapticTile
                            id={`epg-prog-${ch.id}-${prog.id}`}
                            variant="epg"
                            radius="10px"
                            onSelect={() =>
                              sendCommand({ type: "SelectChannel", channel_id: ch.id })
                            }
                            class="flex h-full w-full flex-col justify-between rounded-[10px] px-4 py-3 text-left"
                          >
                            <div>
                              <div class="flex items-center justify-between gap-2 text-[12px] font-medium tabular-nums text-white/[0.62]">
                                <span>
                                  {formatXmltvTime(prog.start_time)} –{" "}
                                  {formatXmltvTime(prog.stop_time)}
                                </span>
                                <Show when={idx() === 0}>
                                  <span class="inline-flex items-center gap-1.5 font-semibold text-white">
                                    <span class="live-dot" />
                                    Live
                                  </span>
                                </Show>
                              </div>
                              <div class="mt-1 truncate text-[14px] font-semibold text-white">
                                {prog.title}
                              </div>
                              <Show when={prog.description}>
                                <div class="mt-0.5 line-clamp-1 text-[12px] font-medium text-white/[0.62]">
                                  {prog.description}
                                </div>
                              </Show>
                            </div>

                            <Show when={idx() === 0}>
                              <div class="mt-2.5 h-[3px] w-full overflow-hidden rounded-full bg-white/20">
                                <div
                                  class="h-full rounded-full bg-white"
                                  style={{
                                    width: `${computeEpgProgress(prog.start_time, prog.stop_time)}%`
                                  }}
                                />
                              </div>
                            </Show>
                          </HapticTile>
                        </div>
                      )}
                    </For>

                    <Show when={programs().length === 0}>
                      <div class="flex flex-1 items-center px-5 text-[13px] font-medium text-white/[0.52]">
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
