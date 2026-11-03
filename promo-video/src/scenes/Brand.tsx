import { ArrowUpRight } from "lucide-react";
import React from "react";
import { Mark, Wordmark } from "../components/Mark";
import { clamp, ease, mix, sp, SPR, tween } from "../lib/motion";
import { CUE, PHRASES } from "../timeline";
import { C, SANS } from "../theme";
import { MARK_BOX, TILE } from "./Opening";

// Width of "STAFFORA" in Geist 750 with 0.07em tracking, per px of font size
// (checked against rendered frames).
const WORDMARK_EM = 6.02;

/*
 * 4.5–8.8 s. The logo lands as the voice says "Staffora", the wordmark draws
 * out beside it, and the tagline arrives word by word. Then the lockup lifts
 * to make room for the product window rising from below.
 */
export const RevealLockup: React.FC<{ f: number }> = ({ f }) => {
  if (f < CUE.mark - 4 || f > CUE.product + 8) return null;
  const inO = tween(f, CUE.mark - 3, CUE.mark + 5, ease.out);
  const slide = tween(f, CUE.mark + 9, CUE.mark + 39, ease.cam);
  const lift = tween(f, CUE.sheetRise, CUE.sheetRise + 44, ease.cam);
  const exit = tween(f, CUE.product - 14, CUE.product + 4, ease.in);

  const box = mix(MARK_BOX, 156, slide);
  const tileW = (box * 60) / 64;
  const wmSize = 88;
  const gap = 34;
  const total = tileW + gap + WORDMARK_EM * wmSize;
  const tileCx = mix(TILE.cx, 540 - total / 2 + tileW / 2, slide);
  const cy = mix(TILE.cy, 556, lift) - exit * 40;
  const letters = Array.from({ length: 8 }, (_, i) => sp(f, CUE.mark + 16 + i * 1.7, SPR.ui));
  const tag = PHRASES.p4.words;

  const glow = tween(f, CUE.mark - 4, CUE.mark + 24) * (1 - tween(f, CUE.product - 10, CUE.product + 18));
  return (
    <div style={{ position: "absolute", inset: 0, opacity: 1 - exit }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: glow,
          background: `radial-gradient(620px 520px at 540px ${cy}px, rgba(37,99,235,0.20), rgba(37,99,235,0) 70%)`,
        }}
      />
      <Mark size={box} style={{ position: "absolute", left: tileCx - box / 2, top: cy - box / 2, opacity: inO }} />
      <Wordmark
        size={wmSize}
        color={C.darkText}
        reveal={letters}
        style={{ position: "absolute", left: tileCx + tileW / 2 + gap, top: cy - wmSize * 0.52 }}
      />
      <div
        style={{
          position: "absolute",
          left: 90,
          right: 90,
          top: mix(TILE.cy + 150, 670, lift) - exit * 40,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          columnGap: 15,
          fontFamily: SANS,
          fontSize: 54,
          lineHeight: 1.18,
          fontWeight: 520,
          letterSpacing: "-0.03em",
        }}
      >
        {tag.map((w, i) => {
          const p = sp(f, w.at - 3, SPR.ui);
          return (
            <span key={i} style={{ display: "inline-block", overflow: "hidden", paddingBottom: 8, marginBottom: -8 }}>
              <span style={{ display: "inline-block", transform: `translateY(${(1 - p) * 108}%)`, opacity: clamp(p * 2), color: i >= 2 ? C.darkText : C.darkMuted }}>
                {w.text}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
};

/* 25–30 s. Brand end card: mark builds stroke by stroke, wordmark, slogan, CTA. */
export const EndCard: React.FC<{ f: number }> = ({ f }) => {
  if (f < CUE.brand) return null;
  const bg = tween(f, CUE.brand - 2, CUE.brand + 10, ease.inOut);
  const tile = sp(f, CUE.brandMark - 2, SPR.hero);
  const bands: [number, number, number] = [0, 1, 2].map((i) => sp(f, CUE.brandMark + 5 + i * 4, SPR.ui)) as [number, number, number];
  const letters = Array.from({ length: 8 }, (_, i) => sp(f, CUE.brandMark + 12 + i * 1.6, SPR.ui));
  const [w1, w2] = PHRASES.p14.words;
  const s1 = sp(f, w1.at - 3, SPR.ui);
  const s2 = sp(f, w2.at - 3, SPR.ui);
  const cta = sp(f, CUE.cta + 4, SPR.hero);
  const box = 220;
  const marks = tween(f, CUE.brandMark + 20, CUE.brandMark + 44, ease.out);
  return (
    <div style={{ position: "absolute", inset: 0, background: `rgba(245,247,250,${bg})` }}>
      {[
        [72, 190],
        [1008, 190],
        [72, 1520],
        [1008, 1520],
      ].map(([x, y], i) => (
        <React.Fragment key={i}>
          <div style={{ position: "absolute", left: x - 11, top: y, width: 22, height: 1.5, background: C.lineStrong, opacity: marks }} />
          <div style={{ position: "absolute", left: x, top: y - 11, width: 1.5, height: 22, background: C.lineStrong, opacity: marks }} />
        </React.Fragment>
      ))}
      <div style={{ position: "absolute", left: 540 - box / 2, top: 676 - box / 2, opacity: clamp(tile * 2) }}>
        <Mark size={box} tile={mix(0.55, 1, tile)} bands={bands} />
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 838, display: "flex", justifyContent: "center" }}>
        <Wordmark size={94} color={C.ink} reveal={letters} />
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 1000,
          display: "flex",
          justifyContent: "center",
          gap: 17,
          fontFamily: SANS,
          fontSize: 56,
          fontWeight: 520,
          letterSpacing: "-0.03em",
          color: C.ink2,
        }}
      >
        {[
          { t: "Jamoangiz —", p: s1, c: C.muted },
          { t: "nazoratingizda.", p: s2, c: C.ink },
        ].map((w) => (
          <span key={w.t} style={{ display: "inline-block", overflow: "hidden", paddingBottom: 8 }}>
            <span style={{ display: "inline-block", transform: `translateY(${(1 - w.p) * 108}%)`, opacity: clamp(w.p * 2), color: w.c }}>{w.t}</span>
          </span>
        ))}
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 1146, display: "flex", justifyContent: "center" }}>
        <div
          style={{
            height: 104,
            borderRadius: 52,
            padding: "0 44px 0 54px",
            background: C.brand,
            color: "#fff",
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontFamily: SANS,
            fontSize: 44,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            opacity: clamp(cta * 1.6),
            transform: `translateY(${(1 - cta) * 26}px) scale(${mix(0.94, 1, cta)})`,
            boxShadow: "0 18px 40px -14px rgba(37,99,235,0.55)",
          }}
        >
          staffora.uz
          <ArrowUpRight size={42} color="#fff" strokeWidth={2.4} />
        </div>
      </div>
    </div>
  );
};
