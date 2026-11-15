import {
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount
} from "solid-js";
import type {
  MediaItem,
  YouTubeChannelChip,
  YouTubeFeedResponse,
  YouTubePlaylistItem
} from "../bridge/types";
import { melangeState, sendCommand } from "../bridge/ws";
import { ensureValidFocus, focusedId, registerBackHandler, setFocus } from "../spatial/nav";
import { OnScreenKeyboard } from "./OnScreenKeyboard";
import { YouTubeLoginModal } from "./YouTubeLoginModal";
import { GlassPanel, HapticTile, SegmentedPill, type SegmentedItem } from "./primitives";

interface OnDemandViewProps {
  provider: "mediathek" | "youtube" | "local";
  title: string;
  subtitle: string;
  onBack: () => void;
}

type YouTubeTab = "foryou" | "subscriptions" | "playlists" | "history" | "search";

function youtubeTabLabel(tab: YouTubeTab): string {
  switch (tab) {
    case "foryou":
      return "For You";
    case "subscriptions":
      return "Subscriptions";
    case "playlists":
      return "Playlists";
    case "history":
      return "History";
    case "search":
      return "Search";
  }
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

function extractYouTubeVideoId(item: MediaItem): string | null {
  if (item.id.startsWith("yt:")) {
    const id = item.id.slice(3).trim();
    if (id) return id;
  }
  const match = item.stream_url.match(/[?&]v=([^&]+)/);
  return match?.[1] ?? null;
}

function resolvedThumbnailUrl(
  item: MediaItem,
  provider: OnDemandViewProps["provider"]
): string | null {
  if (item.thumbnail_url && item.thumbnail_url.trim().length > 0) {
    return item.thumbnail_url;
  }
  if (provider === "youtube") {
    const vid = extractYouTubeVideoId(item);
    if (vid) {
      return `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
    }
  }
  return null;
}

function handleThumbError(img: HTMLImageElement, item: MediaItem) {
  if (img.dataset.fallbackApplied === "1") return;
  const vid = extractYouTubeVideoId(item);
  if (!vid) return;
  const fallback = `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
  if (img.src !== fallback) {
    img.dataset.fallbackApplied = "1";
    img.src = fallback;
  }
}

interface PosterTheme {
  background: string;
  glow: string;
  wordmark: string;
}

function extractBroadcasterWordmark(
  rawAuthor: string,
  provider: OnDemandViewProps["provider"]
): string {
  const trimmed = rawAuthor.trim();
  if (!trimmed) {
    switch (provider) {
      case "mediathek":
        return "ARD";
      case "youtube":
        return "YouTube";
      case "local":
        return "Local Media";
    }
  }
  const upper = trimmed.toUpperCase();
  const known = [
    "ARTE",
    "3SAT",
    "ZDF",
    "ARD",
    "WDR",
    "NDR",
    "SWR",
    "RBB",
    "MDR",
    "BR",
    "HR",
    "SR",
    "KIKA",
    "PHOENIX"
  ];
  for (const tag of known) {
    if (upper.includes(tag)) {
      return tag === "3SAT" ? "3sat" : tag;
    }
  }
  return trimmed;
}

function editorialPosterTheme(
  item: MediaItem,
  provider: OnDemandViewProps["provider"]
): PosterTheme {
  const raw = (item.channel_or_author || "").trim();
  const upper = raw.toUpperCase();
  const wordmark = extractBroadcasterWordmark(raw, provider);

  if (provider === "local") {
    return {
      background: "linear-gradient(155deg, #3730A3 0%, #11131A 100%)",
      glow: "radial-gradient(85% 90% at 22% 15%, rgba(129, 140, 248, 0.28) 0%, rgba(55, 48, 163, 0.12) 50%, transparent 100%)",
      wordmark
    };
  }

  if (upper.includes("ARTE")) {
    return {
      background: "linear-gradient(155deg, #9A3412 0%, #18181B 100%)",
      glow: "radial-gradient(85% 90% at 22% 15%, rgba(251, 146, 60, 0.28) 0%, rgba(154, 52, 18, 0.12) 50%, transparent 100%)",
      wordmark
    };
  }

  if (upper.includes("ZDF") || upper.includes("3SAT")) {
    return {
      background: "linear-gradient(155deg, #B45309 0%, #14171F 100%)",
      glow: "radial-gradient(85% 90% at 22% 15%, rgba(251, 191, 36, 0.26) 0%, rgba(180, 83, 9, 0.12) 50%, transparent 100%)",
      wordmark
    };
  }

  if (
    provider === "mediathek" ||
    upper.includes("ARD") ||
    upper.includes("BR") ||
    upper.includes("RBB") ||
    upper.includes("WDR") ||
    upper.includes("NDR") ||
    upper.includes("SWR")
  ) {
    return {
      background: "linear-gradient(155deg, #1E40AF 0%, #111520 100%)",
      glow: "radial-gradient(85% 90% at 22% 15%, rgba(96, 165, 250, 0.28) 0%, rgba(30, 64, 175, 0.12) 50%, transparent 100%)",
      wordmark
    };
  }

  return {
    background: "linear-gradient(155deg, #991B1B 0%, #141218 100%)",
    glow: "radial-gradient(85% 90% at 22% 15%, rgba(248, 113, 113, 0.26) 0%, rgba(153, 27, 27, 0.12) 50%, transparent 100%)",
    wordmark
  };
}

export function OnDemandView(props: OnDemandViewProps) {
  const [items, setItems] = createSignal<MediaItem[]>([]);
  const [channels, setChannels] = createSignal<YouTubeChannelChip[]>([]);
  const [playlists, setPlaylists] = createSignal<YouTubePlaylistItem[]>([]);
  const [nextContinuation, setNextContinuation] = createSignal<string | null>(null);
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [requiresAuth, setRequiresAuth] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [errorMsg, setErrorMsg] = createSignal<string | null>(null);
  const [query, setQuery] = createSignal("");

  const [ytTab, setYtTab] = createSignal<YouTubeTab>("foryou");
  const [activeChannel, setActiveChannel] = createSignal<{ id: string; title: string } | null>(
    null
  );
  const [activePlaylist, setActivePlaylist] = createSignal<{ id: string; title: string } | null>(
    null
  );
  const [loginModalOpen, setLoginModalOpen] = createSignal(false);

  let loadSeq = 0;
  let scrollContainerRef: HTMLDivElement | undefined;

  const keyboardOpen = () => melangeState().overlay === "SearchKeyboard";
  const ytAccount = () => melangeState().youtube_account ?? null;

  const openKeyboard = () => {
    sendCommand({ type: "SetOverlay", overlay: "SearchKeyboard" });
  };

  const closeKeyboard = () => {
    sendCommand({ type: "SetOverlay", overlay: "None" });
    requestAnimationFrame(() =>
      ensureValidFocus(props.provider === "youtube" ? "yt-sub-search" : "od-search")
    );
  };

  const loadYouTubeTab = async (
    tab: YouTubeTab,
    channelOverride?: { id: string; title: string } | null,
    playlistOverride?: { id: string; title: string } | null
  ) => {
    const channel = channelOverride !== undefined ? channelOverride : activeChannel();
    const playlist = playlistOverride !== undefined ? playlistOverride : activePlaylist();
    if (!channel && !playlist && tab === "search" && query().trim()) {
      await runSearch(query());
      return;
    }

    const seq = ++loadSeq;
    setLoading(true);
    setLoadingMore(false);
    setNextContinuation(null);
    setErrorMsg(null);
    setRequiresAuth(false);

    try {
      let url: string;
      if (channel) {
        url = `/api/youtube/feed?tab=channel&channel_id=${encodeURIComponent(channel.id)}`;
      } else if (playlist) {
        url = `/api/youtube/feed?tab=playlist&playlist_id=${encodeURIComponent(playlist.id)}`;
      } else {
        url = `/api/youtube/feed?tab=${encodeURIComponent(tab === "search" ? "foryou" : tab)}`;
      }

      const res = await fetch(url);
      if (seq !== loadSeq) return;

      if (res.ok) {
        const data = (await res.json()) as YouTubeFeedResponse;
        if (seq !== loadSeq) return;
        setItems(data.items ?? []);
        setChannels(data.channels ?? []);
        setPlaylists(data.playlists ?? []);
        setNextContinuation(data.next_continuation ?? null);
        setRequiresAuth(Boolean(data.requires_auth));
        if (channel && data.channel_title && data.channel_title !== channel.title) {
          setActiveChannel({ id: channel.id, title: data.channel_title });
        }
        if (playlist && data.channel_title && data.channel_title !== playlist.title) {
          setActivePlaylist({ id: playlist.id, title: data.channel_title });
        }
      } else {
        let detail = `HTTP ${res.status}`;
        try {
          const errJson = (await res.json()) as { error?: string };
          if (errJson?.error) detail = errJson.error;
        } catch {
          // ignore
        }
        if (seq !== loadSeq) return;
        setErrorMsg(detail);
        setItems([]);
        setChannels([]);
        setPlaylists([]);
      }
    } catch (err) {
      if (seq !== loadSeq) return;
      setErrorMsg(err instanceof Error ? err.message : "Network error");
      setItems([]);
      setChannels([]);
      setPlaylists([]);
    } finally {
      if (seq === loadSeq) {
        setLoading(false);
        requestAnimationFrame(() => {
          if (loginModalOpen()) return;
          const firstPl = playlists()[0];
          const first = items()[0];
          if (tab === "playlists" && !playlist && !channel && firstPl) {
            ensureValidFocus(`yt-pl-${firstPl.playlist_id}`);
          } else if (first) {
            ensureValidFocus(`od-item-${first.id}`);
          } else if (requiresAuth()) {
            ensureValidFocus("yt-subs-signin");
          } else if (playlist) {
            ensureValidFocus("yt-playlist-back");
          } else if (channel) {
            ensureValidFocus("yt-channel-back");
          } else {
            ensureValidFocus("od-back");
          }
        });
      }
    }
  };

  const loadMoreContinuation = async () => {
    const token = nextContinuation();
    if (props.provider !== "youtube" || !token || loading() || loadingMore()) {
      return;
    }

    const seq = loadSeq;
    const effectiveTab = activePlaylist()
      ? "playlist"
      : activeChannel()
        ? "channel"
        : ytTab() === "search"
          ? "foryou"
          : ytTab();

    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/youtube/feed?tab=${encodeURIComponent(effectiveTab)}&continuation=${encodeURIComponent(token)}`
      );
      if (seq !== loadSeq) return;
      if (!res.ok) {
        setNextContinuation(null);
        return;
      }
      const data = (await res.json()) as YouTubeFeedResponse;
      if (seq !== loadSeq) return;

      const incomingItems = data.items ?? [];
      if (incomingItems.length > 0) {
        setItems((prev) => {
          const seen = new Set(prev.map((i) => i.id));
          const merged = [...prev];
          for (const item of incomingItems) {
            if (!seen.has(item.id)) {
              seen.add(item.id);
              merged.push(item);
            }
          }
          return merged;
        });
      }

      const incomingPlaylists = data.playlists ?? [];
      if (incomingPlaylists.length > 0) {
        setPlaylists((prev) => {
          const seen = new Set(prev.map((p) => p.playlist_id));
          const merged = [...prev];
          for (const pl of incomingPlaylists) {
            if (!seen.has(pl.playlist_id)) {
              seen.add(pl.playlist_id);
              merged.push(pl);
            }
          }
          return merged;
        });
      }

      const nextTok = data.next_continuation ?? null;
      setNextContinuation(nextTok && nextTok !== token ? nextTok : null);
    } catch {
      // Keep current items on transient continuation errors
    } finally {
      if (seq === loadSeq) {
        setLoadingMore(false);
      }
    }
  };

  const loadFeed = async (provider: OnDemandViewProps["provider"]) => {
    if (provider === "youtube") {
      await loadYouTubeTab(ytTab());
      return;
    }

    const seq = ++loadSeq;
    setLoading(true);
    setLoadingMore(false);
    setNextContinuation(null);
    setErrorMsg(null);
    setChannels([]);
    setPlaylists([]);
    setRequiresAuth(false);
    try {
      const res = await fetch(`/api/ondemand/feed?provider=${encodeURIComponent(provider)}`);
      if (seq !== loadSeq) return;
      if (res.ok) {
        const data = (await res.json()) as MediaItem[];
        if (seq !== loadSeq) return;
        setItems(data);
      } else {
        let detail = `HTTP ${res.status}`;
        try {
          const errJson = (await res.json()) as { error?: string };
          if (errJson?.error) detail = errJson.error;
        } catch {
          // ignore
        }
        if (seq !== loadSeq) return;
        setErrorMsg(detail);
        setItems([]);
      }
    } catch (err) {
      if (seq !== loadSeq) return;
      setErrorMsg(err instanceof Error ? err.message : "Network error");
      setItems([]);
    } finally {
      if (seq === loadSeq) {
        setLoading(false);
        requestAnimationFrame(() => {
          const first = items()[0];
          ensureValidFocus(first ? `od-item-${first.id}` : "od-back");
        });
      }
    }
  };

  const runSearch = async (q: string) => {
    sendCommand({ type: "SetOverlay", overlay: "None" });
    const trimmed = q.trim();
    if (!trimmed) {
      if (props.provider === "youtube") {
        setYtTab("foryou");
        setActiveChannel(null);
        setActivePlaylist(null);
      }
      await loadFeed(props.provider);
      return;
    }

    if (props.provider === "youtube") {
      setYtTab("search");
      setActiveChannel(null);
      setActivePlaylist(null);
      setChannels([]);
      setPlaylists([]);
      setNextContinuation(null);
      setRequiresAuth(false);
    }

    const seq = ++loadSeq;
    setLoading(true);
    setLoadingMore(false);
    setErrorMsg(null);
    try {
      const res = await fetch(
        `/api/ondemand/search?provider=${encodeURIComponent(props.provider)}&q=${encodeURIComponent(trimmed)}`
      );
      if (seq !== loadSeq) return;
      if (res.ok) {
        const data = (await res.json()) as MediaItem[];
        if (seq !== loadSeq) return;
        setItems(data);
      } else {
        let detail = `HTTP ${res.status}`;
        try {
          const errJson = (await res.json()) as { error?: string };
          if (errJson?.error) detail = errJson.error;
        } catch {
          // ignore
        }
        if (seq !== loadSeq) return;
        setErrorMsg(detail);
        setItems([]);
      }
    } catch (err) {
      if (seq !== loadSeq) return;
      setErrorMsg(err instanceof Error ? err.message : "Network error");
      setItems([]);
    } finally {
      if (seq === loadSeq) {
        setLoading(false);
        requestAnimationFrame(() => {
          const first = items()[0];
          ensureValidFocus(first ? `od-item-${first.id}` : "od-back");
        });
      }
    }
  };

  const selectYouTubeTab = (tab: YouTubeTab) => {
    setActiveChannel(null);
    setActivePlaylist(null);
    if (tab === "search") {
      openKeyboard();
      return;
    }
    setYtTab(tab);
    void loadYouTubeTab(tab, null, null);
  };

  const openChannel = (channelId: string, title: string) => {
    const ch = { id: channelId, title: title || "Channel" };
    setActivePlaylist(null);
    setActiveChannel(ch);
    void loadYouTubeTab(ytTab(), ch, null);
  };

  const closeChannel = () => {
    setActiveChannel(null);
    void loadYouTubeTab(ytTab(), null, activePlaylist());
  };

  const openPlaylist = (playlistId: string, title: string) => {
    const pl = { id: playlistId, title: title || "Playlist" };
    setActiveChannel(null);
    setActivePlaylist(pl);
    void loadYouTubeTab("playlists", null, pl);
  };

  const closePlaylist = () => {
    setActivePlaylist(null);
    void loadYouTubeTab("playlists", null, null);
  };

  const handleAccountAction = async () => {
    if (ytAccount()?.signed_in) {
      try {
        await fetch("/api/youtube/auth/logout", { method: "POST" });
        await loadYouTubeTab(ytTab());
      } catch {
        // ignore
      }
      return;
    }
    setLoginModalOpen(true);
  };

  const handleGridScroll = () => {
    if (!scrollContainerRef || props.provider !== "youtube") return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef;
    if (scrollHeight - scrollTop - clientHeight < 360) {
      void loadMoreContinuation();
    }
  };

  // Auto-load next continuation chunk when D-Pad/keyboard focus enters the last 2 rows
  createEffect(() => {
    const fid = focusedId();
    if (!fid || props.provider !== "youtube" || loading() || loadingMore() || !nextContinuation()) {
      return;
    }
    const cols =
      typeof window !== "undefined"
        ? window.innerWidth >= 1024
          ? 4
          : window.innerWidth >= 768
            ? 3
            : 2
        : 4;
    const threshold = cols * 2;

    if (ytTab() === "playlists" && !activePlaylist() && !activeChannel()) {
      const list = playlists();
      if (list.length === 0) return;
      const idx = list.findIndex((p) => `yt-pl-${p.playlist_id}` === fid);
      if (idx !== -1 && idx >= Math.max(0, list.length - threshold)) {
        void loadMoreContinuation();
      }
      return;
    }

    const list = items();
    if (list.length === 0) return;
    const idx = list.findIndex((i) => `od-item-${i.id}` === fid || `od-ch-${i.id}` === fid);
    if (idx !== -1 && idx >= Math.max(0, list.length - threshold)) {
      void loadMoreContinuation();
    }
  });

  onMount(() => {
    requestAnimationFrame(() => ensureValidFocus("od-back"));
    const unsubBack = registerBackHandler(() => {
      if (props.provider === "youtube" && activeChannel() !== null) {
        closeChannel();
        return true;
      }
      if (props.provider === "youtube" && activePlaylist() !== null) {
        closePlaylist();
        return true;
      }
      return false;
    });
    onCleanup(unsubBack);
  });

  createEffect((prev?: { provider: OnDemandViewProps["provider"]; profileId: number | undefined }) => {
    const provider = props.provider;
    const profileId = melangeState().active_profile?.id;
    if (prev && prev.provider === provider && prev.profileId === profileId) {
      return prev;
    }
    setQuery("");
    setActiveChannel(null);
    setActivePlaylist(null);
    setYtTab("foryou");
    void loadFeed(provider);
    return { provider, profileId };
  });

  const playItem = (item: MediaItem) => {
    sendCommand({ type: "PlayMedia", item, resume: true });
  };

  const ytSubTab = () => (!activeChannel() && !activePlaylist() ? ytTab() : "");

  const providerTabs: SegmentedItem[] = [
    {
      id: "mediathek",
      focusId: "od-tab-mediathek",
      label: "Mediathek",
      onSelect: () => sendCommand({ type: "SetMode", mode: "Mediathek" })
    },
    {
      id: "youtube",
      focusId: "od-tab-youtube",
      label: "YouTube",
      onSelect: () => sendCommand({ type: "SetMode", mode: "YouTube" })
    },
    {
      id: "local",
      focusId: "od-tab-local",
      label: "Media",
      onSelect: () => sendCommand({ type: "SetMode", mode: "Media" })
    }
  ];

  const youtubeTabs: SegmentedItem[] = [
    {
      id: "foryou",
      focusId: "yt-sub-foryou",
      label: "For You",
      onSelect: () => selectYouTubeTab("foryou")
    },
    {
      id: "subscriptions",
      focusId: "yt-sub-subscriptions",
      label: "Subscriptions",
      onSelect: () => selectYouTubeTab("subscriptions")
    },
    {
      id: "playlists",
      focusId: "yt-sub-playlists",
      label: "Playlists",
      onSelect: () => selectYouTubeTab("playlists")
    },
    {
      id: "history",
      focusId: "yt-sub-history",
      label: "History",
      onSelect: () => selectYouTubeTab("history")
    },
    {
      id: "search",
      focusId: "yt-sub-search",
      label: () => (query() ? `Search: ${query()}` : "Search"),
      onSelect: () => selectYouTubeTab("search")
    }
  ];

  const showingPlaylistsGrid = () =>
    props.provider === "youtube" &&
    ytTab() === "playlists" &&
    !activeChannel() &&
    !activePlaylist();

  const displayedTitle = () => {
    if (props.provider === "youtube") {
      if (activeChannel()) return activeChannel()!.title;
      if (activePlaylist()) return activePlaylist()!.title;
    }
    return props.title;
  };

  const displayedSubtitle = () => {
    if (props.provider === "youtube") {
      if (activeChannel()) return "Channel uploads";
      if (activePlaylist()) return "Playlist";
      if (ytTab() === "search" && query()) return `Results for "${query()}"`;
      if (ytAccount()?.signed_in) return `Signed in as ${ytAccount()!.account_name}`;
      return "Guest feed";
    }
    return props.subtitle;
  };

  return (
    <div class="relative z-20 flex h-full w-full flex-col overflow-hidden px-10 py-8 text-white xl:px-14 xl:py-10">
      <header class="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div class="flex flex-col gap-3">
          <div class="flex flex-wrap items-center gap-3">
            <SegmentedPill items={providerTabs} activeId={props.provider} />
            <Show when={props.provider === "youtube" && !activeChannel() && !activePlaylist()}>
              <SegmentedPill items={youtubeTabs} activeId={ytSubTab()} />
            </Show>
            <Show when={props.provider === "youtube" && activeChannel()}>
              <HapticTile
                id="yt-channel-back"
                variant="pill"
                radius="9999px"
                active={true}
                onSelect={closeChannel}
              >
                ← Back to {activePlaylist() ? activePlaylist()!.title : youtubeTabLabel(ytTab())}
              </HapticTile>
            </Show>
            <Show when={props.provider === "youtube" && !activeChannel() && activePlaylist()}>
              <HapticTile
                id="yt-playlist-back"
                variant="pill"
                radius="9999px"
                active={true}
                onSelect={closePlaylist}
              >
                ← Back to Playlists
              </HapticTile>
            </Show>
          </div>

          <div class="flex items-baseline gap-3">
            <h1 class="view-title">{displayedTitle()}</h1>
            <span class="text-[13px] font-medium text-white/80">{displayedSubtitle()}</span>
          </div>
        </div>

        <div class="flex items-center gap-2.5">
          <Show
            when={props.provider === "youtube"}
            fallback={
              <HapticTile
                id="od-search"
                variant="pill"
                radius="9999px"
                onSelect={openKeyboard}
                class="min-w-[15rem] justify-between"
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
                <span class="text-[11px] font-medium opacity-75">OK</span>
              </HapticTile>
            }
          >
            <HapticTile
              id="yt-account-btn"
              variant="pill"
              radius="9999px"
              onSelect={() => void handleAccountAction()}
              class="gap-2.5"
            >
              <Show
                when={ytAccount()?.signed_in}
                fallback={
                  <>
                    <span class="h-2 w-2 rounded-full bg-[#DC2626]" />
                    <span>Sign in</span>
                  </>
                }
              >
                <Show
                  when={ytAccount()?.account_avatar_url}
                  fallback={
                    <span class="flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-[11px] font-bold">
                      {(ytAccount()?.account_name ?? "Y").slice(0, 1).toUpperCase()}
                    </span>
                  }
                >
                  {(avatar) => (
                    <img
                      src={avatar()}
                      alt={ytAccount()?.account_name ?? "Account"}
                      class="h-5 w-5 rounded-full object-cover"
                    />
                  )}
                </Show>
                <span class="max-w-[10rem] truncate">{ytAccount()?.account_name}</span>
                <span class="text-[11px] font-medium opacity-70">Sign out</span>
              </Show>
            </HapticTile>
          </Show>

          <HapticTile
            id="od-refresh"
            variant="pill"
            radius="9999px"
            onSelect={() => void loadFeed(props.provider)}
          >
            Refresh
          </HapticTile>

          <HapticTile
            id="od-back"
            variant="pill"
            radius="9999px"
            onSelect={props.onBack}
          >
            ← Home
          </HapticTile>
        </div>
      </header>

      <div
        ref={scrollContainerRef}
        onScroll={handleGridScroll}
        class="no-scrollbar -mx-3 flex-1 overflow-y-auto px-3 py-2"
      >
        <Show
          when={
            props.provider === "youtube" &&
            !activeChannel() &&
            !activePlaylist() &&
            ytTab() === "subscriptions" &&
            channels().length > 0 &&
            !loading()
          }
        >
          <div class="mb-5">
            <div class="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wider text-white/60">
              Subscribed Channels
            </div>
            <div class="no-scrollbar -mx-2 flex gap-2.5 overflow-x-auto px-2 py-1">
              <For each={channels()}>
                {(ch) => (
                  <HapticTile
                    id={`yt-ch-${ch.channel_id}`}
                    variant="pill"
                    radius="9999px"
                    onSelect={() => openChannel(ch.channel_id, ch.title)}
                    class="shrink-0 gap-2"
                  >
                    <Show when={ch.avatar_url}>
                      {(av) => (
                        <img
                          src={av()}
                          alt={ch.title}
                          class="h-5 w-5 rounded-full object-cover"
                          loading="lazy"
                        />
                      )}
                    </Show>
                    <span class="max-w-[12rem] truncate">{ch.title}</span>
                  </HapticTile>
                )}
              </For>
            </div>
          </div>
        </Show>

        <Show when={loading()}>
          <div class="grid grid-cols-2 gap-5 pb-8 md:grid-cols-3 lg:grid-cols-4">
            <For each={[1, 2, 3, 4, 5, 6, 7, 8]}>
              {() => (
                <GlassPanel variant="surface" class="animate-pulse overflow-hidden rounded-[18px]">
                  <div class="aspect-video w-full bg-white/[0.05]" />
                  <div class="space-y-2.5 p-4">
                    <div class="h-3 w-4/5 rounded-full bg-white/15" />
                    <div class="h-2.5 w-24 rounded-full bg-white/10" />
                  </div>
                </GlassPanel>
              )}
            </For>
          </div>
        </Show>

        <Show when={!loading() && errorMsg()}>
          {(err) => (
            <GlassPanel variant="heavy" class="max-w-xl rounded-[24px] p-7">
              <div class="flex items-center gap-2">
                <span class="live-dot" />
                <span class="text-[12px] font-semibold text-white/80">Feed unavailable</span>
              </div>
              <div class="mt-2.5 text-[18px] font-semibold tracking-[-0.02em] text-white">
                Failed to load {displayedTitle()}
              </div>
              <div class="mt-1.5 max-w-[44ch] text-[13px] font-medium leading-relaxed text-white/80">
                {err()}
              </div>
            </GlassPanel>
          )}
        </Show>

        <Show when={!loading() && !errorMsg() && props.provider === "youtube" && requiresAuth()}>
          <GlassPanel variant="heavy" class="max-w-xl rounded-[24px] p-7">
            <div class="flex items-center gap-2">
              <span class="h-2 w-2 rounded-full bg-[#DC2626]" />
              <span class="text-[12px] font-semibold text-white/80">YouTube Account</span>
            </div>
            <div class="mt-2.5 text-[20px] font-semibold tracking-[-0.02em] text-white">
              Sign in to view {ytTab() === "playlists" ? "Playlists" : "Subscriptions"}
            </div>
            <p class="mt-1.5 max-w-[44ch] text-[13px] font-medium leading-relaxed text-white/75">
              Connect your YouTube account for profile &ldquo;
              {melangeState().active_profile?.name ?? "Default"}&rdquo; using a quick QR scan on
              your phone.
            </p>
            <div class="mt-5">
              <HapticTile
                id="yt-subs-signin"
                variant="pill"
                radius="9999px"
                active={true}
                onSelect={() => setLoginModalOpen(true)}
              >
                Sign in with YouTube TV
              </HapticTile>
            </div>
          </GlassPanel>
        </Show>

        <Show
          when={
            !loading() &&
            !errorMsg() &&
            !requiresAuth() &&
            (showingPlaylistsGrid() ? playlists().length === 0 : items().length === 0)
          }
        >
          <GlassPanel variant="heavy" class="max-w-xl rounded-[24px] p-7">
            <div class="text-[18px] font-semibold tracking-[-0.02em] text-white">
              No items available
            </div>
            <div class="mt-1.5 max-w-[44ch] text-[13px] font-medium leading-relaxed text-white/80">
              {props.provider === "local"
                ? "Add video files (.mp4, .mkv, .webm) to your media directory or run ./scripts/seed_dev.sh."
                : props.provider === "youtube" && ytTab() === "history"
                  ? "No watch history recorded yet. Videos you watch in Melange or on your signed-in YouTube account appear here."
                  : props.provider === "youtube" && showingPlaylistsGrid()
                    ? "No playlists found on your YouTube account yet."
                    : "No results returned. Check your network connection or try a different search."}
            </div>
          </GlassPanel>
        </Show>

        <Show when={!loading() && showingPlaylistsGrid() && playlists().length > 0}>
          <div class="grid grid-cols-2 gap-5 pb-6 md:grid-cols-3 lg:grid-cols-4">
            <For each={playlists()}>
              {(pl) => (
                <HapticTile
                  id={`yt-pl-${pl.playlist_id}`}
                  variant="card"
                  radius="18px"
                  onSelect={() => openPlaylist(pl.playlist_id, pl.title)}
                  class="flex h-full flex-col justify-between overflow-hidden rounded-[18px] text-left"
                >
                  <Show
                    when={pl.thumbnail_url}
                    fallback={
                      <div
                        class="relative flex aspect-video w-full shrink-0 items-center justify-center overflow-hidden border-b border-white/[0.14]"
                        style={{
                          background: "linear-gradient(155deg, #991B1B 0%, #141218 100%)"
                        }}
                      >
                        <Show when={pl.item_count}>
                          {(count) => (
                            <span class="absolute bottom-2.5 right-2.5 rounded-full border border-white/20 bg-black/50 px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-white backdrop-blur-md">
                              {count()}
                            </span>
                          )}
                        </Show>
                        <span class="select-none px-4 text-center text-xl font-bold tracking-tight text-white/90">
                          Playlist
                        </span>
                      </div>
                    }
                  >
                    {(thumb) => (
                      <div class="relative flex aspect-video w-full shrink-0 items-center justify-center overflow-hidden border-b border-white/[0.14] bg-black/25">
                        <img
                          src={thumb()}
                          alt={pl.title}
                          class="h-full w-full object-cover"
                          loading="lazy"
                        />
                        <div
                          class="pointer-events-none absolute inset-0"
                          style={{
                            background:
                              "linear-gradient(180deg, transparent 56%, rgba(8, 10, 14, 0.54) 100%)"
                          }}
                        />
                        <Show when={pl.item_count}>
                          {(count) => (
                            <span class="absolute bottom-2.5 right-2.5 rounded-full border border-white/[0.12] bg-black/55 px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-white backdrop-blur-md">
                              {count()}
                            </span>
                          )}
                        </Show>
                      </div>
                    )}
                  </Show>

                  <div class="flex flex-1 flex-col justify-between gap-1.5 px-4 py-3.5">
                    <div class="line-clamp-2 text-[14px] font-semibold leading-snug tracking-[-0.015em] text-white">
                      {pl.title}
                    </div>
                    <div class="truncate text-[12px] font-medium text-white/75">
                      {pl.item_count ?? "YouTube Playlist"}
                    </div>
                  </div>
                </HapticTile>
              )}
            </For>
          </div>
        </Show>

        <Show when={!loading() && !showingPlaylistsGrid() && items().length > 0}>
          <div class="grid grid-cols-2 gap-5 pb-6 md:grid-cols-3 lg:grid-cols-4">
            <For each={items()}>
              {(item) => {
                const thumbSrc = () => resolvedThumbnailUrl(item, props.provider);
                const showChannelFooter = () =>
                  props.provider === "youtube" && Boolean(item.channel_id) && !activeChannel();
                return (
                  <GlassPanel
                    variant="surface"
                    class="flex h-full flex-col justify-between rounded-[18px]"
                  >
                    <HapticTile
                      id={`od-item-${item.id}`}
                      variant="card"
                      radius="18px"
                      onSelect={() => playItem(item)}
                      class="flex flex-1 flex-col justify-between overflow-hidden rounded-[18px] border-0 bg-transparent text-left shadow-none"
                    >
                      <Show
                        when={thumbSrc()}
                        fallback={(() => {
                          const theme = editorialPosterTheme(item, props.provider);
                          return (
                            <>
                              <div
                                class="relative flex aspect-video w-full shrink-0 items-center justify-center overflow-hidden border-b border-white/[0.14]"
                                style={{ background: theme.background }}
                              >
                                <div
                                  class="pointer-events-none absolute inset-0"
                                  style={{ background: theme.glow }}
                                />
                                <div
                                  class="pointer-events-none absolute inset-x-0 top-0 h-px"
                                  style={{
                                    background:
                                      "linear-gradient(90deg, rgba(255,255,255,0.06), rgba(255,255,255,0.28), rgba(255,255,255,0.06))"
                                  }}
                                />

                                <Show when={item.duration_sec > 0}>
                                  <span class="absolute right-2.5 top-2.5 z-10 rounded-full border border-white/20 bg-black/35 px-2 py-0.5 text-[10.5px] font-semibold tabular-nums text-white/95 backdrop-blur-md">
                                    {formatDuration(item.duration_sec)}
                                  </span>
                                </Show>

                                <span class="relative z-10 select-none px-4 text-center text-2xl font-bold tracking-tight text-white/90">
                                  {theme.wordmark}
                                </span>
                              </div>

                              <div class="flex flex-1 flex-col justify-between gap-1.5 px-4 py-3.5">
                                <div class="line-clamp-2 text-[14px] font-semibold leading-snug tracking-[-0.015em] text-white">
                                  {item.title}
                                </div>
                                <div class="truncate text-[12px] font-medium text-white/80">
                                  {item.channel_or_author || props.title}
                                  <Show when={item.subtitle}>
                                    <span> · {item.subtitle}</span>
                                  </Show>
                                </div>
                              </div>
                            </>
                          );
                        })()}
                      >
                        {(thumb) => (
                          <>
                            <div class="relative flex aspect-video w-full shrink-0 items-center justify-center overflow-hidden border-b border-white/[0.14] bg-black/25">
                              <img
                                src={thumb()}
                                alt={item.title}
                                class="h-full w-full object-cover"
                                loading="lazy"
                                onError={(e) => handleThumbError(e.currentTarget, item)}
                              />
                              <div
                                class="pointer-events-none absolute inset-0"
                                style={{
                                  background:
                                    "linear-gradient(180deg, transparent 56%, rgba(8, 10, 14, 0.54) 100%)"
                                }}
                              />
                              <Show when={item.duration_sec > 0}>
                                <span class="absolute bottom-2.5 right-2.5 rounded-full border border-white/[0.12] bg-black/50 px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-white backdrop-blur-md">
                                  {formatDuration(item.duration_sec)}
                                </span>
                              </Show>
                            </div>

                            <div class="flex flex-1 flex-col justify-between gap-1.5 px-4 py-3.5">
                              <div class="line-clamp-2 text-[14px] font-semibold leading-snug tracking-[-0.015em] text-white">
                                {item.title}
                              </div>
                              <div class="truncate text-[12px] font-medium text-white/80">
                                {item.channel_or_author || props.title}
                                <Show when={item.subtitle}>
                                  <span> · {item.subtitle}</span>
                                </Show>
                              </div>
                            </div>
                          </>
                        )}
                      </Show>
                    </HapticTile>

                    <Show when={showChannelFooter()}>
                      <div class="border-t border-white/[0.08] px-3 py-2">
                        <HapticTile
                          id={`od-ch-${item.id}`}
                          variant="pill"
                          radius="9999px"
                          onSelect={() =>
                            openChannel(item.channel_id!, item.channel_or_author || "Channel")
                          }
                          class="h-7 w-full justify-between px-3 text-[11.5px] text-white/85"
                        >
                          <span class="truncate">{item.channel_or_author}</span>
                          <span class="shrink-0 opacity-70">Channel ›</span>
                        </HapticTile>
                      </div>
                    </Show>
                  </GlassPanel>
                );
              }}
            </For>
          </div>
        </Show>

        <Show when={loadingMore()}>
          <div class="flex justify-center pb-8 pt-2">
            <div class="inline-flex items-center gap-2.5 rounded-full border border-white/15 bg-white/[0.08] px-4 py-1.5 text-[12px] font-medium text-white/85 backdrop-blur-md">
              <span class="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              <span>Loading more…</span>
            </div>
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

      <Show when={loginModalOpen()}>
        <YouTubeLoginModal
          onClose={() => {
            setLoginModalOpen(false);
            requestAnimationFrame(() => setFocus("yt-account-btn", false));
          }}
          onSuccess={() => {
            setLoginModalOpen(false);
            void loadYouTubeTab(ytTab());
          }}
        />
      </Show>
    </div>
  );
}
