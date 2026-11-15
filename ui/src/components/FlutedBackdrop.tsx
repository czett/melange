import { createEffect, createSignal, onCleanup, onMount, type JSX } from "solid-js";

/**
 * Real-time optical fluted-glass backdrop rendered via a GPU WebGL2 fragment
 * shader with an analytical Canvas 2D sliced-column fallback.
 *
 * Layer 1 (behind glass) — 5 slow-drifting organic rotated Gaussian plumes
 *   spanning deep velvet garnet (#831613), crimson (#E13A26), coral-red (#FF5A42),
 *   and a subtle warm peach/gold specular core (#FF9E6D / #FEED65).
 * Layer 2 (fluted lens) — variable-width vertical cylindrical glass reeds that
 *   refract the light field horizontally and vertically per reed with subtle
 *   chromatic dispersion, luminance-modulated specular catchlights, and static
 *   micro-frosted grain.
 */

export interface FlutedBackdropProps {
  class?: string;
  style?: JSX.CSSProperties;
  /** Disable slow plume drift (renders static optical glass). */
  still?: boolean;
  /** Pause the render loop when occluded/hidden (e.g. LiveTv video mode). */
  active?: boolean;
  /** Warm #FEED65 / #FF6B42 focal crest intensity (0..0.45, default 0.26). */
  warmIntensity?: number;
}

const VERT_SRC = `#version 300 es
precision highp float;
in vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_warmIntensity;
uniform float u_refractStrength;

out vec4 fragColor;

const float PI = 3.14159265359;

const vec3 C_VOID  = vec3(0.038, 0.004, 0.006); // #0A0102 deep obsidian garnet
const vec3 C_DEEP  = vec3(0.360, 0.045, 0.042); // Moody #831613 Deep Red under glass
const vec3 C_CRIM  = vec3(0.760, 0.165, 0.110); // Controlled #E13A26 Crimson Red
const vec3 C_CORAL = vec3(0.920, 0.290, 0.200); // Restrained warm transition
const vec3 C_GOLD  = vec3(0.996, 0.929, 0.396); // #FEED65 subtle specular rim

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float plume(vec2 p, vec2 center, vec2 sigma, float angle, vec2 stretch) {
  vec2 d = (p - center) * stretch;
  float c = cos(angle);
  float s = sin(angle);
  vec2 r = vec2(c * d.x + s * d.y, -s * d.x + c * d.y) / sigma;
  return exp(-dot(r, r));
}

vec3 sampleLightField(vec2 p, float t, vec2 stretch) {
  vec2 warp = vec2(
    sin(p.y * 3.1 + t * 0.14) + 0.45 * cos(p.y * 5.2 - t * 0.10),
    cos(p.x * 2.6 - t * 0.11) + 0.45 * sin(p.x * 4.4 + t * 0.13)
  ) * 0.032;
  vec2 wp = p + warp;

  vec2 c1 = vec2(0.28 + 0.035 * sin(t * 0.19),       0.55 + 0.030 * cos(t * 0.15));
  vec2 c2 = vec2(0.46 + 0.040 * cos(t * 0.13),       0.47 + 0.035 * sin(t * 0.17));
  vec2 c3 = vec2(0.36 + 0.030 * sin(t * 0.23 + 1.1), 0.48 + 0.025 * cos(t * 0.21));
  vec2 c4 = vec2(0.58 + 0.035 * cos(t * 0.16 + 2.4), 0.14 + 0.025 * sin(t * 0.14));
  vec2 c5 = vec2(0.80 + 0.030 * sin(t * 0.12 + 4.0), 0.80 + 0.030 * cos(t * 0.18));

  float p1 = plume(wp, c1, vec2(0.35, 0.22), -0.42, stretch);
  float p2 = plume(wp, c2, vec2(0.52, 0.16), -0.58, stretch);
  float p3 = plume(wp, c3, vec2(0.14, 0.08), -0.42, stretch);
  float p4 = plume(wp, c4, vec2(0.32, 0.16), -0.22, stretch);
  float p5 = plume(wp, c5, vec2(0.36, 0.20), -0.28, stretch);

  float E = p1 * 0.88 + p2 * 0.78 + p3 * 0.68 + p4 * 0.48 + p5 * 0.40;
  float C = p3 * 1.15 + p1 * 0.22 + p2 * 0.18;

  float baseGrad = clamp(1.0 - length((p - vec2(0.42, 0.50)) * vec2(0.90, 1.18)) * 1.05, 0.0, 1.0);
  vec3 col = mix(C_VOID, C_DEEP * 0.54, baseGrad);
  col = mix(col, C_DEEP, smoothstep(0.08, 0.44, E));
  col = mix(col, C_CRIM, smoothstep(0.38, 0.92, E));
  col = mix(col, C_CORAL, smoothstep(0.84, 1.40, E));

  float coreMask = smoothstep(0.68, 1.32, C);
  float peakMask = smoothstep(0.86, 1.38, C);
  float warmGain = clamp(u_warmIntensity / 0.26, 0.0, 1.15);
  col = mix(col, mix(C_CORAL, C_GOLD, 0.38), clamp(coreMask * u_warmIntensity * 1.1, 0.0, 0.48));
  col = mix(col, C_GOLD, clamp(peakMask * u_warmIntensity * 1.15 * warmGain, 0.0, 0.34));
  return col;
}

void main() {
  vec2 uv = gl_FragCoord.xy / max(u_resolution, vec2(1.0));
  vec2 suv = vec2(uv.x, 1.0 - uv.y);

  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 stretch = vec2(clamp(aspect / 1.777778, 0.55, 1.35), 1.0);

  // Variable-width architectural glass reeds (strictly monotonic warp)
  float reedPitch = u_resolution.x < 700.0
    ? clamp(u_resolution.x / 24.0, 14.0, 26.0)
    : clamp(u_resolution.x / 52.0, 18.0, 34.0);

  float s = gl_FragCoord.x / reedPitch;
  float w = s
    + 0.22 * sin(s * 0.41)
    + 0.14 * sin(s * 1.13 + 1.3)
    + 0.09 * sin(s * 2.47 + 4.1);

  float colId = floor(w);
  float localU = fract(w);
  float seamAA = max(fwidth(w), 0.002);

  float r1 = hash11(colId);
  float r2 = hash11(colId + 37.0) * 2.0 - 1.0;
  float r3 = 0.94 + 0.11 * hash11(colId + 91.0);
  float r4 = hash11(colId + 157.0) - 0.5;

  // Cylindrical lens normal & depth profile
  float theta = (localU - 0.5) * PI;
  float edgeFillet = 0.94 + 0.06 * smoothstep(0.0, 0.04, localU) * smoothstep(1.0, 0.96, localU);
  float nx = sin(theta) * edgeFillet;
  float thickness = cos(theta);

  float refractX = u_refractStrength * (u_resolution.x < 700.0 ? 1.35 : 1.0);
  vec2 refractedUV = vec2(
    suv.x + nx * refractX * (0.75 + 0.50 * r1),
    suv.y + r2 * 0.032 + thickness * 0.012 * r4 + nx * 0.008
  );

  // Subtle chromatic dispersion across steep reed curvature
  float disp = nx * 0.0032 * (0.5 + 0.5 * abs(nx));
  float red = sampleLightField(refractedUV + vec2(disp, 0.0), u_time, stretch).r;
  float green = sampleLightField(refractedUV, u_time, stretch).g;
  float blue = sampleLightField(refractedUV - vec2(disp, 0.0), u_time, stretch).b;
  vec3 glassCol = vec3(red, green, blue) * r3;

  // Luminance-responsive specular ridge catchlights + grazing refraction trough
  float luma = dot(glassCol, vec3(0.299, 0.587, 0.114));
  float ridgeMask = smoothstep(0.16, 0.02, localU) * smoothstep(0.0, seamAA * 1.2 + 0.015, localU);
  float troughMask = smoothstep(0.72, 0.99, localU);

  vec3 ridgeTint = mix(vec3(1.0, 0.86, 0.82), C_GOLD, smoothstep(0.28, 0.55, luma) * 0.42);
  glassCol += ridgeTint * ridgeMask * (0.025 + 0.10 * luma);
  glassCol *= 1.0 - troughMask * 0.24;

  // Stronger perimeter vignette + subtle center-clock readability wash
  float distCenter = length((suv - vec2(0.46, 0.50)) * vec2(0.95, 1.12));
  float vigRadial = smoothstep(0.28, 0.96, distCenter);
  float vigVert = smoothstep(0.24, 0.0, suv.y) * 0.42 + smoothstep(0.64, 1.0, suv.y) * 0.54;
  float clockWash = smoothstep(0.35, 0.05, length((suv - vec2(0.50, 0.38)) * vec2(1.0, 1.6))) * 0.14;
  glassCol *= 1.0 - clamp(vigRadial * 0.64 + vigVert * 0.85 + clockWash, 0.0, 0.82);

  // Static micro-frosted glass grain + 8-bit dither (prevents HDMI banding without shimmer)
  float grain = (hash21(gl_FragCoord.xy) - 0.5) * 0.020;
  glassCol = clamp(glassCol + grain, 0.0, 1.0);

  fragColor = vec4(glassCol, 1.0);
}
`;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn("[FlutedBackdrop] shader compile failed:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

interface WebGlRenderer {
  render: (timeSec: number, warmIntensity: number) => void;
  resize: (width: number, height: number) => void;
  dispose: () => void;
}

function createWebGlRenderer(canvas: HTMLCanvasElement): WebGlRenderer | null {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance"
  });
  if (!gl) return null;

  const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
  if (!vs || !fs) {
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    return null;
  }

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return null;
  }

  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn("[FlutedBackdrop] program link failed:", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }

  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();
  if (!vao || !vbo) {
    if (vao) gl.deleteVertexArray(vao);
    if (vbo) gl.deleteBuffer(vbo);
    gl.deleteProgram(program);
    return null;
  }

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

  const posLoc = gl.getAttribLocation(program, "a_pos");
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const uRes = gl.getUniformLocation(program, "u_resolution");
  const uTime = gl.getUniformLocation(program, "u_time");
  const uWarm = gl.getUniformLocation(program, "u_warmIntensity");
  const uRefract = gl.getUniformLocation(program, "u_refractStrength");

  let width = canvas.width;
  let height = canvas.height;

  return {
    resize(w: number, h: number) {
      width = Math.max(1, w);
      height = Math.max(1, h);
      gl.viewport(0, 0, width, height);
    },
    render(timeSec: number, warmIntensity: number) {
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.uniform2f(uRes, width, height);
      gl.uniform1f(uTime, timeSec);
      gl.uniform1f(uWarm, warmIntensity);
      gl.uniform1f(uRefract, 0.036);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteBuffer(vbo);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    }
  };
}

interface ReedSlice {
  x: number;
  w: number;
  shiftX: number;
  shiftY: number;
}

function buildFallbackReeds(width: number): ReedSlice[] {
  const reedPitch = width < 700 ? Math.max(14, Math.min(26, width / 24)) : Math.max(18, Math.min(34, width / 52));
  const slices: ReedSlice[] = [];
  let x = 0;
  let idx = 0;
  while (x < width) {
    const s = idx;
    const widthScale =
      1 +
      0.24 * Math.sin(s * 0.71) +
      0.16 * Math.sin(s * 1.63 + 1.3);
    const w = Math.max(10, Math.round(reedPitch * widthScale));
    const h1 = ((Math.sin(idx * 12.9898) * 43758.5453) % 1 + 1) % 1;
    const h2 = ((Math.sin((idx + 37) * 78.233) * 43758.5453) % 1 + 1) % 1;
    slices.push({
      x,
      w: Math.min(w, width - x),
      shiftX: (h1 - 0.5) * 14,
      shiftY: (h2 - 0.5) * 18
    });
    x += w;
    idx += 1;
  }
  return slices;
}

function createCanvas2dRenderer(canvas: HTMLCanvasElement): WebGlRenderer | null {
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return null;

  const offW = 240;
  const offH = 135;
  const offscreen = document.createElement("canvas");
  offscreen.width = offW;
  offscreen.height = offH;
  const offCtx = offscreen.getContext("2d", { alpha: false });
  if (!offCtx) return null;

  let width = Math.max(1, canvas.width);
  let height = Math.max(1, canvas.height);
  let reeds = buildFallbackReeds(width);

  return {
    resize(w: number, h: number) {
      width = Math.max(1, w);
      height = Math.max(1, h);
      reeds = buildFallbackReeds(width);
    },
    render(timeSec: number, warmIntensity: number) {
      // 1. Render smooth organic crimson/coral/gold plumes to offscreen light buffer
      const base = offCtx.createLinearGradient(0, 0, offW, offH);
      base.addColorStop(0, "#0A0102");
      base.addColorStop(0.42, "#2B0505");
      base.addColorStop(0.72, "#520B09");
      base.addColorStop(1, "#0A0102");
      offCtx.fillStyle = base;
      offCtx.fillRect(0, 0, offW, offH);

      const drawPlume = (cx: number, cy: number, rx: number, ry: number, c0: string, c1: string) => {
        offCtx.save();
        offCtx.translate(cx * offW, cy * offH);
        offCtx.scale(rx, ry);
        const r = Math.max(offW, offH) * 0.5;
        const grad = offCtx.createRadialGradient(0, 0, 0, 0, 0, r);
        grad.addColorStop(0, c0);
        grad.addColorStop(0.48, c1);
        grad.addColorStop(1, "rgba(82, 11, 9, 0)");
        offCtx.fillStyle = grad;
        offCtx.beginPath();
        offCtx.arc(0, 0, r, 0, Math.PI * 2);
        offCtx.fill();
        offCtx.restore();
      };

      offCtx.globalCompositeOperation = "screen";
      drawPlume(
        0.28 + 0.03 * Math.sin(timeSec * 0.19),
        0.55 + 0.03 * Math.cos(timeSec * 0.15),
        0.92,
        0.62,
        "rgba(235, 74, 51, 0.56)",
        "rgba(194, 42, 28, 0.30)"
      );
      drawPlume(
        0.46 + 0.035 * Math.cos(timeSec * 0.13),
        0.47 + 0.03 * Math.sin(timeSec * 0.17),
        1.1,
        0.46,
        "rgba(194, 42, 28, 0.46)",
        "rgba(82, 11, 9, 0.20)"
      );
      if (warmIntensity > 0.01) {
        const a = Math.min(0.28, warmIntensity * 1.05).toFixed(2);
        drawPlume(
          0.36 + 0.025 * Math.sin(timeSec * 0.23),
          0.48 + 0.02 * Math.cos(timeSec * 0.21),
          0.28,
          0.14,
          `rgba(254, 237, 101, ${a})`,
          "rgba(235, 74, 51, 0.20)"
        );
      }
      drawPlume(
        0.58 + 0.03 * Math.cos(timeSec * 0.16),
        0.14 + 0.02 * sinSafe(timeSec * 0.14),
        0.7,
        0.4,
        "rgba(194, 42, 28, 0.32)",
        "rgba(82, 11, 9, 0.12)"
      );
      offCtx.globalCompositeOperation = "source-over";

      // 2. Refract offscreen light buffer through variable-width cylindrical reeds
      ctx.fillStyle = "#0A0102";
      ctx.fillRect(0, 0, width, height);

      for (const reed of reeds) {
        const sx = Math.max(0, Math.min(offW - 4, (reed.x / width) * offW + reed.shiftX));
        const sw = Math.max(2, Math.min(offW - sx, (reed.w / width) * offW * 1.45));
        const sy = Math.max(0, Math.min(offH - 16, reed.shiftY > 0 ? reed.shiftY : 0));
        const sh = offH - Math.abs(reed.shiftY);
        ctx.drawImage(offscreen, sx, sy, sw, Math.max(16, sh), reed.x, 0, reed.w, height);

        const lensGrad = ctx.createLinearGradient(reed.x, 0, reed.x + reed.w, 0);
        lensGrad.addColorStop(0, "rgba(255, 225, 215, 0.09)");
        lensGrad.addColorStop(0.18, "rgba(255, 255, 255, 0.02)");
        lensGrad.addColorStop(0.65, "rgba(0, 0, 0, 0)");
        lensGrad.addColorStop(1, "rgba(10, 1, 1, 0.36)");
        ctx.fillStyle = lensGrad;
        ctx.fillRect(reed.x, 0, reed.w, height);
      }

      // 3. Outer perimeter vignette
      const vig = ctx.createRadialGradient(
        width * 0.45,
        height * 0.5,
        width * 0.12,
        width * 0.5,
        height * 0.5,
        width * 0.68
      );
      vig.addColorStop(0, "rgba(10, 1, 2, 0.12)");
      vig.addColorStop(1, "rgba(8, 1, 1, 0.84)");
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, width, height);
    },
    dispose() {
      // Nothing to release explicitly for Canvas 2D
    }
  };
}

function sinSafe(v: number): number {
  return Math.sin(v);
}

export function FlutedBackdrop(props: FlutedBackdropProps) {
  let canvasRef!: HTMLCanvasElement;
  const [reducedMotion, setReducedMotion] = createSignal(false);

  let renderer: WebGlRenderer | null = null;
  let rafId: number | null = null;
  let lastFrameMs = 0;
  let elapsedSec = 0;

  const warmValue = () => Math.max(0, Math.min(0.45, props.warmIntensity ?? 0.26));

  const drawFrame = () => {
    renderer?.render(elapsedSec, warmValue());
  };

  const syncCanvasSize = () => {
    if (!canvasRef) return;
    const rect = canvasRef.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvasRef.width !== w || canvasRef.height !== h) {
      canvasRef.width = w;
      canvasRef.height = h;
    }
    renderer?.resize(w, h);
    drawFrame();
  };

  const initRenderer = () => {
    renderer?.dispose();
    const webgl = createWebGlRenderer(canvasRef);
    if (webgl) {
      console.debug("[FlutedBackdrop] backend=webgl2");
      renderer = webgl;
    } else {
      console.debug("[FlutedBackdrop] backend=canvas2d-fallback");
      renderer = createCanvas2dRenderer(canvasRef);
    }
    syncCanvasSize();
  };

  onMount(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onMqChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", onMqChange);

    initRenderer();

    const onContextLost = (e: Event) => {
      e.preventDefault();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };
    const onContextRestored = () => {
      initRenderer();
    };
    canvasRef.addEventListener("webglcontextlost", onContextLost);
    canvasRef.addEventListener("webglcontextrestored", onContextRestored);

    const ro = new ResizeObserver(() => syncCanvasSize());
    ro.observe(canvasRef);

    onCleanup(() => {
      mq.removeEventListener("change", onMqChange);
      canvasRef.removeEventListener("webglcontextlost", onContextLost);
      canvasRef.removeEventListener("webglcontextrestored", onContextRestored);
      ro.disconnect();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      renderer?.dispose();
      renderer = null;
    });
  });

  createEffect(() => {
    const isActive = props.active ?? true;
    const shouldAnimate = isActive && !props.still && !reducedMotion();
    void warmValue();

    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }

    if (!renderer) return;

    drawFrame();
    if (!shouldAnimate) return;

    lastFrameMs = performance.now();
    const tick = (nowMs: number) => {
      const dt = Math.min(0.1, Math.max(0, (nowMs - lastFrameMs) / 1000));
      lastFrameMs = nowMs;
      elapsedSec += dt;
      drawFrame();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  });

  return (
    <div class={`fluted-backdrop ${props.class ?? ""}`} style={props.style} aria-hidden="true">
      <canvas ref={canvasRef} class="block h-full w-full" />
    </div>
  );
}
