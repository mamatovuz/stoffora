"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BarChart3, BriefcaseBusiness, CalendarDays, Check, ChevronDown, Clock3, FileText, Headphones, Mail, MapPinned, MessageCircle, Phone, Play, Send, ShieldCheck, Sparkles, UsersRound, WalletCards } from "lucide-react";
import { FormEvent, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useLanguage } from "./language-provider";
import { Reveal } from "./motion";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.staffora.uz";
const featureIcons = [Clock3, UsersRound, MapPinned, BriefcaseBusiness, CalendarDays, FileText, BarChart3, WalletCards, ShieldCheck];
const screenshots = ["dashboard", "attendance", "employees", "map", "calendar", "reports"];

function SectionHeading({ eyebrow, title, desc, center = false }: { eyebrow: string; title: string; desc?: string; center?: boolean }) {
  return <Reveal className={`section-heading ${center ? "center" : ""}`}><span className="eyebrow"><Sparkles size={14} />{eyebrow}</span><h2>{title}</h2>{desc && <p>{desc}</p>}</Reveal>;
}

export function Hero() {
  const { t } = useLanguage();
  const reduced = useReducedMotion();
  return (
    <section id="home" className="hero grid-bg">
      <div className="hero-glow" />
      <div className="container hero-copy">
        <motion.span className="hero-badge" initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .5 }}><Sparkles size={14} />{t.hero.badge}</motion.span>
        <motion.h1 initial={reduced ? false : { opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7, delay: .08 }}>{t.hero.line1}<br /><span>{t.hero.accent}</span></motion.h1>
        <motion.p initial={reduced ? false : { opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7, delay: .16 }}>{t.hero.desc}</motion.p>
        <motion.div className="hero-actions" initial={reduced ? false : { opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .65, delay: .24 }}>
          <a className="button button-primary button-large" href={appUrl}>{t.hero.start}<ArrowRight size={17} /></a>
          <a className="button button-ghost button-large" href="#features"><Play size={16} fill="currentColor" />{t.hero.explore}</a>
        </motion.div>
        <motion.div className="hero-proof" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .7, delay: .35 }}>
          {t.hero.proof.map((item) => <span key={item}><Check size={14} />{item}</span>)}
        </motion.div>
      </div>
      <motion.div className="container product-stage" initial={reduced ? false : { opacity: 0, y: 60, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: .9, delay: .28, ease: [0.22, 1, 0.36, 1] }}>
        <div className="product-shadow-card left" aria-hidden="true" />
        <div className="product-shadow-card right" aria-hidden="true" />
        <div className="product-window">
          <div className="browser-bar"><div><i /><i /><i /></div><span>app.staffora.uz/dashboard</span><ShieldCheck size={14} /></div>
          <Image src="/screenshots/dashboard.png" width={1440} height={900} priority alt="Staffora boshqaruv panelining haqiqiy ko‘rinishi" />
        </div>
      </motion.div>
    </section>
  );
}

export function Features({ condensed = false }: { condensed?: boolean }) {
  const { t } = useLanguage();
  return (
    <section id="features" className="section features-section">
      <div className="container">
        <SectionHeading eyebrow={t.features.eyebrow} title={t.features.title} desc={t.features.desc} center />
        <div className="feature-grid">
          {t.features.items.map((item, i) => { const Icon = featureIcons[i]; return <Reveal key={item.title} delay={(i % 3) * .07}><article className={`feature-card ${i === 0 || i === 4 ? "feature-card-accent" : ""}`}><span className="feature-icon"><Icon size={21} /></span><span className="feature-no">0{i + 1}</span><h3>{item.title}</h3><p>{item.desc}</p></article></Reveal>; })}
        </div>
        {!condensed && <Reveal className="section-link"><Link href="/features">{t.common.learn}<ArrowRight size={16} /></Link></Reveal>}
      </div>
    </section>
  );
}

export function Showcase() {
  const { t } = useLanguage();
  const [active, setActive] = useState(0);
  return (
    <section className="section showcase-section">
      <div className="container">
        <SectionHeading eyebrow={t.showcase.eyebrow} title={t.showcase.title} desc={t.showcase.desc} />
        <div className="showcase-tabs" role="tablist" aria-label={t.showcase.title}>{t.showcase.tabs.map((tab, i) => <button role="tab" aria-selected={active === i} className={active === i ? "active" : ""} onClick={() => setActive(i)} key={tab}>{tab}</button>)}</div>
        <div className="showcase-frame">
          <div className="showcase-copy"><span>0{active + 1}</span><h3>{t.showcase.tabs[active]}</h3><p>{t.showcase.details[active]}</p><a href={appUrl}>{t.hero.start}<ArrowRight size={16} /></a></div>
          <div className="showcase-image">
            <AnimatePresence mode="wait"><motion.div key={active} initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: .3 }}><Image src={`/screenshots/${screenshots[active]}.png`} width={1440} height={900} alt={`Staffora — ${t.showcase.tabs[active]}`} /></motion.div></AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}

export function HowItWorks() {
  const { t } = useLanguage();
  return <section className="section steps-section grid-bg"><div className="container"><SectionHeading eyebrow={t.steps.eyebrow} title={t.steps.title} center /><div className="steps-line">{t.steps.items.map((item, i) => <Reveal key={item.title} delay={i * .1}><article className="step-card"><span>0{i + 1}</span><h3>{item.title}</h3><p>{item.desc}</p></article></Reveal>)}</div></div></section>;
}

export function Pricing({ page = false }: { page?: boolean }) {
  const { t } = useLanguage();
  return <section id="pricing" className={`section pricing-section ${page ? "page-section" : ""}`}><div className="container"><SectionHeading eyebrow={t.pricing.eyebrow} title={t.pricing.title} desc={t.pricing.desc} center /><div className="pricing-grid">{t.pricing.plans.map((plan, i) => <Reveal key={plan.name} delay={i * .08}><article className={`pricing-card ${i === 1 ? "featured" : ""}`}>{i === 1 && <span className="popular">{t.pricing.popular}</span>}<div className="plan-top"><h3>{plan.name}</h3><p>{plan.note}</p><strong>{i === 0 ? "0 UZS" : t.pricing.custom}</strong></div><ul>{plan.features.map((feature) => <li key={feature}><Check size={16} />{feature}</li>)}</ul>{i === 2 ? <a className="button button-ghost" href="#contact">{t.pricing.contact}<ArrowRight size={16} /></a> : <a className="button button-primary" href={appUrl}>{t.pricing.start}<ArrowRight size={16} /></a>}</article></Reveal>)}</div></div></section>;
}

export function Statistics() {
  const { t } = useLanguage();
  return <section className="section stats-section"><div className="container stats-shell"><SectionHeading eyebrow={t.stats.eyebrow} title={t.stats.title} /><div className="stats-grid">{t.stats.items.map((item, i) => <Reveal key={item.label} delay={i * .08}><article><strong>{item.value}</strong><p>{item.label}</p></article></Reveal>)}</div><small className="stats-note">* 2026-yil noyabr holatidagi tasdiqlangan platforma ko‘rsatkichlari.</small></div></section>;
}

export function About({ page = false }: { page?: boolean }) {
  const { t } = useLanguage();
  return <section id="about" className={`section about-section ${page ? "page-section" : ""}`}><div className="container about-grid"><div><SectionHeading eyebrow={t.about.eyebrow} title={t.about.title} /><Reveal><p className="about-lead">{t.about.p1}</p><p>{t.about.p2}</p></Reveal></div><div className="value-stack">{t.about.values.map((value, i) => <Reveal key={value.title} delay={i * .08}><article><span>0{i + 1}</span><div><h3>{value.title}</h3><p>{value.desc}</p></div></article></Reveal>)}</div></div></section>;
}

export function Faq() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(0);
  return <section className="section faq-section"><div className="container faq-grid"><SectionHeading eyebrow={t.faq.eyebrow} title={t.faq.title} /><div className="faq-list">{t.faq.items.map((item, i) => <article className={open === i ? "open" : ""} key={item.q}><button aria-expanded={open === i} onClick={() => setOpen(open === i ? -1 : i)}><span>{item.q}</span><ChevronDown size={19} /></button><div className="faq-answer"><p>{item.a}</p></div></article>)}</div></div></section>;
}

export function Contact({ page = false }: { page?: boolean }) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("sending");
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    try {
      const response = await fetch("/api/lead", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error("request failed");
      event.currentTarget.reset();
      setStatus("success");
    } catch { setStatus("error"); }
  };
  const telegram = process.env.NEXT_PUBLIC_TELEGRAM_URL || "https://t.me/staffora_support";
  const email = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@staffora.uz";
  const phone = process.env.NEXT_PUBLIC_SUPPORT_PHONE || "";
  return <section id="contact" className={`section contact-section ${page ? "page-section" : ""}`}><div className="container contact-shell"><div className="contact-copy"><SectionHeading eyebrow={t.contact.eyebrow} title={t.contact.title} desc={t.contact.desc} /><div className="contact-direct"><small>{t.contact.channels}</small><a href={telegram}><Send size={18} />Telegram</a><a href={`mailto:${email}`}><Mail size={18} />{email}</a>{phone && <a href={`tel:${phone.replace(/\s/g, "")}`}><Phone size={18} />{phone}</a>}<Link href="/support"><Headphones size={18} />Support center</Link></div></div><Reveal><form className="lead-form" onSubmit={submit}><div className="form-row"><label><span>{t.contact.name}</span><input name="name" minLength={2} maxLength={80} required /></label><label><span>{t.contact.phone}</span><input name="phone" inputMode="tel" minLength={9} maxLength={30} required /></label></div><label><span>{t.contact.company}</span><input name="company" minLength={2} maxLength={120} required /></label><label><span>{t.contact.message}</span><textarea name="message" maxLength={1000} rows={4} /></label><input name="website" tabIndex={-1} autoComplete="off" className="honey" aria-hidden="true" /><button className="button button-primary button-large" disabled={status === "sending"}>{status === "sending" ? t.contact.sending : t.contact.send}<MessageCircle size={17} /></button>{status === "success" && <p className="form-message success">{t.contact.success}</p>}{status === "error" && <p className="form-message error">{t.contact.error}</p>}</form></Reveal></div></section>;
}

export function FinalCta() {
  const { t } = useLanguage();
  return <section className="final-cta-section"><Reveal className="container final-cta"><span className="eyebrow"><Sparkles size={14} />Staffora</span><h2>{t.contact.title}</h2><p>{t.contact.desc}</p><div><a className="button button-white button-large" href={appUrl}>{t.hero.start}<ArrowRight size={17} /></a><Link className="button button-glass button-large" href="/contact">{t.pricing.contact}</Link></div></Reveal></section>;
}

export function MarketingPage() {
  return <main><Hero /><Features /><Showcase /><HowItWorks /><Pricing /><Statistics /><About /><Faq /><Contact /><FinalCta /></main>;
}

export function PageHero({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <section className="subpage-hero grid-bg"><div className="container"><span className="eyebrow"><Sparkles size={14} />{eyebrow}</span><h1>{title}</h1><p>{description}</p></div></section>;
}
