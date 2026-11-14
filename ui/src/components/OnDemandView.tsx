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

function categoryBadge(item: MediaItem, provider: OnDemandViewProps["provider"], fallback: string): string {
  const raw = (item.channel_or_author || "").trim();
  if (raw.length > 0) return raw;
  return provider === "local" ? "LOCAL MEDIA" : fallback;
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
          <h1 class="mt-2 pb-0.5 text-[40px] font-normal leading-[1.12] tracking-[-0.035em] text-white">
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
                  class="glass-card glass-card-interactive flex h-full flex-col overflow-hidden rounded-[18px] text-left"
                >
                  <Show
                    when={item.thumbnail_url}
                    fallback={
                      <div
                        class="relative flex min-h-[192px] w-full flex-1 flex-col justify-between overflow-hidden p-5"
                        style={{ background: "rgba(15, 2, 2, 0.78)" }}
                      >
                        {/* Subtle diagonal #831613 / #E13A26 editorial light accent */}
                        <div
                          class="pointer-events-none absolute inset-0"
                          style={{
                            background:
                              "linear-gradient(132deg, rgba(225, 58, 38, 0.2) 0%, rgba(131, 22, 19, 0.16) 28%, rgba(15, 2, 2, 0) 62%)"
                          }}
                        />
                        <div
                          class="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full"
                          style={{
                            background:
                              "radial-gradient(circle, rgba(225, 58, 38, 0.16) 0%, transparent 72%)"
                          }}
                        />

                        <div class="relative flex items-center justify-between gap-2">
                          <span class="chip max-w-[68%] truncate uppercase tracking-[0.12em] text-white/85">
                            {categoryBadge(item, props.provider, props.subtitle)}
                          </span>
                          <Show when={item.duration_sec > 0}>
                            <span class="chip shrink-0 tabular-nums text-white/75">
                              {formatDuration(item.duration_sec)}
                            </span>
                          </Show>
                        </div>

                        <div class="relative mt-6 space-y-2">
                          <div class="line-clamp-3 pb-0.5 text-[15px] font-medium leading-[1.3] tracking-[-0.015em] text-white">
                            {item.title}
                          </div>
                          <Show when={item.subtitle || item.description}>
                            <div class="line-clamp-2 text-[12px] leading-relaxed text-white/55">
                              {item.subtitle || item.description}
                            </div>
                          </Show>
                        </div>
                      </div>
                    }
                  >
                    {(thumb) => (
                      <>
                        <div class="relative flex aspect-video w-full items-center justify-center overflow-hidden bg-[rgba(10,1,1,0.62)]">
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
                                "linear-gradient(180deg, transparent 55%, rgba(15,2,2,0.7) 100%)"
                            }}
                          />
                          <Show when={item.duration_sec > 0}>
                            <span class="chip absolute bottom-2.5 right-2.5 bg-[rgba(15,2,2,0.78)] tabular-nums text-white/85 backdrop-blur-md">
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
                          <div class="line-clamp-2 pb-0.5 text-[13px] font-medium leading-snug tracking-[-0.01em] text-white">
                            {item.title}
                          </div>
                        </div>
                      </>
                    )}
                  </Show>
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
