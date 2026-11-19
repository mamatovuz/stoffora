"use client";

import Image from "next/image";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { ArrowRight, Banknote, CalendarDays, Check, Clock3, Coins, Database, History, KeyRound, Mic, Package, RotateCcw, Send, ShieldCheck, Sun, X, type LucideIcon } from "lucide-react";
import { groupNumber } from "@/lib/format";
import { useLanguage } from "./language-provider";
import { CountUp, easeOut, Reveal, ScrollScale, SlideIn, StaggerItem, StaggerReveal, useReducedMotionSafe, useScrollReveal } from "./motion";
import { SectionHeading } from "./section-heading";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.staffora.uz";

/* ------------------------------------------------------------------ */
/*  Ish haqi — to‘rt xil stavka va hisob varag‘i                       */
/* ------------------------------------------------------------------ */

type Unit = "currency" | "day" | "hour" | "piece";
type PayExample = { tone: string; icon: LucideIcon; parts: { value: number; unit: Unit }[] | null; result: number };

const payExamples: PayExample[] = [
  { tone: "blue", icon: CalendarDays, parts: null, result: 4_000_000 },
  { tone: "green", icon: Sun, parts: [{ value: 150_000, unit: "currency" }, { value: 22, unit: "day" }], result: 3_300_000 },
  { tone: "teal", icon: Clock3, parts: [{ value: 10_000, unit: "currency" }, { value: 8, unit: "hour" }], result: 80_000 },
  { tone: "amber", icon: Package, parts: [{ value: 100, unit: "piece" }, { value: 5_000, unit: "currency" }], result: 500_000 },
];

const payFeatureIcons = [History, Coins, Banknote, ShieldCheck];

// Hisob varag‘i: 3 300 000 + 300 000 − 1 000 000 − 50 000 = 2 550 000; to‘langan 1 500 000
const slip = { accrued: 3_300_000, bonus: 300_000, advance: 1_000_000, penalty: 50_000, total: 2_550_000, paid: 1_500_000 };

export function PayrollHighlight() {
  const { t, lang } = useLanguage();
  const p = t.payroll;
  const fmt = (value: number) => groupNumber(value, lang);
  const paidShare = slip.paid / slip.total;
  return (
    <section id="payroll" className="section payroll-section">
      <div className="container">
        <SectionHeading eyebrow={p.eyebrow} title={p.title} desc={p.desc} center />
        <StaggerReveal className="pay-grid" stagger={0.08}>
          {payExamples.map((example, i) => {
            const Icon = example.icon;
            const type = p.types[i];
            return (
              <StaggerItem key={type.name} variant="pop">
                <article className={`pay-card tone-${example.tone}`}>
                  <header><span className="pay-tag">{type.name}</span><span className="pay-icon"><Icon size={18} /></span></header>
                  <p>{type.desc}</p>
                  <div className="pay-formula">
                    <div className="pay-operands">
                      {example.parts ? example.parts.map((part, j) => (
                        <span key={j} className="pay-operand-wrap">{j > 0 && <i aria-hidden="true">×</i>}<span className="pay-operand">{fmt(part.value)} {p.units[part.unit]}</span></span>
                      )) : <span className="pay-operand">{p.units.fixed}</span>}
                    </div>
                    <div className="pay-result"><small>{p.result}</small><strong><CountUp value={example.result} duration={1.4} delay={0.3 + i * 0.12} format={fmt} /><em>{p.units.currency}</em></strong></div>
                  </div>
                </article>
              </StaggerItem>
            );
          })}
        </StaggerReveal>

        <div className="pay-detail">
          <div className="pay-features">
            <StaggerReveal className="pay-feature-list" stagger={0.08}>
              {p.features.map((feature, i) => {
                const Icon = payFeatureIcons[i];
                return <StaggerItem key={feature.title} variant="left"><article><span><Icon size={18} /></span><div><h3>{feature.title}</h3><p>{feature.desc}</p></div></article></StaggerItem>;
              })}
            </StaggerReveal>
            <Reveal delay={0.1}><a className="button button-primary" href={appUrl}>{p.cta}<ArrowRight size={16} /></a></Reveal>
          </div>

          <SlideIn direction="right" className="payslip-wrap">
            <div className="payslip">
              <header>
                <div><small>{p.slip.period}</small><strong>{p.slip.employee}</strong></div>
                <span className="pay-tag tone-green">{p.slip.type}</span>
              </header>
              <StaggerReveal className="payslip-rows" stagger={0.09} delay={0.15}>
                <StaggerItem className="payslip-row" variant="left"><span>{p.slip.accrued}</span><b>{fmt(slip.accrued)}</b></StaggerItem>
                <StaggerItem className="payslip-row plus" variant="left"><span>{p.slip.bonus}</span><b>+{fmt(slip.bonus)}</b></StaggerItem>
                <StaggerItem className="payslip-row minus" variant="left"><span>{p.slip.advance}</span><b>{fmt(-slip.advance)}</b></StaggerItem>
                <StaggerItem className="payslip-row minus" variant="left"><span>{p.slip.penalty}</span><b>{fmt(-slip.penalty)}</b></StaggerItem>
              </StaggerReveal>
              <div className="payslip-total"><span>{p.slip.total}</span><strong><CountUp value={slip.total} duration={1.6} delay={0.5} format={fmt} /> <em>{p.units.currency}</em></strong></div>
              <div className="payslip-pay">
                <div className="payslip-pay-head"><span className="pay-tag tone-amber">{p.slip.partial} · {Math.round(paidShare * 100)}%</span></div>
                <div className="payslip-bar" aria-hidden="true">
                  <PaidBar share={paidShare} />
                </div>
                <div className="payslip-pay-foot"><span>{p.slip.paid}: <b>{fmt(slip.paid)}</b></span><span>{p.slip.remaining}: <b>{fmt(slip.total - slip.paid)}</b></span></div>
              </div>
              <footer><ShieldCheck size={14} />{p.slip.audit}</footer>
            </div>
          </SlideIn>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Staffora AI — ketma-ket paydo bo‘ladigan suhbat                    */
/* ------------------------------------------------------------------ */

const aiPointIcons = [Database, ShieldCheck, KeyRound, Send];
const providers = ["OpenAI", "Gemini", "Claude", "Groq"];
// 1 savol · 2 yozmoqda · 3 javob · 4 buyruq · 5 yozmoqda · 6 tasdiqlash kartasi
const stageDelays = [250, 850, 1900, 3100, 3700, 4700];
const lastStage = stageDelays.length;

/** To‘langan ulush chizig‘i — umumiy scroll-reveal orqali (tez scrollda ham to‘ladi). */
function PaidBar({ share }: { share: number }) {
  const { ref, shown, reduced } = useScrollReveal<HTMLElement>();
  return <motion.i ref={ref} initial={{ scaleX: 0 }} animate={{ scaleX: shown ? share : 0 }} transition={reduced ? { duration: 0 } : { duration: 1.2, delay: 0.4, ease: easeOut }} />;
}

function AiMark({ size = 28 }: { size?: number }) {
  return <Image className="ai-mark" src="/favicon.svg" width={size} height={size} alt="" aria-hidden="true" />;
}

function ChatItem({ visible, className, children, inert }: { visible: boolean; className: string; children: ReactNode; inert?: boolean }) {
  const reduced = useReducedMotionSafe();
  return (
    <motion.div
      className={className}
      initial={false}
      animate={visible ? { opacity: 1, y: 0 } : { opacity: 0, y: reduced ? 0 : 12 }}
      transition={reduced ? { duration: 0 } : { duration: 0.45, ease: easeOut }}
      inert={inert && !visible ? true : undefined}
    >
      {children}
    </motion.div>
  );
}

function Typing({ visible }: { visible: boolean }) {
  return <div className={`ai-typing ${visible ? "is-visible" : ""}`} aria-hidden="true"><AiMark size={24} /><span><i /><i /><i /></span></div>;
}

function AiChat() {
  const { t } = useLanguage();
  const c = t.ai.chat;
  const reduced = useReducedMotionSafe();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.35 });
  const [stage, setStage] = useState(0);
  const [run, setRun] = useState(0);
  const [decision, setDecision] = useState<"pending" | "done" | "cancelled">("pending");

  useEffect(() => {
    if (!inView || reduced) return;
    const timers = stageDelays.map((delay, i) => window.setTimeout(() => setStage(i + 1), delay));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [inView, reduced, run]);

  const s = reduced ? lastStage : stage;
  const replay = () => { setStage(0); setDecision("pending"); setRun((value) => value + 1); };

  return (
    <div className="ai-chat" ref={ref}>
      <div className="ai-chat-head">
        <AiMark size={34} />
        <div><strong>Staffora AI</strong><small><span className="ai-dot" />{t.ai.status}</small></div>
        <button type="button" className="ai-icon-button" onClick={replay} aria-label={c.replay} title={c.replay}><RotateCcw size={16} /></button>
      </div>
      <div className="ai-chat-body">
        <ChatItem visible={s >= 1} className="ai-msg-user"><p>{c.q1}</p></ChatItem>
        <div className="ai-slot">
          <Typing visible={s === 2} />
          <ChatItem visible={s >= 3} className="ai-msg-bot">
            <AiMark />
            <div className="ai-card">
              <strong className="ai-card-title">{c.a1Title}</strong>
              <div className="ai-table" role="table" aria-label={c.a1Title}>
                <div className="ai-row ai-row-head" role="row">{c.a1Head.map((head) => <span key={head} role="columnheader">{head}</span>)}</div>
                {c.a1Rows.map(([name, time, late]) => <div className="ai-row" role="row" key={name}><span role="cell">{name}</span><span role="cell">{time}</span><span role="cell" className="ai-late">{late}</span></div>)}
              </div>
              <small className="ai-note">{c.a1Note}</small>
            </div>
          </ChatItem>
        </div>
        <ChatItem visible={s >= 4} className="ai-msg-user"><p>{c.q2}</p></ChatItem>
        <div className="ai-slot">
          <Typing visible={s === 5} />
          <ChatItem visible={s >= 6} className="ai-msg-bot" inert>
            <AiMark />
            <div className={`ai-card ai-confirm is-${decision}`}>
              <span className="pay-tag tone-amber">{c.confirmBadge}</span>
              <p>{c.confirmIntro}</p>
              <dl>{c.fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
              <div className="ai-confirm-actions" aria-live="polite">
                {decision === "pending" && <>
                  <button type="button" className="button button-primary button-small" onClick={() => setDecision("done")}><Check size={15} />{c.confirm}</button>
                  <button type="button" className="button button-ghost button-small" onClick={() => setDecision("cancelled")}><X size={15} />{c.cancel}</button>
                </>}
                {decision === "done" && <p className="ai-result success"><Check size={15} />{c.done}</p>}
                {decision === "cancelled" && <p className="ai-result muted"><X size={15} />{c.cancelled}</p>}
              </div>
            </div>
          </ChatItem>
        </div>
      </div>
      <div className="ai-chat-input" aria-hidden="true"><span>{c.input}</span><Mic size={16} /><i><ArrowRight size={15} /></i></div>
      <small className="ai-footnote">{c.footnote}</small>
    </div>
  );
}

export function AiHighlight() {
  const { t } = useLanguage();
  return (
    <ScrollScale className="ai-scale-wrap" innerClassName="ai-scale" from={0.93}>
    <section id="ai" className="section ai-section">
      <div className="container ai-grid">
        <div className="ai-copy">
          <SectionHeading eyebrow={t.ai.eyebrow} title={t.ai.title} desc={t.ai.desc} />
          <StaggerReveal className="ai-points" stagger={0.08}>
            {t.ai.points.map((point, i) => {
              const Icon = aiPointIcons[i];
              return <StaggerItem key={point.title} variant="left"><article><span><Icon size={18} /></span><div><h3>{point.title}</h3><p>{point.desc}</p></div></article></StaggerItem>;
            })}
          </StaggerReveal>
          <Reveal className="ai-providers" delay={0.1}>
            <small>{t.ai.providers}</small>
            <ul>{providers.map((name) => <li key={name}>{name}</li>)}</ul>
          </Reveal>
        </div>
        <SlideIn direction="right" className="ai-chat-wrap"><AiChat /></SlideIn>
      </div>
    </section>
    </ScrollScale>
  );
}
