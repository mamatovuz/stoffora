import { Easing, interpolate, spring, SpringConfig } from "remotion";

export const FPS = 30;

// The product uses cubic-bezier(0.2, 0.8, 0.2, 1) for UI motion; the film
// reuses it so the ad moves like the software does.
export const ease = {
  out: Easing.bezier(0.2, 0.8, 0.2, 1),
  inOut: Easing.bezier(0.65, 0, 0.35, 1),
  cam: Easing.bezier(0.72, 0, 0.12, 1),
  in: Easing.bezier(0.55, 0, 0.8, 0.2),
  linear: (t: number) => t,
};

export const SPR = {
  // UI elements: settles fast, ~1–2 % overshoot
  ui: { damping: 20, stiffness: 150, mass: 0.9 } as Partial<SpringConfig>,
  // larger layout moves: softer, no visible bounce
  layout: { damping: 26, stiffness: 95, mass: 1 } as Partial<SpringConfig>,
  // logo and hero beats: a touch more presence
  hero: { damping: 16, stiffness: 110, mass: 1 } as Partial<SpringConfig>,
};

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Eased 0→1 progress between two frames. */
export const tween = (f: number, start: number, end: number, e: (t: number) => number = ease.out) =>
  interpolate(f, [start, end], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: e,
  });

/** Spring progress starting at `start` (0 before it). */
export const sp = (f: number, start: number, config = SPR.ui, durationInFrames?: number) =>
  f < start ? 0 : spring({ frame: f - start, fps: FPS, config, durationInFrames });

/** Fade/slide-in helper used by small UI parts. */
export const rise = (f: number, start: number, dist = 14, config = SPR.ui) => {
  const p = sp(f, start, config);
  return { opacity: clamp(p * 1.4), transform: `translateY(${(1 - p) * dist}px)` };
};

export type Rect = { x: number; y: number; w: number; h: number };
export const mixRect = (a: Rect, b: Rect, t: number): Rect => ({
  x: mix(a.x, b.x, t),
  y: mix(a.y, b.y, t),
  w: mix(a.w, b.w, t),
  h: mix(a.h, b.h, t),
});

/** Integer count-up that lands exactly on `to`. */
export const countUp = (f: number, start: number, dur: number, from: number, to: number) =>
  Math.round(mix(from, to, tween(f, start, start + dur, ease.out)));
