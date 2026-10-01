/*
 * Mini App ko‘rinish sozlamalari: mavzu (avto / yorug‘ / tungi), shrift o‘lchami
 * va yuqori kontrast. Qurilmada saqlanadi va Telegram CloudStorage orqali
 * xodimning boshqa qurilmalariga ham o‘tadi.
 */

export type MiniPrefs = { theme: "auto" | "light" | "dark"; font: "normal" | "large"; contrast: boolean };
const KEY = "staffora:mini:prefs";
const CLOUD_KEY = "staffora_prefs";
export const DEFAULT_PREFS: MiniPrefs = { theme: "auto", font: "normal", contrast: false };

const sanitize = (value: Partial<MiniPrefs> | null | undefined): MiniPrefs => ({
  theme: value?.theme === "light" || value?.theme === "dark" ? value.theme : "auto",
  font: value?.font === "large" ? "large" : "normal",
  contrast: Boolean(value?.contrast),
});

export function readPrefs(): MiniPrefs | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? sanitize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function savePrefs(prefs: MiniPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* saqlab bo‘lmasa ham ishlaydi */
  }
  try {
    window.Telegram?.WebApp?.CloudStorage?.setItem(CLOUD_KEY, JSON.stringify(prefs));
  } catch {
    /* eski Telegram */
  }
}

/** Qurilmada sozlama bo‘lmasa — Telegram bulutidan olamiz. */
export function loadCloudPrefs(): Promise<MiniPrefs | null> {
  return new Promise((resolve) => {
    const storage = window.Telegram?.WebApp?.CloudStorage;
    const supported = window.Telegram?.WebApp?.isVersionAtLeast?.("6.9");
    if (!storage || !supported) return resolve(null);
    const timer = window.setTimeout(() => resolve(null), 1500);
    try {
      storage.getItem(CLOUD_KEY, (error, value) => {
        window.clearTimeout(timer);
        if (error || !value) return resolve(null);
        try {
          resolve(sanitize(JSON.parse(value)));
        } catch {
          resolve(null);
        }
      });
    } catch {
      window.clearTimeout(timer);
      resolve(null);
    }
  });
}

export function applyPrefs(prefs: MiniPrefs) {
  const root = document.documentElement;
  root.dataset.miniTheme = prefs.theme;
  root.dataset.miniFont = prefs.font;
  root.dataset.miniContrast = prefs.contrast ? "1" : "0";
}
