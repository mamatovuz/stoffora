import React from "react";
import { STATUS, Status } from "../data";
import { C, MONO, SANS } from "../theme";

export const Avatar: React.FC<{
  initials: string;
  tint: readonly [string, string];
  size: number;
  style?: React.CSSProperties;
}> = ({ initials, tint, size, style }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: size,
      background: tint[0],
      color: tint[1],
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: SANS,
      fontWeight: 600,
      fontSize: size * 0.36,
      letterSpacing: "0.01em",
      flexShrink: 0,
      ...style,
    }}
  >
    {initials}
  </div>
);

export const StatusPill: React.FC<{ status: Status; size?: number; style?: React.CSSProperties }> = ({
  status,
  size = 12,
  style,
}) => {
  const s = STATUS[status];
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: size * 0.45,
        height: size * 2,
        padding: `0 ${size * 0.75}px 0 ${size * 0.6}px`,
        borderRadius: size * 2,
        background: s.bg,
        color: s.text,
        fontFamily: SANS,
        fontSize: size,
        fontWeight: 500,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      <div style={{ width: size * 0.5, height: size * 0.5, borderRadius: 10, background: s.dot }} />
      {s.label}
    </div>
  );
};

export const Mono: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <span style={{ fontFamily: MONO, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em", ...style }}>
    {children}
  </span>
);

/** A number that rolls vertically when it changes (odometer-style, one step). */
export const RollingNumber: React.FC<{
  from: number | string;
  to: number | string;
  progress: number; // 0 → shows `from`, 1 → shows `to`
  style?: React.CSSProperties;
}> = ({ from, to, progress, style }) => {
  if (from === to || progress <= 0) return <span style={style}>{from}</span>;
  if (progress >= 1) return <span style={style}>{to}</span>;
  return (
    <span style={{ display: "inline-grid", overflow: "hidden", verticalAlign: "bottom", ...style }}>
      <span style={{ gridArea: "1/1", transform: `translateY(${-progress * 100}%)`, opacity: 1 - progress }}>{from}</span>
      <span style={{ gridArea: "1/1", transform: `translateY(${(1 - progress) * 100}%)`, opacity: progress }}>{to}</span>
    </span>
  );
};

export const CardTitle: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ fontFamily: SANS, fontSize: 14, fontWeight: 600, color: C.ink, letterSpacing: "-0.01em", ...style }}>
    {children}
  </div>
);
