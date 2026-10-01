import { useEffect, useRef } from "react";
import { api, post } from "../../api";

/*
 * Telegram Mini App API ustidagi yupqa qatlam. Har bir funksiya eski Telegram
 * versiyalarida ham xatosiz ishlaydi (imkoniyat bo‘lmasa — brauzer muqobili).
 */

export const tg = () => window.Telegram?.WebApp;
export const supports = (version: string) => Boolean(tg()?.isVersionAtLeast?.(version));
export const isTelegram = () => Boolean(tg()?.initData);
export const platform = () => tg()?.platform || "unknown";
export const isMobile = () => ["ios", "android", "android_x"].includes(platform());

/* ------------------------------------------------------------ haptika --- */
export const haptic = {
  success: () => tg()?.HapticFeedback?.notificationOccurred("success"),
  error: () => tg()?.HapticFeedback?.notificationOccurred("error"),
  warning: () => tg()?.HapticFeedback?.notificationOccurred("warning"),
  tap: (style: "light" | "medium" | "heavy" | "rigid" | "soft" = "light") => tg()?.HapticFeedback?.impactOccurred(style),
  select: () => tg()?.HapticFeedback?.selectionChanged?.(),
};

/* ------------------------------------------------------ native oynalar --- */
/** Tasdiqlash oynasi: Telegram’niki (6.2+), bo‘lmasa brauzerniki. */
export function confirmNative(message: string, options: { title?: string; ok?: string; destructive?: boolean } = {}): Promise<boolean> {
  const webApp = tg();
  haptic.warning();
  if (webApp?.showPopup && supports("6.2"))
    return new Promise((resolve) => {
      try {
        webApp.showPopup!(
          {
            title: options.title,
            message: message.slice(0, 256),
            buttons: [
              { id: "ok", type: options.destructive ? "destructive" : "default", text: options.ok || "Ha" },
              { id: "cancel", type: "cancel" },
            ],
          },
          (id) => resolve(id === "ok"),
        );
      } catch {
        resolve(window.confirm(message));
      }
    });
  return Promise.resolve(window.confirm(message));
}

/** Bir nechta variantli native tanlov (3 tagacha tugma). */
export function choiceNative(message: string, choices: { id: string; text: string; destructive?: boolean }[], title?: string): Promise<string | null> {
  const webApp = tg();
  if (webApp?.showPopup && supports("6.2"))
    return new Promise((resolve) => {
      try {
        webApp.showPopup!(
          {
            title,
            message: message.slice(0, 256),
            buttons: [
              ...choices.slice(0, 2).map((c) => ({ id: c.id, text: c.text, type: c.destructive ? ("destructive" as const) : ("default" as const) })),
              { id: "", type: "cancel" as const },
            ],
          },
          (id) => resolve(id || null),
        );
      } catch {
        resolve(null);
      }
    });
  return Promise.resolve(window.confirm(message) ? choices[0]?.id || null : null);
}

export function alertNative(message: string) {
  const webApp = tg();
  if (webApp?.showAlert && supports("6.2")) return new Promise<void>((resolve) => webApp.showAlert!(message.slice(0, 256), () => resolve()));
  window.alert(message);
  return Promise.resolve();
}

/* ------------------------------------------ pastki tugmalar (Main/Secondary) --- */
type BottomButtonOptions = {
  text: string;
  onClick: () => void;
  visible?: boolean;
  disabled?: boolean;
  progress?: boolean;
  shine?: boolean;
  color?: string;
};

/** Telegram MainButton mavjudmi (sahifadagi tugmani yashirish uchun). */
export const hasMainButton = () => Boolean(tg()?.MainButton && supports("6.1") && isTelegram());
export const hasSecondaryButton = () => Boolean(tg()?.SecondaryButton && supports("7.10") && isTelegram());

function useBottomButton(kind: "MainButton" | "SecondaryButton", options: BottomButtonOptions | null) {
  const handler = useRef(options?.onClick);
  handler.current = options?.onClick;
  const available = kind === "MainButton" ? hasMainButton() : hasSecondaryButton();
  // Bosish hodisasi bir marta ulanadi — har renderda qayta ulash shart emas.
  useEffect(() => {
    const button = tg()?.[kind];
    if (!button || !available) return;
    const click = () => {
      haptic.tap("medium");
      handler.current?.();
    };
    button.onClick(click);
    return () => {
      button.offClick(click);
      button.hideProgress();
      button.hide();
    };
  }, [kind, available]);
  const text = options?.text;
  const visible = Boolean(options) && options?.visible !== false;
  const disabled = options?.disabled;
  const progress = options?.progress;
  const shine = options?.shine;
  const color = options?.color;
  useEffect(() => {
    const button = tg()?.[kind];
    if (!button || !available) return;
    if (!visible) {
      button.hide();
      return;
    }
    button.setParams({
      text: text || "",
      is_active: !disabled,
      is_visible: true,
      ...(color ? { color } : {}),
      ...(supports("7.10") ? { has_shine_effect: Boolean(shine) } : {}),
      ...(kind === "SecondaryButton" ? { position: "left" as const } : {}),
    });
    if (progress) button.showProgress(false);
    else button.hideProgress();
  }, [kind, available, visible, text, disabled, progress, shine, color]);
  return available;
}

/** Telegram’ning pastki asosiy tugmasi. Qaytaradi: native tugma ishlatilyaptimi. */
export const useMainButton = (options: BottomButtonOptions | null) => useBottomButton("MainButton", options);
export const useSecondaryButton = (options: BottomButtonOptions | null) => useBottomButton("SecondaryButton", options);

/** «⋯» menyusidagi «Sozlamalar» tugmasi. */
export function useSettingsButton(onClick: () => void) {
  const handler = useRef(onClick);
  handler.current = onClick;
  useEffect(() => {
    const button = tg()?.SettingsButton;
    if (!button || !supports("7.0")) return;
    const click = () => handler.current();
    button.show();
    button.onClick(click);
    return () => {
      button.offClick(click);
      button.hide();
    };
  }, []);
}

/** Telegram «Orqaga» tugmasi: `onBack` berilsa ko‘rinadi. */
export function useBackButton(onBack: (() => void) | null) {
  const handler = useRef(onBack);
  handler.current = onBack;
  const active = Boolean(onBack);
  useEffect(() => {
    const back = tg()?.BackButton;
    if (!back || !supports("6.1")) return;
    const click = () => {
      haptic.select();
      handler.current?.();
    };
    if (active) back.show();
    else back.hide();
    back.onClick(click);
    return () => back.offClick(click);
  }, [active]);
}

/* ----------------------------------------------------- havolalar --- */
export function openTelegram(url: string) {
  const webApp = tg();
  if (webApp?.openTelegramLink && /^https:\/\/t\.me\//.test(url)) webApp.openTelegramLink(url);
  else window.open(url, "_blank", "noopener");
}
export function openExternal(url: string) {
  const webApp = tg();
  if (webApp?.openLink) webApp.openLink(url);
  else window.open(url, "_blank", "noopener");
}
/** Telegram’da yozish: @username bo‘lsa — chat, bo‘lmasa telefon raqami bo‘yicha. */
export function writeInTelegram(target: { username?: string; phone?: string }) {
  if (target.username) return openTelegram(`https://t.me/${target.username.replace(/^@/, "")}`);
  const digits = target.phone?.replace(/\D/g, "");
  if (digits) openTelegram(`https://t.me/+${digits}`);
}
export function callPhone(phone: string) {
  window.location.href = `tel:${phone.replace(/[^\d+]/g, "")}`;
}

/* ------------------------------------------------------ yuklab olish --- */
/**
 * Faylni telefonga yuklab olish (Telegram 8.0+ — «Yuklab olish» oynasi).
 * Server 5 daqiqalik imzolangan havola beradi; eski Telegram’da havola brauzerda ochiladi.
 */
export async function downloadMiniFile(body: { kind: "payslip"; month: string } | { kind: "document"; id: string }) {
  const { path, fileName } = await post<{ path: string; fileName: string }>("/mini/download", body);
  const url = new URL(path, window.location.origin).toString();
  const webApp = tg();
  if (webApp?.downloadFile && supports("8.0")) {
    return new Promise<boolean>((resolve) => {
      try {
        webApp.downloadFile!({ url, file_name: fileName }, (accepted) => resolve(accepted));
      } catch {
        openExternal(url);
        resolve(true);
      }
    });
  }
  openExternal(url);
  return true;
}

/* ------------------------------------------------------------ ulashish --- */
/** Xabarni chatga ulashish: Telegram 8.0 tayyor xabar, bo‘lmasa t.me/share havolasi. */
export async function shareText(title: string, text: string) {
  const webApp = tg();
  if (webApp?.shareMessage && supports("8.0")) {
    try {
      const prepared = await post<{ id?: string } | undefined>("/mini/share", { title, text });
      if (prepared?.id)
        return await new Promise<boolean>((resolve) => webApp.shareMessage!(prepared.id!, (sent) => resolve(sent)));
    } catch {
      /* oddiy ulashishga o‘tamiz */
    }
  }
  const url = `https://t.me/share/url?url=${encodeURIComponent(" ")}&text=${encodeURIComponent(text)}`;
  openTelegram(url);
  return true;
}

/* ------------------------------------------------------- emoji-status --- */
/** Ishga kelganda Telegram profilida emoji-status (faqat Premium; foydalanuvchi ruxsati bilan). */
export function setWorkEmojiStatus(emojiId: string | undefined, untilMinutes: number) {
  const webApp = tg();
  if (!emojiId || !webApp?.setEmojiStatus || !supports("8.0")) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    try {
      webApp.setEmojiStatus!(emojiId, { duration: Math.max(600, Math.round(untilMinutes * 60)) }, (ok) => resolve(ok));
    } catch {
      resolve(false);
    }
  });
}

/* -------------------------------------------- bot yozishiga ruxsat --- */
const WRITE_ASKED = "staffora_write_asked";
/** Bir marta so‘raladi: bot xodimga eslatma yubora olishi uchun (Direct Link orqali ochilganda kerak). */
export function askWriteAccessOnce() {
  const webApp = tg();
  if (!webApp?.requestWriteAccess || !supports("6.9") || !isTelegram()) return;
  void kvGet("cloud", WRITE_ASKED).then((asked) => {
    if (asked) return;
    try {
      webApp.requestWriteAccess!(() => void kvSet("cloud", WRITE_ASKED, "1"));
    } catch {
      /* qo‘llab-quvvatlanmaydi */
    }
  });
}

/* --------------------------------------------------------- xotiralar --- */
type Store = "cloud" | "device" | "secure";
const storeOf = (kind: Store) => {
  const webApp = tg();
  if (kind === "cloud") return supports("6.9") ? webApp?.CloudStorage : undefined;
  if (kind === "device") return supports("9.0") ? webApp?.DeviceStorage : undefined;
  return supports("9.0") ? webApp?.SecureStorage : undefined;
};

/** Kalit-qiymat: Telegram xotirasi (bulut / qurilma / shifrlangan), bo‘lmasa localStorage. */
export function kvGet(kind: Store, key: string): Promise<string | null> {
  const storage = storeOf(kind);
  const local = () => {
    try {
      return localStorage.getItem(`tgkv:${kind}:${key}`);
    } catch {
      return null;
    }
  };
  if (!storage) return Promise.resolve(local());
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(local()), 1500);
    try {
      storage.getItem(key, (error, value) => {
        window.clearTimeout(timer);
        resolve(error ? local() : (value ?? null));
      });
    } catch {
      window.clearTimeout(timer);
      resolve(local());
    }
  });
}
export function kvSet(kind: Store, key: string, value: string | null): Promise<void> {
  const storage = storeOf(kind);
  try {
    if (value === null) localStorage.removeItem(`tgkv:${kind}:${key}`);
    else if (kind !== "secure") localStorage.setItem(`tgkv:${kind}:${key}`, value);
  } catch {
    /* muhim emas */
  }
  if (!storage) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      if (value === null) storage.removeItem(key, () => resolve());
      else storage.setItem(key, value, () => resolve());
    } catch {
      resolve();
    }
  });
}

/* ------------------------------------------------- harakat sensori --- */
export type MotionSummary = { samples: number; spread: number; source: "telegram" | "browser" };

/**
 * ~2 soniya davomida tezlanishni o‘lchaydi (emulyatorni sezish uchun).
 * Telegram 8.0 Accelerometer, bo‘lmasa brauzer `devicemotion`. Ruxsat bo‘lmasa — undefined.
 */
export function sampleMotion(durationMs = 2000): Promise<MotionSummary | undefined> {
  return new Promise((resolve) => {
    const values: number[] = [];
    const finish = (source: MotionSummary["source"], stop: () => void) => {
      stop();
      if (!values.length) return resolve(undefined);
      resolve({ samples: values.length, spread: Number((Math.max(...values) - Math.min(...values)).toFixed(4)), source });
    };
    const sensor = tg()?.Accelerometer;
    if (sensor && supports("8.0") && isMobile()) {
      let timer = 0;
      const onChange = () => values.push(Math.hypot(sensor.x, sensor.y, sensor.z));
      try {
        tg()?.onEvent?.("accelerometerChanged", onChange);
        sensor.start({ refresh_rate: 60 }, (started) => {
          if (!started) {
            tg()?.offEvent?.("accelerometerChanged", onChange);
            return resolve(undefined);
          }
          timer = window.setTimeout(
            () =>
              finish("telegram", () => {
                tg()?.offEvent?.("accelerometerChanged", onChange);
                sensor.stop();
              }),
            durationMs,
          );
        });
      } catch {
        window.clearTimeout(timer);
        resolve(undefined);
      }
      return;
    }
    if (typeof DeviceMotionEvent === "undefined") return resolve(undefined);
    const onMotion = (event: DeviceMotionEvent) => {
      const a = event.accelerationIncludingGravity;
      if (a && a.x !== null && a.y !== null && a.z !== null) values.push(Math.hypot(a.x, a.y, a.z));
    };
    window.addEventListener("devicemotion", onMotion);
    window.setTimeout(() => finish("browser", () => window.removeEventListener("devicemotion", onMotion)), durationMs);
  });
}

/* ------------------------------------------------- mavzu va xavfsiz hudud --- */
/**
 * Telegram mavzusi o‘zgarganda (yoki foydalanuvchi ilovada mavzu tanlaganda)
 * sarlavha, fon va pastki panel ranglarini moslaydi. Xavfsiz hudud CSS’da
 * Telegram’ning --tg-safe-area-* o‘zgaruvchilari orqali hisoblanadi.
 */
export function bindViewport() {
  const webApp = tg();
  if (!webApp) return () => undefined;
  const root = document.documentElement;
  const apply = () => {
    root.dataset.tgScheme = webApp.colorScheme;
    if (supports("6.1")) {
      // Foydalanuvchi ilovada o‘z mavzusini tanlagan bo‘lsa — sarlavha ham shu rangda.
      const custom = root.dataset.miniTheme && root.dataset.miniTheme !== "auto";
      const bg = custom ? getComputedStyle(document.querySelector(".mini") || document.body).backgroundColor : "";
      try {
        if (bg && /^rgb/.test(bg)) {
          const hex = `#${(bg.match(/\d+/g) || []).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
          webApp.setHeaderColor?.(hex);
          webApp.setBackgroundColor?.(hex);
          if (supports("7.10")) webApp.setBottomBarColor?.(hex);
        } else {
          webApp.setHeaderColor?.("secondary_bg_color");
          webApp.setBackgroundColor?.("secondary_bg_color");
          if (supports("7.10")) webApp.setBottomBarColor?.("secondary_bg_color");
        }
      } catch {
        /* eski Telegram */
      }
    }
  };
  apply();
  const events = ["themeChanged", "safeAreaChanged", "contentSafeAreaChanged", "fullscreenChanged"];
  for (const name of events) webApp.onEvent?.(name, apply);
  window.addEventListener("staffora:mini-theme", apply);
  return () => {
    for (const name of events) webApp.offEvent?.(name, apply);
    window.removeEventListener("staffora:mini-theme", apply);
  };
}

/* ----------------------------------------------------- xato jurnali --- */
let sentLogs = 0;
/** Mini App xatosini serverga yozadi (sessiyasiga 15 tagacha). */
export function reportError(kind: string, message: string, detail?: unknown) {
  if (sentLogs >= 15 || !message) return;
  sentLogs += 1;
  const text = detail instanceof Error ? `${detail.name}: ${detail.message}\n${detail.stack || ""}` : detail === undefined ? undefined : String(detail);
  void api("/mini-log", {
    method: "POST",
    body: JSON.stringify({
      kind: kind.slice(0, 40),
      message: message.slice(0, 500),
      detail: text?.slice(0, 2000),
      platform: platform(),
      version: tg()?.version,
    }),
  }).catch(() => undefined);
}

/** Global xatolarni ushlash (bir marta). */
let errorsBound = false;
export function bindErrorReporting() {
  if (errorsBound) return;
  errorsBound = true;
  window.addEventListener("error", (event) => {
    if (!event.message || /ResizeObserver/.test(event.message)) return;
    reportError("js", event.message, event.error || `${event.filename}:${event.lineno}`);
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason as { message?: string; status?: number } | undefined;
    // API xatolari (4xx) foydalanuvchiga ko‘rsatiladi — jurnalga kerak emas.
    if (reason && typeof reason.status === "number") return;
    reportError("promise", reason?.message || String(event.reason), event.reason);
  });
}
