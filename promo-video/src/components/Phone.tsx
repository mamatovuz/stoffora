import { Bell, Check, FileText, History, Home, MapPin, QrCode, ScanFace, User } from "lucide-react";
import React from "react";
import { BRANCH, PHONE_USER } from "../data";
import { PHONE, PhoneT } from "../lib/layout";
import { clamp, ease, tween } from "../lib/motion";
import { CUE } from "../timeline";
import { C, MONO, SANS } from "../theme";
import { Avatar, Mono } from "./ui";

const BEZEL = 12;
const SW = PHONE.w - BEZEL * 2; // 366
const SH = PHONE.h - BEZEL * 2; // 820
export const SCAN_CENTER = { x: BEZEL + SW / 2, y: BEZEL + 352 }; // phone-local

const StatusBar: React.FC<{ dark: number }> = ({ dark }) => {
  const col = dark > 0.5 ? "#FFFFFF" : C.ink;
  return (
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 50, display: "flex", alignItems: "center", padding: "6px 30px 0", zIndex: 5 }}>
      <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: 15, color: col, width: 60 }}>08:58</div>
      <div style={{ flex: 1 }} />
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, marginRight: 7 }}>
        {[5, 7, 9, 11].map((h) => (
          <div key={h} style={{ width: 3, height: h, borderRadius: 1, background: col }} />
        ))}
      </div>
      <div style={{ width: 24, height: 12, borderRadius: 4, border: `1.4px solid ${col}`, padding: 1.5, boxSizing: "border-box", opacity: 0.95 }}>
        <div style={{ width: "78%", height: "100%", borderRadius: 2, background: col }} />
      </div>
    </div>
  );
};

const HomeScreen: React.FC<{ f: number }> = ({ f }) => {
  const press = tween(f, CUE.tap - 2, CUE.tap + 2, ease.out) * (1 - tween(f, CUE.tap + 4, CUE.tap + 10, ease.out));
  const rows = [
    { d: "Du, 26-okt", t: "08:51 — 18:04", ok: true },
    { d: "Se, 27-okt", t: "08:49 — 18:02", ok: true },
    { d: "Ch, 28-okt", t: "Bugun", ok: false },
  ];
  return (
    <div style={{ position: "absolute", inset: 0, background: C.bg, fontFamily: SANS, color: C.ink }}>
      <div style={{ position: "absolute", top: 62, left: 20, right: 20, display: "flex", alignItems: "center", gap: 12 }}>
        <Avatar initials={PHONE_USER.initials} tint={[C.brandSoft, C.brand]} size={42} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12.5, color: C.muted }}>Xayrli tong,</div>
          <div style={{ fontSize: 20, fontWeight: 650, letterSpacing: "-0.02em" }}>{PHONE_USER.first}</div>
        </div>
        <div style={{ width: 40, height: 40, borderRadius: 20, background: C.surface, border: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Bell size={17} color={C.ink2} />
        </div>
      </div>

      <div style={{ position: "absolute", top: 126, left: 16, right: 16, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 18, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 12, color: C.muted, fontWeight: 500 }}>Bugungi smena</div>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.waitText, background: C.waitBg, borderRadius: 20, padding: "3px 9px" }}>Kutilmoqda</div>
        </div>
        <Mono style={{ display: "block", fontSize: 27, fontWeight: 600, marginTop: 8, letterSpacing: "-0.03em" }}>{PHONE_USER.shift}</Mono>
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 8, fontSize: 12.5, color: C.muted }}>
          <MapPin size={13} color={C.faint} /> {BRANCH} · {PHONE_USER.role}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          top: 268,
          left: 16,
          right: 16,
          height: 40,
          borderRadius: 12,
          background: C.okBg,
          display: "flex",
          alignItems: "center",
          padding: "0 14px",
          gap: 9,
          fontSize: 13,
          fontWeight: 500,
          color: C.okText,
        }}
      >
        <div style={{ width: 7, height: 7, borderRadius: 7, background: C.ok }} />
        <div style={{ flex: 1 }}>Siz ish hududidasiz</div>
        <Mono style={{ fontSize: 12.5 }}>{PHONE_USER.distance}</Mono>
      </div>

      <div
        style={{
          position: "absolute",
          top: 326,
          left: 16,
          right: 16,
          height: 60,
          borderRadius: 30,
          background: press > 0 ? "#1E293B" : C.ink,
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          fontSize: 16,
          fontWeight: 600,
          transform: `scale(${1 - press * 0.03})`,
          boxShadow: "0 10px 24px -8px rgba(15,23,42,0.45)",
        }}
      >
        <ScanFace size={20} color="#fff" strokeWidth={2} />
        Ishga keldim
      </div>
      <div style={{ position: "absolute", top: 398, left: 0, right: 0, display: "flex", justifyContent: "center", alignItems: "center", gap: 7, fontSize: 13.5, fontWeight: 500, color: C.brand }}>
        <QrCode size={15} color={C.brand} /> QR-kod orqali belgilash
      </div>

      <div style={{ position: "absolute", top: 446, left: 20, right: 20, display: "flex", justifyContent: "space-between", fontSize: 13.5, fontWeight: 600 }}>
        Bu hafta <span style={{ color: C.brand, fontWeight: 500, fontSize: 13 }}>Tarix</span>
      </div>
      <div style={{ position: "absolute", top: 474, left: 16, right: 16, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, overflow: "hidden" }}>
        {rows.map((r, i) => (
          <div key={r.d} style={{ height: 48, display: "flex", alignItems: "center", padding: "0 14px", borderTop: i ? `1px solid ${C.lineSoft}` : "none", fontSize: 13 }}>
            <div style={{ width: 7, height: 7, borderRadius: 7, background: r.ok ? C.ok : C.wait, marginRight: 10 }} />
            <div style={{ flex: 1, color: C.ink2 }}>{r.d}</div>
            <Mono style={{ fontSize: 12.5, color: r.ok ? C.ink : C.muted }}>{r.t}</Mono>
          </div>
        ))}
      </div>

      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 86, background: C.surface, borderTop: `1px solid ${C.line}`, display: "flex", justifyContent: "center", paddingTop: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ height: 40, borderRadius: 20, background: C.ink, color: "#fff", display: "flex", alignItems: "center", gap: 7, padding: "0 16px", fontSize: 13, fontWeight: 600 }}>
            <Home size={16} color="#fff" /> Bosh sahifa
          </div>
          {[History, FileText, User].map((I, i) => (
            <div key={i} style={{ width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <I size={19} color={C.muted} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const ScanScreen: React.FC<{ f: number }> = ({ f }) => {
  const enter = tween(f, CUE.scan - 1, CUE.scan + 11, ease.out);
  if (enter <= 0) return null;
  const prog = tween(f, CUE.scan + 6, CUE.success - 4, ease.inOut);
  const done = tween(f, CUE.success - 3, CUE.success + 5, ease.out);
  const check = tween(f, CUE.success + 2, CUE.success + 14, ease.out);
  const cx = SW / 2;
  const cy = 352;
  const ticks = 72;
  const R0 = 128;
  const R1 = 142;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "#0B0F17",
        transform: `translateY(${(1 - enter) * 100}%)`,
        fontFamily: SANS,
        color: "#fff",
      }}
    >
      <div style={{ position: "absolute", top: 84, left: 0, right: 0, textAlign: "center" }}>
        <div style={{ fontSize: 12.5, color: "#8792A2", fontWeight: 500 }}>Ishga kelishni tasdiqlash</div>
        <div style={{ position: "relative", height: 30, marginTop: 6, overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, fontSize: 21, fontWeight: 650, letterSpacing: "-0.02em", transform: `translateY(${-done * 100}%)`, opacity: 1 - done }}>
            Yuzni ramkaga joylang
          </div>
          <div style={{ position: "absolute", inset: 0, fontSize: 21, fontWeight: 650, letterSpacing: "-0.02em", transform: `translateY(${(1 - done) * 100}%)`, opacity: done }}>
            Ishga kelish belgilandi
          </div>
        </div>
      </div>
      <svg width={SW} height={560} style={{ position: "absolute", top: 0, left: 0 }}>
        <defs>
          <radialGradient id="feed" cx="50%" cy="42%" r="60%">
            <stop offset="0%" stopColor="#2B3546" />
            <stop offset="100%" stopColor="#121824" />
          </radialGradient>
          <clipPath id="feedClip">
            <circle cx={cx} cy={cy} r={112} />
          </clipPath>
        </defs>
        <circle cx={cx} cy={cy} r={112} fill="url(#feed)" />
        <g clipPath="url(#feedClip)" opacity={0.9 * (1 - done)}>
          <ellipse cx={cx} cy={cy - 16} rx={40} ry={50} fill="rgba(255,255,255,0.07)" />
          <path d={`M ${cx - 92} ${cy + 120} C ${cx - 80} ${cy + 52}, ${cx - 40} ${cy + 40}, ${cx} ${cy + 40} C ${cx + 40} ${cy + 40}, ${cx + 80} ${cy + 52}, ${cx + 92} ${cy + 120} Z`} fill="rgba(255,255,255,0.06)" />
          {/* scan line */}
          <rect x={cx - 112} y={cy - 112 + 224 * ((prog * 2) % 1)} width={224} height={2} fill="rgba(106,165,255,0.5)" opacity={prog > 0 && prog < 1 ? 0.8 : 0} />
        </g>
        <circle cx={cx} cy={cy} r={112 * done} fill={C.ok} />
        <path
          d={`M ${cx - 34} ${cy + 2} L ${cx - 10} ${cy + 26} L ${cx + 38} ${cy - 24}`}
          fill="none"
          stroke="#fff"
          strokeWidth={11}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={130}
          strokeDashoffset={130 * (1 - check)}
          opacity={check > 0 ? 1 : 0}
        />
        {Array.from({ length: ticks }).map((_, i) => {
          const a = (i / ticks) * Math.PI * 2 - Math.PI / 2;
          const lit = i / ticks < prog;
          const col = done > 0.5 ? "#4CC38A" : lit ? "#6AA5FF" : "rgba(255,255,255,0.16)";
          return (
            <line
              key={i}
              x1={cx + Math.cos(a) * R0}
              y1={cy + Math.sin(a) * R0}
              x2={cx + Math.cos(a) * (lit || done > 0.5 ? R1 + 2 : R1 - 3)}
              y2={cy + Math.sin(a) * (lit || done > 0.5 ? R1 + 2 : R1 - 3)}
              stroke={col}
              strokeWidth={3}
              strokeLinecap="round"
            />
          );
        })}
      </svg>
      <div style={{ position: "absolute", top: 530, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, height: 34, padding: "0 14px", borderRadius: 17, background: "rgba(255,255,255,0.07)", fontSize: 13, color: "#C9D1DC" }}>
          <MapPin size={14} color="#4CC38A" /> {BRANCH} · {PHONE_USER.distance}
        </div>
      </div>
      <div style={{ position: "absolute", top: 596, left: 0, right: 0, textAlign: "center", opacity: done, transform: `translateY(${(1 - done) * 10}px)` }}>
        <div style={{ fontFamily: MONO, fontSize: 44, fontWeight: 500, letterSpacing: "-0.03em" }}>{PHONE_USER.checkIn}</div>
        <div style={{ fontSize: 13, color: "#8792A2", marginTop: 4 }}>Yuz orqali · {BRANCH}</div>
      </div>
      {/* subtle "done" check badge in the corner of the frame */}
      <div style={{ position: "absolute", bottom: 44, left: 20, right: 20, height: 54, borderRadius: 27, background: "rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 15, fontWeight: 600, opacity: done }}>
        <Check size={17} color="#fff" strokeWidth={2.6} /> Tayyor
      </div>
    </div>
  );
};

/** Finger-touch indicator for the tap. */
const Touch: React.FC<{ f: number }> = ({ f }) => {
  const appear = tween(f, CUE.tap - 10, CUE.tap - 3, ease.out);
  const gone = tween(f, CUE.tap + 5, CUE.tap + 12, ease.out);
  const o = appear * (1 - gone);
  if (o <= 0) return null;
  const press = tween(f, CUE.tap - 2, CUE.tap + 2, ease.out);
  const ring = tween(f, CUE.tap, CUE.tap + 12, ease.out);
  return (
    <>
      <div style={{ position: "absolute", left: SW / 2 + 40 - 24, top: 356 - 24, width: 48, height: 48, borderRadius: 48, background: "rgba(15,23,42,0.22)", border: "2px solid rgba(255,255,255,0.7)", opacity: o, transform: `scale(${1 - press * 0.15})` }} />
      <div style={{ position: "absolute", left: SW / 2 + 40 - 40, top: 356 - 40, width: 80, height: 80, borderRadius: 80, border: "2px solid rgba(255,255,255,0.6)", opacity: (1 - ring) * (ring > 0 ? 1 : 0), transform: `scale(${0.6 + ring * 0.7})` }} />
    </>
  );
};

export const Phone: React.FC<{ t: PhoneT; f: number }> = ({ t, f }) => {
  if (t.o < 0.003 || t.y > 1925) return null;
  const darkUi = tween(f, CUE.scan + 2, CUE.scan + 8);
  return (
    <div
      style={{
        position: "absolute",
        left: t.x,
        top: t.y,
        width: PHONE.w,
        height: PHONE.h,
        transform: `perspective(2200px) scale(${t.s}) rotateX(${t.rx}deg) rotateY(${t.ry}deg)`,
        transformOrigin: "0 0",
        opacity: clamp(t.o),
      }}
    >
      {/* body */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 60,
          background: "linear-gradient(145deg, #2A2C33 0%, #111216 40%, #0B0C0F 100%)",
          boxShadow: "0 50px 90px -20px rgba(15,23,42,0.45), 0 20px 40px -20px rgba(15,23,42,0.35), inset 0 0 0 1.5px rgba(255,255,255,0.10)",
        }}
      />
      {/* side buttons */}
      <div style={{ position: "absolute", left: -2.5, top: 170, width: 3, height: 60, borderRadius: 2, background: "#1A1B20" }} />
      <div style={{ position: "absolute", left: -2.5, top: 245, width: 3, height: 60, borderRadius: 2, background: "#1A1B20" }} />
      <div style={{ position: "absolute", right: -2.5, top: 210, width: 3, height: 92, borderRadius: 2, background: "#1A1B20" }} />
      {/* screen */}
      <div style={{ position: "absolute", left: BEZEL, top: BEZEL, width: SW, height: SH, borderRadius: 48, overflow: "hidden", background: C.bg }}>
        <HomeScreen f={f} />
        <Touch f={f} />
        <ScanScreen f={f} />
        <StatusBar dark={darkUi} />
        <div style={{ position: "absolute", top: 11, left: SW / 2 - 56, width: 112, height: 33, borderRadius: 20, background: "#000", zIndex: 6 }} />
        <div style={{ position: "absolute", bottom: 8, left: SW / 2 - 64, width: 128, height: 5, borderRadius: 5, background: darkUi > 0.5 ? "rgba(255,255,255,0.7)" : "rgba(15,23,42,0.85)", zIndex: 6 }} />
      </div>
    </div>
  );
};

export const phonePoint = (t: PhoneT, px: number, py: number) => ({ x: t.x + px * t.s, y: t.y + py * t.s });
