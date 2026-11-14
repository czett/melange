import type { Component } from "solid-js";
import { focusRect } from "../spatial/nav";

export const FocusRing: Component = () => {
  return (
    <div
      class="focus-ring"
      style={{
        opacity: focusRect().visible ? "1" : "0",
        width: `${focusRect().width}px`,
        height: `${focusRect().height}px`,
        "border-radius": focusRect().radius,
        transform: `translate3d(${focusRect().x}px, ${focusRect().y}px, 0) scale(1.015)`
      }}
    />
  );
};
