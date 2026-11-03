import { Clock, Palmtree, QrCode, ScanFace, UserCheck, Users, ChevronRight, ChevronDown } from "lucide-react";
import React from "react";
import { activityAt, BEKZOD_ROW, chartAt, EMPLOYEES, kpis, STATUS } from "../data";
import { CardId, CardT, assembleAt } from "../lib/layout";
import { clamp, countUp, ease, mix, sp, SPR, tween } from "../lib/motion";
import { CUE, LIVE } from "../timeline";
import { C, MONO, SANS } from "../theme";
import { Avatar, CardTitle, Mono, RollingNumber, StatusPill } from "./ui";

/* --------------------------------------------------------------- shell */
export const CardShell: React.FC<{
  t: CardT;
  flash?: number;
  children: React.ReactNode;
}> = ({ t, flash = 0, children }) => {
  if (t.o < 0.003) return null;
  const lift = clamp((t.s - 0.75) / 1.0);
  const hair = 1.2 / t.s;
  return (
    <div
      style={{
        position: "absolute",
        left: t.x,
        top: t.y,
        width: t.w,
        height: t.h,
        transform: `scale(${t.s})`,
        transformOrigin: "0 0",
        opacity: clamp(t.o),
        background: C.surface,
        borderRadius: 14,
        border: `${hair}px solid ${flash > 0 ? mixColor(C.line, C.brand, flash * 0.9) : C.line}`,
        boxShadow: [
          `0 ${0.5 + lift * 0.5}px ${1 + lift}px rgba(15,23,42,0.05)`,
          `0 ${4 + lift * 8}px ${12 + lift * 22}px -${lift * 6}px rgba(15,23,42,${0.05 + lift * 0.05})`,
          flash > 0 ? `0 0 0 ${3.5 * flash}px rgba(37,99,235,${0.14 * flash})` : "",
        ]
          .filter(Boolean)
          .join(","),
        overflow: "hidden",
        fontFamily: SANS,
        color: C.ink,
      }}
    >
      {children}
    </div>
  );
};

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
export const mixColor = (a: string, b: string, t: number) => {
  const A = hex(a);
  const B = hex(b);
  return `rgb(${A.map((v, i) => Math.round(mix(v, B[i], clamp(t)))).join(",")})`;
};

/** Brief highlight after a live change lands. */
const flashAt = (f: number, at: number) => (f < at ? 0 : 1 - tween(f, at + 6, at + 40, ease.inOut));

/** Number that counts up during the reveal and rolls on live changes. */
const liveValue = (f: number, id: CardId, get: (f: number) => number, changes: number[]) => {
  const start = assembleAt(id) + 4;
  const value = get(f);
  if (f < CUE.product) return { text: String(countUp(f, start, 34, 0, value)), roll: null };
  for (const at of changes) {
    if (f >= at && f < at + 12) {
      return { text: "", roll: { from: get(at - 1), to: get(at), p: tween(f, at, at + 10, ease.out) } };
    }
  }
  return { text: String(value), roll: null };
};

/* --------------------------------------------------------------- KPI tile */
const KPI_DEF = [
  { label: "Jami xodimlar", Icon: Users, fg: C.brand, bg: C.brandSoft, get: (f: number) => kpis(f).total, sub: () => "3 ta filial" },
  {
    label: "Ishga kelgan",
    Icon: UserCheck,
    fg: C.okText,
    bg: C.okBg,
    get: (f: number) => kpis(f).came,
    sub: (f: number) => `${kpis(f).rate}% davomat`,
  },
  { label: "Kechikkan", Icon: Clock, fg: C.lateText, bg: C.lateBg, get: (f: number) => kpis(f).late, sub: () => "bugun" },
  { label: "Ta’tilda", Icon: Palmtree, fg: C.leaveText, bg: C.leaveBg, get: (f: number) => kpis(f).leave, sub: () => "2 ta so‘rov" },
];

export const KpiCard: React.FC<{ i: number; t: CardT; f: number }> = ({ i, t, f }) => {
  const d = KPI_DEF[i];
  const id = `kpi${i}` as CardId;
  const live = i === 1 ? [LIVE.bekzodKpi, LIVE.kamolaIn] : [];
  const n = liveValue(f, id, d.get, live);
  const full = clamp((t.w - 132) / 70); // semantic detail: compact strip → full tile
  const flash = i === 1 ? Math.max(flashAt(f, LIVE.bekzodKpi), flashAt(f, LIVE.kamolaIn)) : 0;
  const pad = mix(12, 18, full);
  return (
    <CardShell t={t} flash={flash}>
      <div style={{ padding: pad, height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{
              width: 26 * full,
              height: 26,
              marginRight: 10 * full,
              borderRadius: 8,
              background: d.bg,
              opacity: full,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
            }}
          >
            <d.Icon size={14} color={d.fg} strokeWidth={2.2} />
          </div>
          <div style={{ fontSize: mix(11, 12.5, full), fontWeight: 500, color: C.muted, whiteSpace: "nowrap" }}>{d.label}</div>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <div
            style={{
              fontSize: mix(25, 31, full),
              fontWeight: 650,
              letterSpacing: "-0.03em",
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1,
              color: flash > 0.3 ? mixColor(C.ink, C.brand, (flash - 0.3) * 1.4) : C.ink,
            }}
          >
            {n.roll ? <RollingNumber from={n.roll.from} to={n.roll.to} progress={n.roll.p} /> : n.text}
          </div>
          <div style={{ fontSize: 11.5, color: C.muted, opacity: full, whiteSpace: "nowrap" }}>{d.sub(f)}</div>
        </div>
      </div>
    </CardShell>
  );
};

/* --------------------------------------------------------------- ring */
const arc = (cx: number, cy: number, r: number, a0: number, a1: number) => {
  const p = (a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1}`;
};

export const RingCard: React.FC<{ t: CardT; f: number }> = ({ t, f }) => {
  const k = kpis(f);
  const segs = [
    { label: "Vaqtida", v: k.onTime, c: C.ok },
    { label: "Kechikkan", v: k.late, c: C.late },
    { label: "Kelmagan", v: k.absent, c: C.bad },
    { label: "Kutilmoqda", v: k.waiting, c: C.wait },
  ];
  const sweep = sp(f, assembleAt("ring") + 6, SPR.layout);
  const R = 150;
  const r = 62;
  const gap = 0.045;
  let a = -Math.PI / 2;
  const total = k.expected;
  const detail = f > CUE.product ? 1 : 0; // proportion bars appear once the card is in focus
  const rate = liveValue(f, "ring", (ff) => kpis(ff).rate, [LIVE.bekzodKpi, LIVE.kamolaIn]);
  return (
    <CardShell t={t}>
      <div style={{ padding: 18, height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <CardTitle>Bugungi davomat</CardTitle>
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: C.muted }}>
            Barcha filiallar <ChevronDown size={13} color={C.faint} />
          </div>
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 26 }}>
          <div style={{ position: "relative", width: R, height: R, flexShrink: 0 }}>
            <svg width={R} height={R}>
              <circle cx={R / 2} cy={R / 2} r={r} fill="none" stroke={C.lineSoft} strokeWidth={13} />
              {segs.map((s, i) => {
                const span = (s.v / total) * Math.PI * 2 * sweep;
                const a0 = a + gap / 2;
                const a1 = a + Math.max(span - gap / 2, gap / 2 + 0.001);
                a += span;
                if (s.v <= 0 || span < gap) return null;
                return <path key={i} d={arc(R / 2, R / 2, r, a0, a1)} fill="none" stroke={s.c} strokeWidth={13} strokeLinecap="butt" />;
              })}
            </svg>
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <div style={{ fontSize: 30, fontWeight: 650, letterSpacing: "-0.03em", lineHeight: 1 }}>
                {rate.roll ? <RollingNumber from={rate.roll.from} to={rate.roll.to} progress={rate.roll.p} /> : rate.text}
                <span style={{ fontSize: 17, color: C.muted, fontWeight: 600 }}>%</span>
              </div>
              <Mono style={{ fontSize: 11, color: C.muted, marginTop: 5 }}>
                {k.came} / {k.expected}
              </Mono>
            </div>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 9 }}>
            {segs.map((s, i) => {
              const bar = detail * tween(f, CUE.product + 22 + i * 4, CUE.product + 46 + i * 4, ease.out);
              return (
                <div key={s.label}>
                  <div style={{ display: "flex", alignItems: "center", fontSize: 12.5 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 3, background: s.c, marginRight: 9 }} />
                    <div style={{ color: C.ink2, flex: 1 }}>{s.label}</div>
                    <Mono style={{ fontSize: 12.5, color: C.ink, fontWeight: 500 }}>{s.v}</Mono>
                  </div>
                  <div style={{ height: 3, borderRadius: 3, background: C.lineSoft, marginTop: 5, marginLeft: 17, opacity: bar > 0 ? 1 : 0 }}>
                    <div style={{ height: 3, borderRadius: 3, background: s.c, width: `${(s.v / total) * 100 * bar}%` }} />
                  </div>
                </div>
              );
            })}
            <div style={{ fontSize: 11.5, color: C.faint, marginTop: 2 }}>Ta’tilda: {k.leave} nafar</div>
          </div>
        </div>
      </div>
    </CardShell>
  );
};

/* --------------------------------------------------------------- employees */
export const EmployeesCard: React.FC<{ t: CardT; f: number }> = ({ t, f }) => {
  const k = kpis(f);
  const rowsBase = f < CUE.employees ? assembleAt("employees") + 6 : CUE.employees + 12;
  const filters = [
    { label: "Hammasi", n: k.total, on: true },
    { label: "Ishda", n: k.came },
    { label: "Kechikkan", n: k.late },
    { label: "Ta’tilda", n: k.leave },
  ];
  return (
    <CardShell t={t}>
      <div style={{ padding: "16px 18px 0", display: "flex", alignItems: "center", justifyContent: "space-between", height: 54, boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <CardTitle>Bugungi xodimlar</CardTitle>
          <Mono style={{ fontSize: 11, color: C.muted, background: C.waitBg, borderRadius: 6, padding: "2px 6px" }}>{k.total}</Mono>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 12, color: C.brand, fontWeight: 500 }}>
          Barchasi <ChevronRight size={13} color={C.brand} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, padding: "4px 18px 10px" }}>
        {filters.map((x) => (
          <div
            key={x.label}
            style={{
              height: 26,
              padding: "0 10px",
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              fontWeight: 500,
              background: x.on ? C.brandSoft : C.surface,
              color: x.on ? C.brand : C.muted,
              border: `1px solid ${x.on ? C.brandLine : C.line}`,
            }}
          >
            {x.label}
            <Mono style={{ fontSize: 11, opacity: 0.8 }}>{x.n}</Mono>
          </div>
        ))}
      </div>
      {EMPLOYEES.map((e, i) => {
        const p = sp(f, rowsBase + i * 4, SPR.ui);
        const status = e.status(f);
        const changed = i === BEKZOD_ROW ? tween(f, LIVE.bekzodIn, LIVE.bekzodIn + 9, ease.out) : 0;
        const glow = i === BEKZOD_ROW && f >= LIVE.bekzodIn ? 1 - tween(f, LIVE.bekzodIn + 14, LIVE.bekzodIn + 46, ease.inOut) : 0;
        return (
          <div
            key={e.name}
            style={{
              height: 52,
              display: "flex",
              alignItems: "center",
              padding: "0 18px",
              borderTop: `1px solid ${C.lineSoft}`,
              background: glow > 0 ? `rgba(239,244,255,${glow})` : "transparent",
              opacity: clamp(p * 1.3),
              transform: `translateY(${(1 - p) * 12}px)`,
            }}
          >
            <Avatar initials={e.initials} tint={e.tint} size={32} />
            <div style={{ marginLeft: 12, flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 550, color: C.ink, whiteSpace: "nowrap" }}>{e.name}</div>
              <div style={{ fontSize: 11.5, color: C.muted, marginTop: 1 }}>{e.role}</div>
            </div>
            <Mono style={{ fontSize: 12.5, color: e.time(f) === "—" ? C.faint : C.ink2, width: 46, textAlign: "right", marginRight: 16 }}>
              {i === BEKZOD_ROW && changed > 0 && changed < 1 ? (
                <RollingNumber from="—" to={e.time(f)} progress={changed} />
              ) : (
                e.time(f)
              )}
            </Mono>
            <div style={{ width: 98, display: "flex", justifyContent: "flex-end", position: "relative" }}>
              {i === BEKZOD_ROW && changed > 0 && changed < 1 ? (
                <>
                  <StatusPill status="wait" style={{ position: "absolute", right: 0, opacity: 1 - changed, transform: `scale(${1 - changed * 0.15})` }} />
                  <StatusPill status="ok" style={{ opacity: changed, transform: `scale(${0.85 + changed * 0.15})` }} />
                </>
              ) : (
                <StatusPill status={status} />
              )}
            </div>
          </div>
        );
      })}
    </CardShell>
  );
};

/* --------------------------------------------------------------- chart */
export const ChartCard: React.FC<{ t: CardT; f: number }> = ({ t, f }) => {
  const data = chartAt(f);
  const base = f < CUE.employees ? assembleAt("chart") + 8 : CUE.stats + 22;
  const plotH = t.h - 18 - 44 - 22 - 16;
  const plotW = t.w - 36 - 30;
  const n = data.length;
  const slot = plotW / n;
  const bw = slot * 0.56;
  const yOf = (v: number) => plotH * clamp((v - 80) / 20);
  const today = data[n - 1];
  return (
    <CardShell t={t}>
      <div style={{ padding: "16px 18px 0", height: 44 + 16, boxSizing: "border-box", display: "flex", justifyContent: "space-between" }}>
        <div>
          <CardTitle>Davomat dinamikasi</CardTitle>
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 3 }}>So‘nggi 12 ish kuni</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 20, fontWeight: 650, letterSpacing: "-0.03em", lineHeight: 1 }}>
            {today.rate}
            <span style={{ fontSize: 13, color: C.muted }}>%</span>
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>bugun</div>
        </div>
      </div>
      <div style={{ position: "relative", marginLeft: 18, marginTop: 6, width: plotW + 30, height: plotH + 22 }}>
        {[80, 90, 100].map((g) => (
          <div key={g} style={{ position: "absolute", left: 0, top: plotH - yOf(g) - 6, width: plotW + 30, display: "flex", alignItems: "center" }}>
            <Mono style={{ fontSize: 9.5, color: C.faint, width: 26 }}>{g}%</Mono>
            <div style={{ flex: 1, height: 1, background: g === 80 ? C.line : C.lineSoft }} />
          </div>
        ))}
        {data.map((d, i) => {
          const g = sp(f, base + i * 2.2, SPR.ui);
          const h = Math.max(2, yOf(d.rate) * g);
          return (
            <React.Fragment key={d.day}>
              <div
                style={{
                  position: "absolute",
                  left: 30 + i * slot + (slot - bw) / 2,
                  top: plotH - h,
                  width: bw,
                  height: h,
                  borderRadius: "4px 4px 1px 1px",
                  background: d.today ? C.brand : C.brandTint,
                }}
              />
              <Mono
                style={{
                  position: "absolute",
                  left: 30 + i * slot,
                  width: slot,
                  top: plotH + 6,
                  textAlign: "center",
                  fontSize: 9.5,
                  color: d.today ? C.ink : C.faint,
                  fontWeight: d.today ? 600 : 400,
                }}
              >
                {d.day}
              </Mono>
            </React.Fragment>
          );
        })}
      </div>
    </CardShell>
  );
};

/* --------------------------------------------------------------- activity */
export const ActivityCard: React.FC<{ t: CardT; f: number }> = ({ t, f }) => {
  const items = activityAt(f);
  const base = f < CUE.employees ? assembleAt("activity") + 8 : CUE.stats + 30;
  const pulse = 0.5 + 0.5 * Math.cos((f / 30) * Math.PI * 2);
  return (
    <CardShell t={t}>
      <div style={{ padding: "16px 18px 8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <CardTitle>So‘nggi faollik</CardTitle>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, color: C.okText, background: C.okBg, padding: "3px 8px", borderRadius: 20 }}>
          <div style={{ position: "relative", width: 6, height: 6 }}>
            <div style={{ position: "absolute", inset: 0, borderRadius: 6, background: C.ok }} />
            <div style={{ position: "absolute", inset: -3 - 2 * (1 - pulse), borderRadius: 10, background: C.ok, opacity: 0.25 * pulse }} />
          </div>
          Jonli
        </div>
      </div>
      <div style={{ position: "relative" }}>
        {items.map((a, i) => {
          const isLive = a.at !== undefined;
          const ins = isLive ? sp(f, a.at as number, SPR.ui) : 1;
          const p = sp(f, base + (isLive ? 0 : i * 4), SPR.ui);
          const hl = isLive ? 1 - tween(f, (a.at as number) + 18, (a.at as number) + 60, ease.inOut) : 0;
          const Via = a.via === "QR-kod" ? QrCode : ScanFace;
          return (
            <div
              key={a.name + a.time}
              style={{
                height: 42 * ins,
                overflow: "hidden",
                opacity: clamp(p * 1.3) * clamp(ins * 1.5),
                transform: `translateY(${(1 - p) * 10}px)`,
                background: hl > 0 ? `rgba(239,244,255,${hl})` : "transparent",
              }}
            >
              <div style={{ height: 42, display: "flex", alignItems: "center", padding: "0 18px", borderTop: `1px solid ${C.lineSoft}` }}>
                <Mono style={{ fontSize: 11.5, color: C.muted, width: 42 }}>{a.time}</Mono>
                <Avatar initials={a.initials} tint={a.tint} size={24} />
                <div style={{ marginLeft: 10, flex: 1, minWidth: 0, whiteSpace: "nowrap" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 550 }}>{a.name}</span>
                  <span style={{ fontSize: 11.5, color: a.kind === "late" ? STATUS.late.text : C.muted }}> · {a.what}</span>
                </div>
                <Via size={14} color={C.faint} strokeWidth={2} />
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 26, background: "linear-gradient(rgba(255,255,255,0), #fff)" }} />
    </CardShell>
  );
};
