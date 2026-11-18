"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BarChart3, BriefcaseBusiness, CalendarDays, Check, ChevronDown, Clock3, FileText, Headphones, Mail, MapPinned, MessageCircle, Phone, Send, ShieldCheck, UsersRound, WalletCards } from "lucide-react";
import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useMotionValueEvent, useScroll } from "framer-motion";
import { groupNumber } from "@/lib/format";
import { useLanguage } from "./language-provider";
import { CountUp, easeOut, Reveal, ScrollScale, SlideIn, StaggerItem, StaggerReveal, TextReveal, useReducedMotionSafe } from "./motion";
import { SectionHeading } from "./section-heading";
import { Hero, Ticker } from "./hero";
import { ScrollStory } from "./story";
import { AiHighlight, PayrollHighlight } from "./highlights";

export { Hero } from "./hero";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.staffora.uz";
const featureIcons = [Clock3, UsersRound, MapPinned, BriefcaseBusiness, CalendarDays, FileText, BarChart3, WalletCards, ShieldCheck];
const screenshots = [
  { image: "dashboard", path: "dashboard" },
  { image: "payroll", path: "finance/payroll" },
  { image: "payroll-rates", path: "finance/payroll · stavkalar" },
  { image: "ai", path: "dashboard · Staffora AI" },
  { image: "attendance", path: "attendance" },
  { image: "employees", path: "employees" },
  { image: "calendar", path: "attendance/calendar" },
  { image: "reports", path: "reports" },
];
const showcaseInterval = 6000;

type PublicPlan = {
  key: string;
  name: string;
  description: string;
  price: number | null;
  currency: string;
  period: "MONTH" | "YEAR";
  limits: { employees?: number | null; branches?: number | null; managers?: number | null };
  modules: string[] | "all";
  trialDays: number;
};

const planWords = {
  uz: { free: "Bepul", month: "/ oy", year: "/ yil", employees: "xodim", branches: "filial", managers: "rahbar", unlimited: "Cheklanmagan", allModules: "Barcha modullar", modules: "ta modul", trial: "kunlik bepul sinov", fallback: "Biznesingiz uchun mos imkoniyatlar" },
  ru: { free: "Бесплатно", month: "/ мес.", year: "/ год", employees: "сотрудников", branches: "филиалов", managers: "руководителей", unlimited: "Без ограничений", allModules: "Все модули", modules: "модулей", trial: "дней бесплатного периода", fallback: "Возможности для вашего бизнеса" },
  en: { free: "Free", month: "/ month", year: "/ year", employees: "employees", branches: "branches", managers: "managers", unlimited: "Unlimited", allModules: "All modules", modules: "modules", trial: "day free trial", fallback: "Capabilities for your business" },
} as const;

function useEnter(delay: number, y = 20) {
  const reduced = useReducedMotionSafe();
  return {
    className: "motion-reveal",
    initial: { opacity: 0, y },
    animate: { opacity: 1, y: 0 },
    transition: reduced ? { duration: 0 } : { duration: 0.7, delay, ease: easeOut },
  };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export function Features({ condensed = false }: { condensed?: boolean }) {
  const { t } = useLanguage();
  return (
    <section id="features" className="section features-section">
      <div className="container">
        <SectionHeading eyebrow={t.features.eyebrow} title={t.features.title} desc={t.features.desc} center />
        <StaggerReveal className="feature-grid" stagger={0.07}>
          {t.features.items.map((item, i) => { const Icon = featureIcons[i]; return <StaggerItem key={item.title} variant="pop"><article className="feature-card"><span className="feature-icon"><Icon size={20} /></span><span className="feature-no">{pad2(i + 1)}</span><h3>{item.title}</h3><p>{item.desc}</p></article></StaggerItem>; })}
        </StaggerReveal>
        {!condensed && <Reveal className="section-link"><Link href="/features">{t.common.learn}<ArrowRight size={16} /></Link></Reveal>}
      </div>
    </section>
  );
}

export function Showcase() {
  const { t } = useLanguage();
  const reduced = useReducedMotionSafe();
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(true);
  const [hover, setHover] = useState(false);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const frameRef = useRef<HTMLDivElement>(null);
  const inView = useInView(frameRef, { amount: 0.4 });
  const count = t.showcase.tabs.length;
  const shot = screenshots[active] || screenshots[0];
  const running = auto && inView && !hover && !reduced;

  // Ko‘rinib turganda bo‘limlar o‘zi almashadi; foydalanuvchi tanlasa to‘xtaydi
  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => setActive((value) => (value + 1) % count), showcaseInterval);
    return () => window.clearTimeout(timer);
  }, [running, active, count]);

  const choose = (index: number) => { setAuto(false); setActive(index); };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const next = (active + (event.key === "ArrowRight" ? 1 : -1) + count) % count;
    choose(next);
    tabRefs.current[next]?.focus();
  };
  return (
    <section className="section showcase-section">
      <div className="container">
        <SectionHeading eyebrow={t.showcase.eyebrow} title={t.showcase.title} desc={t.showcase.desc} />
        <Reveal>
          <div className="showcase-tabs" role="tablist" aria-label={t.showcase.title} onKeyDown={onKey}>
            {t.showcase.tabs.map((tab, i) => (
              <button ref={(node) => { tabRefs.current[i] = node; }} role="tab" type="button" id={`showcase-tab-${i}`} aria-selected={active === i} aria-controls="showcase-panel" tabIndex={active === i ? 0 : -1} className={active === i ? "active" : ""} onClick={() => choose(i)} key={tab}>
                {tab}
                {active === i && running && <span key={`p-${active}`} className="tab-progress" aria-hidden="true" style={{ animationDuration: `${showcaseInterval}ms` }} />}
              </button>
            ))}
          </div>
        </Reveal>
        <div ref={frameRef} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocusCapture={() => setHover(true)} onBlurCapture={() => setHover(false)}>
          <ScrollScale innerClassName="showcase-frame" from={0.96}>
            <div className="showcase-copy" role="tabpanel" id="showcase-panel" aria-labelledby={`showcase-tab-${active}`}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={active} initial={{ opacity: 0, y: reduced ? 0 : 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : -8 }} transition={{ duration: reduced ? 0 : 0.3, ease: easeOut }}>
                  <span>{pad2(active + 1)} / {pad2(count)}</span>
                  <h3>{t.showcase.tabs[active]}</h3>
                  <p>{t.showcase.details[active]}</p>
                </motion.div>
              </AnimatePresence>
              <a href={appUrl}>{t.hero.start}<ArrowRight size={16} /></a>
            </div>
            <div className="showcase-image">
              <div className="showcase-browser"><i /><i /><i /><span>app.staffora.uz/{shot.path}</span></div>
              <div className="showcase-screen">
                <AnimatePresence initial={false}>
                  <motion.div key={shot.image} className="showcase-shot" initial={{ opacity: 0, x: reduced ? 0 : 28, scale: reduced ? 1 : 1.015 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: reduced ? 0 : -16 }} transition={{ duration: reduced ? 0 : 0.45, ease: easeOut }}>
                    <Image src={`/screenshots/${shot.image}.png`} width={1440} height={900} alt={`Staffora — ${t.showcase.tabs[active]}: ${t.showcase.details[active]}`} />
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </ScrollScale>
        </div>
      </div>
    </section>
  );
}

export function HowItWorks() {
  const { t } = useLanguage();
  const reduced = useReducedMotionSafe();
  const lineRef = useRef<HTMLDivElement>(null);
  const [reached, setReached] = useState(0);
  const total = t.steps.items.length;
  const { scrollYProgress } = useScroll({ target: lineRef, offset: ["start 85%", "end 55%"] });
  useMotionValueEvent(scrollYProgress, "change", (value) => {
    const next = value <= 0.01 ? 0 : Math.min(total, Math.floor(value * (total - 1) + 1.0001));
    setReached((current) => (current === next ? current : next));
  });
  const shownReached = reduced ? total : reached;
  return (
    <section className="section steps-section grid-bg">
      <div className="container">
        <SectionHeading eyebrow={t.steps.eyebrow} title={t.steps.title} center />
        <div className="steps-wrap" ref={lineRef}>
          <div className="steps-progress" aria-hidden="true"><motion.span style={{ scaleX: reduced ? 1 : scrollYProgress }} /></div>
          <StaggerReveal className="steps-line" stagger={0.12}>
            {t.steps.items.map((item, i) => <StaggerItem key={item.title} variant="lift"><article className={`step-card ${i < shownReached ? "is-reached" : ""}`}><span>{pad2(i + 1)}</span><h3>{item.title}</h3><p>{item.desc}</p></article></StaggerItem>)}
          </StaggerReveal>
        </div>
      </div>
    </section>
  );
}

export function Pricing({ page = false }: { page?: boolean }) {
  const { t, lang } = useLanguage();
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/public/plans", { signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<PublicPlan[]> : Promise.reject())
      .then((rows) => { if (rows.length) setPlans(rows); })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  const words = planWords[lang];
  const fallbackPlans: PublicPlan[] = t.pricing.plans.map((plan, index) => ({ key: plan.name.toLowerCase(), name: plan.name, description: plan.note, price: index === 0 ? 0 : null, currency: "UZS", period: "MONTH", limits: {}, modules: index === 0 ? ["attendance", "workspace"] : "all", trialDays: 0 }));
  const visiblePlans = plans.length ? plans : fallbackPlans;
  const featuredIndex = Math.max(0, visiblePlans.findIndex((plan) => plan.key.toLowerCase() === "pro"));
  const number = { format: (value: number) => groupNumber(value, lang) };
  const price = (plan: PublicPlan) => {
    if (plan.price === null) return <strong>{t.pricing.custom}</strong>;
    if (plan.price === 0) return <strong>{words.free}</strong>;
    return <strong>{number.format(plan.price)} <em>{plan.currency}</em><small>{plan.period === "YEAR" ? words.year : words.month}</small></strong>;
  };
  const features = (plan: PublicPlan, index: number) => {
    const rows: string[] = [];
    const limit = (value: number | null | undefined, label: string) => rows.push(value ? `${number.format(value)} ${label}` : `${words.unlimited} ${label}`);
    if (Object.keys(plan.limits || {}).length) {
      limit(plan.limits.employees, words.employees);
      limit(plan.limits.branches, words.branches);
      limit(plan.limits.managers, words.managers);
      rows.push(plan.modules === "all" ? words.allModules : `${plan.modules.length} ${words.modules}`);
      if (plan.trialDays > 0) rows.push(`${plan.trialDays} ${words.trial}`);
    }
    return rows.length ? rows : t.pricing.plans[Math.min(index, t.pricing.plans.length - 1)].features;
  };
  return <section id="pricing" className={`section pricing-section ${page ? "page-section" : ""}`}><div className="container"><SectionHeading eyebrow={t.pricing.eyebrow} title={t.pricing.title} desc={t.pricing.desc} center /><StaggerReveal className="pricing-grid" stagger={0.14}>{visiblePlans.map((plan, i) => { const featured = i === featuredIndex; const contact = plan.price === null; return <StaggerItem key={plan.key} variant="lift"><article className={`pricing-card ${featured ? "featured" : ""}`}><div className="plan-badges"><span className="plan-status">ACTIVE</span>{featured && <span className="popular">{t.pricing.popular}</span>}</div><div className="plan-top"><h3>{plan.name}</h3><p>{plan.description || words.fallback}</p>{price(plan)}</div><ul>{features(plan, i).map((feature) => <li key={feature}><span><Check size={13} /></span>{feature}</li>)}</ul><a className={`button ${featured ? "button-primary" : "button-ghost"}`} href={contact ? "#contact" : appUrl}>{contact ? t.pricing.contact : t.pricing.start}<ArrowRight size={16} /></a></article></StaggerItem>; })}</StaggerReveal><Reveal><p className="pricing-live"><span /> {t.pricing.live}</p></Reveal></div></section>;
}

export function Statistics() {
  const { t, lang } = useLanguage();
  const format = (value: number) => groupNumber(value, lang);
  return <section className="section stats-section"><ScrollScale className="container" innerClassName="stats-shell" from={0.92}><SectionHeading eyebrow={t.stats.eyebrow} title={t.stats.title} /><StaggerReveal className="stats-grid" stagger={0.14}>{t.stats.items.map((item, i) => { const number = Number(item.value.replace(/\D/g, "")); return <StaggerItem key={item.label} variant="lift"><article><strong><CountUp value={number} suffix={item.value.includes("+") ? "+" : ""} format={format} delay={i * 0.15} /></strong><p>{item.label}</p></article></StaggerItem>; })}</StaggerReveal><Reveal delay={0.2}><small className="stats-note">{t.stats.note}</small></Reveal></ScrollScale></section>;
}

export function About({ page = false }: { page?: boolean }) {
  const { t } = useLanguage();
  return <section id="about" className={`section about-section ${page ? "page-section" : ""}`}><div className="container about-grid"><div><SectionHeading eyebrow={t.about.eyebrow} title={t.about.title} /><StaggerReveal stagger={0.1}><StaggerItem><p className="about-lead">{t.about.p1}</p></StaggerItem><StaggerItem><p>{t.about.p2}</p></StaggerItem></StaggerReveal></div><StaggerReveal className="value-stack" stagger={0.12}>{t.about.values.map((value, i) => <StaggerItem key={value.title} variant="right"><article><span>{pad2(i + 1)}</span><div><h3>{value.title}</h3><p>{value.desc}</p></div></article></StaggerItem>)}</StaggerReveal></div></section>;
}

export function Faq() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(0);
  return <section className="section faq-section"><div className="container faq-grid"><SlideIn direction="left"><SectionHeading eyebrow={t.faq.eyebrow} title={t.faq.title} /></SlideIn><StaggerReveal className="faq-list" stagger={0.07}>{t.faq.items.map((item, i) => <StaggerItem key={item.q}><article className={open === i ? "open" : ""}><button type="button" id={`faq-q-${i}`} aria-expanded={open === i} aria-controls={`faq-a-${i}`} onClick={() => setOpen(open === i ? -1 : i)}><span>{item.q}</span><ChevronDown size={19} /></button><div className="faq-answer" id={`faq-a-${i}`} role="region" aria-labelledby={`faq-q-${i}`}><p>{item.a}</p></div></article></StaggerItem>)}</StaggerReveal></div></section>;
}

export function Contact({ page = false }: { page?: boolean }) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    setStatus("sending");
    const payload = Object.fromEntries(new FormData(formElement).entries());
    try {
      const response = await fetch("/api/public/lead", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error("request failed");
      formElement.reset();
      setStatus("success");
    } catch { setStatus("error"); }
  };
  const telegram = process.env.NEXT_PUBLIC_TELEGRAM_URL || "https://t.me/staffora_support";
  const email = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@staffora.uz";
  const phone = process.env.NEXT_PUBLIC_SUPPORT_PHONE || "";
  return (
    <section id="contact" className={`section contact-section ${page ? "page-section" : ""}`}>
      <ScrollScale className="container" innerClassName="contact-shell" from={0.96}>
        <div className="contact-copy">
          <SectionHeading eyebrow={t.contact.eyebrow} title={t.contact.title} desc={t.contact.desc} />
          <StaggerReveal className="contact-direct" stagger={0.08}>
            <StaggerItem><small>{t.contact.channels}</small></StaggerItem>
            <StaggerItem variant="left"><a href={telegram}><Send size={18} />Telegram</a></StaggerItem>
            <StaggerItem variant="left"><a href={`mailto:${email}`}><Mail size={18} />{email}</a></StaggerItem>
            {phone && <StaggerItem variant="left"><a href={`tel:${phone.replace(/\s/g, "")}`}><Phone size={18} />{phone}</a></StaggerItem>}
            <StaggerItem variant="left"><Link href="/support"><Headphones size={18} />Support center</Link></StaggerItem>
          </StaggerReveal>
        </div>
        <form className="lead-form" onSubmit={submit}>
          <StaggerReveal className="lead-form-fields" stagger={0.08} delay={0.1}>
            <StaggerItem className="form-row"><label><span>{t.contact.name}</span><input name="name" minLength={2} maxLength={80} required autoComplete="name" /></label><label><span>{t.contact.phone}</span><input name="phone" inputMode="tel" minLength={9} maxLength={30} required autoComplete="tel" /></label></StaggerItem>
            <StaggerItem><label><span>{t.contact.company}</span><input name="company" minLength={2} maxLength={120} required autoComplete="organization" /></label></StaggerItem>
            <StaggerItem><label><span>{t.contact.message}</span><textarea name="message" maxLength={1000} rows={4} /></label></StaggerItem>
            <StaggerItem>
              <input name="website" tabIndex={-1} autoComplete="off" className="honey" aria-hidden="true" />
              <button className="button button-primary button-large" disabled={status === "sending"}>{status === "sending" ? t.contact.sending : t.contact.send}<MessageCircle size={17} /></button>
            </StaggerItem>
          </StaggerReveal>
          {status === "success" && <p className="form-message success" role="status">{t.contact.success}</p>}
          {status === "error" && <p className="form-message error" role="alert">{t.contact.error}</p>}
        </form>
      </ScrollScale>
    </section>
  );
}

export function FinalCta() {
  const { t } = useLanguage();
  return (
    <section className="final-cta-section">
      <ScrollScale className="container" innerClassName="final-cta" from={0.9}>
        <StaggerReveal className="final-cta-inner" stagger={0.1}>
          <StaggerItem><span className="eyebrow">Staffora</span></StaggerItem>
          <h2><TextReveal text={t.contact.title} stagger={0.035} /></h2>
          <StaggerItem><p>{t.contact.desc}</p></StaggerItem>
          <StaggerItem variant="pop"><div className="final-cta-actions"><a className="button button-white button-large" href={appUrl}>{t.hero.start}<ArrowRight size={17} /></a><Link className="button button-outline-light button-large" href="/contact">{t.pricing.contact}</Link></div></StaggerItem>
        </StaggerReveal>
      </ScrollScale>
    </section>
  );
}

export function MarketingPage() {
  return <main><Hero /><Ticker /><Features /><ScrollStory /><PayrollHighlight /><AiHighlight /><Showcase /><HowItWorks /><Pricing /><Statistics /><About /><Faq /><Contact /><FinalCta /></main>;
}

export function PageHero({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  const badge = useEnter(0, 12);
  const heading = useEnter(0.08, 24);
  const text = useEnter(0.16, 22);
  return <section className="subpage-hero grid-bg"><div className="container"><motion.span {...badge} className="eyebrow motion-reveal">{eyebrow}</motion.span><motion.h1 {...heading}>{title}</motion.h1><motion.p {...text}>{description}</motion.p></div></section>;
}
