import React from "react";
import { AbsoluteFill, Audio, staticFile, useCurrentFrame } from "remotion";
import { ActivityCard, ChartCard, EmployeesCard, KpiCard, RingCard } from "./components/Cards";
import { Headlines } from "./components/Headline";
import { Connector, Packet } from "./components/Overlays";
import { Phone } from "./components/Phone";
import { WindowBg, WindowChrome } from "./components/WindowChrome";
import { cardT, expandAt, phoneT, WIN, windowT } from "./lib/layout";
import { EndCard, RevealLockup } from "./scenes/Brand";
import { DarkBackdrop, Opening } from "./scenes/Opening";
import { CUE } from "./timeline";
import { C } from "./theme";

const DARK_UNTIL = 284; // the product window has covered the frame by now

export const Film: React.FC = () => {
  const f = useCurrentFrame();
  const W = windowT(f);
  const e = expandAt(f);
  const dark = f < DARK_UNTIL ? 1 : 0;
  const ox = W.x + (WIN.w * W.s) / 2;
  const oy = W.y + (WIN.h * W.s) / 2;

  return (
    <AbsoluteFill style={{ background: dark ? C.dark : C.stage, overflow: "hidden" }}>
      <Audio src={staticFile("audio/mix.wav")} />

      {f < DARK_UNTIL + 10 && <DarkBackdrop f={f} />}
      <Opening f={f} />
      <RevealLockup f={f} />

      {/* the product: window + cards share one 3D stage */}
      {f >= CUE.sheetRise - 2 && (
        <AbsoluteFill
          style={{
            transform: `perspective(2600px) rotateX(${W.rx}deg) rotateY(${W.ry}deg)`,
            transformOrigin: `${ox}px ${oy}px`,
          }}
        >
          <WindowBg W={W} expand={e} dark={dark} />
          <WindowChrome W={W} f={f} visible={1 - e} />
          <ChartCard t={cardT("chart", f)} f={f} />
          <ActivityCard t={cardT("activity", f)} f={f} />
          <EmployeesCard t={cardT("employees", f)} f={f} />
          <RingCard t={cardT("ring", f)} f={f} />
          {[0, 1, 2, 3].map((i) => (
            <KpiCard key={i} i={i} t={cardT(`kpi${i}` as "kpi0", f)} f={f} />
          ))}
        </AbsoluteFill>
      )}

      <Connector f={f} />
      <Phone t={phoneT(f)} f={f} />
      <Packet f={f} />
      <Headlines f={f} />
      <EndCard f={f} />
    </AbsoluteFill>
  );
};
