import type { Component } from "solid-js";
import { focusRect } from "../spatial/nav";

/** Gap between the focused element and the reticle, in px. */
const OFFSET = 4;
/** Matches the scale(1.02) focused surfaces animate to. */
const FOCUS_SCALE = 1.02;

function offsetRadius(radius: string): string {
  const m = /^(\d+(?:\.\d+)?)px$/.exec(radius.trim());
  if (!m) return radius;
  const value = Number(m[1]);
  return value >= 999 ? "9999px" : `${value + OFFSET}px`;
}

/**
 * Crisp, quiet spatial-focus reticle: a 1.5px hairline that follows the focused
 * element's geometry. No blur, no glow.
 */
export const FocusRing: Component = () => {
  const geometry = () => {
    const r = focusRect();
    const width = r.width * FOCUS_SCALE + OFFSET * 2;
    const height = r.height * FOCUS_SCALE + OFFSET * 2;
    const x = r.x - (width - r.width) / 2;
    const y = r.y - (height - r.height) / 2;
    return { x, y, width, height, radius: offsetRadius(r.radius), visible: r.visible };
  };

  return (
    <div
      class="focus-ring"
      style={{
        opacity: geometry().visible ? "1" : "0",
        width: `${geometry().width}px`,
        height: `${geometry().height}px`,
        "border-radius": geometry().radius,
        transform: `translate3d(${geometry().x}px, ${geometry().y}px, 0)`
      }}
    />
  );
};
