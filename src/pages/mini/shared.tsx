import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import type { Attendance, Branch, Company, Department, Employee, LeaveRequest, Notification, Position, Schedule } from "@/lib/types";
import { tashkentWeekday } from "@/lib/format";
import { useMainButton, useSecondaryButton } from "./tg";

/* Mini App bo‘limlari uchun umumiy turlar va kichik komponentlar. */

export type MiniFeatures = {
  biometric: boolean;
  biometricRegistered: boolean;
  faceEvery: number;
  directory: boolean;
  breaks: boolean;
  leaderboard: boolean;
  advances: boolean;
  overtimeApproval: boolean;
  /** «Qo‘shimcha ish uchun to‘lash» o‘chiq bo‘lsa false — qo‘shimcha ish bo‘limlari ko‘rinmaydi (eski serverda yo‘q). */
  overtime?: boolean;
  /** «Kechikishni ishlab yopish» yoqilgan. */
  lateOffset?: boolean;
  workEmojiId?: string;
  /** Super admin o‘chirgan modullar (lib/modules.ts kalitlari). */
  modules?: string[];
};
/** Mini App’da modul yoqilganmi (ma’lumot kelmagan bo‘lsa — yoqilgan). */
export const miniModuleOn = (features: MiniFeatures | undefined, key: string) => !features?.modules?.includes(key);
export type LateNoticeInfo = { id: string; minutes: number; reason: string; createdAt: string };

export type HomeData = {
  employee: Employee;
  company?: Company;
  branch: Branch | null;
  /** «Istalgan filialdan» lavozimi: keldi-ketdi mumkin bo‘lgan filiallar (bittadan ko‘p bo‘lsa). */
  branches?: Branch[];
  department: Department | null;
  position: Position | null;
  schedule: Schedule | null;
  /** lateCoveredMinutes — ish tugagach qo‘shimcha ish bilan yopilgan kechikish (yangi serverda). */
  attendance?: Attendance & { lateCoveredMinutes?: number };
  todayLeave: LeaveRequest | null;
  /** Bugungi reja (server): smena almashish, dam kunini ko‘chirish, shaxsiy dam kuni hisobga olingan. */
  todayPlan?: { enabled: boolean; start: string; end: string; overridden: boolean; reason?: string; personalRest?: boolean };
  month: {
    practiceUntil?: string;
    deduction?: number;
    penaltyMode?: string;
    days: number;
    late: number;
    lateMinutes: number;
    workedMinutes: number;
    overtimeMinutes: number;
  };
  features?: MiniFeatures;
  lateNotice?: LateNoticeInfo | null;
  notifications: Notification[];
  unreadNotifications?: number;
};
/** «leave» — So‘rovlar ekrani: pastki menyuda emas, «Bo‘limlar»dan ochiladi. */
export type Tab = "home" | "history" | "sections" | "leave" | "profile" | "manager";
export type Action = "CHECK_IN" | "CHECK_OUT";
export type Toast = (text: string, tone?: "ok" | "error") => void;

export const som = (value: number) => `${Math.round(value).toLocaleString("ru-RU").replace(/\s/g, " ")} so‘m`;
export const clockDuration = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
export const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Bugungi reja: serverdan (shaxsiy dam kuni, ko‘chirish hisobga olingan), bo‘lmasa haftalik grafik. */
export function todayPlanOf(data: HomeData) {
  if (data.todayPlan) return data.todayPlan;
  const weekly = data.schedule?.days.find((d) => d.day === tashkentWeekday());
  return weekly ? { enabled: weekly.enabled, start: weekly.start, end: weekly.end, overridden: false } : undefined;
}

export function useClock(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/**
 * Daqiqa chegarasida yangilanadigan soat (09:41:00 → 09:42:00). Bosh sahifada faqat soat:daqiqa
 * ko‘rsatiladi — har soniyada butun sahifani qayta chizish sekin telefonlarda qotishga sabab bo‘lardi.
 * Telegram fondan qaytganda (taymerlar to‘xtatilgan bo‘lishi mumkin) darhol yangilanadi.
 */
export function useMinuteClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer = 0;
    const tick = () => {
      const current = new Date();
      setNow((prev) => (Math.floor(prev.getTime() / 60_000) === Math.floor(current.getTime() / 60_000) ? prev : current));
      timer = window.setTimeout(tick, 60_000 - (current.getTime() % 60_000) + 50);
    };
    timer = window.setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      window.clearTimeout(timer);
      tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return now;
}

export function PhotoAvatar({ employee, className }: { employee: Pick<Employee, "firstName" | "lastName" | "photoDataUrl">; className?: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={`mini-avatar ${className || ""}`}>
      {employee.photoDataUrl && !broken ? (
        <img src={employee.photoDataUrl} alt="" onError={() => setBroken(true)} />
      ) : (
        `${employee.firstName[0] || ""}${employee.lastName[0] || ""}`
      )}
    </span>
  );
}

/**
 * Pastdan chiquvchi oyna. `primary` berilsa — Telegram’ning pastki asosiy tugmasi
 * (MainButton) ishlatiladi; Telegram tashqarisida sahifadagi oddiy tugma ko‘rinadi.
 */
export function Sheet({
  title,
  subtitle,
  onClose,
  children,
  className,
  primary,
  secondary,
  headExtra,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  primary?: { text: string; onClick: () => void; disabled?: boolean; busy?: boolean; icon?: ReactNode; shine?: boolean } | null;
  secondary?: { text: string; onClick: () => void } | null;
  headExtra?: ReactNode;
}) {
  const nativePrimary = useMainButton(
    primary ? { text: primary.busy ? "Yuborilmoqda…" : primary.text, onClick: primary.onClick, disabled: primary.disabled || primary.busy, progress: primary.busy, shine: primary.shine } : null,
  );
  const nativeSecondary = useSecondaryButton(secondary && nativePrimary ? { text: secondary.text, onClick: secondary.onClick } : null);
  return (
    <div className="sheet-layer">
      <button className="sheet-backdrop" onClick={onClose} aria-label="Yopish" />
      <section className={`sheet ${className || ""} ${nativePrimary && primary ? "has-main-button" : ""}`} role="dialog" aria-modal="true">
        <div className="sheet-head">
          <div>
            <b>{title}</b>
            {subtitle && <small>{subtitle}</small>}
          </div>
          {headExtra}
          <button className="sheet-close" onClick={onClose} aria-label="Yopish">
            <X size={18} />
          </button>
        </div>
        {children}
        {primary && !nativePrimary && (
          <div className="sheet-actions">
            {secondary && (
              <button type="button" className="mini-btn ghost-neutral" onClick={secondary.onClick}>
                {secondary.text}
              </button>
            )}
            <button type="button" className="mini-btn" onClick={primary.onClick} disabled={primary.disabled || primary.busy}>
              {primary.icon}
              {primary.busy ? "Yuborilmoqda…" : primary.text}
            </button>
          </div>
        )}
        {secondary && nativePrimary && !nativeSecondary && (
          <button type="button" className="mini-btn ghost-neutral" style={{ marginTop: 10 }} onClick={secondary.onClick}>
            {secondary.text}
          </button>
        )}
      </section>
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange, className }: { value: T; options: [T, ReactNode][]; onChange: (value: T) => void; className?: string }) {
  return (
    <div className={`mini-seg ${className || ""}`} role="tablist">
      {options.map(([key, label]) => (
        <button key={key} role="tab" aria-selected={value === key} className={value === key ? "on" : ""} onClick={() => onChange(key)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <section className="mini-card" aria-busy="true">
      <div className="mini-rows">
        {Array.from({ length: rows }, (_, i) => (
          <div className="mini-row sk-row" key={i}>
            <span className="sk sk-circle" />
            <span>
              <i className="sk sk-line" style={{ width: `${55 + ((i * 13) % 30)}%` }} />
              <i className="sk sk-line short" />
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Bo‘sh holatlar uchun kichik illyustratsiya (mavzu ranglariga moslashadi). */
export function EmptyArt({ kind }: { kind: "chat" | "idea" | "doc" | "calendar" | "people" | "cake" | "check" }) {
  const body: Record<typeof kind, ReactNode> = {
    chat: (
      <>
        <rect x="14" y="18" width="52" height="34" rx="10" className="ea-fill" />
        <path d="M26 52l-6 12 16-12" className="ea-fill" />
        <rect x="38" y="34" width="46" height="30" rx="10" className="ea-accent" />
        <circle cx="52" cy="49" r="3" className="ea-dot" />
        <circle cx="61" cy="49" r="3" className="ea-dot" />
        <circle cx="70" cy="49" r="3" className="ea-dot" />
      </>
    ),
    idea: (
      <>
        <circle cx="50" cy="40" r="22" className="ea-accent" />
        <rect x="41" y="62" width="18" height="10" rx="3" className="ea-fill" />
        <rect x="44" y="74" width="12" height="5" rx="2.5" className="ea-fill" />
        <path d="M44 42l6 6 6-6" className="ea-line" />
      </>
    ),
    doc: (
      <>
        <rect x="26" y="14" width="42" height="56" rx="7" className="ea-fill" />
        <rect x="34" y="28" width="26" height="4" rx="2" className="ea-dot" />
        <rect x="34" y="37" width="20" height="4" rx="2" className="ea-dot" />
        <circle cx="64" cy="64" r="14" className="ea-accent" />
        <path d="M58 64l4 4 8-8" className="ea-line" />
      </>
    ),
    calendar: (
      <>
        <rect x="18" y="22" width="64" height="52" rx="9" className="ea-fill" />
        <rect x="18" y="22" width="64" height="14" rx="7" className="ea-accent" />
        <circle cx="36" cy="52" r="4" className="ea-dot" />
        <circle cx="50" cy="52" r="4" className="ea-dot" />
        <circle cx="64" cy="52" r="4" className="ea-dot" />
      </>
    ),
    people: (
      <>
        <circle cx="38" cy="36" r="11" className="ea-fill" />
        <rect x="20" y="51" width="36" height="22" rx="11" className="ea-fill" />
        <circle cx="62" cy="34" r="12" className="ea-accent" />
        <rect x="44" y="50" width="38" height="24" rx="12" className="ea-accent" />
      </>
    ),
    cake: (
      <>
        <rect x="22" y="44" width="56" height="28" rx="6" className="ea-accent" />
        <rect x="28" y="34" width="44" height="14" rx="5" className="ea-fill" />
        <rect x="47" y="20" width="6" height="14" rx="3" className="ea-dot" />
        <path d="M50 12c3 4 3 6 0 8-3-2-3-4 0-8z" className="ea-flame" />
      </>
    ),
    check: (
      <>
        <circle cx="50" cy="44" r="28" className="ea-accent" />
        <path d="M38 44l8 8 16-16" className="ea-line" />
      </>
    ),
  };
  return (
    <svg className="empty-art" viewBox="0 0 100 86" width="96" height="82" aria-hidden="true">
      <ellipse cx="50" cy="80" rx="34" ry="4" className="ea-shadow" />
      {body[kind]}
    </svg>
  );
}

/**
 * Pastga tortib yangilash: sahifa eng tepada bo‘lganda barmoq bilan pastga tortilsa
 * (≥ 70px) `onRefresh` chaqiriladi. Telegram vertikal yopishi o‘chirilgan — xavfsiz.
 */
/**
 * Pastga tortib yangilash. Tortish masofasi React holatida saqlanmaydi: har `touchmove`da butun
 * Mini App qayta chizilib, barmoq ortidan qotib yurardi. Endi ko‘rsatkich elementi to‘g‘ridan-to‘g‘ri
 * (requestAnimationFrame bilan, kadrga bir marta) o‘zgartiriladi; React faqat «yangilanmoqda» holatini biladi.
 */
export function usePullToRefresh(enabled: boolean, onRefresh: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  const indicator = useRef<HTMLDivElement | null>(null);
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;
  useEffect(() => {
    if (!enabled) return;
    let startY: number | null = null;
    let distance = 0;
    let frame = 0;
    const paint = () => {
      frame = 0;
      const el = indicator.current;
      if (!el) return;
      const pull = startY === null ? 0 : Math.min(90, distance * 0.5);
      el.style.height = pull ? `${pull}px` : "";
      if (pull >= 70) el.dataset.ready = "1";
      else delete el.dataset.ready;
      if (pull > 0) el.dataset.drag = "1";
      else delete el.dataset.drag;
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(paint);
    };
    const onStart = (event: TouchEvent) => {
      const target = event.target as HTMLElement | null;
      // Ochiq oynalar (sheet) ichida va sahifa tepada bo‘lmasa — ishlamaydi.
      startY = window.scrollY <= 0 && !target?.closest(".sheet-layer, .faceid, .rc-layer") && event.touches.length === 1 ? event.touches[0].clientY : null;
      distance = 0;
    };
    const onMove = (event: TouchEvent) => {
      if (startY === null) return;
      const next = Math.max(0, event.touches[0].clientY - startY);
      if (next === distance) return;
      distance = next;
      schedule();
    };
    const onEnd = () => {
      if (startY === null) return;
      startY = null;
      schedule();
      if (distance * 0.5 >= 70) {
        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("medium");
        setRefreshing(true);
        void refresh.current().finally(() => setRefreshing(false));
      }
      distance = 0;
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      startY = null;
      paint();
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [enabled]);
  return { indicator, refreshing };
}
