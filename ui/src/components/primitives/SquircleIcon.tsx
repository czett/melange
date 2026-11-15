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
  LiveTv: "#181B22",
  FullEpg: "#1E2430",
  Mediathek: "#0284C7",
  YouTube: "#DC2626",
  Media: "#4F46E5",
  Settings: "#262932"
};

function AppGlyph(props: { app: SquircleApp }) {
  switch (props.app) {
    case "LiveTv":
      return (
        <svg
          class="h-[26px] w-[26px] text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.22)]"
          viewBox="0 0 24 24"
          fill="currentColor"
          fill-rule="evenodd"
        >
          {/* Solid rounded widescreen display with bold play cutout + solid base */}
          <path d="M5.6 4h12.8A2.6 2.6 0 0 1 21 6.6v7.8a2.6 2.6 0 0 1-2.6 2.6H5.6A2.6 2.6 0 0 1 3 14.4V6.6A2.6 2.6 0 0 1 5.6 4Zm4.6 3.7a.55.55 0 0 0-.84.47v4.66a.55.55 0 0 0 .84.47l3.9-2.33a.55.55 0 0 0 0-.94l-3.9-2.33Z" />
          <rect x="7.5" y="18.4" width="9" height="2.1" rx="1.05" />
        </svg>
      );

    case "FullEpg":
      return (
        <svg
          class="h-6 w-6 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.22)]"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          {/* Bold filled 3-row EPG schedule grid */}
          <rect x="3" y="4.5" width="5" height="3.8" rx="1.4" />
          <rect x="9.5" y="4.5" width="11.5" height="3.8" rx="1.4" />
          <rect x="3" y="10.1" width="5" height="3.8" rx="1.4" />
          <rect x="9.5" y="10.1" width="6.2" height="3.8" rx="1.4" />
          <rect x="17" y="10.1" width="4" height="3.8" rx="1.4" />
          <rect x="3" y="15.7" width="5" height="3.8" rx="1.4" />
          <rect x="9.5" y="15.7" width="8.5" height="3.8" rx="1.4" />
        </svg>
      );

    case "Mediathek":
      return (
        <svg
          class="h-[25px] w-[25px] text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.22)]"
          viewBox="0 0 24 24"
          fill="currentColor"
          fill-rule="evenodd"
        >
          {/* Bold filled play-prism emblem */}
          <path d="M6.4 4h11.2A3.4 3.4 0 0 1 21 7.4v9.2a3.4 3.4 0 0 1-3.4 3.4H6.4A3.4 3.4 0 0 1 3 16.6V7.4A3.4 3.4 0 0 1 6.4 4Zm3.8 4.4a.65.65 0 0 0-.98.56v6.08a.65.65 0 0 0 .98.56l5.2-3.04a.65.65 0 0 0 0-1.12l-5.2-3.04Z" />
        </svg>
      );

    case "YouTube":
      return (
        <svg
          class="h-[26px] w-[26px] translate-x-[0.5px] text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.22)]"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M7.8 6.15c0-.96 1.05-1.55 1.88-1.05l9.3 5.58a1.22 1.22 0 0 1 0 2.1l-9.3 5.58c-.83.5-1.88-.09-1.88-1.05V6.15Z" />
        </svg>
      );

    case "Media":
      return (
        <svg
          class="h-[25px] w-[25px] text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.22)]"
          viewBox="0 0 24 24"
          fill="currentColor"
          fill-rule="evenodd"
        >
          {/* Bold filled filmstrip frame with sprocket cutouts and center play emblem */}
          <path d="M5.6 4.2h12.8A2.6 2.6 0 0 1 21 6.8v10.4a2.6 2.6 0 0 1-2.6 2.6H5.6A2.6 2.6 0 0 1 3 17.2V6.8a2.6 2.6 0 0 1 2.6-2.6Zm-.9 2.7v2.1h2V6.9h-2Zm0 4.05v2.1h2v-2.1h-2Zm0 4.05v2.1h2V15h-2Zm12.6-8.1v2.1h2V6.9h-2Zm0 4.05v2.1h2v-2.1h-2Zm0 4.05v2.1h2V15h-2ZM9.4 7.4a1.2 1.2 0 0 0-1.2 1.2v6.8a1.2 1.2 0 0 0 1.2 1.2h5.2a1.2 1.2 0 0 0 1.2-1.2V8.6a1.2 1.2 0 0 0-1.2-1.2H9.4Zm1.4 2.45a.45.45 0 0 1 .68-.39l2.9 1.74a.45.45 0 0 1 0 .78l-2.9 1.74a.45.45 0 0 1-.68-.39V9.85Z" />
        </svg>
      );

    case "Settings":
      return (
        <svg
          class="h-6 w-6 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.24)]"
          viewBox="0 0 24 24"
          fill="currentColor"
          fill-rule="evenodd"
        >
          <path d="M 19.03 10.43 L 21.61 10.71 Q 22.05 12.00 21.61 13.29 L 19.03 13.57 Q 18.51 14.70 18.08 15.86 L 19.71 17.88 Q 19.11 19.11 17.88 19.71 L 15.86 18.08 Q 14.70 18.51 13.57 19.03 L 13.29 21.61 Q 12.00 22.05 10.71 21.61 L 10.43 19.03 Q 9.30 18.51 8.14 18.08 L 6.12 19.71 Q 4.89 19.11 4.29 17.88 L 5.92 15.86 Q 5.49 14.70 4.97 13.57 L 2.39 13.29 Q 1.95 12.00 2.39 10.71 L 4.97 10.43 Q 5.49 9.30 5.92 8.14 L 4.29 6.12 Q 4.89 4.89 6.12 4.29 L 8.14 5.92 Q 9.30 5.49 10.43 4.97 L 10.71 2.39 Q 12.00 1.95 13.29 2.39 L 13.57 4.97 Q 14.70 5.49 15.86 5.92 L 17.88 4.29 Q 19.11 4.89 19.71 6.12 L 18.08 8.14 Q 18.51 9.30 19.03 10.43 Z M 15.30 12.00 A 3.3 3.3 0 1 0 8.70 12.00 A 3.3 3.3 0 1 0 15.30 12.00 Z" />
        </svg>
      );
  }
}

export function SquircleIcon(props: SquircleIconProps) {
  return (
    <div
      class="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[14px]"
      style={{ background: APP_BACKGROUNDS[props.app] }}
    >
      <AppGlyph app={props.app} />

      <Show when={props.active}>
        <span class="absolute bottom-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-white/95" />
      </Show>
    </div>
  );
}
