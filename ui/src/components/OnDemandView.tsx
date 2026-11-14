import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import type { MediaItem } from "../bridge/types";
import { melangeState, sendCommand } from "../bridge/ws";
import { ensureValidFocus, registerFocusable } from "../spatial/nav";
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

/**
 * Typographic monogram for items without artwork (e.g. MediathekViewWeb). Uses the
 * broadcaster's initials, or a compact three-letter mark for single-token names.
 */
function broadcasterMonogram(item: MediaItem): string {
  const source = (item.channel_or_author || item.title || "M").trim();
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }
  return (words[0] ?? "M").slice(0, 3).toUpperCase();
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
    <div class="relative z-20 flex h-full w-full flex-col overflow-hidden px-14 py-10 text-white">
      <header class="mb-9 flex items-end justify-between gap-6">
        <div>
          <div class="eyebrow">{props.subtitle}</div>
          <h1 class="mt-2 text-[40px] font-normal leading-[1.05] tracking-[-0.035em] text-white">
            {props.title}
          </h1>
        </div>

        <div class="flex items-center gap-2">
          <button
            ref={(el) => onCleanup(registerFocusable("od-search", el, openKeyboard))}
            type="button"
            data-focus-radius="9999px"
            onClick={openKeyboard}
            class="pill pill-secondary min-w-[15rem] justify-between"
          >
            <span class="flex min-w-0 items-center gap-2">
              <svg
                class="h-3.5 w-3.5 shrink-0 opacity-70"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
              >
                <circle cx="11" cy="11" r="6.5" />
                <path d="M20 20l-4-4" />
              </svg>
              <span class="truncate">{query() ? query() : "Search"}</span>
            </span>
            <span class="text-[10px] uppercase tracking-[0.14em] opacity-50">OK</span>
          </button>

          <button
            ref={(el) =>
              onCleanup(registerFocusable("od-refresh", el, () => void loadFeed(props.provider)))
            }
            type="button"
            data-focus-radius="9999px"
            onClick={() => void loadFeed(props.provider)}
            class="pill pill-secondary"
          >
            Refresh
          </button>

          <button
            ref={(el) => onCleanup(registerFocusable("od-back", el, props.onBack))}
            type="button"
            data-focus-radius="9999px"
            onClick={props.onBack}
            class="pill pill-secondary"
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
                <div class="glass-card animate-pulse overflow-hidden rounded-[18px]">
                  <div class="aspect-video w-full bg-white/[0.04]" />
                  <div class="space-y-2.5 p-4">
                    <div class="h-2.5 w-20 rounded-full bg-white/10" />
                    <div class="h-3 w-4/5 rounded-full bg-white/[0.14]" />
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>

        <Show when={!loading() && errorMsg()}>
          {(err) => (
            <div class="glass-card max-w-xl rounded-[22px] p-7">
              <div class="flex items-center gap-2">
                <span class="live-dot" />
                <span class="eyebrow">Feed unavailable</span>
              </div>
              <div class="mt-3 text-lg font-normal tracking-[-0.02em] text-white">
                Failed to load {props.title}
              </div>
              <div class="mt-1.5 max-w-[44ch] text-[13px] leading-relaxed text-white/65">{err()}</div>
            </div>
          )}
        </Show>

        <Show when={!loading() && !errorMsg() && items().length === 0}>
          <div class="glass-card max-w-xl rounded-[22px] p-7">
            <div class="text-lg font-normal tracking-[-0.02em] text-white">No items available</div>
            <div class="mt-1.5 max-w-[44ch] text-[13px] leading-relaxed text-white/65">
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
                  data-focus-radius="18px"
                  onClick={() => playItem(item)}
                  class="glass-card glass-card-interactive flex flex-col overflow-hidden rounded-[18px] text-left"
                >
                  <div class="relative flex aspect-video w-full items-center justify-center overflow-hidden bg-[rgba(24,3,3,0.48)]">
                    <Show
                      when={item.thumbnail_url}
                      fallback={
                        <div class="relative flex h-full w-full items-center justify-center overflow-hidden">
                          <div
                            class="absolute inset-0"
                            style={{
                              background:
                                "linear-gradient(135deg, #5e0b0a 0%, #831613 52%, #4a0807 100%)"
                            }}
                          />
                          <div
                            class="absolute inset-0"
                            style={{
                              background:
                                "radial-gradient(80% 90% at 16% 8%, rgba(255, 82, 59, 0.4) 0%, transparent 66%)"
                            }}
                          />
                          <div
                            class="absolute inset-0"
                            style={{
                              background:
                                "linear-gradient(112deg, transparent 34%, rgba(255,255,255,0.16) 46%, rgba(255,255,255,0.02) 55%, transparent 68%)"
                            }}
                          />
                          <span class="relative select-none text-[46px] font-medium leading-none tracking-[-0.05em] text-white/95 drop-shadow-[0_8px_20px_rgba(22,3,3,0.5)]">
                            {broadcasterMonogram(item)}
                          </span>
                          <span class="absolute bottom-3 left-4 max-w-[80%] truncate text-[9px] uppercase tracking-[0.2em] text-white/55">
                            {item.channel_or_author || props.subtitle}
                          </span>
                        </div>
                      }
                    >
                      {(thumb) => (
                        <img
                          src={thumb()}
                          alt={item.title}
                          class="h-full w-full object-cover"
                          loading="lazy"
                        />
                      )}
                    </Show>
                    <div
                      class="pointer-events-none absolute inset-0"
                      style={{
                        background:
                          "linear-gradient(180deg, transparent 55%, rgba(22,3,3,0.6) 100%)"
                      }}
                    />
                    <Show when={item.duration_sec > 0}>
                      <span class="chip absolute bottom-2.5 right-2.5 bg-[rgba(22,3,3,0.6)] tabular-nums text-white/85 backdrop-blur-md">
                        {formatDuration(item.duration_sec)}
                      </span>
                    </Show>
                  </div>

                  <div class="flex flex-col gap-1 px-4 py-3.5">
                    <div class="truncate text-[11px] text-white/50">
                      {item.channel_or_author}
                      <Show when={item.subtitle}>
                        <span> · {item.subtitle}</span>
                      </Show>
                    </div>
                    <div class="line-clamp-2 text-[13px] font-medium leading-snug tracking-[-0.01em] text-white">
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
