import React from "react";
import { cardT, phoneT } from "../lib/layout";
import { clamp, ease, tween } from "../lib/motion";
import { CUE, LIVE } from "../timeline";
import { C } from "../theme";
import { phonePoint, SCAN_CENTER } from "./Phone";

/** Elbow path with rounded corners through the given points. */
const elbow = (pts: [number, number][], r: number) => {
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const l1 = Math.hypot(x1 - x0, y1 - y0);
    const l2 = Math.hypot(x2 - x1, y2 - y1);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const a = [x1 - ((x1 - x0) / l1) * rr, y1 - ((y1 - y0) / l1) * rr];
    const b = [x1 + ((x2 - x1) / l2) * rr, y1 + ((y2 - y1) / l2) * rr];
    d += ` L ${a[0]} ${a[1]} Q ${x1} ${y1} ${b[0]} ${b[1]}`;
  }
  const last = pts[pts.length - 1];
  return d + ` L ${last[0]} ${last[1]}`;
};
const polyLen = (pts: [number, number][]) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
const pointAt = (pts: [number, number][], t: number): [number, number] => {
  let rem = polyLen(pts) * clamp(t);
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (rem <= seg) {
      const k = seg ? rem / seg : 0;
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k];
    }
    rem -= seg;
  }
  return pts[pts.length - 1];
};

const Dot: React.FC<{ x: number; y: number; o: number; r?: number }> = ({ x, y, o, r = 9 }) => (
  <div
    style={{
      position: "absolute",
      left: x - r,
      top: y - r,
      width: r * 2,
      height: r * 2,
      borderRadius: r * 2,
      background: C.brand,
      border: "3px solid #fff",
      boxSizing: "border-box",
      boxShadow: "0 2px 8px rgba(37,99,235,0.45)",
      opacity: o,
    }}
  />
);

/**
 * Bekzod's QR check-in travels from his row to the "Ishga kelgan" tile along
 * the left margin: the summary changes because the record changed.
 */
export const Connector: React.FC<{ f: number }> = ({ f }) => {
  const start = LIVE.bekzodIn + 1;
  const end = LIVE.bekzodKpi;
  if (f < start || f > end + 30) return null;
  const emp = cardT("employees", f);
  const kpi = cardT("kpi1", f);
  const rowY = emp.y + (94 + 4 * 52 + 26) * emp.s;
  const gapY = (kpi.y + kpi.h * kpi.s + emp.y) / 2;
  const tx = kpi.x + (kpi.w * kpi.s) / 2;
  const pts: [number, number][] = [
    [emp.x + 6, rowY],
    [44, rowY],
    [44, gapY],
    [tx, gapY],
    [tx, kpi.y + kpi.h * kpi.s - 2],
  ];
  const L = polyLen(pts);
  const draw = tween(f, start, end, ease.inOut);
  const fade = 1 - tween(f, end + 8, end + 26, ease.inOut);
  const [hx, hy] = pointAt(pts, draw);
  return (
    <div style={{ position: "absolute", inset: 0, opacity: fade }}>
      <svg width={1080} height={1920} style={{ position: "absolute", inset: 0 }}>
        <path d={elbow(pts, 18)} fill="none" stroke={C.brand} strokeWidth={3} strokeLinecap="round" strokeDasharray={`${L * draw} ${L * 2}`} />
      </svg>
      <Dot x={pts[0][0]} y={pts[0][1]} o={1} r={7} />
      <Dot x={hx} y={hy} o={draw < 1 ? 1 : 0} />
    </div>
  );
};

/**
 * Kamola's check-in leaves the phone and lands in the panel's activity feed.
 */
export const Packet: React.FC<{ f: number }> = ({ f }) => {
  const start = CUE.packet;
  const end = CUE.arrive;
  if (f < start - 2 || f > end + 40) return null;
  const ph = phoneT(f);
  const act = cardT("activity", f);
  const p0 = phonePoint(ph, SCAN_CENTER.x, SCAN_CENTER.y - 40);
  const p1 = { x: act.x + 74 * act.s, y: act.y + 65 * act.s };
  const c1 = { x: p0.x + 40, y: p0.y - 260 };
  const c2 = { x: p1.x - 200, y: p1.y + 40 };
  const bez = (t: number) => {
    const u = 1 - t;
    return {
      x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
      y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
    };
  };
  const head = tween(f, start, end, ease.inOut);
  const tail = tween(f, start + 6, end + 6, ease.inOut);
  const steps = 40;
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = mix(tail, head, i / steps);
    const p = bez(t);
    pts.push(`${i ? "L" : "M"} ${p.x} ${p.y}`);
  }
  const h = bez(head);
  const ripple = tween(f, end, end + 24, ease.out);
  const fade = 1 - tween(f, end + 4, end + 30);
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <svg width={1080} height={1920} style={{ position: "absolute", inset: 0, opacity: fade }}>
        <defs>
          <linearGradient id="trail" gradientUnits="userSpaceOnUse" x1={bez(tail).x} y1={bez(tail).y} x2={h.x} y2={h.y}>
            <stop offset="0" stopColor={C.brand} stopOpacity={0} />
            <stop offset="1" stopColor={C.brand} stopOpacity={1} />
          </linearGradient>
        </defs>
        <path d={pts.join(" ")} fill="none" stroke="url(#trail)" strokeWidth={4} strokeLinecap="round" />
      </svg>
      {head < 1 && <Dot x={h.x} y={h.y} o={clamp(tween(f, start - 2, start + 3) * 1)} r={10} />}
      {f >= end && (
        <div
          style={{
            position: "absolute",
            left: p1.x - 30,
            top: p1.y - 30,
            width: 60,
            height: 60,
            borderRadius: 60,
            border: `3px solid ${C.brand}`,
            opacity: (1 - ripple) * 0.8,
            transform: `scale(${0.4 + ripple * 1.2})`,
          }}
        />
      )}
    </div>
  );
};

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
