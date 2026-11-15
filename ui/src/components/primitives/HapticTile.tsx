import { onCleanup, onMount, type JSX } from "solid-js";
import { registerFocusable, setFocus, setInputModality } from "../../spatial/nav";

export type HapticTileVariant =
  | "card"
  | "row"
  | "pill"
  | "icon"
  | "dock"
  | "key"
  | "epg"
  | "grouped"
  | "sidebar";

export interface HapticTileProps {
  id: string;
  onSelect: () => void;
  active?: boolean;
  variant?: HapticTileVariant;
  radius?: string;
  ariaLabel?: string;
  title?: string;
  class?: string;
  children: JSX.Element;
}

export function HapticTile(props: HapticTileProps) {
  let btnRef!: HTMLButtonElement;
  let pressTimer: number | undefined;

  const variant = () => props.variant ?? "card";

  onMount(() => {
    const cleanup = registerFocusable(props.id, btnRef, () => props.onSelect());
    onCleanup(() => {
      cleanup();
      if (pressTimer !== undefined) {
        window.clearTimeout(pressTimer);
      }
    });
  });

  // Pointer hover uses native CSS :hover without reactive focus churn or audio ticks;
  // click updates the spatial focus target cleanly for subsequent D-Pad/Arrow input.
  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    setInputModality("pointer");
    if (btnRef) {
      btnRef.setAttribute("data-pressed", "true");
      if (pressTimer !== undefined) window.clearTimeout(pressTimer);
      pressTimer = window.setTimeout(() => {
        btnRef?.removeAttribute("data-pressed");
      }, 140);
    }
    setFocus(props.id, false);
    props.onSelect();
  };

  return (
    <button
      ref={btnRef}
      type="button"
      data-focus-id={props.id}
      data-focus-self="true"
      data-focus-radius={props.radius}
      data-active={props.active ? "true" : undefined}
      aria-label={props.ariaLabel}
      title={props.title}
      onClick={handleClick}
      class={`haptic-tile haptic-tile--${variant()} ${props.class ?? ""}`}
    >
      {props.children}
    </button>
  );
}
