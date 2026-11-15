import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import type { YouTubeAuthStartResponse, YouTubeAuthStatusResponse } from "../bridge/types";
import { melangeState } from "../bridge/ws";
import { ensureValidFocus, registerBackHandler, setFocus } from "../spatial/nav";
import { GlassPanel, HapticTile } from "./primitives";

interface YouTubeLoginModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export function YouTubeLoginModal(props: YouTubeLoginModalProps) {
  const [authData, setAuthData] = createSignal<YouTubeAuthStartResponse | null>(null);
  const [status, setStatus] = createSignal<string>("Starting");
  const [errorMsg, setErrorMsg] = createSignal<string | null>(null);

  let pollTimer: number | undefined;
  let closed = false;

  const stopPolling = () => {
    if (pollTimer !== undefined) {
      window.clearInterval(pollTimer);
      pollTimer = undefined;
    }
  };

  const completeSuccess = () => {
    if (closed) return;
    closed = true;
    stopPolling();
    props.onSuccess();
  };

  const checkStatus = async () => {
    if (closed) return;
    try {
      const res = await fetch("/api/youtube/auth/status");
      if (!res.ok) return;
      const body = (await res.json()) as YouTubeAuthStatusResponse;
      if (closed) return;

      setStatus(body.status);
      if (body.status === "Authorized") {
        completeSuccess();
      } else if (body.status === "Expired") {
        stopPolling();
        setErrorMsg("This activation code has expired. Generate a new code to continue.");
        requestAnimationFrame(() => ensureValidFocus("yt-login-retry"));
      } else if (body.status === "Denied" || body.status === "Error") {
        stopPolling();
        setErrorMsg(body.error ?? "Authorization was cancelled or failed.");
        requestAnimationFrame(() => ensureValidFocus("yt-login-retry"));
      }
    } catch {
      // Keep polling on transient network hiccups
    }
  };

  const startAuth = async () => {
    stopPolling();
    setErrorMsg(null);
    setStatus("Starting");
    setAuthData(null);

    try {
      const profileId = melangeState().active_profile?.id;
      const res = await fetch("/api/youtube/auth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profileId !== undefined ? { profile_id: profileId } : {})
      });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const errJson = (await res.json()) as { error?: string };
          if (errJson?.error) detail = errJson.error;
        } catch {
          // ignore
        }
        setStatus("Error");
        setErrorMsg(detail);
        return;
      }

      const data = (await res.json()) as YouTubeAuthStartResponse;
      if (closed) return;
      setAuthData(data);
      setStatus("Pending");

      const intervalMs = Math.max(2000, (data.interval || 2) * 1000);
      pollTimer = window.setInterval(() => {
        void checkStatus();
      }, intervalMs);
    } catch (err) {
      setStatus("Error");
      setErrorMsg(err instanceof Error ? err.message : "Failed to reach Melange server");
    }
  };

  createEffect(() => {
    const acct = melangeState().youtube_account;
    if (acct?.signed_in && status() === "Pending") {
      completeSuccess();
    }
  });

  onMount(() => {
    requestAnimationFrame(() => {
      setFocus("yt-login-cancel", false);
      ensureValidFocus("yt-login-cancel");
    });

    const unsubBack = registerBackHandler(() => {
      closed = true;
      stopPolling();
      props.onClose();
      return true;
    });

    void startAuth();

    onCleanup(() => {
      closed = true;
      stopPolling();
      unsubBack();
    });
  });

  const activeProfileName = () => melangeState().active_profile?.name ?? "Default";

  return (
    <GlassPanel
      variant="scrim"
      class="fixed inset-0 z-50 flex items-center justify-center px-8"
      onClick={() => props.onClose()}
    >
      <GlassPanel
        variant="heavy"
        class="relative w-full max-w-2xl rounded-[24px] p-8 text-white"
        onClick={(e: MouseEvent) => e.stopPropagation()}
      >
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="flex items-center gap-2 text-[12px] font-semibold text-white/75">
              <span class="h-2 w-2 rounded-full bg-[#DC2626]" />
              <span>YouTube TV · Profile: {activeProfileName()}</span>
            </div>
            <h2 class="view-title mt-1.5 text-[26px]">Sign in with your phone</h2>
            <p class="mt-1.5 max-w-[46ch] text-[13px] font-medium leading-relaxed text-white/75">
              Link your YouTube account for personalized For You picks, Subscriptions, and Watch
              History.
            </p>
          </div>

          <HapticTile
            id="yt-login-cancel"
            variant="pill"
            radius="9999px"
            neighbors={{
              left: errorMsg() ? "yt-login-retry" : "none",
              right: "none",
              down: errorMsg() ? "yt-login-retry" : "none"
            }}
            onSelect={() => {
              closed = true;
              stopPolling();
              props.onClose();
            }}
            class="shrink-0"
          >
            ← Cancel
          </HapticTile>
        </div>

        <Show
          when={authData()}
          fallback={
            <div class="mt-7 flex flex-col items-center justify-center gap-4 rounded-[20px] border border-white/[0.08] bg-white/[0.03] px-6 py-12">
              <Show
                when={errorMsg()}
                fallback={
                  <>
                    <div class="h-8 w-8 animate-spin rounded-full border-2 border-white/25 border-t-white" />
                    <div class="text-[14px] font-medium text-white/80">
                      Requesting TV activation code…
                    </div>
                  </>
                }
              >
                {(err) => (
                  <>
                    <div class="text-[15px] font-semibold text-white">
                      Could not start YouTube sign-in
                    </div>
                    <div class="max-w-[44ch] text-center text-[13px] text-white/70">{err()}</div>
                    <HapticTile
                      id="yt-login-retry"
                      variant="pill"
                      radius="9999px"
                      active={true}
                      onSelect={() => void startAuth()}
                      class="mt-1"
                    >
                      Try again
                    </HapticTile>
                  </>
                )}
              </Show>
            </div>
          }
        >
          {(data) => (
            <div class="mt-7 flex flex-col items-center gap-7 rounded-[20px] border border-white/[0.1] bg-white/[0.04] p-6 sm:flex-row sm:items-center">
              <div class="shrink-0 rounded-[18px] bg-white p-3 shadow-lg [&_svg]:block [&_svg]:h-44 [&_svg]:w-44">
                <div innerHTML={data().qr_svg} />
              </div>

              <div class="flex min-w-0 flex-1 flex-col gap-4">
                <div>
                  <div class="text-[12px] font-semibold uppercase tracking-wider text-white/60">
                    1. Open on phone or computer
                  </div>
                  <div class="mt-1 font-mono text-[15px] font-semibold text-white">
                    {data().verification_url}
                  </div>
                </div>

                <div>
                  <div class="text-[12px] font-semibold uppercase tracking-wider text-white/60">
                    2. Enter this activation code
                  </div>
                  <div class="mt-1.5 inline-flex items-center rounded-[14px] border border-white/15 bg-black/40 px-4 py-2 font-mono text-3xl font-bold tracking-[0.16em] tabular-nums text-white">
                    {data().user_code}
                  </div>
                </div>

                <Show
                  when={errorMsg()}
                  fallback={
                    <div class="flex items-center gap-2.5 text-[13px] font-medium text-white/85">
                      <span class="h-2.5 w-2.5 animate-pulse rounded-full bg-[#22C55E]" />
                      <span>Waiting for confirmation on your phone…</span>
                    </div>
                  }
                >
                  {(err) => (
                    <div class="flex flex-wrap items-center gap-3">
                      <span class="text-[13px] font-medium text-amber-300">{err()}</span>
                      <HapticTile
                        id="yt-login-retry"
                        variant="pill"
                        radius="9999px"
                        active={true}
                        neighbors={{ up: "yt-login-cancel", right: "yt-login-cancel" }}
                        onSelect={() => void startAuth()}
                      >
                        New code
                      </HapticTile>
                    </div>
                  )}
                </Show>
              </div>
            </div>
          )}
        </Show>
      </GlassPanel>
    </GlassPanel>
  );
}
