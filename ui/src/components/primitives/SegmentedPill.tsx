import { For, Show, createEffect, onCleanup, onMount } from "solid-js";
import { registerFocusable, setFocus } from "../../spatial/nav";

export interface SegmentedItem {
  id: string;
  focusId: string;
  label: string;
  active: boolean;
  onSelect: () => void;
  badge?: string;
}

export interface SegmentedPillProps {
  items: SegmentedItem[];
  trailingAction?: {
    focusId: string;
    label: string;
    ariaLabel?: string;
    title?: string;
    onSelect: () => void;
  };
  class?: string;
}

function SegmentButton(props: { item: SegmentedItem }) {
  let btnRef!: HTMLButtonElement;
  let pressTimer: number | undefined;

  onMount(() => {
    const cleanup = registerFocusable(props.item.focusId, btnRef, () => props.item.onSelect());
    onCleanup(() => {
      cleanup();
      if (pressTimer !== undefined) window.clearTimeout(pressTimer);
    });
  });

  createEffect(() => {
    if (!btnRef) return;
    if (props.item.active) {
      btnRef.setAttribute("data-active", "true");
    } else {
      btnRef.removeAttribute("data-active");
    }
  });

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    btnRef.setAttribute("data-pressed", "true");
    if (pressTimer !== undefined) window.clearTimeout(pressTimer);
    pressTimer = window.setTimeout(() => {
      btnRef?.removeAttribute("data-pressed");
    }, 140);
    setFocus(props.item.focusId, false);
    props.item.onSelect();
  };

  return (
    <button
      ref={btnRef}
      type="button"
      data-focus-id={props.item.focusId}
      data-focus-self="true"
      data-focus-radius="9999px"
      data-active={props.item.active ? "true" : undefined}
      onClick={handleClick}
      class="segmented-item"
    >
      <span>{props.item.label}</span>
      <Show when={props.item.badge}>
        {(badge) => (
          <span
            class={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${
              props.item.active
                ? "bg-[#111113]/12 text-[#111113]"
                : "bg-white/10 text-white/80"
            }`}
          >
            {badge()}
          </span>
        )}
      </Show>
    </button>
  );
}

export function SegmentedPill(props: SegmentedPillProps) {
  return (
    <div class={`segmented-pill ${props.class ?? ""}`}>
      <For each={props.items}>{(item) => <SegmentButton item={item} />}</For>

      <Show when={props.trailingAction}>
        {(action) => {
          let actionRef!: HTMLButtonElement;

          onMount(() => {
            const cleanup = registerFocusable(action().focusId, actionRef, () =>
              action().onSelect()
            );
            onCleanup(cleanup);
          });

          return (
            <button
              ref={actionRef}
              type="button"
              data-focus-id={action().focusId}
              data-focus-self="true"
              data-focus-radius="9999px"
              aria-label={action().ariaLabel ?? action().label}
              title={action().title ?? action().label}
              onClick={(e) => {
                e.stopPropagation();
                setFocus(action().focusId, false);
                action().onSelect();
              }}
              class="segmented-item h-[1.875rem] w-[1.875rem] px-0 text-[14px] font-semibold"
            >
              {action().label}
            </button>
          );
        }}
      </Show>
    </div>
  );
}
