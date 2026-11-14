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
  radius: string;
  visible: boolean;
}>({ x: 0, y: 0, width: 0, height: 0, radius: "16px", visible: false });

function syncFocusedAttribute(activeId: string | null): void {
  for (const [id, target] of targets.entries()) {
    if (id === activeId) {
      target.el.setAttribute("data-focused", "true");
    } else {
      target.el.removeAttribute("data-focused");
    }
  }
}

export function isFocused(id: string): boolean {
  return focusedId() === id;
}

export function registerFocusable(
  id: string,
  el: HTMLElement,
  onSelect: () => void
): () => void {
  targets.set(id, { id, el, onSelect });
  if (!focusedId()) {
    setFocus(id, false);
  } else if (focusedId() === id) {
    el.setAttribute("data-focused", "true");
    measureFocused();
  }
  return () => {
    el.removeAttribute("data-focused");
    el.removeAttribute("data-pressed");
    targets.delete(id);
    if (focusedId() === id) {
      const next = targets.keys().next().value ?? null;
      setFocusedId(next);
      syncFocusedAttribute(next);
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
  syncFocusedAttribute(id);
  target.el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  requestAnimationFrame(measureFocused);
}

export function ensureValidFocus(preferredId?: string): void {
  const current = focusedId();
  if (current) {
    const t = targets.get(current);
    if (t && t.el.isConnected) {
      const r = t.el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        syncFocusedAttribute(current);
        measureFocused();
        return;
      }
    }
  }
  if (preferredId) {
    const t = targets.get(preferredId);
    if (t && t.el.isConnected) {
      setFocus(preferredId, false);
      return;
    }
  }
  for (const [id, t] of targets.entries()) {
    if (!t.el.isConnected) continue;
    const r = t.el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      setFocus(id, false);
      return;
    }
  }
  syncFocusedAttribute(null);
  setFocusRect((r) => ({ ...r, visible: false }));
}

const SELF_FOCUS_SELECTOR =
  ".pill, .nav-link, .text-link, .glass-card-interactive, .glass-inner, .strip-item, .key";

function usesSelfFocus(el: HTMLElement): boolean {
  if (el.dataset.focusSelf === "false" || el.dataset.focusRing === "reticle") {
    return false;
  }
  if (el.dataset.focusSelf === "true") {
    return true;
  }
  return el.matches(SELF_FOCUS_SELECTOR);
}

export function measureFocused(): void {
  const id = focusedId();
  if (!id) {
    setFocusRect((r) => ({ ...r, visible: false }));
    return;
  }
  const target = targets.get(id);
  if (!target || !target.el.isConnected) {
    setFocusRect((r) => ({ ...r, visible: false }));
    return;
  }
  if (usesSelfFocus(target.el)) {
    setFocusRect((r) => (r.visible ? { ...r, visible: false } : r));
    return;
  }
  const rect = target.el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    setFocusRect((r) => ({ ...r, visible: false }));
    return;
  }
  const computed = window.getComputedStyle(target.el);
  const radius = target.el.dataset.focusRadius || computed.borderRadius || "16px";
  setFocusRect({
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
    radius,
    visible: true
  });
}

export function handleSpatialNav(ev: NavEvent): boolean {
  if (ev === "Select") {
    const id = focusedId();
    if (id) {
      const target = targets.get(id);
      if (target) {
        target.el.setAttribute("data-pressed", "true");
        window.setTimeout(() => {
          target.el.removeAttribute("data-pressed");
        }, 140);
        target.onSelect();
        requestAnimationFrame(measureFocused);
        return true;
      }
    }
    return false;
  }

  if (ev === "Back") {
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
