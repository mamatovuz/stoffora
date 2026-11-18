"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { motion, useScroll, useSpring } from "framer-motion";
import { Bot, Check, Clock3, LayoutDashboard, MapPinned, ShieldCheck, WalletCards, type LucideIcon } from "lucide-react";
import { useLanguage } from "./language-provider";
import { easeOut, Reveal, StaggerItem, StaggerReveal, useReducedMotionSafe } from "./motion";
import { SectionHeading } from "./section-heading";

const storyMedia: { image: string; path: string; icon: LucideIcon }[] = [
  { image: "dashboard", path: "dashboard", icon: LayoutDashboard },
  { image: "attendance", path: "attendance", icon: Clock3 },
  { image: "payroll", path: "finance/payroll", icon: WalletCards },
  { image: "ai", path: "dashboard · Staffora AI", icon: Bot },
  { image: "map", path: "attendance/map", icon: MapPinned },
];

const pad = (n: number) => String(n).padStart(2, "0");

export function ScrollStory() {
  const { t } = useLanguage();
  const reduced = useReducedMotionSafe();
  const steps = t.story.steps;
  const [active, setActive] = useState(0);
  const stepsRef = useRef<HTMLDivElement>(null);
  const stepNodes = useRef<(HTMLElement | null)[]>([]);
  const { scrollYProgress } = useScroll({ target: stepsRef, offset: ["start center", "end center"] });
  const fill = useSpring(scrollYProgress, { stiffness: 140, damping: 30, mass: 0.3 });

  // Ekran markazidan o‘tayotgan qadam — faol qadam
  useEffect(() => {
    const nodes = stepNodes.current.filter((node): node is HTMLElement => !!node);
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.index || 0));
      });
    }, { rootMargin: "-28% 0px -70% 0px" });
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [steps.length]);

  const goTo = (index: number) => stepNodes.current[index]?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
  const current = storyMedia[active];

  return (
    <section id="product" className="section story-section">
      <div className="container">
        <SectionHeading eyebrow={t.story.eyebrow} title={t.story.title} desc={t.story.desc} center />
        <div className="story-layout">
          <div className="story-steps" ref={stepsRef}>
            <div className="story-rail" aria-hidden="true"><motion.span style={{ scaleY: reduced ? scrollYProgress : fill }} /></div>
            {steps.map((step, i) => {
              const media = storyMedia[i];
              const Icon = media.icon;
              return (
                <article
                  key={step.label}
                  ref={(node) => { stepNodes.current[i] = node; }}
                  data-index={i}
                  className={`story-step ${active === i ? "is-active" : ""}`}
                  aria-current={active === i ? "step" : undefined}
                >
                  <StaggerReveal className="story-step-body" stagger={0.07}>
                    <StaggerItem><span className="story-step-no"><Icon size={15} />{pad(i + 1)} / {pad(steps.length)} · {step.label}</span></StaggerItem>
                    <StaggerItem><h3>{step.title}</h3></StaggerItem>
                    <StaggerItem><p>{step.desc}</p></StaggerItem>
                    <StaggerItem>
                      <ul className="story-points">{step.points.map((point) => <li key={point}><Check size={14} />{point}</li>)}</ul>
                    </StaggerItem>
                  </StaggerReveal>
                  <Reveal className="story-step-media" delay={0.08}>
                    <div className="mini-browser"><i /><i /><i /><span>app.staffora.uz/{media.path}</span></div>
                    <Image src={`/screenshots/${media.image}.png`} width={1440} height={900} sizes="100vw" alt={step.alt} />
                  </Reveal>
                </article>
              );
            })}
          </div>

          <div className="story-visual">
            <div className="story-sticky">
              <Reveal className="story-frame" direction="left">
                <div className="browser-bar"><div><i /><i /><i /></div><span>app.staffora.uz/{current.path}</span><ShieldCheck size={14} /></div>
                <div className="story-screens">
                  {steps.map((step, i) => {
                    const offset = i < active ? -18 : 18;
                    return (
                      <motion.div
                        key={step.label}
                        className="story-screen"
                        initial={false}
                        animate={i === active ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: reduced ? 0 : offset, scale: reduced ? 1 : 0.985 }}
                        transition={reduced ? { duration: 0.15 } : { duration: 0.6, ease: easeOut }}
                        style={{ zIndex: i === active ? 2 : 1 }}
                        aria-hidden={i !== active}
                      >
                        <Image src={`/screenshots/${storyMedia[i].image}.png`} width={1440} height={900} sizes="(min-width: 900px) 60vw, 1px" alt={step.alt} />
                      </motion.div>
                    );
                  })}
                </div>
              </Reveal>
              <nav className="story-progress" aria-label={t.story.progress}>
                {steps.map((step, i) => (
                  <button
                    key={step.label}
                    type="button"
                    className={i === active ? "active" : i < active ? "done" : ""}
                    aria-current={i === active ? "step" : undefined}
                    onClick={() => goTo(i)}
                  >
                    <span className="story-progress-bar" aria-hidden="true" />
                    <span className="story-progress-label">{pad(i + 1)} {step.label}</span>
                  </button>
                ))}
              </nav>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
