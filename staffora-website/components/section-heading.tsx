"use client";

import { Reveal, TextReveal } from "./motion";

export function SectionHeading({ eyebrow, title, desc, center = false, className = "" }: { eyebrow: string; title: string; desc?: string; center?: boolean; className?: string }) {
  return (
    <div className={`section-heading ${center ? "center" : ""} ${className}`}>
      <Reveal><span className="eyebrow">{eyebrow}</span></Reveal>
      <h2><TextReveal text={title} stagger={0.025} /></h2>
      {desc && <Reveal delay={0.12}><p>{desc}</p></Reveal>}
    </div>
  );
}
