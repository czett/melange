import { For, Show, createEffect, createSignal } from "solid-js";
import type { MediaItem } from "../bridge/types";
import { sendCommand } from "../bridge/ws";
import { registerFocusable } from "../spatial/nav";
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
  const [query, setQuery] = createSignal("");
  const [keyboardOpen, setKeyboardOpen] = createSignal(false);

  const loadFeed = async (provider: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ondemand/feed?provider=${encodeURIComponent(provider)}`);
      if (res.ok) {
        const data = (await res.json()) as MediaItem[];
        setItems(data);
      } else {
        setItems([]);
      }
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const runSearch = async (q: string) => {
    setKeyboardOpen(false);
    const trimmed = q.trim();
    if (!trimmed) {
      await loadFeed(props.provider);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/ondemand/search?provider=${encodeURIComponent(props.provider)}&q=${encodeURIComponent(trimmed)}`,
      );
      if (res.ok) {
        const data = (await res.json()) as MediaItem[];
        setItems(data);
      } else {
        setItems([]);
      }
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  createEffect(() => {
    setQuery("");
    void loadFeed(props.provider);
  });

  const playItem = (item: MediaItem) => {
    sendCommand({ type: "PlayMedia", item, resume: true });
  };

  return (
    <div class="fixed inset-0 z-20 flex flex-col bg-black/55 backdrop-blur-2xl text-white p-10 overflow-hidden">
      <div class="flex items-center justify-between gap-6 mb-8">
        <div>
          <div class="text-xs uppercase tracking-[0.25em] text-white/50">{props.subtitle}</div>
          <h1 class="text-3xl font-semibold tracking-tight mt-1">{props.title}</h1>
        </div>

        <div class="flex items-center gap-3">
          <button
            ref={(el) => registerFocusable("od-search", el, () => setKeyboardOpen(true))}
            onClick={() => setKeyboardOpen(true)}
            class="glass-card px-5 py-2.5 rounded-full text-sm text-white/85 flex items-center gap-2 min-w-[14rem] justify-between"
          >
            <span class="truncate">{query() ? `Search: ${query()}` : "Search..."}</span>
            <span class="text-white/45 text-xs">KEY</span>
          </button>

          <button
            ref={(el) => registerFocusable("od-refresh", el, () => void loadFeed(props.provider))}
            onClick={() => void loadFeed(props.provider)}
            class="glass-card px-4 py-2.5 rounded-full text-sm text-white/85"
          >
            Refresh
          </button>

          <button
            ref={(el) => registerFocusable("od-back", el, props.onBack)}
            onClick={props.onBack}
            class="glass-card px-5 py-2.5 rounded-full text-sm text-white/85"
          >
            Home
          </button>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto pr-2">
        <Show when={loading()}>
          <div class="text-white/60 text-sm py-12">Loading {props.title}...</div>
        </Show>

        <Show when={!loading() && items().length === 0}>
          <div class="glass-panel rounded-3xl p-8 text-white/70 max-w-xl">
            <div class="text-lg font-medium text-white mb-1">No items available</div>
            <div class="text-sm text-white/60">
              {props.provider === "local"
                ? "Add video files (.mp4, .mkv, .webm) to your media directory or run ./scripts/seed_dev.sh."
                : "No results returned. Check your network connection or try a different search."}
            </div>
          </div>
        </Show>

        <Show when={!loading() && items().length > 0}>
          <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5 pb-8">
            <For each={items()}>
              {(item) => (
                <button
                  ref={(el) => registerFocusable(`od-item-${item.id}`, el, () => playItem(item))}
                  onClick={() => playItem(item)}
                  class="glass-card rounded-2xl overflow-hidden text-left flex flex-col group transition-transform"
                >
                  <div class="relative aspect-video w-full bg-white/5 flex items-center justify-center overflow-hidden">
                    <Show
                      when={item.thumbnail_url}
                      fallback={
                        <div class="text-xs uppercase tracking-[0.2em] text-white/35 px-4 text-center">
                          {item.channel_or_author}
                        </div>
                      }
                    >
                      {(thumb) => (
                        <img
                          src={thumb()}
                          alt={item.title}
                          class="w-full h-full object-cover"
                          loading="lazy"
                        />
                      )}
                    </Show>
                    <Show when={item.duration_sec > 0}>
                      <span class="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-black/75 text-[11px] font-medium text-white">
                        {formatDuration(item.duration_sec)}
                      </span>
                    </Show>
                  </div>

                  <div class="p-4 flex flex-col gap-1">
                    <div class="text-xs text-white/55 truncate">
                      {item.channel_or_author}
                      <Show when={item.subtitle}>
                        <span> · {item.subtitle}</span>
                      </Show>
                    </div>
                    <div class="text-sm font-medium text-white line-clamp-2 leading-snug">
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
          onClose={() => setKeyboardOpen(false)}
        />
      </Show>
    </div>
  );
}
