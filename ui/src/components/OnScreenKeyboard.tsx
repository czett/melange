import { For, onCleanup, onMount } from "solid-js";
import { ensureValidFocus, registerFocusable, setFocus } from "../spatial/nav";

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
    requestAnimationFrame(() => {
      setFocus("osk-key-Q", false);
      ensureValidFocus("osk-key-Q");
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      if (e.key === "Backspace") {
        e.preventDefault();
        e.stopPropagation();
        backspace();
        setFocus("osk-submit", false);
        return;
      }

      if (e.key.length === 1 && !/[\u0000-\u001F\u007F]/.test(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        props.onChange(props.value + e.key);
        setFocus("osk-submit", false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  return (
    <div class="modal-scrim fixed inset-0 z-40 flex items-center justify-center p-6">
      <div class="glass-card flex w-full max-w-3xl flex-col gap-5 rounded-[24px] p-7">
        <div class="flex items-center justify-between gap-4">
          <div class="eyebrow">Search</div>
          <div class="chip">Type or D-pad + OK</div>
        </div>

        <div class="glass-inner flex min-h-[3.25rem] items-center justify-between rounded-2xl px-5 py-3 text-lg font-normal tracking-[-0.02em] text-white">
          <div class="flex items-center gap-1 truncate">
            {props.value ? (
              <span>{props.value}</span>
            ) : (
              <span class="text-white/45">Type to search...</span>
            )}
            <span class="inline-block h-5 w-px animate-pulse bg-white/80" />
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
                      class="key flex h-11 w-11 items-center justify-center rounded-xl text-[13px] font-medium"
                    >
                      {key}
                    </button>
                  )}
                </For>
              </div>
            )}
          </For>

          <div class="flex justify-center gap-2 pt-3">
            <button
              ref={(el) =>
                onCleanup(
                  registerFocusable("osk-space", el, () => props.onChange(props.value + " "))
                )
              }
              type="button"
              data-focus-radius="9999px"
              onClick={() => props.onChange(props.value + " ")}
              class="pill pill-secondary"
            >
              Space
            </button>
            <button
              ref={(el) => onCleanup(registerFocusable("osk-backspace", el, backspace))}
              type="button"
              data-focus-radius="9999px"
              onClick={backspace}
              class="pill pill-secondary"
            >
              Backspace
            </button>
            <button
              ref={(el) => onCleanup(registerFocusable("osk-clear", el, clear))}
              type="button"
              data-focus-radius="9999px"
              onClick={clear}
              class="pill pill-secondary"
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
              class="pill pill-primary"
            >
              Search
            </button>
            <button
              ref={(el) => onCleanup(registerFocusable("osk-cancel", el, props.onClose))}
              type="button"
              data-focus-radius="9999px"
              onClick={props.onClose}
              class="pill pill-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
