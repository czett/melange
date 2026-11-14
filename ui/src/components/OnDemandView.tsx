import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import type { MediaItem } from "../bridge/types";
import { melangeState, sendCommand } from "../bridge/ws";
import { ensureValidFocus, isFocused, registerFocusable } from "../spatial/nav";
import { OnScreenKeyboard } from "./OnScreenKeyboard";

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
        `/api/ondemand/search?provider=${encodeURIComponent(props.provider)}&q=${encodeURIComponent(trimmed)}`,
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

  return (
    <div class="relative z-20 flex h-full w-full flex-col overflow-hidden bg-[#120303]/28 p-10 text-white">
      <header class="mb-8 flex items-center justify-between gap-6">
        <div>
          <div class="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.25em] text-white/60">
            <span class="h-1.5 w-1.5 rounded-full bg-[#E13A26]" />
            <span>{props.subtitle}</span>
          </div>
          <h1 class="mt-1.5 text-4xl font-light tracking-editorial text-white">
            {props.title}
          </h1>
        </div>

        <div class="flex items-center gap-3">
          <button
            ref={(el) => onCleanup(registerFocusable("od-search", el, openKeyboard))}
            type="button"
            data-focus-radius="9999px"
            onClick={openKeyboard}
            class={`flex min-w-[15rem] items-center justify-between gap-3 rounded-full px-5 py-2.5 text-sm font-medium transition ${
              isFocused("od-search")
                ? "pill-cta-white"
                : "fluted-pill text-white"
            }`}
          >
            <span class="truncate">
              {query() ? `Search: ${query()}` : "Search..."}
            </span>
            <span
              class={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                isFocused("od-search")
                  ? "bg-[#140404]/10 text-[#140404]"
                  : "border border-[#E13A26]/45 bg-[#E13A26]/25 text-white"
              }`}
            >
              KEY
            </span>
          </button>

          <button
            ref={(el) =>
              onCleanup(registerFocusable("od-refresh", el, () => void loadFeed(props.provider)))
            }
            type="button"
            data-focus-radius="9999px"
            onClick={() => void loadFeed(props.provider)}
            class={`rounded-full px-5 py-2.5 text-sm font-medium transition ${
              isFocused("od-refresh")
                ? "pill-cta-white"
                : "fluted-pill text-white"
            }`}
          >
            Refresh
          </button>

          <button
            ref={(el) => onCleanup(registerFocusable("od-back", el, props.onBack))}
            type="button"
            data-focus-radius="9999px"
            onClick={props.onBack}
            class={`rounded-full px-5 py-2.5 text-sm font-semibold transition ${
              isFocused("od-back")
                ? "pill-cta-white"
                : "fluted-pill text-white"
            }`}
          >
            ← Back
          </button>
        </div>
      </header>

      <div class="no-scrollbar flex-1 overflow-y-auto px-1 py-1">
        <Show when={loading()}>
          <div class="grid grid-cols-2 gap-5 pb-8 md:grid-cols-3 lg:grid-cols-4">
            <For each={[1, 2, 3, 4, 5, 6, 7, 8]}>
              {() => (
                <div class="fluted-card animate-pulse overflow-hidden rounded-2xl">
                  <div class="aspect-video w-full bg-[#831613]/25" />
                  <div class="space-y-2.5 p-4">
                    <div class="h-3 w-24 rounded-full bg-white/15" />
                    <div class="h-4 w-4/5 rounded-full bg-white/20" />
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>

        <Show when={!loading() && errorMsg()}>
          {(err) => (
            <div class="fluted-surface max-w-xl rounded-3xl border-[#E13A26]/55 p-8">
              <div class="mb-2 inline-flex items-center gap-2 rounded-full border border-[#E13A26]/50 bg-[#E13A26]/25 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white">
                <span class="live-beacon h-1.5 w-1.5 rounded-full" />
                Feed Unavailable
              </div>
              <div class="text-xl font-medium tracking-tight text-white">
                Failed to load {props.title}
              </div>
              <div class="mt-1.5 text-sm text-white/70">{err()}</div>
            </div>
          )}
        </Show>

        <Show when={!loading() && !errorMsg() && items().length === 0}>
          <div class="fluted-card max-w-xl rounded-3xl p-8">
            <div class="text-xl font-medium tracking-tight text-white">
              No items available
            </div>
            <div class="mt-1.5 text-sm text-white/65">
              {props.provider === "local"
                ? "Add video files (.mp4, .mkv, .webm) to your media directory or run ./scripts/seed_dev.sh."
                : "No results returned. Check your network connection or try a different search."}
            </div>
          </div>
        </Show>

        <Show when={!loading() && items().length > 0}>
          <div class="grid grid-cols-2 gap-5 pb-8 md:grid-cols-3 lg:grid-cols-4">
            <For each={items()}>
              {(item) => (
                <button
                  ref={(el) =>
                    onCleanup(registerFocusable(`od-item-${item.id}`, el, () => playItem(item)))
                  }
                  type="button"
                  onClick={() => playItem(item)}
                  class="fluted-card group flex flex-col overflow-hidden rounded-2xl text-left"
                >
                  <div class="relative flex aspect-video w-full items-center justify-center overflow-hidden bg-[#120303]/75">
                    <Show
                      when={item.thumbnail_url}
                      fallback={
                        <div class="px-4 text-center text-xs uppercase tracking-[0.22em] text-white/40">
                          {item.channel_or_author}
                        </div>
                      }
                    >
                      {(thumb) => (
                        <img
                          src={thumb()}
                          alt={item.title}
                          class="h-full w-full object-cover transition-transform duration-500 ease-spring group-hover:scale-105"
                          loading="lazy"
                        />
                      )}
                    </Show>
                    <div
                      class="pointer-events-none absolute inset-0"
                      style={{
                        background:
                          "linear-gradient(180deg, transparent 45%, rgba(18,3,3,0.72) 100%)"
                      }}
                    />
                    <Show when={item.duration_sec > 0}>
                      <span class="absolute bottom-2.5 right-2.5 rounded-full border border-white/20 bg-[#120303]/85 px-2.5 py-0.5 text-[11px] font-medium tabular-nums text-white backdrop-blur-md">
                        {formatDuration(item.duration_sec)}
                      </span>
                    </Show>
                  </div>

                  <div class="flex flex-col gap-1.5 p-4">
                    <div class="truncate text-xs text-white/55">
                      {item.channel_or_author}
                      <Show when={item.subtitle}>
                        <span> · {item.subtitle}</span>
                      </Show>
                    </div>
                    <div class="line-clamp-2 text-sm font-medium leading-snug tracking-tight text-white">
                      {item.title}
                    </div>
                  </div>
                </button>
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
