import { splitProps, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";

export type GlassPanelVariant = "surface" | "heavy" | "dock" | "scrim";

export interface GlassPanelProps {
  variant?: GlassPanelVariant;
  as?: "div" | "section" | "nav" | "header";
  class?: string;
  style?: JSX.CSSProperties;
  onClick?: JSX.EventHandlerUnion<HTMLElement, MouseEvent>;
  children: JSX.Element;
}

export function GlassPanel(props: GlassPanelProps) {
  const [local, rest] = splitProps(props, [
    "variant",
    "as",
    "class",
    "style",
    "children",
    "onClick"
  ]);
  const tag = () => local.as ?? "div";
  const variantClass = () => {
    const variant = local.variant ?? "surface";
    const extra =
      variant === "scrim"
        ? "modal-scrim bg-[#090B10]/92 backdrop-blur-3xl"
        : variant === "heavy"
          ? "bg-[#111319]/95"
          : "";
    return `glass-panel glass-panel--${variant} ${extra}`.trim();
  };

  return (
    <Dynamic
      component={tag()}
      class={`${variantClass()} ${local.class ?? ""}`}
      style={local.style}
      onClick={local.onClick}
      {...rest}
    >
      {local.children}
    </Dynamic>
  );
}
