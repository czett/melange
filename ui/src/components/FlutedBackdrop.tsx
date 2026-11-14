import { For, createUniqueId, type JSX } from "solid-js";

/**
 * Optical irregular fluted-glass backdrop.
 *
 * Layer 1 — volumetric crimson light field (#3D0706 / #831613 edges, #E13A26 → #F24E38
 *           blooms through the centre-left and bottom-right), warped by an SVG
 *           feTurbulence + feDisplacementMap so the light bends like real reeded glass.
 * Layer 2 — irregular vertical reed lenses (7/13/9/18/11/15/8 px, reshuffled every cycle so
 *           the pattern never tiles), each with a soft specular edge and a deep glass trough.
 *
 * Everything is static SVG (rasterised once); only a soft bloom drifts via transform/opacity.
 */

const REED_WIDTHS = [7, 13, 9, 18, 11, 15, 8] as const;
const VIEW_W = 1920;
const VIEW_H = 1080;

interface Reed {
  x: number;
  w: number;
  opacity: number;
  variant: 0 | 1 | 2;
}

function buildReeds(): Reed[] {
  // Deterministic LCG so the glass looks identical across renders and devices.
  let seed = 0x5eed1e;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const reeds: Reed[] = [];
  let x = 0;
  while (x < VIEW_W) {
    // Fisher–Yates shuffle of the width set per cycle → irregular, never a repeating stripe.
    const cycle: number[] = [...REED_WIDTHS];
    for (let i = cycle.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [cycle[i], cycle[j]] = [cycle[j], cycle[i]];
    }
    for (const w of cycle) {
      if (x >= VIEW_W) break;
      reeds.push({
        x,
        w,
        opacity: 0.8 + rand() * 0.2,
        variant: Math.floor(rand() * 3) as 0 | 1 | 2
      });
      x += w;
    }
  }
  return reeds;
}

const REEDS = buildReeds();

/**
 * Per-reed sawtooth displacement map: red ramps 0 → 255 across every reed (green held at
 * 128 = no vertical shift). Fed to feDisplacementMap, each reed shows its own horizontally
 * compressed slice of the light — the stepped refraction of real fluted glass.
 */
const REED_MAP_URI = (() => {
  const rects = REEDS.map(
    (r) => `<rect x="${r.x}" y="0" width="${r.w}" height="${VIEW_H}" fill="url(#r)"/>`
  ).join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${VIEW_W}" height="${VIEW_H}" viewBox="0 0 ${VIEW_W} ${VIEW_H}" preserveAspectRatio="none">` +
    `<defs><linearGradient id="r" x1="0" y1="0" x2="1" y2="0">` +
    `<stop offset="0" stop-color="rgb(0,128,0)"/><stop offset="1" stop-color="rgb(255,128,0)"/>` +
    `</linearGradient></defs>${rects}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
})();

export interface FlutedBackdropProps {
  class?: string;
  style?: JSX.CSSProperties;
  /** Disable the slow bloom drift (e.g. on low-power devices). */
  still?: boolean;
}

export function FlutedBackdrop(props: FlutedBackdropProps) {
  const uid = createUniqueId();
  const id = (name: string) => `fb-${uid}-${name}`;
  const ref = (name: string) => `url(#${id(name)})`;

  return (
    <div class={`fluted-backdrop ${props.class ?? ""}`} style={props.style} aria-hidden="true">
      {/* Layer 1 — volumetric crimson light field, optically distorted */}
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={id("base")} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#3D0706" />
            <stop offset="0.38" stop-color="#831613" />
            <stop offset="0.68" stop-color="#6E120F" />
            <stop offset="1" stop-color="#3D0706" />
          </linearGradient>
          <radialGradient id={id("bloomA")}>
            <stop offset="0" stop-color="#F24E38" stop-opacity="1" />
            <stop offset="0.32" stop-color="#E13A26" stop-opacity="0.86" />
            <stop offset="0.7" stop-color="#831613" stop-opacity="0.28" />
            <stop offset="1" stop-color="#831613" stop-opacity="0" />
          </radialGradient>
          <radialGradient id={id("bloomB")}>
            <stop offset="0" stop-color="#F24E38" stop-opacity="0.9" />
            <stop offset="0.36" stop-color="#E13A26" stop-opacity="0.7" />
            <stop offset="1" stop-color="#831613" stop-opacity="0" />
          </radialGradient>
          <linearGradient id={id("shaft")} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#F24E38" stop-opacity="0" />
            <stop offset="0.5" stop-color="#F24E38" stop-opacity="0.32" />
            <stop offset="1" stop-color="#F24E38" stop-opacity="0" />
          </linearGradient>
          <radialGradient id={id("edge")} cx="0.45" cy="0.5" r="0.75">
            <stop offset="0.55" stop-color="#3D0706" stop-opacity="0" />
            <stop offset="1" stop-color="#2A0404" stop-opacity="0.85" />
          </radialGradient>
          <filter
            id={id("distort")}
            filterUnits="userSpaceOnUse"
            x="0"
            y="0"
            width={VIEW_W}
            height={VIEW_H}
            color-interpolation-filters="sRGB"
          >
            {/* Low-frequency glass imperfection: gentle organic waviness of the light */}
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.006 0.0011"
              numOctaves="2"
              seed="11"
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="26"
              xChannelSelector="R"
              yChannelSelector="G"
              result="wavy"
            />
            {/* Stepped per-reed lens refraction */}
            <feImage
              href={REED_MAP_URI}
              x="0"
              y="0"
              width={VIEW_W}
              height={VIEW_H}
              preserveAspectRatio="none"
              result="reedMap"
            />
            <feDisplacementMap
              in="wavy"
              in2="reedMap"
              scale="-34"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>

        <g filter={ref("distort")}>
          <rect x="-100" y="-100" width="2120" height="1280" fill={ref("base")} />
          <ellipse
            cx="560"
            cy="600"
            rx="770"
            ry="530"
            fill={ref("bloomA")}
            transform="rotate(-18 560 600)"
          />
          <ellipse
            cx="1580"
            cy="970"
            rx="670"
            ry="430"
            fill={ref("bloomB")}
            transform="rotate(-12 1580 970)"
          />
          <rect
            x="-240"
            y="400"
            width="2400"
            height="340"
            fill={ref("shaft")}
            transform="rotate(28 960 540)"
            opacity="0.7"
          />
          <rect x="-100" y="-100" width="2120" height="1280" fill={ref("edge")} />
        </g>
      </svg>

      <div class="fluted-backdrop__bloom" style={props.still ? { animation: "none" } : undefined} />

      {/* Layer 2 — irregular reeded glass lenses */}
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none">
        <defs>
          {/* Specular edge on the left, deep trough on the right */}
          <linearGradient id={id("reed0")} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.07" />
            <stop offset="0.16" stop-color="#FFFFFF" stop-opacity="0.025" />
            <stop offset="0.55" stop-color="#FFFFFF" stop-opacity="0" />
            <stop offset="0.86" stop-color="#120202" stop-opacity="0.2" />
            <stop offset="1" stop-color="#120202" stop-opacity="0.28" />
          </linearGradient>
          {/* Highlight sits slightly inside the lens */}
          <linearGradient id={id("reed1")} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#120202" stop-opacity="0.08" />
            <stop offset="0.24" stop-color="#FFFFFF" stop-opacity="0.07" />
            <stop offset="0.5" stop-color="#FFFFFF" stop-opacity="0.01" />
            <stop offset="0.82" stop-color="#120202" stop-opacity="0.18" />
            <stop offset="1" stop-color="#120202" stop-opacity="0.28" />
          </linearGradient>
          {/* Softer, wider trough */}
          <linearGradient id={id("reed2")} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.06" />
            <stop offset="0.1" stop-color="#FFFFFF" stop-opacity="0.02" />
            <stop offset="0.42" stop-color="#120202" stop-opacity="0.04" />
            <stop offset="1" stop-color="#120202" stop-opacity="0.26" />
          </linearGradient>
        </defs>
        <For each={REEDS}>
          {(reed) => (
            <rect
              x={reed.x}
              y="0"
              width={reed.w}
              height={VIEW_H}
              fill={ref(`reed${reed.variant}`)}
              opacity={reed.opacity.toFixed(2)}
            />
          )}
        </For>
      </svg>

      <div class="fluted-backdrop__vignette" />
    </div>
  );
}
