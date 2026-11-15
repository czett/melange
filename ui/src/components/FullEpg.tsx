import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { computeEpgProgress, formatXmltvTime, parseXmltvDate } from "../bridge/epgTime";
import { epgEntries, melangeState, sendCommand } from "../bridge/ws";
import { ensureValidFocus, setFocus } from "../spatial/nav";
import { GlassPanel, HapticTile, SegmentedPill, type SegmentedItem } from "./primitives";

const EPG_COLUMNS = [
  { label: "Now", isNow: true },
  { label: "Up Next", isNow: false },
  { label: "Later", isNow: false },
  { label: "Tonight", isNow: false }
] as const;

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

  const formattedNow = () =>
    now().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
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
    if (list.length > 0) {
      const nowMs = now().getTime();
      const activeIdx = list.findIndex((e) => {
        const start = parseXmltvDate(e.start_time)?.getTime();
        const stop = parseXmltvDate(e.stop_time)?.getTime();
        return start !== undefined && stop !== undefined && start <= nowMs && nowMs < stop;
      });
      if (activeIdx >= 0) {
        return list.slice(activeIdx, activeIdx + 4);
      }
      return list.slice(0, 4);
    }
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
            <span class="text-[12px] font-medium tabular-nums text-white/70">
              {visibleChannels().length} channels · {formattedNow()}
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

        {/* Slot header ruler */}
        <div class="flex shrink-0 items-center gap-2 border-b border-white/[0.08] bg-white/[0.04] px-3 py-2.5">
          <div class="w-60 shrink-0 px-4 text-[12px] font-semibold text-white/75">
            Channel
          </div>
          <div class="grid flex-1 grid-cols-4 gap-1.5">
            <For each={EPG_COLUMNS}>
              {(slot) => (
                <div class="flex items-center gap-2 px-4 text-[12px] font-semibold text-white/80">
                  <Show when={slot.isNow}>
                    <span class="live-dot" />
                  </Show>
                  <span>{slot.label}</span>
                </div>
              )}
            </For>
          </div>
        </div>

        {/* Unclipped 1.016x cells with padded scroll container */}
        <div class="no-scrollbar flex-1 space-y-1.5 overflow-y-auto px-3 py-2">
          <For each={visibleChannels()}>
            {(ch) => {
              const isPlaying = () => melangeState().playback.channel_id === ch.id;
              const programs = () => programsForChannel(ch.tvg_id);

              return (
                <div class="flex items-stretch gap-2">
                  <div class="w-60 shrink-0">
                    <HapticTile
                      id={`epg-ch-${ch.id}`}
                      variant="epg"
                      radius="12px"
                      active={isPlaying()}
                      onSelect={() => sendCommand({ type: "SelectChannel", channel_id: ch.id })}
                      class="flex h-full w-full items-center gap-3.5 rounded-[12px] px-4 py-3 text-left"
                    >
                      <span
                        data-playing={isPlaying() ? "true" : undefined}
                        class="epg-ch-badge flex h-8 min-w-[2.15rem] shrink-0 items-center justify-center rounded-[9px] px-2 text-[12px] font-semibold tabular-nums"
                      >
                        {ch.number}
                      </span>
                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2">
                          <span class="truncate text-[14px] font-semibold">
                            {ch.name}
                          </span>
                          <Show when={isPlaying()}>
                            <span class="live-dot" />
                          </Show>
                        </div>
                        <span class="row-muted block truncate text-[12px] font-medium">
                          {ch.group_title || "Live TV"}
                        </span>
                      </div>
                    </HapticTile>
                  </div>

                  <div class="grid flex-1 grid-cols-4 gap-1.5">
                    <For each={programs()}>
                      {(prog, idx) => (
                        <HapticTile
                          id={`epg-prog-${ch.id}-${prog.id}`}
                          variant="epg"
                          radius="12px"
                          onSelect={() =>
                            sendCommand({ type: "SelectChannel", channel_id: ch.id })
                          }
                          class="flex h-full min-w-0 w-full flex-col justify-between rounded-[12px] px-4 py-3 text-left"
                        >
                          <div class="min-w-0">
                            <div class="row-muted flex items-center justify-between gap-2 text-[12px] font-medium tabular-nums">
                              <span class="truncate">
                                {formatXmltvTime(prog.start_time)} –{" "}
                                {formatXmltvTime(prog.stop_time)}
                              </span>
                              <Show when={idx() === 0}>
                                <span class="inline-flex shrink-0 items-center gap-1.5 font-semibold">
                                  <span class="live-dot" />
                                  Live
                                </span>
                              </Show>
                            </div>
                            <div class="mt-1 truncate text-[14px] font-semibold">
                              {prog.title}
                            </div>
                            <Show when={prog.description}>
                              <div class="row-muted mt-0.5 line-clamp-1 text-[12px] font-medium">
                                {prog.description}
                              </div>
                            </Show>
                          </div>

                          <Show when={idx() === 0}>
                            <div class="epg-progress-track mt-2.5 h-[3px] w-full overflow-hidden rounded-full">
                              <div
                                class="h-full rounded-full bg-[#E13A26]"
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
                      <div class="col-span-4 flex items-center rounded-[12px] border border-white/[0.08] bg-white/[0.03] px-5 py-3 text-[13px] font-medium text-white/70">
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
