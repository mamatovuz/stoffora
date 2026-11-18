"use client";

import Image from "next/image";
import { ArrowRight, Check, Pause, Play, ShieldCheck, UserCheck, WalletCards } from "lucide-react";
import { type ReactNode, useState } from "react";
import { motion, useScroll, useTransform, type MotionValue } from "framer-motion";
import { groupNumber } from "@/lib/format";
import { useLanguage } from "./language-provider";
import { CountUp, easeOut, useReducedMotionSafe } from "./motion";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.staffora.uz";
const floatTones = ["tone-green", "tone-blue", "tone-ai"];
const floatIcons = [UserCheck, WalletCards, null];
const tickerWords = { uz: ["To‘xtatish", "Davom ettirish"], ru: ["Пауза", "Продолжить"], en: ["Pause", "Play"] } as const;

function useEnter(delay: number, y = 20) {
  const reduced = useReducedMotionSafe();
  return {
    className: "motion-reveal",
    initial: { opacity: 0, y },
    animate: { opacity: 1, y: 0 },
    transition: reduced ? { duration: 0 } : { duration: 0.7, delay, ease: easeOut },
  };
}

function Depth({ y, className, children }: { y: MotionValue<number> | number; className: string; children: ReactNode }) {
  return <motion.div className={className} style={{ y }}>{children}</motion.div>;
}

export function Hero() {
  const { t, lang } = useLanguage();
  const reduced = useReducedMotionSafe();
  const badge = useEnter(0, 12);
  const title = useEnter(0.08, 24);
  const desc = useEnter(0.16, 20);
  const actions = useEnter(0.24, 18);
  const proof = useEnter(0.32, 12);
  const stage = useEnter(0.3, 56);

  // Scroll bilan: oyna yotiq holatdan to‘g‘rilanadi, kartochkalar turli tezlikda suzadi
  const { scrollY } = useScroll();
  const rotateX = useTransform(scrollY, [0, 620], [14, 0], { clamp: true });
  const scale = useTransform(scrollY, [0, 620], [0.93, 1], { clamp: true });
  const depthA = useTransform(scrollY, [0, 900], [0, -90]);
  const depthB = useTransform(scrollY, [0, 900], [0, -160]);
  const depthC = useTransform(scrollY, [0, 900], [0, -40]);
  const depthPhone = useTransform(scrollY, [0, 900], [0, -110]);
  const depths = [depthA, depthB, depthC];
  const fmt = (value: number) => groupNumber(value, lang);

  return (
    <section id="home" className="hero">
      <div className="container hero-copy">
        <motion.span {...badge} className="hero-badge motion-reveal"><span className="live-dot" aria-hidden="true" />{t.hero.badge}</motion.span>
        <motion.h1 {...title}>{t.hero.line1}<br /><span>{t.hero.accent}</span></motion.h1>
        <motion.p {...desc}>{t.hero.desc}</motion.p>
        <motion.div {...actions} className="hero-actions motion-reveal">
          <a className="button button-primary button-large" href={appUrl}>{t.hero.start}<ArrowRight size={17} /></a>
          <a className="button button-ghost button-large" href="#product"><Play size={15} fill="currentColor" />{t.hero.explore}</a>
        </motion.div>
        <motion.div {...proof} className="hero-proof motion-reveal">
          {t.hero.proof.map((item) => <span key={item}><Check size={14} />{item}</span>)}
        </motion.div>
      </div>

      <div className="hero-product">
        <motion.div {...stage} className="container product-stage motion-reveal">
          <motion.div className="product-tilt" style={reduced ? { rotateX: 0, scale: 1 } : { rotateX, scale, transformPerspective: 1800, transformOrigin: "50% 0%" }}>
            <div className="product-window">
              <div className="browser-bar"><div><i /><i /><i /></div><span>app.staffora.uz/dashboard</span><ShieldCheck size={14} /></div>
              <Image src="/screenshots/dashboard.png" width={1440} height={900} priority alt="Staffora boshqaruv paneli: bugungi davomat, kechikkanlar va arizalar bir ekranda" />
            </div>
          </motion.div>
          <motion.div className="product-mobile" style={reduced ? { rotateX: 0, scale: 1 } : { rotateX, scale, transformPerspective: 1400, transformOrigin: "50% 0%" }}>
            <div className="product-phone product-phone-lg">
              <Image src="/screenshots/dashboard-mobile.png" width={780} height={1688} alt="Staffora boshqaruv paneli telefonda: bugungi davomat kartalari" />
            </div>
          </motion.div>

          <div className="product-floats" aria-hidden="true">
            {t.hero.floats.map((item, i) => {
              const Icon = floatIcons[i];
              return (
                <Depth key={item.title} y={reduced ? 0 : depths[i]} className={`product-float-slot product-float-${i + 1}`}>
                  <motion.div
                    className={`product-float ${floatTones[i]} motion-reveal`}
                    initial={{ opacity: 0, y: 16, scale: 0.94 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={reduced ? { duration: 0 } : { duration: 0.6, delay: 0.9 + i * 0.4, ease: easeOut }}
                  >
                    <span className="product-float-icon">{Icon ? <Icon size={16} /> : <Image src="/favicon.svg" width={20} height={20} alt="" />}</span>
                    <div>
                      <strong>{item.title}</strong>
                      <small>{typeof item.value === "number" && <b><CountUp value={item.value} duration={1.6} delay={1.1 + i * 0.4} format={fmt} /></b>}{item.meta}</small>
                    </div>
                  </motion.div>
                </Depth>
              );
            })}
            <Depth y={reduced ? 0 : depthPhone} className="product-phone-slot">
              <motion.div
                className="product-phone motion-reveal"
                initial={{ opacity: 0, y: 40, rotate: 3 }}
                animate={{ opacity: 1, y: 0, rotate: 0 }}
                transition={reduced ? { duration: 0 } : { duration: 0.8, delay: 1.3, ease: easeOut }}
              >
                <Image src="/screenshots/dashboard-mobile.png" width={780} height={1688} alt="" />
              </motion.div>
            </Depth>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

export function Ticker() {
  const { t, lang } = useLanguage();
  const [paused, setPaused] = useState(false);
  const words = tickerWords[lang];
  const items = t.hero.ticker;
  return (
    <section className={`ticker ${paused ? "is-paused" : ""}`} aria-label={t.nav[1]}>
      <div className="ticker-viewport">
        <div className="ticker-track">
          <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
          <ul aria-hidden="true" className="ticker-copy">{items.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      </div>
      <button type="button" className="ticker-toggle" onClick={() => setPaused((value) => !value)} aria-pressed={paused} aria-label={paused ? words[1] : words[0]} title={paused ? words[1] : words[0]}>
        {paused ? <Play size={14} /> : <Pause size={14} />}
      </button>
    </section>
  );
}
