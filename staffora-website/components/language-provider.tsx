"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { content, type Lang } from "@/lib/content";

const LanguageContext = createContext({ lang: "uz" as Lang, setLang: (() => undefined) as (lang: Lang) => void, t: content.uz });

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>("uz");
  useEffect(() => {
    const stored = window.localStorage.getItem("staffora-language") as Lang | null;
    if (stored && content[stored]) window.requestAnimationFrame(() => setLang(stored));
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    window.localStorage.setItem("staffora-language", lang);
  }, [lang]);
  const value = useMemo(() => ({ lang, setLang, t: content[lang] }), [lang]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export const useLanguage = () => useContext(LanguageContext);
