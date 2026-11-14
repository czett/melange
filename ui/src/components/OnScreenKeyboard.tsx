import { For, onCleanup, onMount } from "solid-js";
import { ensureValidFocus, registerFocusable } from "../spatial/nav";

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
    <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-xl p-6">
      <div class="glass-panel w-full max-w-3xl rounded-3xl p-6 flex flex-col gap-5">
        <div class="flex items-center justify-between gap-4">
          <div class="text-xs uppercase tracking-[0.2em] text-white/60">Search</div>
          <div class="text-xs text-white/50">Use D-Pad / Arrow keys + Select</div>
        </div>

        <div class="rounded-2xl bg-black/40 border border-white/15 px-5 py-3.5 text-xl font-medium text-white min-h-[3.25rem] flex items-center">
          {props.value ? (
            <span>{props.value}</span>
          ) : (
            <span class="text-white/35">Type to search...</span>
          )}
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
                      onClick={() => appendChar(key)}
                      class="glass-card w-12 h-12 rounded-xl text-base font-semibold text-white flex items-center justify-center hover:bg-white/20"
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
              onClick={() => props.onChange(props.value + " ")}
              class="glass-card px-8 h-12 rounded-xl text-sm font-medium text-white"
            >
              Space
            </button>
            <button
              ref={(el) => onCleanup(registerFocusable("osk-backspace", el, backspace))}
              onClick={backspace}
              class="glass-card px-5 h-12 rounded-xl text-sm font-medium text-white"
            >
              Backspace
            </button>
            <button
              ref={(el) => onCleanup(registerFocusable("osk-clear", el, clear))}
              onClick={clear}
              class="glass-card px-5 h-12 rounded-xl text-sm font-medium text-white/80"
            >
              Clear
            </button>
            <button
              ref={(el) =>
                onCleanup(registerFocusable("osk-submit", el, () => props.onSubmit(props.value)))
              }
              onClick={() => props.onSubmit(props.value)}
              class="px-7 h-12 rounded-xl text-sm font-semibold bg-white text-black"
            >
              Search
            </button>
            <button
              ref={(el) => onCleanup(registerFocusable("osk-cancel", el, props.onClose))}
              onClick={props.onClose}
              class="glass-card px-5 h-12 rounded-xl text-sm font-medium text-white/75"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
