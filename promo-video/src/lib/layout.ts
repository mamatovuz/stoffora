import { CUE } from "../timeline";
import { CONTENT, MARGIN } from "../theme";
import { clamp, ease, mix, sp, SPR, tween } from "./motion";

/* ------------------------------------------------------------------ chains
 * A chain is a deterministic list of keyframed moves. Each step blends from
 * the value produced by all earlier steps (evaluated at the same frame) to its
 * target, so targets may themselves be moving (e.g. "back inside the window").
 */
export type Vals = Record<string, number>;
type Target<T extends Vals> = Partial<T> | ((f: number) => Partial<T>);
export type Step<T extends Vals> = {
  at: number;
  to: Target<T>;
  dur?: number; // bezier when set
  e?: (t: number) => number;
  spring?: typeof SPR.ui; // spring when set (default: layout spring)
};

export function chain<T extends Vals>(f: number, initial: T, steps: Step<T>[]): T {
  let v: T = { ...initial };
  for (const s of steps) {
    if (f < s.at) break;
    const to = typeof s.to === "function" ? s.to(f) : s.to;
    const p = s.dur !== undefined ? tween(f, s.at, s.at + Math.max(1, s.dur), s.e ?? ease.cam) : sp(f, s.at, s.spring ?? SPR.layout);
    const next = { ...v };
    for (const k of Object.keys(to) as (keyof T)[]) {
      const target = to[k] as number;
      // opacity never overshoots
      next[k] = (k === "o" ? mix(v[k] as number, target, clamp(p)) : mix(v[k] as number, target, p)) as T[keyof T];
    }
    v = next;
  }
  return v;
}

/* ------------------------------------------------------------------ window
 * The desktop panel is a 1440×900 virtual window. W = its screen transform.
 */
export const WIN = { w: 1440, h: 900, side: 232, head: 64 };
export type WinT = { x: number; y: number; s: number; o: number; rx: number; ry: number };

export const windowT = (f: number): WinT =>
  chain<WinT>(f, { x: 70, y: 1990, s: 0.653, o: 1, rx: 24, ry: 0 }, [
    { at: CUE.sheetRise, to: { y: 930, rx: 0 }, dur: 46, e: ease.out },
    { at: 300, to: { y: 700 }, dur: 1 }, // re-parked while hidden behind the full-frame product view
    { at: CUE.phoneRise - 4, to: { y: 640 }, dur: 36, e: ease.inOut },
    { at: CUE.phoneFocus, to: { o: 0, s: 0.56, x: 260, y: 560 }, dur: 16, e: ease.inOut },
    { at: 656, to: { o: 1, s: 0.62, x: 140, y: 600 }, dur: 32 },
    { at: CUE.hero - 6, to: { rx: 4, ry: 6, y: 576, x: 126, s: 0.64 }, dur: 54, e: ease.inOut }, // slow push-in
    { at: CUE.brand - 2, to: { o: 0, y: 680, s: 0.6 }, dur: 16, e: ease.in },
  ]);

/** 0 = framed desktop window, 1 = window has become the whole frame. */
export const expandAt = (f: number) =>
  tween(f, 248, 278, ease.cam) * (1 - tween(f, CUE.system, CUE.system + 32, ease.cam));

/** Window-local card slots (virtual px). */
export const SLOT = {
  kpi0: { x: 260, y: 148, w: 276, h: 112 },
  kpi1: { x: 552, y: 148, w: 276, h: 112 },
  kpi2: { x: 844, y: 148, w: 276, h: 112 },
  kpi3: { x: 1136, y: 148, w: 276, h: 112 },
  employees: { x: 260, y: 276, w: 728, h: 352 },
  ring: { x: 1004, y: 276, w: 408, h: 352 },
  chart: { x: 260, y: 644, w: 728, h: 228 },
  activity: { x: 1004, y: 644, w: 408, h: 228 },
} as const;
export type CardId = keyof typeof SLOT;

/** Card transform: screen x/y, virtual w/h, scale s, opacity o. */
export type CardT = { x: number; y: number; w: number; h: number; s: number; o: number };

/** First appearance inside the window during the reveal (stagger). */
const ASSEMBLE: Record<CardId, number> = {
  kpi0: CUE.dashAssemble + 10,
  kpi1: CUE.dashAssemble + 13,
  kpi2: CUE.dashAssemble + 16,
  kpi3: CUE.dashAssemble + 19,
  employees: CUE.dashAssemble + 22,
  ring: CUE.dashAssemble + 25,
  chart: CUE.dashAssemble + 28,
  activity: CUE.dashAssemble + 31,
};
export const assembleAt = (id: CardId) => ASSEMBLE[id];

const inWindow = (id: CardId) => (f: number): CardT => {
  const W = windowT(f);
  const L = SLOT[id];
  return { x: W.x + L.x * W.s, y: W.y + L.y * W.s, w: L.w, h: L.h, s: W.s, o: W.o };
};
const fadeInPlace = (id: CardId) => (f: number): Partial<CardT> => ({ ...inWindow(id)(f), o: 0 });

/* Vertical "product" layouts (screen px; virtual size = screen / s). */
const S = 2;
const TOP = 560;
const GAP = 24;
const half = (CONTENT - GAP) / 2; // 456
const colD: Record<string, Partial<CardT>> = {
  kpi0: { x: MARGIN, y: TOP, w: half / S, h: 232 / S, s: S },
  kpi1: { x: MARGIN + half + GAP, y: TOP, w: half / S, h: 232 / S, s: S },
  kpi2: { x: MARGIN, y: TOP + 232 + GAP, w: half / S, h: 232 / S, s: S },
  kpi3: { x: MARGIN + half + GAP, y: TOP + 232 + GAP, w: half / S, h: 232 / S, s: S },
  ring: { x: MARGIN, y: TOP + 2 * (232 + GAP) + 8, w: CONTENT / S, h: 524 / S, s: S },
};
const STRIP_S = 1.8;
const stripW = (CONTENT - 3 * 16) / 4; // 222
const strip = (i: number): Partial<CardT> => ({
  x: MARGIN + i * (stripW + 16),
  y: TOP,
  w: stripW / STRIP_S,
  h: 150 / STRIP_S,
  s: STRIP_S,
});
export const BELOW_STRIP = TOP + 150 + 32; // 742
const colE = { x: MARGIN, y: BELOW_STRIP, w: CONTENT / S, h: 852 / S, s: S };
const colChart = { x: MARGIN, y: BELOW_STRIP, w: CONTENT / S, h: 408 / S, s: S };
const colAct = { x: MARGIN, y: BELOW_STRIP + 408 + 32, w: CONTENT / S, h: 412 / S, s: S };

export const COL_LAYOUT = { colD, strip, colE, colChart, colAct };

const kpiSteps = (i: number) => {
  const id = `kpi${i}` as CardId;
  return [
    { at: CUE.product + i * 3, to: colD[id] },
    { at: CUE.employees + i * 4, to: strip(i) },
    { at: CUE.system + i, to: inWindow(id) },
  ];
};

const STEPS: Record<CardId, Step<CardT>[]> = {
  kpi0: kpiSteps(0),
  kpi1: kpiSteps(1),
  kpi2: kpiSteps(2),
  kpi3: kpiSteps(3),
  ring: [
    { at: CUE.product + 10, to: colD.ring },
    { at: CUE.employees, to: { ...colD.ring, y: (colD.ring.y as number) + 160, o: 0 }, dur: 12, e: ease.out },
    { at: CUE.employees + 14, to: { y: 2000 }, dur: 1 },
    { at: CUE.system + 3, to: inWindow("ring") },
  ],
  employees: [
    { at: CUE.product, to: fadeInPlace("employees"), dur: 12, e: ease.out },
    { at: 300, to: { ...colE, y: colE.y + 420, o: 0 }, dur: 1 },
    { at: CUE.employees + 4, to: { ...colE, o: 1 } },
    { at: CUE.stats, to: { ...colE, x: colE.x - 1040, o: 0.0 }, dur: 22, e: ease.in },
    { at: CUE.system + 2, to: inWindow("employees") },
  ],
  chart: [
    { at: CUE.product + 2, to: fadeInPlace("chart"), dur: 12, e: ease.out },
    { at: 330, to: { ...colChart, x: colChart.x + 1040, o: 1 }, dur: 1 },
    { at: CUE.stats + 4, to: colChart },
    { at: CUE.system + 1, to: inWindow("chart") },
  ],
  activity: [
    { at: CUE.product + 4, to: fadeInPlace("activity"), dur: 12, e: ease.out },
    { at: 330, to: { ...colAct, x: colAct.x + 1040, o: 1 }, dur: 1 },
    { at: CUE.stats + 12, to: colAct },
    { at: CUE.system + 3, to: inWindow("activity") },
  ],
};

export const cardT = (id: CardId, f: number): CardT => {
  const base = inWindow(id)(f);
  const v = chain<CardT>(f, base, STEPS[id]);
  // reveal-time assembly inside the window
  const a = sp(f, ASSEMBLE[id], SPR.ui);
  const assembled = f < CUE.product ? a : 1;
  return {
    ...v,
    y: v.y + (1 - assembled) * 18 * v.s,
    o: v.o * clamp(assembled * 1.3),
  };
};

/* ------------------------------------------------------------------ phone */
export const PHONE = { w: 390, h: 844 };
export type PhoneT = { x: number; y: number; s: number; o: number; ry: number; rx: number };
export const phoneT = (f: number): PhoneT =>
  chain<PhoneT>(f, { x: 90, y: 2000, s: 1.15, o: 1, ry: 0, rx: 0 }, [
    { at: CUE.phoneRise, to: { y: 1150 }, spring: SPR.layout },
    { at: CUE.phoneFocus, to: { x: (1080 - PHONE.w * 1.75) / 2, y: 548, s: 1.75 }, dur: 30 },
    { at: 656, to: { x: 40, y: 980, s: 1.0 }, dur: 32 },
    { at: CUE.hero - 6, to: { y: 930, s: 1.04, ry: -6, rx: 3 }, dur: 54, e: ease.inOut },
    { at: CUE.brand - 2, to: { y: 1060, o: 0 }, dur: 16, e: ease.in },
  ]);
