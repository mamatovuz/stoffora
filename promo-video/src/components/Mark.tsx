import React from "react";
import { clamp } from "../lib/motion";
import { C, SANS } from "../theme";

// Exact paths of the Staffora mark (src/assets/staffora-mark.svg in the app).
export const MARK_PATHS = [
  {
    d: "M19 29.2C19 24.1 22.5 20.3 27.1 19L46 13.8V19.1C46 24.2 43.4 27.5 38.7 28.9L25.6 32.7C21.7 33.8 19 32.2 19 29.2Z",
    fill: "#FFFFFF",
  },
  {
    d: "M21.2 27.4C19.2 29.6 19 32.1 20.4 34.8C21.6 37 23.8 38.2 27 39.4L38.7 43.9C42.2 45.2 43.9 47.1 43.3 49.7C45.9 47.6 46.3 44.5 44.7 41.8C43.5 39.8 41.4 38.4 38 37.1L26.1 32.6C23.2 31.5 21.6 29.9 21.2 27.4Z",
    fill: C.brandTint,
  },
  {
    d: "M18.9 50.4V45.2C18.9 41.4 21.2 38.9 25 37.8L38.2 34C42.2 32.8 45.1 34.3 45.1 37.5C45.1 42.5 41.8 46.1 37 47.5L18.9 52.5V50.4Z",
    fill: "#FFFFFF",
  },
];

/** Rotated-bar approximations of the three bands (64-unit box) used for morphs. */
export const BANDS = [
  { cx: 32.5, cy: 23.4, len: 28, thick: 9.5, angle: -25, color: "#FFFFFF" },
  { cx: 32.6, cy: 38.4, len: 27, thick: 6.5, angle: 33, color: C.brandTint },
  { cx: 32.0, cy: 43.0, len: 28, thick: 9.5, angle: -21, color: "#FFFFFF" },
];
// direction each band is drawn from (unit vector along its length)
const DIRS = BANDS.map((b) => [Math.cos((b.angle * Math.PI) / 180), Math.sin((b.angle * Math.PI) / 180)]);

/**
 * The mark. `size` is the full 64-unit box in px. `bands` (0→1 each) slides
 * the three strokes in along their own direction for the end-card build.
 */
export const Mark: React.FC<{
  size: number;
  bands?: [number, number, number];
  tile?: number; // tile scale 0→1
  style?: React.CSSProperties;
}> = ({ size, bands = [1, 1, 1], tile = 1, style }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" style={{ overflow: "visible", ...style }}>
    <rect
      x="2"
      y="2"
      width="60"
      height="60"
      rx="16"
      fill={C.brand}
      transform={`translate(32 32) scale(${tile}) translate(-32 -32)`}
    />
    <defs>
      <clipPath id="mark-tile">
        <rect x="2" y="2" width="60" height="60" rx="16" />
      </clipPath>
    </defs>
    <g clipPath="url(#mark-tile)">
      {MARK_PATHS.map((p, i) => {
        const b = clamp(bands[i], 0, 1.2);
        const off = (1 - b) * 26 * (i === 1 ? 1 : -1);
        return (
          <path
            key={i}
            d={p.d}
            fill={p.fill}
            opacity={clamp(b * 1.6)}
            transform={`translate(${DIRS[i][0] * off} ${DIRS[i][1] * off})`}
          />
        );
      })}
    </g>
  </svg>
);

/** Product wordmark: uppercase, heavy, tracked (matches the app's .logo). */
export const Wordmark: React.FC<{
  size: number;
  color: string;
  reveal?: number[]; // per-letter 0→1
  style?: React.CSSProperties;
}> = ({ size, color, reveal, style }) => (
  <div
    style={{
      display: "flex",
      fontFamily: SANS,
      fontWeight: 750,
      fontSize: size,
      letterSpacing: "0.07em",
      color,
      lineHeight: 1,
      ...style,
    }}
  >
    {"STAFFORA".split("").map((ch, i) => {
      const p = reveal ? reveal[i] : 1;
      return (
        <span key={i} style={{ display: "inline-block", overflow: "hidden", paddingBottom: size * 0.04 }}>
          <span style={{ display: "inline-block", transform: `translateY(${(1 - p) * 105}%)`, opacity: clamp(p * 2) }}>{ch}</span>
        </span>
      );
    })}
  </div>
);
