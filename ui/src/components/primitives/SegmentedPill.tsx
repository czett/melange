import { For, Show, onCleanup, onMount } from "solid-js";
import { registerFocusable, setFocus, setInputModality, type NavNeighbors } from "../../spatial/nav";

export interface SegmentedItem {
  id: string;
  focusId: string;
  label: string | (() => string);
  active?: boolean | (() => boolean);
  onSelect: () => void;
  badge?: string;
  neighbors?: NavNeighbors;
}

export interface SegmentedPillProps {
  items: SegmentedItem[];
  activeId?: string;
  trailingAction?: {
    focusId: string;
    label: string;
    ariaLabel?: string;
    title?: string;
    onSelect: () => void;
    neighbors?: NavNeighbors;
  };
  class?: string;
}

function createPressHelper() {
  let timer: number | undefined;
  const trigger = (el: HTMLElement | undefined) => {
    if (!el) return;
    el.setAttribute("data-pressed", "true");
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      el.removeAttribute("data-pressed");
    }, 140);
  };
  const clear = () => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
  };
  return { trigger, clear };
}

function SegmentButton(props: { item: SegmentedItem; activeId?: string }) {
  let btnRef!: HTMLButtonElement;
  const press = createPressHelper();

  onMount(() => {
    const cleanup = registerFocusable(
      props.item.focusId,
      btnRef,
      () => props.item.onSelect(),
      () => props.item.neighbors
    );
    onCleanup(() => {
      cleanup();
      press.clear();
    });
  });

  const isActive = () => {
    if (props.activeId !== undefined) {
      return props.activeId === props.item.id;
    }
    return typeof props.item.active === "function"
      ? props.item.active()
      : Boolean(props.item.active);
  };

  const labelText = () =>
    typeof props.item.label === "function" ? props.item.label() : props.item.label;

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    setInputModality("pointer");
    press.trigger(btnRef);
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
      data-active={isActive() ? "true" : undefined}
      onClick={handleClick}
      class="segmented-item"
    >
      <span>{labelText()}</span>
      <Show when={props.item.badge}>
        {(badge) => (
          <span class="segmented-badge rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none">
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
      <For each={props.items}>
        {(item) => <SegmentButton item={item} activeId={props.activeId} />}
      </For>

      <Show when={props.trailingAction}>
        {(action) => {
          let actionRef!: HTMLButtonElement;
          const press = createPressHelper();

          onMount(() => {
            const cleanup = registerFocusable(
              action().focusId,
              actionRef,
              () => action().onSelect(),
              () => action().neighbors
            );
            onCleanup(() => {
              cleanup();
              press.clear();
            });
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
                setInputModality("pointer");
                press.trigger(actionRef);
                setFocus(action().focusId, false);
                action().onSelect();
              }}
              class="segmented-item h-[1.875rem] w-[1.875rem] px-0 text-[15px] font-semibold"
            >
              {action().label}
            </button>
          );
        }}
      </Show>
    </div>
  );
}
