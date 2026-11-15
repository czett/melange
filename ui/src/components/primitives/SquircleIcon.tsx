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

const APP_STYLES: Record<SquircleApp, { gradient: string; accent?: boolean }> = {
  LiveTv: {
    gradient: "linear-gradient(145deg, #E13A26 0%, #831613 68%, #2B0505 100%)",
    accent: true
  },
  FullEpg: {
    gradient: "linear-gradient(145deg, #9E1E19 0%, #520C0A 65%, #1D0304 100%)"
  },
  Mediathek: {
    gradient: "linear-gradient(145deg, #B5281C 0%, #65100E 65%, #240405 100%)"
  },
  YouTube: {
    gradient: "linear-gradient(145deg, #E13A26 0%, #6D110F 65%, #220404 100%)"
  },
  Media: {
    gradient: "linear-gradient(145deg, #6E1514 0%, #370808 65%, #160203 100%)"
  },
  Settings: {
    gradient: "linear-gradient(145deg, #4B1011 0%, #240607 65%, #110203 100%)"
  }
};

function AppGlyph(props: { app: SquircleApp }) {
  switch (props.app) {
    case "LiveTv":
      return (
        <svg
          class="h-6 w-6 text-white"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="2.5" y="6" width="19" height="13" rx="3" />
          <path d="M8.5 2.5 12 6l3.5-3.5" />
          <circle cx="12" cy="12.5" r="2" fill="currentColor" stroke="none" />
        </svg>
      );
    case "FullEpg":
      return (
        <svg
          class="h-6 w-6 text-white"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <path d="M8 9h8M8 13h5M8 17h3" />
        </svg>
      );
    case "Mediathek":
      return (
        <svg
          class="h-6 w-6 text-white"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M4 19V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14" />
          <path d="M9 17V7l7 5-7 5Z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "YouTube":
      return (
        <svg
          class="h-6 w-6 text-white"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
          <polygon points="10,9 16,12 10,15" fill="currentColor" stroke="none" />
        </svg>
      );
    case "Media":
      return (
        <svg
          class="h-6 w-6 text-white"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
          <path d="M10.5 11.5 15 14l-4.5 2.5v-5Z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "Settings":
      return (
        <svg
          class="h-6 w-6 text-white"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
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
    <div class="flex flex-col items-center gap-1.5 px-1 py-0.5">
      <div
        class="relative flex h-[50px] w-[66px] items-center justify-center rounded-[16px] border border-white/[0.18]"
        style={{
          background: spec().gradient,
          "box-shadow":
            "inset 0 1px 0 rgba(255, 255, 255, 0.28), 0 10px 24px rgba(0, 0, 0, 0.48)"
        }}
      >
        <AppGlyph app={props.app} />
        <Show when={props.active || spec().accent}>
          <span
            class={`absolute right-2 top-2 h-1.5 w-1.5 rounded-full ${
              props.active ? "bg-[#FEED65]" : "bg-white/60"
            }`}
          />
        </Show>
      </div>
      <span
        class={`text-[11px] font-semibold leading-none tracking-[-0.01em] transition-colors duration-150 ${
          focused() || props.active ? "text-white" : "text-white/[0.74]"
        }`}
      >
        {props.label}
      </span>
    </div>
  );
}
