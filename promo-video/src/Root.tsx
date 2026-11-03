import React from "react";
import { Composition } from "remotion";
import { Film } from "./Film";
import { DURATION, FPS } from "./timeline";
import { H, W } from "./theme";

export const Root: React.FC = () => (
  <Composition id="StafforaPromo" component={Film} durationInFrames={DURATION} fps={FPS} width={W} height={H} />
);
