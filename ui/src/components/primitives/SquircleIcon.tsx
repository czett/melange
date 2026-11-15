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

const APP_STYLES: Record<SquircleApp, { background: string; gloss: string }> = {
  LiveTv: {
    background: "linear-gradient(165deg, #FF453A 0%, #DC2626 52%, #B91C1C 100%)",
    gloss:
      "radial-gradient(110% 70% at 50% -10%, rgba(255,255,255,0.48) 0%, rgba(255,255,255,0.12) 48%, rgba(255,255,255,0) 68%)"
  },
  FullEpg: {
    background: "linear-gradient(165deg, #38BDF8 0%, #2563EB 54%, #1D4ED8 100%)",
    gloss:
      "radial-gradient(110% 70% at 50% -10%, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.14) 48%, rgba(255,255,255,0) 68%)"
  },
  Mediathek: {
    background: "linear-gradient(165deg, #22D3EE 0%, #0A84FF 46%, #0040DD 100%)",
    gloss:
      "radial-gradient(110% 70% at 50% -10%, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.14) 48%, rgba(255,255,255,0) 68%)"
  },
  YouTube: {
    background: "linear-gradient(165deg, #FF2447 0%, #FF0033 48%, #C40024 100%)",
    gloss:
      "radial-gradient(110% 70% at 50% -10%, rgba(255,255,255,0.46) 0%, rgba(255,255,255,0.12) 48%, rgba(255,255,255,0) 68%)"
  },
  Media: {
    background: "linear-gradient(155deg, #FF9F0A 0%, #FF5E3A 48%, #FF375F 100%)",
    gloss:
      "radial-gradient(110% 70% at 50% -10%, rgba(255,255,255,0.48) 0%, rgba(255,255,255,0.13) 48%, rgba(255,255,255,0) 68%)"
  },
  Settings: {
    background: "linear-gradient(165deg, #7C7C82 0%, #4E4E52 46%, #2C2C2E 100%)",
    gloss:
      "radial-gradient(110% 70% at 50% -10%, rgba(255,255,255,0.42) 0%, rgba(255,255,255,0.1) 48%, rgba(255,255,255,0) 68%)"
  }
};

function AppGlyph(props: { app: SquircleApp }) {
  switch (props.app) {
    case "LiveTv":
      return (
        <svg class="h-8 w-8 drop-shadow-[0_3px_6px_rgba(0,0,0,0.36)]" viewBox="0 0 36 36" fill="none">
          <defs>
            <linearGradient id="ws-livetv-body" x1="18" y1="7" x2="18" y2="27" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#FFFFFF" />
              <stop offset="65%" stop-color="#F1F5F9" />
              <stop offset="100%" stop-color="#CBD5E1" />
            </linearGradient>
            <linearGradient id="ws-livetv-screen" x1="8" y1="10" x2="26" y2="24" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#1E2534" />
              <stop offset="100%" stop-color="#0B0E14" />
            </linearGradient>
            <linearGradient id="ws-livetv-gloss" x1="7" y1="10" x2="21" y2="22" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.34" />
              <stop offset="55%" stop-color="#FFFFFF" stop-opacity="0.06" />
              <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0" />
            </linearGradient>
          </defs>
          {/* Retro-modern antenna arcs */}
          <path d="M14 5.5L18 9.2L22 5.5" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" opacity="0.92" />
          {/* Glossy silver/white TV housing */}
          <rect x="4.5" y="9" width="27" height="18.5" rx="5.2" fill="url(#ws-livetv-body)" />
          {/* Inner recessed OLED screen */}
          <rect x="7.2" y="11.5" width="18.5" height="13.5" rx="2.8" fill="url(#ws-livetv-screen)" />
          {/* Screen glass diagonal reflection */}
          <path d="M7.2 14.3C7.2 12.75 8.45 11.5 10 11.5H20.5L11.2 25H10C8.45 25 7.2 23.75 7.2 22.2V14.3Z" fill="url(#ws-livetv-gloss)" />
          {/* Broadcast live indicator dot & dial */}
          <circle cx="28.3" cy="14.6" r="1.45" fill="#FF3B30" />
          <circle cx="28.3" cy="19.2" r="1.15" fill="#64748B" />
          <circle cx="28.3" cy="22.8" r="1.15" fill="#94A3B8" />
          {/* Sculpted stand bar */}
          <rect x="11.5" y="29" width="13" height="2.3" rx="1.15" fill="#FFFFFF" opacity="0.92" />
        </svg>
      );

    case "FullEpg":
      return (
        <svg class="h-8 w-8 drop-shadow-[0_3px_6px_rgba(0,0,0,0.34)]" viewBox="0 0 36 36" fill="none">
          <defs>
            <linearGradient id="ws-epg-card" x1="18" y1="6" x2="18" y2="30" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.98" />
              <stop offset="100%" stop-color="#DCEAFE" stop-opacity="0.9" />
            </linearGradient>
            <linearGradient id="ws-epg-bar-active" x1="9" y1="13" x2="25" y2="13" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#0284C7" />
              <stop offset="100%" stop-color="#2563EB" />
            </linearGradient>
          </defs>
          {/* Back layered frosted card */}
          <rect x="7" y="6.5" width="22" height="20" rx="4.2" fill="#FFFFFF" fill-opacity="0.34" />
          {/* Main pearl-glass schedule card */}
          <rect x="5.5" y="9" width="25" height="19.5" rx="4.5" fill="url(#ws-epg-card)" />
          {/* Top header bar */}
          <rect x="8.5" y="12.2" width="12.5" height="3.2" rx="1.6" fill="url(#ws-epg-bar-active)" />
          {/* Live indicator dot with soft halo */}
          <circle cx="25.5" cy="13.8" r="3" fill="#FF3B30" fill-opacity="0.22" />
          <circle cx="25.5" cy="13.8" r="1.7" fill="#FF3B30" />
          {/* Crisp schedule timeline bars */}
          <rect x="8.5" y="18" width="19" height="2.8" rx="1.4" fill="#1D4ED8" fill-opacity="0.28" />
          <rect x="8.5" y="18" width="9.5" height="2.8" rx="1.4" fill="#2563EB" fill-opacity="0.72" />
          <rect x="8.5" y="23" width="15" height="2.8" rx="1.4" fill="#1D4ED8" fill-opacity="0.24" />
          <rect x="19" y="23" width="8.5" height="2.8" rx="1.4" fill="#38BDF8" fill-opacity="0.65" />
        </svg>
      );

    case "Mediathek":
      return (
        <svg class="h-8 w-8 drop-shadow-[0_3px_6px_rgba(0,0,0,0.34)]" viewBox="0 0 36 36" fill="none">
          <defs>
            <linearGradient id="ws-med-prism-back" x1="10" y1="8" x2="28" y2="28" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#E0F2FE" stop-opacity="0.58" />
              <stop offset="100%" stop-color="#7DD3FC" stop-opacity="0.22" />
            </linearGradient>
            <linearGradient id="ws-med-prism-front" x1="12" y1="7" x2="26" y2="27" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#FFFFFF" />
              <stop offset="65%" stop-color="#F0F9FF" />
              <stop offset="100%" stop-color="#BAE6FD" />
            </linearGradient>
          </defs>
          {/* Ambient glass prism halo */}
          <circle cx="18" cy="18" r="12" fill="#FFFFFF" fill-opacity="0.14" stroke="#FFFFFF" stroke-opacity="0.32" stroke-width="1" />
          {/* Secondary 3D refracted prism layer */}
          <path
            d="M15.2 10.6C14 9.9 12.5 10.76 12.5 12.15V23.85C12.5 25.24 14 26.1 15.2 25.4L25.4 19.55C26.6 18.86 26.6 17.14 25.4 16.45L15.2 10.6Z"
            fill="url(#ws-med-prism-back)"
            transform="translate(2.1, 1.2)"
          />
          {/* Foreground glossy 3D play-prism */}
          <path
            d="M14.2 10.5C13 9.8 11.5 10.66 11.5 12.05V23.95C11.5 25.34 13 26.2 14.2 25.5L24.6 19.55C25.8 18.86 25.8 17.14 24.6 16.45L14.2 10.5Z"
            fill="url(#ws-med-prism-front)"
          />
          {/* Top specular facet edge */}
          <path
            d="M12.2 12.2C12.2 11.45 13 10.98 13.65 11.35L23.2 16.8"
            stroke="#FFFFFF"
            stroke-width="1"
            stroke-linecap="round"
            opacity="0.85"
          />
        </svg>
      );

    case "YouTube":
      return (
        <svg class="h-8 w-10 drop-shadow-[0_3px_6px_rgba(0,0,0,0.34)]" viewBox="0 0 42 32" fill="none">
          <defs>
            <linearGradient id="ws-yt-pill" x1="21" y1="4" x2="21" y2="28" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#FFFFFF" />
              <stop offset="100%" stop-color="#F1F5F9" />
            </linearGradient>
            <linearGradient id="ws-yt-tri" x1="18" y1="11" x2="25" y2="21" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#FF0033" />
              <stop offset="100%" stop-color="#B80022" />
            </linearGradient>
          </defs>
          {/* Elevated glossy white rounded YouTube badge */}
          <rect x="4" y="4.5" width="34" height="23" rx="7.5" fill="url(#ws-yt-pill)" />
          {/* Crisp inner crimson play triangle */}
          <path
            d="M18 11.5C18 10.88 18.68 10.5 19.2 10.82L26.5 15.32C27 15.63 27 16.37 26.5 16.68L19.2 21.18C18.68 21.5 18 21.12 18 20.5V11.5Z"
            fill="url(#ws-yt-tri)"
          />
        </svg>
      );

    case "Media":
      return (
        <svg class="h-8 w-8 drop-shadow-[0_3px_6px_rgba(0,0,0,0.34)]" viewBox="0 0 36 36" fill="none">
          <defs>
            <linearGradient id="ws-media-tab" x1="14" y1="6" x2="14" y2="16" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.88" />
              <stop offset="100%" stop-color="#FFE4D6" stop-opacity="0.65" />
            </linearGradient>
            <linearGradient id="ws-media-front" x1="18" y1="10" x2="18" y2="29" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#FFFFFF" />
              <stop offset="100%" stop-color="#FDE8E8" />
            </linearGradient>
          </defs>
          {/* Folder back tab */}
          <path
            d="M5.5 10.5C5.5 8.84 6.84 7.5 8.5 7.5H13.8C14.65 7.5 15.46 7.86 16.03 8.49L17.4 10H27.5C29.16 10 30.5 11.34 30.5 13V24.5C30.5 26.16 29.16 27.5 27.5 27.5H8.5C6.84 27.5 5.5 26.16 5.5 24.5V10.5Z"
            fill="url(#ws-media-tab)"
          />
          {/* Front glossy filmstrip/media body */}
          <rect x="5.5" y="11.8" width="25" height="16.5" rx="4.2" fill="url(#ws-media-front)" />
          {/* Filmstrip sprockets */}
          <rect x="8" y="14.2" width="2.2" height="2" rx="0.6" fill="#FF375F" fill-opacity="0.55" />
          <rect x="8" y="19" width="2.2" height="2" rx="0.6" fill="#FF375F" fill-opacity="0.55" />
          <rect x="8" y="23.8" width="2.2" height="2" rx="0.6" fill="#FF375F" fill-opacity="0.55" />
          <rect x="25.8" y="14.2" width="2.2" height="2" rx="0.6" fill="#FF375F" fill-opacity="0.55" />
          <rect x="25.8" y="19" width="2.2" height="2" rx="0.6" fill="#FF375F" fill-opacity="0.55" />
          <rect x="25.8" y="23.8" width="2.2" height="2" rx="0.6" fill="#FF375F" fill-opacity="0.55" />
          {/* Center play emblem */}
          <circle cx="18" cy="20" r="5.2" fill="#FF375F" fill-opacity="0.14" />
          <path
            d="M16 16.8C16 16.25 16.6 15.9 17.08 16.18L22.1 19.18C22.58 19.46 22.58 20.14 22.1 20.42L17.08 23.42C16.6 23.7 16 23.35 16 22.8V16.8Z"
            fill="#FF375F"
          />
        </svg>
      );

    case "Settings":
      return (
        <svg class="h-8 w-8 drop-shadow-[0_3px_6px_rgba(0,0,0,0.42)]" viewBox="0 0 36 36" fill="none">
          <defs>
            <linearGradient id="ws-gear-metal" x1="18" y1="4" x2="18" y2="32" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#FFFFFF" />
              <stop offset="48%" stop-color="#D4D4D8" />
              <stop offset="100%" stop-color="#8E8E93" />
            </linearGradient>
            <linearGradient id="ws-gear-core" x1="18" y1="10" x2="18" y2="26" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#3A3A3C" />
              <stop offset="100%" stop-color="#1C1C1E" />
            </linearGradient>
          </defs>
          {/* Outer mechanical 8-tooth precision gear */}
          <path
            d="M16.1 4.6C16.3 3.9 16.95 3.5 17.65 3.5H18.35C19.05 3.5 19.7 3.9 19.9 4.6L20.5 6.8C21.35 7.02 22.15 7.36 22.88 7.8L24.85 6.65C25.45 6.3 26.22 6.4 26.71 6.89L27.21 7.39C27.7 7.88 27.8 8.65 27.45 9.25L26.3 11.22C26.74 11.95 27.08 12.75 27.3 13.6L29.5 14.2C30.2 14.4 30.6 15.05 30.6 15.75V16.45C30.6 17.15 30.2 17.8 29.5 18L27.3 18.6C27.08 19.45 26.74 20.25 26.3 20.98L27.45 22.95C27.8 23.55 27.7 24.32 27.21 24.81L26.71 25.31C26.22 25.8 25.45 25.9 24.85 25.55L22.88 24.4C22.15 24.84 21.35 25.18 20.5 25.4L19.9 27.6C19.7 28.3 19.05 28.7 18.35 28.7H17.65C16.95 28.7 16.3 28.3 16.1 27.6L15.5 25.4C14.65 25.18 13.85 24.84 13.12 24.4L11.15 25.55C10.55 25.9 9.78 25.8 9.29 25.31L8.79 24.81C8.3 24.32 8.2 23.55 8.55 22.95L9.7 20.98C9.26 20.25 8.92 19.45 8.7 18.6L6.5 18C5.8 17.8 5.4 17.15 5.4 16.45V15.75C5.4 15.05 5.8 14.4 6.5 14.2L8.7 13.6C8.92 12.75 9.26 11.95 9.7 11.22L8.55 9.25C8.2 8.65 8.3 7.88 8.79 7.39L9.29 6.89C9.78 6.4 10.55 6.3 11.15 6.65L13.12 7.8C13.85 7.36 14.65 7.02 15.5 6.8L16.1 4.6Z"
            transform="translate(0, 1.9)"
            fill="url(#ws-gear-metal)"
          />
          {/* Recessed dark brushed steel race */}
          <circle cx="18" cy="18" r="6.7" fill="url(#ws-gear-core)" stroke="#FFFFFF" stroke-opacity="0.35" stroke-width="0.9" />
          {/* Inner precision collar */}
          <circle cx="18" cy="18" r="3.9" fill="url(#ws-gear-metal)" />
          {/* Center axle bore */}
          <circle cx="18" cy="18" r="1.8" fill="#2C2C2E" />
        </svg>
      );
  }
}

export function SquircleIcon(props: SquircleIconProps) {
  const focused = () => isFocused(props.focusId);
  const spec = () => APP_STYLES[props.app];

  return (
    <div class="relative h-full w-full">
      {/* Floating Liquid Glass label pill above the focused tile */}
      <span
        class={`pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/25 bg-[#10131A]/65 px-3 py-1 text-[12px] font-semibold tracking-[-0.01em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_12px_28px_rgba(0,0,0,0.48)] backdrop-blur-2xl transition-all duration-150 ${
          focused() ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
        }`}
      >
        {props.label}
      </span>

      {/* Full-bleed 82x50 glossy WhiteSur / tvOS app tile */}
      <div
        class="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[11px]"
        style={{
          background: spec().background,
          "box-shadow":
            "inset 0 1px 0.5px rgba(255, 255, 255, 0.48), inset 0 -1px 1px rgba(0, 0, 0, 0.32)"
        }}
      >
        {/* Top WhiteSur specular gloss arc */}
        <div
          class="pointer-events-none absolute inset-0"
          style={{ background: spec().gloss }}
        />

        {/* Specular sheen sweep on hover / focus */}
        <span class="squircle-sheen" />

        <div class="relative z-10 flex items-center justify-center">
          <AppGlyph app={props.app} />
        </div>

        <Show when={props.active}>
          <span class="absolute bottom-1 left-1/2 z-10 h-1 w-1 -translate-x-1/2 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.9)]" />
        </Show>
      </div>
    </div>
  );
}
