import { useEffect, useState } from "react";

/*
 * Panel mavzusi: yorug‘ / tungi / tizim bo‘yicha. Tanlov brauzerda saqlanadi.
 * Dastlabki qiymat index.html dagi kichik skript orqali sahifa chizilishidan oldin qo‘yiladi
 * (oq «chaqnash» bo‘lmasligi uchun). Mini App o‘z mavzusini alohida boshqaradi.
 */
export type ThemePref = "light" | "dark" | "system";
const KEY = "staffora-theme";
const media = () => window.matchMedia?.("(prefers-color-scheme: dark)");

export function storedTheme(): ThemePref {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export const resolveTheme = (pref: ThemePref): "light" | "dark" =>
  pref === "system" ? (media()?.matches ? "dark" : "light") : pref;

export function applyTheme(pref: ThemePref, animate = false) {
  const root = document.documentElement;
  const theme = resolveTheme(pref);
  if (root.dataset.theme === theme) return;
  if (animate) {
    root.classList.add("theme-switching");
    window.setTimeout(() => root.classList.remove("theme-switching"), 320);
  }
  root.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0e1217" : "#2563eb");
  // Xarita kabi o‘z rangini hisoblaydigan komponentlar uchun (o‘tish tugagach).
  window.setTimeout(() => window.dispatchEvent(new Event("staffora:mini-theme")), animate ? 340 : 0);
  window.dispatchEvent(new CustomEvent("staffora:theme", { detail: theme }));
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(storedTheme);
  const [theme, setTheme] = useState(() => resolveTheme(pref));

  useEffect(() => {
    const sync = () => setTheme(resolveTheme(pref));
    sync();
    if (pref !== "system") return;
    const query = media();
    const onChange = () => {
      applyTheme("system", true);
      sync();
    };
    query?.addEventListener?.("change", onChange);
    return () => query?.removeEventListener?.("change", onChange);
  }, [pref]);

  const choose = (next: ThemePref) => {
    try {
      if (next === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      /* xususiy rejim — faqat shu sessiya uchun */
    }
    applyTheme(next, true);
    setPref(next);
  };
  return { pref, theme, choose, toggle: () => choose(theme === "dark" ? "light" : "dark") };
}
