import { Show } from "solid-js";
import { isFocused } from "../../spatial/nav";

export type SquircleApp =
  | "LiveTv"
  | "FullEpg"
  | "Mediathek"
  | "YouTube"
  | "Media"
  | "Settings";

export interface SquircleIconProps {
  app: SquircleApp;
  label: string;
  focusId: string;
  active?: boolean;
}

const APP_STYLES: Record<SquircleApp, { background: string }> = {
  LiveTv: {
    background: "linear-gradient(160deg, #2D3342 0%, #171A23 100%)"
  },
  FullEpg: {
    background: "linear-gradient(160deg, #25364E 0%, #151F2F 100%)"
  },
  Mediathek: {
    background: "linear-gradient(160deg, #257CFF 0%, #0D52C7 100%)"
  },
  YouTube: {
    background: "linear-gradient(160deg, #F02232 0%, #BD0B1B 100%)"
  },
  Media: {
    background: "linear-gradient(160deg, #6866EE 0%, #4643C7 100%)"
  },
  Settings: {
    background: "linear-gradient(160deg, #3A3F4B 0%, #22262E 100%)"
  }
};

function AppGlyph(props: { app: SquircleApp }) {
  switch (props.app) {
    case "LiveTv":
      return (
        <svg
          class="h-[22px] w-[22px] text-white"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.85"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="2.5" y="5.5" width="19" height="13" rx="3" />
          <path d="M8 21h8" />
          <circle cx="12" cy="12" r="2.5" fill="#EF4444" stroke="none" />
        </svg>
      );
    case "FullEpg":
      return (
        <svg
          class="h-[22px] w-[22px] text-white"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.85"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="3" y="4.5" width="18" height="15" rx="3" />
          <path d="M7.5 9.5h9M7.5 13h6M7.5 16.5h4" />
        </svg>
      );
    case "Mediathek":
      return (
        <svg
          class="h-[22px] w-[22px] text-white"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.85"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="3.5" y="4.5" width="17" height="15" rx="3.5" />
          <polygon points="10.2,8.8 16,12 10.2,15.2" fill="currentColor" stroke="none" />
        </svg>
      );
    case "YouTube":
      return (
        <svg class="h-6 w-8" viewBox="0 0 36 26" fill="none">
          <rect x="2" y="2" width="32" height="22" rx="6.5" fill="#FFFFFF" />
          <polygon points="15,8.5 24,13 15,17.5" fill="#E11929" />
        </svg>
      );
    case "Media":
      return (
        <svg
          class="h-[22px] w-[22px] text-white"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.85"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M3.5 7.5a2.2 2.2 0 0 1 2.2-2.2h4l2 2h6.6a2.2 2.2 0 0 1 2.2 2.2v7.3a2.2 2.2 0 0 1-2.2 2.2H5.7a2.2 2.2 0 0 1-2.2-2.2V7.5Z" />
          <polygon points="10.5,10.8 15.2,13.4 10.5,16" fill="currentColor" stroke="none" />
        </svg>
      );
    case "Settings":
      return (
        <svg
          class="h-[22px] w-[22px] text-white"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      );
  }
}

export function SquircleIcon(props: SquircleIconProps) {
  const focused = () => isFocused(props.focusId);
  const spec = () => APP_STYLES[props.app];

  return (
    <div class="relative h-full w-full">
      {/* Floating label pill above the focused tile ONLY (couch-tv ultra-minimal dock) */}
      <span
        class={`pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/[0.14] bg-[#12141A]/90 px-3 py-1 text-[12px] font-semibold tracking-[-0.01em] text-white shadow-[0_10px_24px_rgba(0,0,0,0.5)] backdrop-blur-2xl transition-all duration-150 ${
          focused() ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
        }`}
      >
        {props.label}
      </span>

      {/* Full-bleed 82x50 brand app tile */}
      <div
        class="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[11px]"
        style={{
          background: spec().background,
          "box-shadow": "inset 0 1px 0 rgba(255, 255, 255, 0.2)"
        }}
      >
        <AppGlyph app={props.app} />
        <Show when={props.active}>
          <span class=" absolute bottom-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-white/90" />
        </Show>
      </div>
    </div>
  );
}
