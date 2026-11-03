import { FileSpreadsheet } from "lucide-react";
import React from "react";
import { BANDS } from "../components/Mark";
import { mixColor } from "../components/Cards";
import { clamp, ease, mix, sp, SPR, tween } from "../lib/motion";
import { CUE } from "../timeline";
import { C, MARGIN, MONO, SANS } from "../theme";

/*
 * 0–4.6 s. The "old way": a hand-kept attendance sheet, slightly out of
 * alignment, with guessed times. On "tayyor bo‘ling" the rows snap straight,
 * two of them fold away and the remaining three become the three strokes of
 * the Staffora mark while the sheet itself condenses into the logo tile.
 */

export const TILE = { cx: 540, cy: 860, size: 200 }; // logo tile in the reveal (60-unit rect)
export const MARK_BOX = (TILE.size * 64) / 60; // full 64-unit svg box

const CARD = { x: MARGIN, y: 840, w: 936, h: 600 };
const COLS = [
  { k: "n", label: "#", w: 64 },
  { k: "name", label: "F.I.Sh.", w: 270 },
  { k: "in", label: "Keldi", w: 150 },
  { k: "out", label: "Ketdi", w: 150 },
  { k: "note", label: "Izoh", w: 0 },
] as const;
type Flag = "warn" | "err" | undefined;
const ROWS: { cells: string[]; flags: Flag[]; rot: number; dx: number }[] = [
  { cells: ["1", "Dilnoza K.", "8:52", "18:05", ""], flags: [], rot: -0.55, dx: 8 },
  { cells: ["2", "Jasur A.", "9:2?", "—", "kech qoldi?"], flags: [undefined, undefined, "warn"], rot: 0.8, dx: -12 },
  { cells: ["3", "Madina Y.", "08.47", "18:0", ""], flags: [undefined, undefined, "warn", "warn"], rot: -0.35, dx: 5 },
  { cells: ["4", "Sardor R.", "", "", "ta’tilda??"], flags: [undefined, undefined, undefined, undefined, "warn"], rot: 1.0, dx: -15 },
  { cells: ["5", "Bekzod T.", "???", "", "qo‘ng‘iroq qilish"], flags: [undefined, undefined, "err"], rot: -0.7, dx: 10 },
];
const TITLE_H = 70;
const HEAD_H = 58;
const ROW_H = 90;
const KEEP = [0, 2, 4]; // rows that become the three strokes

const unitToScreen = (u: number, axis: "x" | "y") => (axis === "x" ? TILE.cx : TILE.cy) + (u - 32) * (TILE.size / 60);

export const Opening: React.FC<{ f: number }> = ({ f }) => {
  if (f > CUE.mark + 8) return null;
  const enter = sp(f, CUE.sheetIn, SPR.layout);
  const straight = sp(f, CUE.snap, SPR.ui);
  const textOut = tween(f, CUE.snap, CUE.snap + 12, ease.out);
  const fold = tween(f, CUE.snap + 4, CUE.snap + 18, ease.inOut);
  const m = tween(f, CUE.snap + 14, CUE.mark + 1, ease.cam); // sheet → tile
  const handoff = tween(f, CUE.mark - 3, CUE.mark + 5, ease.out); // to the real svg mark

  const tileW = mix(CARD.w, TILE.size, m);
  const tileH = mix(CARD.h, TILE.size, m);
  const cardCx = mix(CARD.x + CARD.w / 2, TILE.cx, m);
  const cardCy = mix(CARD.y + CARD.h / 2, TILE.cy, m);
  const cardBg = mixColor(C.darkSurface, C.brand, tween(f, CUE.snap + 20, CUE.mark, ease.inOut));
  const radius = mix(22, (16 / 60) * TILE.size, m);

  // row y (screen) before the morph, accounting for folded rows
  let acc = CARD.y + TITLE_H + HEAD_H;
  const rowY: number[] = [];
  ROWS.forEach((_, i) => {
    rowY.push(acc);
    acc += KEEP.includes(i) ? ROW_H : ROW_H * (1 - fold);
  });

  return (
    <div style={{ position: "absolute", inset: 0, opacity: 1 - handoff }}>
      {/* sheet / tile */}
      <div
        style={{
          position: "absolute",
          left: cardCx - tileW / 2,
          top: cardCy - tileH / 2 + (1 - enter) * 120,
          width: tileW,
          height: tileH,
          borderRadius: radius,
          background: cardBg,
          border: `1px solid ${m > 0.5 ? "transparent" : C.darkLine}`,
          opacity: clamp(enter * 1.5),
          overflow: "hidden",
          boxShadow: "0 30px 80px rgba(0,0,0,0.35)",
        }}
      >
        {/* title bar */}
        <div
          style={{
            height: TITLE_H,
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "0 26px",
            borderBottom: `1px solid ${C.darkLine}`,
            opacity: 1 - textOut,
          }}
        >
          <FileSpreadsheet size={26} color={C.darkMuted} strokeWidth={1.8} />
          <div style={{ fontFamily: MONO, fontSize: 23, color: C.darkMuted, flex: 1 }}>davomat_oktabr_YAKUNIY(2).xlsx</div>
          <div style={{ fontFamily: SANS, fontSize: 19, fontWeight: 500, color: "#E9B061", background: "rgba(229,150,43,0.12)", padding: "6px 14px", borderRadius: 20 }}>
            Saqlanmagan
          </div>
        </div>
        {/* header */}
        <div style={{ height: HEAD_H, display: "flex", alignItems: "center", padding: "0 26px", borderBottom: `1px solid ${C.darkLine}`, opacity: 1 - textOut }}>
          {COLS.map((c) => (
            <div key={c.k} style={{ width: c.w || undefined, flex: c.w ? undefined : 1, fontFamily: SANS, fontSize: 19, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: C.darkFaint }}>
              {c.label}
            </div>
          ))}
        </div>
      </div>

      {/* rows live in screen space so they can become the strokes */}
      {ROWS.map((r, i) => {
        const keep = KEEP.indexOf(i);
        const appear = sp(f, CUE.sheetIn + 8 + i * 6, SPR.ui);
        const rot = r.rot * (1 - straight);
        const dx = r.dx * (1 - straight);
        const y0 = rowY[i] + (1 - enter) * 120;
        const h0 = keep >= 0 ? ROW_H : ROW_H * (1 - fold);
        if (keep < 0 && fold >= 1) return null;
        // bar inside the row that turns into a stroke
        const barIn = tween(f, CUE.snap + 2, CUE.snap + 14, ease.out);
        const B = keep >= 0 ? BANDS[keep] : null;
        const u = TILE.size / 60;
        const bx = B ? mix(CARD.x + CARD.w / 2, unitToScreen(B.cx, "x"), m) : 0;
        const by = B ? mix(y0 + ROW_H / 2, unitToScreen(B.cy, "y"), m) : 0;
        const bw = B ? mix(CARD.w - 44, B.len * u, m) : 0;
        const bh = B ? mix(ROW_H - 26, B.thick * u, m) : 0;
        const bAng = B ? mix(0, B.angle, m) : 0;
        const bCol = B ? mixColor("#26303F", B.color, tween(f, CUE.snap + 12, CUE.mark - 4, ease.inOut)) : "";
        return (
          <React.Fragment key={i}>
            <div
              style={{
                position: "absolute",
                left: CARD.x + dx,
                top: y0,
                width: CARD.w,
                height: h0,
                overflow: "hidden",
                transform: `rotate(${rot}deg)`,
                opacity: clamp(appear * 1.4) * (keep >= 0 ? 1 : 1 - fold) * (1 - m),
                borderBottom: `1px solid ${C.darkLine}`,
              }}
            >
              <div style={{ height: ROW_H, display: "flex", alignItems: "center", padding: "0 26px", opacity: 1 - textOut, transform: `translateY(${(1 - appear) * 16}px)` }}>
                {COLS.map((c, ci) => {
                  const flag = r.flags[ci];
                  const v = r.cells[ci];
                  const mono = c.k === "in" || c.k === "out";
                  const sel = flag === "err";
                  return (
                    <div key={c.k} style={{ width: c.w || undefined, flex: c.w ? undefined : 1, height: 58, display: "flex", alignItems: "center", position: "relative" }}>
                      <div
                        style={{
                          padding: v ? "4px 10px" : 0,
                          marginLeft: v && flag ? -10 : 0,
                          borderRadius: 8,
                          background: flag === "warn" ? "rgba(229,150,43,0.13)" : flag === "err" ? "rgba(229,72,77,0.15)" : "transparent",
                          color: flag === "warn" ? "#EDB45E" : flag === "err" ? "#F07A7E" : c.k === "n" ? C.darkFaint : c.k === "note" ? C.darkMuted : C.darkText,
                          fontFamily: mono ? MONO : SANS,
                          fontSize: c.k === "note" ? 25 : 29,
                          fontStyle: c.k === "note" ? "italic" : "normal",
                          whiteSpace: "nowrap",
                          outline: sel ? `3px solid ${C.brand}` : "none",
                          outlineOffset: 4,
                        }}
                      >
                        {v}
                        {sel && <span style={{ display: "inline-block", width: 3, height: 30, marginLeft: 4, verticalAlign: "middle", background: "#fff", opacity: Math.floor(f / 12) % 2 ? 0 : 1 }} />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            {B && barIn > 0 && (
              <div
                style={{
                  position: "absolute",
                  left: bx - bw / 2 + dx * (1 - m),
                  top: by - bh / 2,
                  width: bw,
                  height: bh,
                  borderRadius: mix(12, bh / 2, m),
                  background: bCol,
                  transform: `rotate(${bAng + rot * (1 - m)}deg)`,
                  opacity: barIn,
                }}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

/** Precision marks + the clock that ticks over to 09:00:00 on the logo frame. */
export const DarkBackdrop: React.FC<{ f: number }> = ({ f }) => {
  const o = tween(f, 0, 18) * (1 - tween(f, CUE.mark + 4, CUE.mark + 24));
  const sec = 55 + Math.floor((f + 13) / 30);
  const time = sec >= 60 ? "09:00:00" : `08:59:${String(sec).padStart(2, "0")}`;
  const hit = f >= CUE.mark;
  const marks = [
    [MARGIN, 190],
    [1080 - MARGIN, 190],
    [MARGIN, 1520],
    [1080 - MARGIN, 1520],
  ];
  return (
    <div style={{ position: "absolute", inset: 0, opacity: o }}>
      {marks.map(([x, y], i) => (
        <React.Fragment key={i}>
          <div style={{ position: "absolute", left: x - 11, top: y, width: 22, height: 1.5, background: C.darkFaint, opacity: 0.6 }} />
          <div style={{ position: "absolute", left: x, top: y - 11, width: 1.5, height: 22, background: C.darkFaint, opacity: 0.6 }} />
        </React.Fragment>
      ))}
      <div
        style={{
          position: "absolute",
          left: MARGIN,
          top: 222,
          display: "flex",
          alignItems: "center",
          gap: 14,
          fontFamily: MONO,
          fontSize: 27,
          letterSpacing: "0.04em",
          color: hit ? C.darkText : C.darkMuted,
          opacity: tween(f, 6, 20),
        }}
      >
        <div style={{ width: 10, height: 10, borderRadius: 10, background: hit ? C.brand : "#E5484D", opacity: hit ? 1 : 0.55 + 0.45 * (Math.floor(f / 15) % 2) }} />
        {time}
      </div>
    </div>
  );
};
