import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import type { Attendance, Branch, Company, Department, Employee, LeaveRequest, Notification, Position, Schedule } from "@/lib/types";
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
  workEmojiId?: string;
};
export type LateNoticeInfo = { id: string; minutes: number; reason: string; createdAt: string };

export type HomeData = {
  employee: Employee;
  company?: Company;
  branch: Branch | null;
  department: Department | null;
  position: Position | null;
  schedule: Schedule | null;
  attendance?: Attendance;
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
export type Tab = "home" | "history" | "leave" | "profile" | "manager";
export type Action = "CHECK_IN" | "CHECK_OUT";
export type Toast = (text: string, tone?: "ok" | "error") => void;

export const som = (value: number) => `${Math.round(value).toLocaleString("ru-RU").replace(/\s/g, " ")} so‘m`;
export const clockDuration = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
export const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export function useClock(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
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
export function usePullToRefresh(enabled: boolean, onRefresh: () => Promise<unknown>) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let startY: number | null = null;
    let distance = 0;
    const onStart = (event: TouchEvent) => {
      const target = event.target as HTMLElement | null;
      // Ochiq oynalar (sheet) ichida va sahifa tepada bo‘lmasa — ishlamaydi.
      startY = window.scrollY <= 0 && !target?.closest(".sheet-layer, .faceid, .rc-layer") && event.touches.length === 1 ? event.touches[0].clientY : null;
      distance = 0;
    };
    const onMove = (event: TouchEvent) => {
      if (startY === null) return;
      distance = Math.max(0, event.touches[0].clientY - startY);
      setPull(Math.min(90, distance * 0.5));
    };
    const onEnd = () => {
      if (startY === null) return;
      startY = null;
      setPull(0);
      if (distance * 0.5 >= 70) {
        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("medium");
        setRefreshing(true);
        void onRefresh().finally(() => setRefreshing(false));
      }
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
  }, [enabled, onRefresh]);
  return { pull, ready: pull >= 70, refreshing };
}
