import type { JSX } from "solid-js";

/**
 * True cylindrical fluted-glass backdrop.
 *
 * Layer A — a rich crimson light field (#5E0B0A / #6E0D0C / #831613) carrying two soft,
 *           volumetric #E13A26 + #FF523B light pools: one centre-left behind the hero copy,
 *           one upper-centre behind the navigation.
 * Layer B — wide architectural glass reeds (48px pitch) rendered as a crisp repeating
 *           cylindrical lens curve: specular edge → soft highlight → neutral core → deep
 *           trough → rim catchlight. A second, offset 74px reed layer in soft-light gives
 *           the ridges a natural, non-repetitive optical rhythm.
 *
 * No SVG displacement filters and no needle stripes: the refraction is pure CSS gradients,
 * so the bottom edge stays razor-clean at every viewport size.
 */

export interface FlutedBackdropProps {
  class?: string;
  style?: JSX.CSSProperties;
  /** Disable the slow bloom drift (e.g. on low-power devices). */
  still?: boolean;
}

export function FlutedBackdrop(props: FlutedBackdropProps) {
  return (
    <div class={`fluted-backdrop ${props.class ?? ""}`} style={props.style} aria-hidden="true">
      {/* Layer A — deep crimson field + volumetric light pools */}
      <div class="fluted-backdrop__field" />
      <div
        class="fluted-backdrop__bloom"
        style={props.still ? { animation: "none" } : undefined}
      />

      {/* Layer B — cylindrical glass reeds, plus an offset soft-light relief layer */}
      <div class="fluted-backdrop__reeds" />
      <div class="fluted-backdrop__reeds fluted-backdrop__reeds--offset" />

      <div class="fluted-backdrop__vignette" />
    </div>
  );
}
