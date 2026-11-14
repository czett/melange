import { For, onCleanup, onMount } from "solid-js";
import { ensureValidFocus, isFocused, registerFocusable } from "../spatial/nav";

interface OnScreenKeyboardProps {
  value: string;
  onChange: (next: string) => void;
  onSubmit: (query: string) => void;
  onClose: () => void;
}

const KEY_ROWS: string[][] = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["Q", "W", "E", "R", "T", "Z", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["Y", "X", "C", "V", "B", "N", "M"],
];

export function OnScreenKeyboard(props: OnScreenKeyboardProps) {
  const appendChar = (ch: string) => props.onChange(props.value + ch.toLowerCase());
  const backspace = () => props.onChange(props.value.slice(0, -1));
  const clear = () => props.onChange("");

  onMount(() => {
    requestAnimationFrame(() => ensureValidFocus("osk-key-Q"));
  });

  return (
    <div class="fixed inset-0 z-40 flex items-center justify-center bg-[#120303]/80 p-6 backdrop-blur-xl">
      <div class="fluted-surface flex w-full max-w-3xl flex-col gap-5 rounded-3xl p-7">
        <div class="flex items-center justify-between gap-4">
          <div class="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.24em] text-white/65">
            <span class="h-1.5 w-1.5 rounded-full bg-[#E13A26]" />
            <span>Search</span>
          </div>
          <div class="fluted-pill rounded-full px-3.5 py-1 text-xs text-white/65">
            D-Pad / Arrows + Select
          </div>
        </div>

        <div class="flex min-h-[3.5rem] items-center justify-between rounded-2xl border border-white/20 bg-[#120303]/80 px-5 py-3.5 text-xl font-light tracking-tight text-white shadow-inner">
          <div class="flex items-center gap-1 truncate">
            {props.value ? (
              <span>{props.value}</span>
            ) : (
              <span class="text-white/40">Type to search...</span>
            )}
            <span class="inline-block h-5 w-0.5 animate-pulse rounded-full bg-[#E13A26]" />
          </div>
        </div>

        <div class="flex flex-col gap-2.5">
          <For each={KEY_ROWS}>
            {(row) => (
              <div class="flex justify-center gap-2">
                <For each={row}>
                  {(key) => (
                    <button
                      ref={(el) =>
                        onCleanup(registerFocusable(`osk-key-${key}`, el, () => appendChar(key)))
                      }
                      type="button"
                      data-focus-radius="12px"
                      onClick={() => appendChar(key)}
                      class="fluted-key flex h-12 w-12 items-center justify-center rounded-xl text-base font-medium"
                    >
                      {key}
                    </button>
                  )}
                </For>
              </div>
            )}
          </For>

          <div class="flex justify-center gap-2.5 pt-2">
            <button
              ref={(el) =>
                onCleanup(
                  registerFocusable("osk-space", el, () => props.onChange(props.value + " "))
                )
              }
              type="button"
              data-focus-radius="9999px"
              onClick={() => props.onChange(props.value + " ")}
              class={`h-12 rounded-full px-8 text-sm font-medium transition ${
                isFocused("osk-space") ? "pill-cta-white" : "fluted-pill text-white"
              }`}
            >
              Space
            </button>
            <button
              ref={(el) => onCleanup(registerFocusable("osk-backspace", el, backspace))}
              type="button"
              data-focus-radius="9999px"
              onClick={backspace}
              class={`h-12 rounded-full px-5 text-sm font-medium transition ${
                isFocused("osk-backspace") ? "pill-cta-white" : "fluted-pill text-white"
              }`}
            >
              Backspace
            </button>
            <button
              ref={(el) => onCleanup(registerFocusable("osk-clear", el, clear))}
              type="button"
              data-focus-radius="9999px"
              onClick={clear}
              class={`h-12 rounded-full px-5 text-sm font-medium transition ${
                isFocused("osk-clear") ? "pill-cta-white" : "fluted-pill text-white/80"
              }`}
            >
              Clear
            </button>
            <button
              ref={(el) =>
                onCleanup(registerFocusable("osk-submit", el, () => props.onSubmit(props.value)))
              }
              type="button"
              data-focus-radius="9999px"
              onClick={() => props.onSubmit(props.value)}
              class="pill-cta-white h-12 rounded-full px-7 text-sm font-semibold"
            >
              Search
            </button>
            <button
              ref={(el) => onCleanup(registerFocusable("osk-cancel", el, props.onClose))}
              type="button"
              data-focus-radius="9999px"
              onClick={props.onClose}
              class={`h-12 rounded-full px-5 text-sm font-medium transition ${
                isFocused("osk-cancel") ? "pill-cta-white" : "fluted-pill text-white/75"
              }`}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
