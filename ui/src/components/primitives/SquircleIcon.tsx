import { Show } from "solid-js";

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

const APP_BACKGROUNDS: Record<SquircleApp, string> = {
  LiveTv: "#181A20",
  FullEpg: "#1E222B",
  Mediathek: "#0077C8",
  YouTube: "#E62117",
  Media: "#4338CA",
  Settings: "#23262F"
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
          <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" />
          <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5" />
          <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
          <path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5" />
          <path d="M19.1 4.9c3.9 3.9 3.9 10.3 0 14.2" />
        </svg>
      );

    case "FullEpg":
      return (
        <svg
          class="h-[22px] w-[22px] text-white"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="3" y="4.5" width="18" height="15" rx="3" />
          <path d="M7.5 9.5h9M7.5 13h6M7.5 16.5h4" />
        </svg>
      );

    case "Mediathek":
      return (
        <svg class="h-[22px] w-[22px] text-white" viewBox="0 0 24 24" fill="none">
          <rect
            x="3.5"
            y="4.5"
            width="17"
            height="15"
            rx="3.5"
            stroke="currentColor"
            stroke-width="2"
          />
          <polygon points="10.2,8.8 16,12 10.2,15.2" fill="currentColor" />
        </svg>
      );

    case "YouTube":
      return (
        <svg class="h-6 w-6 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8.5 6.8a1 1 0 0 1 1.52-.85l8.4 5.2a1 1 0 0 1 0 1.7l-8.4 5.2A1 1 0 0 1 8.5 17.2V6.8Z" />
        </svg>
      );

    case "Media":
      return (
        <svg
          class="h-[22px] w-[22px] text-white"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
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
  return (
    <div
      class="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.28)]"
      style={{ background: APP_BACKGROUNDS[props.app] }}
    >
      <AppGlyph app={props.app} />

      <Show when={props.active}>
        <span class="absolute bottom-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-white/90" />
      </Show>
    </div>
  );
}
