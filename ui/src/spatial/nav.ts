import { createSignal } from "solid-js";
import type { NavEvent } from "../bridge/types";

export interface FocusTarget {
  id: string;
  el: HTMLElement;
  onSelect: () => void;
}

const targets = new Map<string, FocusTarget>();
const historyStack: string[] = [];

const [focusedId, setFocusedId] = createSignal<string | null>(null);
const [focusRect, setFocusRect] = createSignal<{
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}>({ x: 0, y: 0, width: 0, height: 0, visible: false });

export function registerFocusable(
  id: string,
  el: HTMLElement,
  onSelect: () => void
): () => void {
  targets.set(id, { id, el, onSelect });
  if (!focusedId()) {
    setFocus(id, false);
  } else if (focusedId() === id) {
    measureFocused();
  }
  return () => {
    targets.delete(id);
    if (focusedId() === id) {
      const next = targets.keys().next().value ?? null;
      setFocusedId(next);
      measureFocused();
    }
  };
}

export function setFocus(id: string, pushHistory = true): void {
  const target = targets.get(id);
  if (!target) return;
  const prev = focusedId();
  if (pushHistory && prev && prev !== id) {
    historyStack.push(prev);
    if (historyStack.length > 24) {
      historyStack.shift();
    }
  }
  setFocusedId(id);
  target.el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  requestAnimationFrame(measureFocused);
}

export function ensureValidFocus(preferredId?: string): void {
  const current = focusedId();
  if (current && targets.has(current)) {
    measureFocused();
    return;
  }
  if (preferredId && targets.has(preferredId)) {
    setFocus(preferredId, false);
    return;
  }
  const first = targets.keys().next().value ?? null;
  if (first) {
    setFocus(first, false);
  } else {
    setFocusRect((r) => ({ ...r, visible: false }));
  }
}

export function measureFocused(): void {
  const id = focusedId();
  if (!id) {
    setFocusRect((r) => ({ ...r, visible: false }));
    return;
  }
  const target = targets.get(id);
  if (!target) {
    setFocusRect((r) => ({ ...r, visible: false }));
    return;
  }
  const rect = target.el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    setFocusRect((r) => ({ ...r, visible: false }));
    return;
  }
  setFocusRect({
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
    visible: true
  });
}

export function handleSpatialNav(ev: NavEvent): boolean {
  if (ev === "Select") {
    const id = focusedId();
    if (id) {
      const target = targets.get(id);
      if (target) {
        target.onSelect();
        return true;
      }
    }
    return false;
  }

  if (ev === "Back") {
    while (historyStack.length > 0) {
      const prev = historyStack.pop()!;
      if (targets.has(prev)) {
        setFocus(prev, false);
        return true;
      }
    }
    return false;
  }

  if (ev !== "Up" && ev !== "Down" && ev !== "Left" && ev !== "Right") {
    return false;
  }

  const currentId = focusedId();
  const current = currentId ? targets.get(currentId) : undefined;
  if (!current) {
    ensureValidFocus();
    return true;
  }

  const curRect = current.el.getBoundingClientRect();
  const curCx = curRect.left + curRect.width / 2;
  const curCy = curRect.top + curRect.height / 2;

  let bestId: string | null = null;
  let bestScore = Infinity;

  for (const [id, candidate] of targets.entries()) {
    if (id === currentId) continue;
    const r = candidate.el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;

    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = cx - curCx;
    const dy = cy - curCy;

    let primary = 0;
    let secondary = 0;

    if (ev === "Right") {
      if (dx <= 8) continue;
      primary = dx;
      secondary = Math.abs(dy);
    } else if (ev === "Left") {
      if (dx >= -8) continue;
      primary = -dx;
      secondary = Math.abs(dy);
    } else if (ev === "Down") {
      if (dy <= 8) continue;
      primary = dy;
      secondary = Math.abs(dx);
    } else if (ev === "Up") {
      if (dy >= -8) continue;
      primary = -dy;
      secondary = Math.abs(dx);
    }

    // Weight cross-axis alignment more heavily so rows/columns feel crisp.
    const score = primary + secondary * 2.2;
    if (score < bestScore) {
      bestScore = score;
      bestId = id;
    }
  }

  if (bestId) {
    setFocus(bestId, true);
    return true;
  }
  return false;
}

export { focusedId, focusRect };
