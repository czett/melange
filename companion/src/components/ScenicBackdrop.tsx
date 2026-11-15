import { onCleanup, onMount, type JSX } from 'solid-js';

export interface ScenicBackdropProps {
  class?: string;
  style?: JSX.CSSProperties;
}

/**
 * Mobile-proportioned nocturnal alpine twilight horizon backdrop for the Companion app.
 * Matches the desktop couch-tv × Apple tvOS dark smoke-glass aesthetic with zero fluted stripes.
 */
function renderTwilightSky(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  if (w <= 0 || h <= 0) return;

  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.82);
  sky.addColorStop(0.0, '#0B0E14');
  sky.addColorStop(0.3, '#101722');
  sky.addColorStop(0.52, '#16202C');
  sky.addColorStop(0.7, '#212230');
  sky.addColorStop(0.86, '#2B2126');
  sky.addColorStop(1.0, '#16141A');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.translate(w * 0.52, h * 0.62);
  ctx.scale(1.2, 0.42);
  const rWarm = Math.max(w, h) * 0.45;
  const warmGlow = ctx.createRadialGradient(0, 0, 0, 0, 0, rWarm);
  warmGlow.addColorStop(0, 'rgba(64, 42, 48, 0.44)');
  warmGlow.addColorStop(0.5, 'rgba(43, 33, 38, 0.22)');
  warmGlow.addColorStop(1, 'rgba(11, 14, 20, 0)');
  ctx.fillStyle = warmGlow;
  ctx.beginPath();
  ctx.arc(0, 0, rWarm, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const tileSize = 128;
  const grainCanvas = document.createElement('canvas');
  grainCanvas.width = tileSize;
  grainCanvas.height = tileSize;
  const gCtx = grainCanvas.getContext('2d');
  if (gCtx) {
    const img = gCtx.createImageData(tileSize, tileSize);
    const data = img.data;
    let seed = 7331;
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
    const pattern = ctx.createPattern(grainCanvas, 'repeat');
    if (pattern) {
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w, h);
    }
  }
}

export function ScenicBackdrop(props: ScenicBackdropProps) {
  let canvasRef!: HTMLCanvasElement;

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
    <div class={`scenic-backdrop ${props.class ?? ''}`} style={props.style} aria-hidden="true">
      <canvas ref={canvasRef} class="block h-full w-full" />

      <svg
        class="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 800 1200"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="comp-ridge-distant" x1="0" y1="680" x2="0" y2="960" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#19212D" stop-opacity="0.92" />
            <stop offset="100%" stop-color="#10151F" stop-opacity="0.98" />
          </linearGradient>
          <linearGradient id="comp-ridge-fore" x1="0" y1="760" x2="0" y2="1200" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#0D1119" />
            <stop offset="60%" stop-color="#080B10" />
            <stop offset="100%" stop-color="#06080C" />
          </linearGradient>
        </defs>

        <path
          d="M0,740 L110,695 L235,725 L365,678 L490,716 L635,672 L800,710 L800,1200 L0,1200 Z"
          fill="url(#comp-ridge-distant)"
        />
        <path
          d="M0,805 L165,772 L320,796 L485,758 L650,788 L800,766 L800,1200 L0,1200 Z"
          fill="url(#comp-ridge-fore)"
        />
      </svg>

      <div
        class="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, rgba(8,10,15,0.22) 0%, rgba(8,10,15,0.06) 45%, rgba(6,8,12,0.88) 100%)',
        }}
      />
    </div>
  );
}
