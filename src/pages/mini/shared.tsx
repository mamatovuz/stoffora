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
