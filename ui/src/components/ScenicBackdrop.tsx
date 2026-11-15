import { Show, createEffect, createSignal, onCleanup, onMount, type JSX } from "solid-js";

export interface ScenicBackdropProps {
  class?: string;
  style?: JSX.CSSProperties;
  active?: boolean;
  wallpaperUrl?: string | null;
}

/**
 * High-craft nocturnal alpine twilight horizon backdrop inspired by couch-tv & Apple tvOS.
 *
 * Combines:
 *  1. A HiDPI Canvas 2D sky & atmospheric scattering layer (#0B0E14 zenith -> #16202C
 *     dusk indigo/teal -> #2B2126 warm horizon ember) with static filmic grain dithering
 *     to eliminate 8-bit HDMI/panel color banding without any continuous GPU spin.
 *  2. Crisp vector alpine mountain & foothills ridge silhouettes with subtle valley mist
 *     and a soft bottom readability vignette so white UI typography and dark smoke-glass
 *     tiles always maintain effortless contrast.
 *  3. Optional full-bleed custom profile wallpaper with a clean readability scrim.
 */
function renderTwilightSky(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  if (w <= 0 || h <= 0) return;

  // 1. Vertical nocturnal alpine twilight sky gradient
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.78);
  sky.addColorStop(0.0, "#0B0E14"); // Deep midnight slate zenith
  sky.addColorStop(0.28, "#101722"); // Upper nocturnal slate
  sky.addColorStop(0.5, "#16202C"); // Moody dusk indigo/teal
  sky.addColorStop(0.68, "#212230"); // Twilight dusk transition
  sky.addColorStop(0.84, "#2B2126"); // Warm horizon ember
  sky.addColorStop(1.0, "#18151B"); // Sub-horizon base
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // 2. Cool upper-west alpine twilight airglow (#16202C / #1B2A3A)
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.translate(w * 0.28, h * 0.38);
  ctx.scale(1.0, 0.52);
  const rCool = Math.max(w, h) * 0.52;
  const coolGlow = ctx.createRadialGradient(0, 0, 0, 0, 0, rCool);
  coolGlow.addColorStop(0, "rgba(28, 46, 66, 0.34)");
  coolGlow.addColorStop(0.55, "rgba(22, 32, 44, 0.14)");
  coolGlow.addColorStop(1, "rgba(11, 14, 20, 0)");
  ctx.fillStyle = coolGlow;
  ctx.beginPath();
  ctx.arc(0, 0, rCool, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 3. Restrained warm horizon alpenglow right behind the central mountain saddle
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.translate(w * 0.54, h * 0.63);
  ctx.scale(1.35, 0.34);
  const rWarm = Math.max(w, h) * 0.44;
  const warmGlow = ctx.createRadialGradient(0, 0, 0, 0, 0, rWarm);
  warmGlow.addColorStop(0, "rgba(68, 44, 50, 0.48)");
  warmGlow.addColorStop(0.48, "rgba(43, 33, 38, 0.24)");
  warmGlow.addColorStop(1, "rgba(11, 14, 20, 0)");
  ctx.fillStyle = warmGlow;
  ctx.beginPath();
  ctx.arc(0, 0, rWarm, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 4. Sparse pinpoint zenith stars (deterministic positions, upper sky only)
  for (let i = 0; i < 28; i++) {
    const hx = (((Math.sin(i * 127.1 + 311.7) * 43758.5453) % 1) + 1) % 1;
    const hy = (((Math.sin(i * 269.5 + 183.3) * 43758.5453) % 1) + 1) % 1;
    const ha = (((Math.sin(i * 419.2 + 71.9) * 43758.5453) % 1) + 1) % 1;
    const x = hx * w;
    const y = hy * h * 0.42;
    const fade = 1 - y / (h * 0.44);
    const alpha = (0.07 + ha * 0.16) * fade;
    const radius = ha > 0.82 ? 1.15 : 0.8;
    ctx.fillStyle = `rgba(226, 234, 248, ${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // 5. Subtle filmic grain tile (eliminates 8-bit sky gradient banding on TVs)
  const tileSize = 128;
  const grainCanvas = document.createElement("canvas");
  grainCanvas.width = tileSize;
  grainCanvas.height = tileSize;
  const gCtx = grainCanvas.getContext("2d");
  if (gCtx) {
    const img = gCtx.createImageData(tileSize, tileSize);
    const data = img.data;
    let seed = 1337;
    for (let i = 0; i < data.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const v = (seed >>> 24) & 0xff;
      const isLight = v > 127;
      data[i] = isLight ? 255 : 0;
      data[i + 1] = isLight ? 255 : 0;
      data[i + 2] = isLight ? 255 : 0;
      data[i + 3] = Math.round((Math.abs(v - 127.5) / 127.5) * 7);
    }
    gCtx.putImageData(img, 0, 0);
    const pattern = ctx.createPattern(grainCanvas, "repeat");
    if (pattern) {
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w, h);
    }
  }
}

export function ScenicBackdrop(props: ScenicBackdropProps) {
  let canvasRef!: HTMLCanvasElement;
  const [imgFailed, setImgFailed] = createSignal(false);

  createEffect(() => {
    void props.wallpaperUrl;
    setImgFailed(false);
  });

  const syncAndDraw = () => {
    if (!canvasRef) return;
    const rect = canvasRef.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvasRef.width !== w || canvasRef.height !== h) {
      canvasRef.width = w;
      canvasRef.height = h;
    }
    renderTwilightSky(canvasRef);
  };

  onMount(() => {
    syncAndDraw();
    const ro = new ResizeObserver(() => syncAndDraw());
    ro.observe(canvasRef);
    onCleanup(() => ro.disconnect());
  });

  return (
    <div class={`scenic-backdrop ${props.class ?? ""}`} style={props.style} aria-hidden="true">
      {/* Nocturnal alpine twilight sky + anti-banding atmospheric grain */}
      <canvas ref={canvasRef} class="block h-full w-full" />

      {/* Silhouetted alpine mountain & horizon ridge layers */}
      <svg
        class="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 1920 1080"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="scenic-ridge-distant" x1="0" y1="540" x2="0" y2="820" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#19212D" stop-opacity="0.92" />
            <stop offset="100%" stop-color="#111620" stop-opacity="0.98" />
          </linearGradient>

          <linearGradient id="scenic-valley-mist" x1="0" y1="590" x2="0" y2="760" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#282836" stop-opacity="0.22" />
            <stop offset="100%" stop-color="#0E121A" stop-opacity="0" />
          </linearGradient>

          <linearGradient id="scenic-ridge-mid" x1="0" y1="600" x2="0" y2="900" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#111620" />
            <stop offset="100%" stop-color="#0A0D13" />
          </linearGradient>

          <linearGradient id="scenic-ridge-fore" x1="0" y1="680" x2="0" y2="1080" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#0B0E15" />
            <stop offset="55%" stop-color="#080B10" />
            <stop offset="100%" stop-color="#06080C" />
          </linearGradient>
        </defs>

        {/* Distant high-alpine range */}
        <path
          d="M0,648 L118,618 L224,582 L318,608 L436,558 L548,596 L652,626 L774,590 L886,628 L992,642 L1116,594 L1238,548 L1352,588 L1468,566 L1596,612 L1724,578 L1834,606 L1920,592 L1920,1080 L0,1080 Z"
          fill="url(#scenic-ridge-distant)"
        />
        <path
          d="M0,648 L118,618 L224,582 L318,608 L436,558 L548,596 L652,626 L774,590 L886,628 L992,642 L1116,594 L1238,548 L1352,588 L1468,566 L1596,612 L1724,578 L1834,606 L1920,592"
          fill="none"
          stroke="rgba(225, 206, 204, 0.09)"
          stroke-width="1.2"
        />

        {/* Subtle atmospheric valley haze */}
        <rect x="0" y="590" width="1920" height="180" fill="url(#scenic-valley-mist)" />

        {/* Midground silhouetted alpine ridge (central saddle frames the lockscreen clock) */}
        <path
          d="M0,692 L142,646 L278,614 L394,650 L526,622 L664,666 L798,688 L946,672 L1078,694 L1204,654 L1338,608 L1476,644 L1612,618 L1764,658 L1920,636 L1920,1080 L0,1080 Z"
          fill="url(#scenic-ridge-mid)"
        />
        <path
          d="M0,692 L142,646 L278,614 L394,650 L526,622 L664,666 L798,688 L946,672 L1078,694 L1204,654 L1338,608 L1476,644 L1612,618 L1764,658 L1920,636"
          fill="none"
          stroke="rgba(186, 204, 228, 0.06)"
          stroke-width="1"
        />

        {/* Foreground dark nocturnal foothills */}
        <path
          d="M0,742 L186,718 L364,748 L556,712 L748,744 L968,732 L1164,756 L1378,716 L1582,738 L1768,708 L1920,726 L1920,1080 L0,1080 Z"
          fill="url(#scenic-ridge-fore)"
        />
      </svg>

      {/* Soft perimeter & bottom readability vignette for effortless white tile contrast */}
      <div
        class="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 38%, rgba(11,14,20,0) 42%, rgba(7,9,14,0.46) 100%), linear-gradient(180deg, rgba(8,10,15,0.22) 0%, rgba(8,10,15,0) 28%, rgba(7,9,13,0.45) 70%, rgba(6,8,12,0.88) 100%)"
        }}
      />

      {/* Custom user profile wallpaper (full-bleed with subtle readability scrim) */}
      <Show when={props.wallpaperUrl && !imgFailed()}>
        <div class="pointer-events-none absolute inset-0 overflow-hidden">
          <img
            src={props.wallpaperUrl!}
            alt=""
            class="h-full w-full object-cover"
            onError={() => setImgFailed(true)}
          />
          <div
            class="absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, rgba(8,10,14,0.22) 0%, rgba(8,10,14,0.08) 45%, rgba(8,10,14,0.68) 100%)"
            }}
          />
        </div>
      </Show>
    </div>
  );
}
