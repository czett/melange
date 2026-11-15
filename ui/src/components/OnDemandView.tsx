import { For, Show, createEffect, createMemo, createSignal, onMount } from "solid-js";
import type { MediaItem } from "../bridge/types";
import { melangeState, sendCommand } from "../bridge/ws";
import { ensureValidFocus } from "../spatial/nav";
import { OnScreenKeyboard } from "./OnScreenKeyboard";
import { GlassPanel, HapticTile, SegmentedPill, type SegmentedItem } from "./primitives";

interface OnDemandViewProps {
  provider: "mediathek" | "youtube" | "local";
  title: string;
  subtitle: string;
  onBack: () => void;
}

function formatDuration(sec: number): string {
  if (!sec || sec <= 0) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

function categoryBadge(
  item: MediaItem,
  provider: OnDemandViewProps["provider"],
  fallback: string
): string {
  const raw = (item.channel_or_author || "").trim();
  if (raw.length > 0) return raw;
  return provider === "local" ? "Local Media" : fallback;
}

export function OnDemandView(props: OnDemandViewProps) {
  const [items, setItems] = createSignal<MediaItem[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [errorMsg, setErrorMsg] = createSignal<string | null>(null);
  const [query, setQuery] = createSignal("");

  const keyboardOpen = () => melangeState().overlay === "SearchKeyboard";

  const openKeyboard = () => {
    sendCommand({ type: "SetOverlay", overlay: "SearchKeyboard" });
  };

  const closeKeyboard = () => {
    sendCommand({ type: "SetOverlay", overlay: "None" });
    requestAnimationFrame(() => ensureValidFocus("od-search"));
  };

  const loadFeed = async (provider: string) => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/ondemand/feed?provider=${encodeURIComponent(provider)}`);
      if (res.ok) {
        const data = (await res.json()) as MediaItem[];
        setItems(data);
      } else {
        let detail = `HTTP ${res.status}`;
        try {
          const errJson = (await res.json()) as { error?: string };
          if (errJson?.error) detail = errJson.error;
        } catch {
          // ignore
        }
        setErrorMsg(detail);
        setItems([]);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Network error");
      setItems([]);
    } finally {
      setLoading(false);
      requestAnimationFrame(() => {
        const first = items()[0];
        ensureValidFocus(first ? `od-item-${first.id}` : "od-back");
      });
    }
  };

  const runSearch = async (q: string) => {
    sendCommand({ type: "SetOverlay", overlay: "None" });
    const trimmed = q.trim();
    if (!trimmed) {
      await loadFeed(props.provider);
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(
        `/api/ondemand/search?provider=${encodeURIComponent(props.provider)}&q=${encodeURIComponent(trimmed)}`
      );
      if (res.ok) {
        const data = (await res.json()) as MediaItem[];
        setItems(data);
      } else {
        let detail = `HTTP ${res.status}`;
        try {
          const errJson = (await res.json()) as { error?: string };
          if (errJson?.error) detail = errJson.error;
        } catch {
          // ignore
        }
        setErrorMsg(detail);
        setItems([]);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Network error");
      setItems([]);
    } finally {
      setLoading(false);
      requestAnimationFrame(() => {
        const first = items()[0];
        ensureValidFocus(first ? `od-item-${first.id}` : "od-back");
      });
    }
  };

  onMount(() => {
    requestAnimationFrame(() => ensureValidFocus("od-back"));
  });

  createEffect(() => {
    setQuery("");
    void loadFeed(props.provider);
  });

  const playItem = (item: MediaItem) => {
    sendCommand({ type: "PlayMedia", item, resume: true });
  };

  const providerTabs = createMemo<SegmentedItem[]>(() => [
    {
      id: "mediathek",
      focusId: "od-tab-mediathek",
      label: "Mediathek",
      active: props.provider === "mediathek",
      onSelect: () => sendCommand({ type: "SetMode", mode: "Mediathek" })
    },
    {
      id: "youtube",
      focusId: "od-tab-youtube",
      label: "YouTube",
      active: props.provider === "youtube",
      onSelect: () => sendCommand({ type: "SetMode", mode: "YouTube" })
    },
    {
      id: "local",
      focusId: "od-tab-local",
      label: "Media",
      active: props.provider === "local",
      onSelect: () => sendCommand({ type: "SetMode", mode: "Media" })
    }
  ]);

  return (
    <div class="relative z-20 flex h-full w-full flex-col overflow-hidden px-10 py-8 text-white xl:px-14 xl:py-10">
      <header class="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div class="flex flex-col gap-3">
          <div class="flex items-center gap-3">
            <div class="text-[13px] font-medium text-white/65">{props.subtitle}</div>
            <SegmentedPill items={providerTabs()} />
          </div>
          <h1 class="view-title">{props.title}</h1>
        </div>

        <div class="flex items-center gap-2.5">
          <HapticTile
            id="od-search"
            variant="pill"
            radius="9999px"
            onSelect={openKeyboard}
            class="min-w-[15rem] justify-between bg-white/[0.10] text-white"
          >
            <span class="flex min-w-0 items-center gap-2">
              <svg
                class="h-3.5 w-3.5 shrink-0 opacity-80"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              >
                <circle cx="11" cy="11" r="6.5" />
                <path d="M20 20l-4-4" />
              </svg>
              <span class="truncate">{query() ? query() : "Search"}</span>
            </span>
            <span class="text-[11px] font-medium text-white/60">OK</span>
          </HapticTile>

          <HapticTile
            id="od-refresh"
            variant="pill"
            radius="9999px"
            onSelect={() => void loadFeed(props.provider)}
            class="bg-white/[0.10] text-white"
          >
            Refresh
          </HapticTile>

          <HapticTile
            id="od-back"
            variant="pill"
            radius="9999px"
            onSelect={props.onBack}
            class="bg-white/[0.10] text-white"
          >
            ← Home
          </HapticTile>
        </div>
      </header>

      <div class="no-scrollbar flex-1 overflow-y-auto px-1 py-1.5">
        <Show when={loading()}>
          <div class="grid grid-cols-2 gap-5 pb-8 md:grid-cols-3 lg:grid-cols-4">
            <For each={[1, 2, 3, 4, 5, 6, 7, 8]}>
              {() => (
                <GlassPanel variant="surface" class="animate-pulse overflow-hidden rounded-[20px]">
                  <div class="aspect-video w-full bg-white/[0.06]" />
                  <div class="space-y-2.5 p-4">
                    <div class="h-2.5 w-20 rounded-full bg-white/15" />
                    <div class="h-3.5 w-4/5 rounded-full bg-white/20" />
                  </div>
                </GlassPanel>
              )}
            </For>
          </div>
        </Show>

        <Show when={!loading() && errorMsg()}>
          {(err) => (
            <GlassPanel
              variant="heavy"
              class="max-w-xl rounded-[24px] bg-[#141418]/[0.65] p-7"
            >
              <div class="flex items-center gap-2">
                <span class="live-dot" />
                <span class="text-[13px] font-medium text-white/70">Feed unavailable</span>
              </div>
              <div class="mt-2.5 text-lg font-semibold tracking-[-0.02em] text-white">
                Failed to load {props.title}
              </div>
              <div class="mt-1.5 max-w-[44ch] text-[13px] font-medium leading-relaxed text-white/70">
                {err()}
              </div>
            </GlassPanel>
          )}
        </Show>

        <Show when={!loading() && !errorMsg() && items().length === 0}>
          <GlassPanel
            variant="heavy"
            class="max-w-xl rounded-[24px] bg-[#141418]/[0.65] p-7"
          >
            <div class="text-lg font-semibold tracking-[-0.02em] text-white">
              No items available
            </div>
            <div class="mt-1.5 max-w-[44ch] text-[13px] font-medium leading-relaxed text-white/70">
              {props.provider === "local"
                ? "Add video files (.mp4, .mkv, .webm) to your media directory or run ./scripts/seed_dev.sh."
                : "No results returned. Check your network connection or try a different search."}
            </div>
          </GlassPanel>
        </Show>

        <Show when={!loading() && items().length > 0}>
          <div class="grid grid-cols-2 gap-5 pb-8 md:grid-cols-3 lg:grid-cols-4">
            <For each={items()}>
              {(item) => (
                <HapticTile
                  id={`od-item-${item.id}`}
                  variant="card"
                  radius="20px"
                  onSelect={() => playItem(item)}
                  class="flex h-full flex-col overflow-hidden rounded-[20px] bg-white/[0.10] text-left"
                >
                  <Show
                    when={item.thumbnail_url}
                    fallback={
                      <div class="flex h-full w-full flex-col justify-between overflow-hidden">
                        <div class="relative flex aspect-video w-full flex-col justify-between overflow-hidden bg-gradient-to-br from-white/[0.14] via-white/[0.06] to-[#141418]/75 p-4">
                          <div class="flex items-center justify-between gap-2">
                            <span class="chip max-w-[68%] truncate text-white/90">
                              {categoryBadge(item, props.provider, props.subtitle)}
                            </span>
                            <Show when={item.duration_sec > 0}>
                              <span class="chip shrink-0 tabular-nums text-white/90">
                                {formatDuration(item.duration_sec)}
                              </span>
                            </Show>
                          </div>
                          <div class="flex items-center gap-2">
                            <span class="h-[3px] w-8 rounded-full bg-white/50" />
                            <span class="text-[12px] font-medium capitalize text-white/65">
                              {props.provider}
                            </span>
                          </div>
                        </div>

                        <div class="flex flex-1 flex-col justify-between gap-1.5 px-4 py-3.5">
                          <div class="line-clamp-2 text-[14px] font-semibold leading-snug tracking-[-0.015em] text-white">
                            {item.title}
                          </div>
                          <Show when={item.subtitle || item.description}>
                            <div class="line-clamp-1 text-[12px] font-medium text-white/65">
                              {item.subtitle || item.description}
                            </div>
                          </Show>
                        </div>
                      </div>
                    }
                  >
                    {(thumb) => (
                      <>
                        <div class="relative flex aspect-video w-full items-center justify-center overflow-hidden bg-[#141418]/60">
                          <img
                            src={thumb()}
                            alt={item.title}
                            class="h-full w-full object-cover"
                            loading="lazy"
                          />
                          <div
                            class="pointer-events-none absolute inset-0"
                            style={{
                              background:
                                "linear-gradient(180deg, transparent 54%, rgba(0, 0, 0, 0.56) 100%)"
                            }}
                          />
                          <Show when={item.duration_sec > 0}>
                            <span class="chip absolute bottom-2.5 right-2.5 border-white/[0.18] bg-[#141418]/[0.76] tabular-nums text-white backdrop-blur-md">
                              {formatDuration(item.duration_sec)}
                            </span>
                          </Show>
                        </div>

                        <div class="flex flex-col gap-1 px-4 py-3.5">
                          <div class="truncate text-[12px] font-medium text-white/65">
                            {item.channel_or_author}
                            <Show when={item.subtitle}>
                              <span> · {item.subtitle}</span>
                            </Show>
                          </div>
                          <div class="line-clamp-2 text-[14px] font-semibold leading-snug tracking-[-0.015em] text-white">
                            {item.title}
                          </div>
                        </div>
                      </>
                    )}
                  </Show>
                </HapticTile>
              )}
            </For>
          </div>
        </Show>
      </div>

      <Show when={keyboardOpen()}>
        <OnScreenKeyboard
          value={query()}
          onChange={setQuery}
          onSubmit={(q) => void runSearch(q)}
          onClose={closeKeyboard}
        />
      </Show>
    </div>
  );
}
