import { For, onCleanup, onMount } from "solid-js";
import { ensureValidFocus, setFocus } from "../spatial/nav";
import { GlassPanel, HapticTile } from "./primitives";

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
  ["Y", "X", "C", "V", "B", "N", "M"]
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
    <GlassPanel
      variant="scrim"
      class="fixed inset-0 z-40 flex items-center justify-center p-6"
      onClick={props.onClose}
    >
      <GlassPanel
        variant="heavy"
        class="flex w-full max-w-3xl flex-col gap-5 rounded-[24px] p-7"
        onClick={(e: MouseEvent) => e.stopPropagation()}
      >
        <div class="flex items-center justify-between gap-4">
          <div class="text-[15px] font-semibold tracking-[-0.015em] text-white/95">Search</div>
          <div class="chip font-medium">Type or D-pad + OK</div>
        </div>

        <div class="flex min-h-[3.25rem] items-center justify-between rounded-[16px] border border-white/[0.12] bg-black/35 px-5 py-3 text-[17px] font-semibold tracking-[-0.02em] text-white">
          <div class="flex items-center gap-1 truncate">
            {props.value ? (
              <span>{props.value}</span>
            ) : (
              <span class="font-medium text-white/45">Type to search...</span>
            )}
            <span class="inline-block h-5 w-0.5 animate-pulse bg-white/85" />
          </div>
        </div>

        <div class="flex flex-col gap-2.5">
          <For each={KEY_ROWS}>
            {(row) => (
              <div class="flex justify-center gap-2">
                <For each={row}>
                  {(key) => (
                    <HapticTile
                      id={`osk-key-${key}`}
                      variant="key"
                      radius="12px"
                      onSelect={() => appendChar(key)}
                      class="flex h-11 w-11 items-center justify-center rounded-[12px] text-[14px] font-semibold tabular-nums"
                    >
                      {key}
                    </HapticTile>
                  )}
                </For>
              </div>
            )}
          </For>

          <div class="flex flex-wrap justify-center gap-2.5 pt-3">
            <HapticTile
              id="osk-space"
              variant="pill"
              radius="9999px"
              onSelect={() => props.onChange(props.value + " ")}
            >
              Space
            </HapticTile>
            <HapticTile
              id="osk-backspace"
              variant="pill"
              radius="9999px"
              onSelect={backspace}
            >
              Backspace
            </HapticTile>
            <HapticTile
              id="osk-clear"
              variant="pill"
              radius="9999px"
              onSelect={clear}
            >
              Clear
            </HapticTile>
            <HapticTile
              id="osk-submit"
              variant="pill"
              radius="9999px"
              active={true}
              onSelect={() => props.onSubmit(props.value)}
            >
              Search
            </HapticTile>
            <HapticTile
              id="osk-cancel"
              variant="pill"
              radius="9999px"
              onSelect={props.onClose}
            >
              Cancel
            </HapticTile>
          </div>
        </div>
      </GlassPanel>
    </GlassPanel>
  );
}
