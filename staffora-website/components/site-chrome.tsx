"use client";

import Link from "next/link";
import { ArrowUpRight, Camera, Menu, Send, X } from "lucide-react";
import { useEffect, useState } from "react";
import { navHref, type Lang } from "@/lib/content";
import { LanguageProvider, useLanguage } from "./language-provider";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.staffora.uz";

function Mark() {
  return <span className="brand-mark" aria-hidden="true">S</span>;
}

export function Navbar() {
  const { lang, setLang, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <header className={`site-nav-wrap ${scrolled ? "is-scrolled" : ""}`}>
      <nav className="site-nav container" aria-label="Asosiy navigatsiya">
        <Link className="brand" href="/#home" aria-label="Staffora bosh sahifa"><Mark /><b>Staffora</b></Link>
        <div className="nav-links desktop-nav">
          {t.nav.map((label, i) => <Link href={navHref[i]} key={label}>{label}</Link>)}
        </div>
        <div className="nav-actions">
          <div className="language-switch" aria-label="Tilni tanlang">
            {(["uz", "ru", "en"] as Lang[]).map((value) => <button key={value} onClick={() => setLang(value)} className={lang === value ? "active" : ""} aria-pressed={lang === value}>{value.toUpperCase()}</button>)}
          </div>
          <a className="button button-dark desktop-login" href={appUrl}>{t.login}<ArrowUpRight size={15} /></a>
          <button className="menu-button" onClick={() => setOpen(!open)} aria-label={t.menu} aria-expanded={open}>{open ? <X /> : <Menu />}</button>
        </div>
      </nav>
      {open && (
        <div className="mobile-menu container">
          {t.nav.map((label, i) => <Link href={navHref[i]} key={label} onClick={() => setOpen(false)}>{label}<span>0{i + 1}</span></Link>)}
          <a className="button button-primary" href={appUrl}>{t.login}<ArrowUpRight size={16} /></a>
        </div>
      )}
    </header>
  );
}

export function Footer() {
  const { t } = useLanguage();
  const telegram = process.env.NEXT_PUBLIC_TELEGRAM_URL || "https://t.me/staffora_support";
  const instagram = process.env.NEXT_PUBLIC_INSTAGRAM_URL || "https://instagram.com/staffora.uz";
  const groups = [
    { title: t.footer.product, links: [[t.footer.links[0], "/features"], [t.footer.links[1], "/pricing"], [t.login, appUrl]] },
    { title: t.footer.company, links: [[t.footer.links[2], "/about"], [t.footer.links[3], "/contact"], [t.footer.links[6], "/support"]] },
    { title: t.footer.legal, links: [[t.footer.links[4], "/privacy"], [t.footer.links[5], "/terms"], [t.footer.links[6], "/support"]] },
  ];
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div className="footer-brand">
          <Link className="brand" href="/"><Mark /><b>Staffora</b></Link>
          <p>{t.footer.desc}</p>
          <div className="socials"><a href={telegram} aria-label="Telegram"><Send size={18} /></a><a href={instagram} aria-label="Instagram"><Camera size={18} /></a></div>
        </div>
        {groups.map((group) => <div className="footer-column" key={group.title}><b>{group.title}</b>{group.links.map(([label, href]) => <Link href={href} key={`${label}-${href}`}>{label}</Link>)}</div>)}
      </div>
      <div className="container footer-bottom"><span>© 2026 Staffora. {t.footer.rights}</span><span>HRM · Workforce Management · Uzbekistan</span></div>
    </footer>
  );
}

export function SiteShell({ children }: { children: React.ReactNode }) {
  return <LanguageProvider><Navbar />{children}<Footer /></LanguageProvider>;
}
