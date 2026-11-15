import { splitProps, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";

export type GlassPanelVariant = "surface" | "heavy" | "dock" | "scrim";

export interface GlassPanelProps {
  variant?: GlassPanelVariant;
  as?: "div" | "section" | "nav" | "header";
  class?: string;
  onClick?: JSX.EventHandlerUnion<HTMLElement, MouseEvent>;
  children: JSX.Element;
}

export function GlassPanel(props: GlassPanelProps) {
  const [local, rest] = splitProps(props, ["variant", "as", "class", "children", "onClick"]);
  const tag = () => local.as ?? "div";
  const variantClass = () => `glass-panel glass-panel--${local.variant ?? "surface"}`;

  return (
    <Dynamic
      component={tag()}
      class={`${variantClass()} ${local.class ?? ""}`}
      onClick={local.onClick}
      {...rest}
    >
      {local.children}
    </Dynamic>
  );
}
