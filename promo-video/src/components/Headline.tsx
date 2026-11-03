import React from "react";
import { clamp, ease, sp, SPR, tween } from "../lib/motion";
import { PHRASES, Phrase } from "../timeline";
import { C, MARGIN, MONO, SANS } from "../theme";

/*
 * Kinetic typography locked to the voiceover. Every spoken phrase appears as
 * art-directed type, word by word on its spoken frame, so the headline system
 * doubles as the film's subtitles.
 */

type Look = "openBig" | "openSub" | "product" | "stack";
type Show = { id: string; look: Look; exit: number; eyebrow?: string };

const SHOWS: Show[] = [
  // exits finish before the next phrase starts entering (no stacked type)
  { id: "p1", look: "openBig", exit: 122 },
  { id: "p2", look: "openSub", exit: 124 },
  { id: "p5", look: "product", exit: 308, eyebrow: "01 — Davomat" },
  { id: "p6", look: "product", exit: 360, eyebrow: "02 — Xodimlar" },
  { id: "p7", look: "product", exit: 448, eyebrow: "03 — Statistika" },
  { id: "p8", look: "product", exit: 499, eyebrow: "04 — Yagona tizim" },
  { id: "p9", look: "stack", exit: 576 },
  { id: "p10", look: "product", exit: 636, eyebrow: "05 — Mobil ilova" },
  { id: "p11", look: "product", exit: 692, eyebrow: "05 — Mobil ilova" },
  { id: "p12", look: "product", exit: 742 },
];

const LOOK: Record<Look, { top: number; size: number; lh: number; weight: number; track: string; color: string; accent?: string }> = {
  openBig: { top: 282, size: 140, lh: 0.98, weight: 620, track: "-0.05em", color: C.darkText },
  openSub: { top: 600, size: 60, lh: 1.14, weight: 500, track: "-0.025em", color: C.darkMuted, accent: C.darkText },
  product: { top: 288, size: 86, lh: 1.04, weight: 620, track: "-0.042em", color: C.ink },
  stack: { top: 232, size: 104, lh: 1.0, weight: 640, track: "-0.05em", color: C.ink },
};

const Words: React.FC<{ f: number; phrase: Phrase; show: Show }> = ({ f, phrase, show }) => {
  const L = LOOK[show.look];
  const n = phrase.words.length;
  return (
    <div
      style={{
        position: "absolute",
        left: MARGIN,
        top: L.top,
        width: 1080 - MARGIN * 2,
        fontFamily: SANS,
        fontSize: L.size,
        lineHeight: L.lh,
        fontWeight: L.weight,
        letterSpacing: L.track,
        color: L.color,
        display: "flex",
        flexWrap: "wrap",
        flexDirection: show.look === "stack" ? "column" : "row",
        columnGap: L.size * 0.26,
      }}
    >
      {phrase.words.map((w, i) => {
        const p = sp(f, w.at - 3, SPR.ui);
        const out = tween(f, show.exit + i * 0.8, show.exit + 7 + i * 0.8, ease.in);
        const accent = L.accent && i >= n - 2; // last words brighter in the sub-line
        const text = w.text;
        const dot = show.look === "stack" && text.endsWith(".");
        return (
          <span key={i} style={{ display: "inline-block", overflow: "hidden", paddingBottom: L.size * 0.12, marginBottom: -L.size * 0.12, whiteSpace: "nowrap" }}>
            <span
              style={{
                display: "inline-block",
                transform: `translateY(${(1 - p) * 108 - out * 60}%)`,
                opacity: clamp(p * 2) * (1 - out),
                color: accent ? L.accent : undefined,
              }}
            >
              {dot ? (
                <>
                  {text.slice(0, -1)}
                  <span style={{ color: C.brand }}>.</span>
                </>
              ) : (
                text
              )}
            </span>
          </span>
        );
      })}
    </div>
  );
};

const Eyebrow: React.FC<{ f: number }> = ({ f }) => {
  // each eyebrow lives from its first phrase's first word to the exit of its last phrase
  const spans: { text: string; from: number; to: number }[] = [];
  for (const s of SHOWS) {
    if (!s.eyebrow) continue;
    const from = PHRASES[s.id].words[0].at - 4;
    const last = spans[spans.length - 1];
    if (last && last.text === s.eyebrow) last.to = s.exit;
    else spans.push({ text: s.eyebrow, from, to: s.exit });
  }
  return (
    <>
      {spans.map((s) => {
        const p = sp(f, s.from, SPR.ui);
        const out = tween(f, s.to, s.to + 8, ease.in);
        if (p <= 0 || out >= 1) return null;
        return (
          <div
            key={s.text}
            style={{
              position: "absolute",
              left: MARGIN,
              top: 226,
              display: "flex",
              alignItems: "center",
              gap: 16,
              fontFamily: MONO,
              fontSize: 25,
              fontWeight: 500,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: C.brand,
              opacity: clamp(p * 1.5) * (1 - out),
              transform: `translateY(${(1 - p) * 14 - out * 10}px)`,
            }}
          >
            <div style={{ width: 36 * p, height: 2, background: C.brand, borderRadius: 2 }} />
            {s.text}
          </div>
        );
      })}
    </>
  );
};

export const Headlines: React.FC<{ f: number }> = ({ f }) => (
  <>
    <Eyebrow f={f} />
    {SHOWS.map((s) => {
      const ph = PHRASES[s.id];
      if (f < ph.words[0].at - 4 || f > s.exit + 16) return null;
      return <Words key={s.id} f={f} phrase={ph} show={s} />;
    })}
  </>
);
