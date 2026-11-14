import type { Component } from "solid-js";
import { focusRect } from "../spatial/nav";

/** Zero extra gap so fallback reticles never create offset double borders. */
const OFFSET = 0;

/**
 * Fallback single-layer spatial-focus reticle for unstyled elements that do not
 * handle their own `[data-focused="true"]` presentation.
 */
export const FocusRing: Component = () => {
  const geometry = () => {
    const r = focusRect();
    const width = r.width + OFFSET * 2;
    const height = r.height + OFFSET * 2;
    const x = r.x - OFFSET;
    const y = r.y - OFFSET;
    return { x, y, width, height, radius: r.radius, visible: r.visible };
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
