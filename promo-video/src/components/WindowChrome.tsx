import {
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  LayoutDashboard,
  Megaphone,
  Search,
  Settings,
  Users,
  Wallet,
} from "lucide-react";
import React from "react";
import { COMPANY, TODAY } from "../data";
import { WIN, WinT } from "../lib/layout";
import { clamp, mix, sp, SPR } from "../lib/motion";
import { CUE } from "../timeline";
import { C, SANS } from "../theme";
import { Mark } from "./Mark";
import { Avatar } from "./ui";

const NAV = [
  { group: "Asosiy", items: [{ l: "Bosh sahifa", I: LayoutDashboard, on: true }, { l: "Keldi-ketdi", I: Clock }, { l: "Hisobotlar", I: BarChart3 }] },
  { group: "Xodimlar", items: [{ l: "Xodimlar", I: Users }, { l: "Ta’til va yo‘qlik", I: CalendarDays }, { l: "Arizalar", I: FileText }] },
  { group: "Boshqaruv", items: [{ l: "Moliya", I: Wallet }, { l: "E’lonlar", I: Megaphone }, { l: "Tashkilot", I: Building2 }] },
  { group: "Tizim", items: [{ l: "Sozlamalar", I: Settings }] },
];

/** Window background: a framed desktop panel that can grow to fill the frame. */
export const WindowBg: React.FC<{ W: WinT; expand: number; dark: number }> = ({ W, expand, dark }) => {
  const x = mix(W.x, 0, expand);
  const y = mix(W.y, 0, expand);
  const w = mix(WIN.w * W.s, 1080, expand);
  const h = mix(WIN.h * W.s, 1920, expand);
  const r = mix(18 * W.s, 0, expand);
  if (W.o < 0.003 && expand < 0.01) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        height: h,
        borderRadius: r,
        background: C.bg,
        opacity: expand > 0 ? 1 : W.o,
        border: expand > 0.98 ? "none" : `1px solid ${dark > 0.5 ? "rgba(255,255,255,0.10)" : C.line}`,
        boxShadow:
          dark > 0.5
            ? "0 40px 120px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04)"
            : `0 30px 70px -10px rgba(15,23,42,${0.18 * (1 - expand)}), 0 6px 18px rgba(15,23,42,${0.06 * (1 - expand)})`,
      }}
    />
  );
};

/** Sidebar, top bar and page title, drawn in window-local virtual px. */
export const WindowChrome: React.FC<{ W: WinT; f: number; visible: number }> = ({ W, f, visible }) => {
  const o = W.o * visible;
  if (o < 0.003) return null;
  const a = (d: number) => {
    const p = f < CUE.product ? sp(f, CUE.dashAssemble + d, SPR.ui) : 1;
    return { opacity: clamp(p * 1.3), transform: `translateY(${(1 - p) * 10}px)` };
  };
  const side = f < CUE.product ? sp(f, CUE.dashAssemble, SPR.layout) : 1;
  return (
    <div
      style={{
        position: "absolute",
        left: W.x,
        top: W.y,
        width: WIN.w,
        height: WIN.h,
        transform: `scale(${W.s})`,
        transformOrigin: "0 0",
        opacity: o,
        fontFamily: SANS,
        color: C.ink,
        borderRadius: 18,
        overflow: "hidden",
      }}
    >
      {/* sidebar */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: WIN.side,
          background: C.surface,
          borderRight: `1px solid ${C.line}`,
          transform: `translateX(${(1 - side) * -40}px)`,
          opacity: clamp(side * 1.4),
          padding: "18px 14px",
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 6px", height: 30 }}>
          <Mark size={28} />
          <div style={{ fontWeight: 750, letterSpacing: "0.08em", fontSize: 14 }}>STAFFORA</div>
        </div>
        <div
          style={{
            marginTop: 18,
            height: 42,
            borderRadius: 10,
            border: `1px solid ${C.line}`,
            display: "flex",
            alignItems: "center",
            padding: "0 8px",
            gap: 9,
          }}
        >
          <div style={{ width: 26, height: 26, borderRadius: 7, background: C.ink, color: "#fff", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
            NS
          </div>
          <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{COMPANY}</div>
          <ChevronDown size={14} color={C.faint} />
        </div>
        {NAV.map((g) => (
          <div key={g.group} style={{ marginTop: 18 }}>
            <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: C.faint, padding: "0 10px 6px" }}>
              {g.group}
            </div>
            {g.items.map((it) => (
              <div
                key={it.l}
                style={{
                  position: "relative",
                  height: 34,
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "0 10px",
                  background: it.on ? C.brandSoft : "transparent",
                  color: it.on ? C.brand : C.ink2,
                  fontSize: 13.5,
                  fontWeight: it.on ? 600 : 500,
                }}
              >
                {it.on && <div style={{ position: "absolute", left: -14, top: 8, bottom: 8, width: 3, borderRadius: 3, background: C.brand }} />}
                <it.I size={16} color={it.on ? C.brand : C.muted} strokeWidth={2} />
                {it.l}
              </div>
            ))}
          </div>
        ))}
      </div>
      {/* top bar */}
      <div
        style={{
          position: "absolute",
          left: WIN.side,
          right: 0,
          top: 0,
          height: WIN.head,
          background: C.surface,
          borderBottom: `1px solid ${C.line}`,
          display: "flex",
          alignItems: "center",
          padding: "0 28px",
          gap: 14,
          ...a(4),
        }}
      >
        <div style={{ fontSize: 13, color: C.muted }}>
          Asosiy <span style={{ color: C.faint, margin: "0 6px" }}>/</span>
          <span style={{ color: C.ink, fontWeight: 500 }}>Bosh sahifa</span>
        </div>
        <div style={{ flex: 1 }} />
        <div
          style={{
            width: 300,
            height: 36,
            borderRadius: 9,
            background: C.surface2,
            border: `1px solid ${C.line}`,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 12px",
            fontSize: 13,
            color: C.faint,
          }}
        >
          <Search size={15} color={C.faint} />
          <div style={{ flex: 1 }}>Qidirish…</div>
          <div style={{ fontSize: 11, border: `1px solid ${C.line}`, borderRadius: 5, padding: "1px 5px", background: C.surface }}>Ctrl K</div>
        </div>
        <div style={{ width: 36, height: 36, borderRadius: 9, border: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Bell size={16} color={C.ink2} />
        </div>
        <Avatar initials="AK" tint={[C.ink, "#FFFFFF"]} size={34} />
      </div>
      {/* page title */}
      <div style={{ position: "absolute", left: 260, right: 28, top: 84, height: 44, display: "flex", alignItems: "center", ...a(8) }}>
        <div style={{ fontSize: 22, fontWeight: 650, letterSpacing: "-0.02em" }}>Bosh sahifa</div>
        <div style={{ flex: 1 }} />
        <div style={{ height: 34, borderRadius: 9, border: `1px solid ${C.line}`, background: C.surface, display: "flex", alignItems: "center", fontSize: 13, fontWeight: 500, color: C.ink2 }}>
          <div style={{ width: 32, display: "flex", justifyContent: "center", borderRight: `1px solid ${C.line}`, height: "100%", alignItems: "center" }}>
            <ChevronLeft size={15} color={C.muted} />
          </div>
          <div style={{ padding: "0 14px", display: "flex", alignItems: "center", gap: 8 }}>
            <CalendarDays size={14} color={C.muted} />
            {TODAY}
          </div>
          <div style={{ width: 32, display: "flex", justifyContent: "center", borderLeft: `1px solid ${C.line}`, height: "100%", alignItems: "center" }}>
            <ChevronRight size={15} color={C.muted} />
          </div>
        </div>
      </div>
    </div>
  );
};
