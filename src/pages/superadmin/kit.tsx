import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, Check, ChevronLeft, ChevronRight, Copy, KeyRound, LoaderCircle, RotateCcw, ShieldAlert, X } from "lucide-react";
import { ApiError, api, authHeaders, errorText, post } from "../../api";
import { useApi } from "../../hooks";
import { Empty, Modal, Status } from "../../components/ui";
import type { PlatformPermission } from "@/lib/platform/permissions";

/*
 * Super Admin Control Center — umumiy komponentlar:
 * PlatformProvider/usePlatform (ruxsatlar), PermissionGuard, DataTable (server sahifalash, mobil — kartalar),
 * FilterBar, StatusBadge, DetailDrawer, ConfirmDialog (matn bilan tasdiq), ReauthProvider (428 → parol),
 * Skeleton, ErrorState, ActivityTimeline, DateRangeFilter, SecretReveal, formatlash yordamchilari.
 */

/* --------------------------------------------------------------- formatlash --- */
export function ago(iso?: string | null) {
  if (!iso) return "—";
  const minutes = Math.round((Date.now() - Date.parse(iso.length === 10 ? `${iso}T12:00:00+05:00` : iso)) / 60_000);
  if (!Number.isFinite(minutes)) return "—";
  if (minutes < 0) return dateTime(iso);
  if (minutes < 1) return "hozir";
  if (minutes < 60) return `${minutes} daq oldin`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} soat oldin`;
  const days = Math.round(minutes / 1440);
  return days < 30 ? `${days} kun oldin` : dateOnly(iso);
}
export const dateOnly = (iso?: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—");
export const dateTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tashkent" }) : "—");
export const num = (value?: number | null) => (value === null || value === undefined ? "—" : value.toLocaleString("ru-RU"));
export const compact = (value: number) => (Math.abs(value) >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}K` : String(value));
export function bytes(value?: number | null) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = value;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}
export const money = (value: number, currency = "UZS") => `${value.toLocaleString("ru-RU")} ${currency}`;

/* -------------------------------------------------------- platforma konteksti --- */
export type PlatformMe = {
  user: { id: string; name: string; email: string; role: string; roleLabel: string; telegramLinked: boolean };
  permissions: PlatformPermission[];
  platformName: string;
  badges: { tickets: number; incidents: number; errors: number; approvals: number };
};
const PlatformContext = createContext<{ me: PlatformMe | null; can: (p: PlatformPermission) => boolean; reload: () => void }>({ me: null, can: () => false, reload: () => undefined });

export function PlatformProvider({ children }: { children: ReactNode }) {
  const { data, reload } = useApi<PlatformMe>("/super-admin/me");
  const value = useMemo(() => ({ me: data, can: (p: PlatformPermission) => Boolean(data?.permissions.includes(p)), reload: () => void reload(true) }), [data, reload]);
  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>;
}
export const usePlatform = () => useContext(PlatformContext);

/** Ruxsat bo‘lmasa — yashiradi (yoki fallback). Server baribir tekshiradi. */
export function PermissionGuard({ perm, children, fallback = null }: { perm: PlatformPermission | PlatformPermission[]; children: ReactNode; fallback?: ReactNode }) {
  const { can, me } = usePlatform();
  if (!me) return null;
  const list = Array.isArray(perm) ? perm : [perm];
  return list.some(can) ? <>{children}</> : <>{fallback}</>;
}

export function NoAccess() {
  return <Empty icon={ShieldAlert} title="Ruxsat yo‘q" text="Bu bo‘lim sizning platforma rolingiz uchun yopiq." />;
}

/* -------------------------------------------------- qayta autentifikatsiya --- */
type Reauth = <T>(run: () => Promise<T>) => Promise<T>;
const ReauthContext = createContext<Reauth>((run) => run());

/** Server 428 (REAUTH_REQUIRED) qaytarsa — parol so‘raladi va amal qayta bajariladi. */
export function ReauthProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<{ resolve: () => void; reject: (e: unknown) => void } | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const withReauth = useCallback<Reauth>(async (run) => {
    try {
      return await run();
    } catch (reason) {
      if (!(reason instanceof ApiError) || reason.code !== "REAUTH_REQUIRED") throw reason;
      await new Promise<void>((resolve, reject) => setPending({ resolve, reject }));
      return run();
    }
  }, []);
  const close = () => {
    pending?.reject(new Error("Amal bekor qilindi."));
    setPending(null);
    setPassword("");
    setError("");
  };
  return (
    <ReauthContext.Provider value={withReauth}>
      {children}
      {pending && (
        <Modal title="Parolni tasdiqlang" subtitle="Bu xavfli amal — davom etish uchun parolingizni kiriting" onClose={close} size="narrow">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await post("/super-admin/reauth", { password });
                pending.resolve();
                setPending(null);
                setPassword("");
              } catch (reason) {
                setError(errorText(reason));
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="field">
              <span className="label">Parol</span>
              <span className="input-icon">
                <KeyRound size={16} />
                <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus required />
              </span>
            </label>
            {error && <p className="sa-error-line">{error}</p>}
            <div className="form-actions">
              <button type="button" className="btn" onClick={close}>
                Bekor qilish
              </button>
              <button className="btn btn-primary" disabled={busy || !password}>
                {busy && <LoaderCircle size={15} className="spin" />} Tasdiqlash
              </button>
            </div>
          </form>
        </Modal>
      )}
    </ReauthContext.Provider>
  );
}
export const useReauth = () => useContext(ReauthContext);

/* ---------------------------------------------------------------- holatlar --- */
const STATUS: Record<string, [string, string]> = {
  ACTIVE: ["Faol", "green"],
  TRIAL: ["Sinov", "amber"],
  SUSPENDED: ["To‘xtatilgan", "red"],
  GRACE: ["Imtiyozli davr", "amber"],
  EXPIRED: ["Muddati tugagan", "red"],
  NONE: ["Obunasiz", "gray"],
  ARCHIVED: ["Arxiv", "gray"],
  OK: ["Ishlayapti", "green"],
  WARN: ["Ogohlantirish", "amber"],
  DOWN: ["Ishlamayapti", "red"],
  NOT_CONFIGURED: ["Sozlanmagan", "gray"],
  OPEN: ["Ochiq", "red"],
  ACKNOWLEDGED: ["Qabul qilindi", "amber"],
  RESOLVED: ["Hal qilindi", "green"],
  IN_PROGRESS: ["Jarayonda", "blue"],
  WAITING_CUSTOMER: ["Mijoz javobi kutilmoqda", "amber"],
  CLOSED: ["Yopilgan", "gray"],
  NEW: ["Yangi", "red"],
  INVESTIGATING: ["Tekshirilmoqda", "amber"],
  IGNORED: ["E’tiborsiz", "gray"],
  QUEUED: ["Navbatda", "gray"],
  RUNNING: ["Bajarilmoqda", "blue"],
  SUCCEEDED: ["Bajarildi", "green"],
  SUCCESS: ["Muvaffaqiyatli", "green"],
  FAILED: ["Xato", "red"],
  FAILURE: ["Xato", "red"],
  DENIED: ["Rad etildi", "red"],
  CANCELLED: ["Bekor qilingan", "gray"],
  DRAFT: ["Qoralama", "gray"],
  ISSUED: ["Chiqarilgan", "blue"],
  PAID: ["To‘langan", "green"],
  VOID: ["Bekor", "gray"],
  OVERDUE: ["Muddati o‘tgan", "red"],
  SCHEDULED: ["Rejalashtirilgan", "blue"],
  SENDING: ["Yuborilmoqda", "blue"],
  SENT: ["Yuborildi", "green"],
  PARTIAL: ["Qisman", "amber"],
  PENDING: ["Kutilmoqda", "amber"],
  SKIPPED: ["O‘tkazib yuborildi", "gray"],
  DELIVERED: ["Yetkazildi", "green"],
  COMPLETED: ["Bajarildi", "green"],
  NEEDS_ATTENTION: ["E’tibor kerak", "red"],
  PENDING_APPROVAL: ["Tasdiq kutilmoqda", "amber"],
  ENDED: ["Tugagan", "gray"],
  REJECTED: ["Rad etilgan", "red"],
  REVOKED: ["Bekor qilingan", "gray"],
  DISABLED: ["O‘chiq", "gray"],
  SUPERSEDED: ["Eski versiya", "gray"],
  TERMINATED: ["Bekor qilingan", "red"],
  PASSED: ["O‘tdi", "green"],
  INFO: ["Ma’lumot", "blue"],
  WARNING: ["Ogohlantirish", "amber"],
  CRITICAL: ["Jiddiy", "red"],
  LOW: ["Past", "gray"],
  NORMAL: ["Oddiy", "blue"],
  HIGH: ["Yuqori", "amber"],
  URGENT: ["Shoshilinch", "red"],
  MEDIUM: ["O‘rta", "amber"],
  GOOD: ["Yaxshi", "green"],
  FAIR: ["O‘rtacha", "amber"],
  POOR: ["Past", "red"],
};
export function StatusBadge({ value, label }: { value: string; label?: string }) {
  const known = STATUS[value];
  if (!known) return <Status value={value} label={label} />;
  return <span className={`badge ${known[1]}`}>{label || known[0]}</span>;
}
export const statusLabel = (value: string) => STATUS[value]?.[0] || value;

/* ---------------------------------------------------------------- yuklanish --- */
export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="sa-skeleton" aria-busy="true" aria-label="Yuklanmoqda">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} style={{ width: `${70 + ((i * 37) % 30)}%` }} />
      ))}
    </div>
  );
}
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="sa-error" role="alert">
      <AlertCircle size={18} />
      <span>{message}</span>
      {onRetry && (
        <button className="btn btn-sm" onClick={onRetry}>
          <RotateCcw size={14} /> Qayta urinish
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ server ro‘yxati --- */
export type Paged<T> = { rows: T[]; total: number; page: number; pageSize: number };
/** Server tomonda filtr/sahifalash: parametrlar o‘zgarsa qayta yuklaydi. */
export function useServerList<T, Extra = object>(path: string | null, params: Record<string, string | number | boolean | undefined | null>) {
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "" && v !== false).map(([k, v]) => [k, String(v)])).toString();
  return useApi<Paged<T> & Extra>(path ? `${path}${query ? `?${query}` : ""}` : null);
}

export type Column<T> = { key: string; label: string; render: (row: T) => ReactNode; className?: string; hideOnMobile?: boolean; sortable?: boolean };

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  onRetry,
  onRowClick,
  empty,
  sort,
  onSort,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  sort?: { key: string; dir: "asc" | "desc" };
  onSort?: (key: string) => void;
}) {
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (!rows && loading) return <Skeleton />;
  if (!rows?.length) return <>{empty || <Empty title="Ma’lumot topilmadi" text="Filtrlarni o‘zgartirib ko‘ring." />}</>;
  return (
    <div className={`table-wrap sa-table-wrap ${loading ? "is-loading" : ""}`}>
      <table className="table table-cards sa-dt">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.className}>
                {c.sortable && onSort ? (
                  <button className={`sa-sort ${sort?.key === c.key ? "on" : ""}`} onClick={() => onSort(c.key)} aria-label={`${c.label} bo‘yicha saralash`}>
                    {c.label}
                    {sort?.key === c.key ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
                  </button>
                ) : (
                  c.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={onRowClick ? "clickable" : ""}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={onRowClick ? (e) => e.key === "Enter" && onRowClick(row) : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} data-label={c.label} className={`${c.className || ""} ${c.hideOnMobile ? "sa-hide-mobile" : ""}`}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return total ? <p className="sa-pager-note">{num(total)} ta</p> : null;
  return (
    <div className="sa-pager">
      <span>
        {num((page - 1) * pageSize + 1)}–{num(Math.min(total, page * pageSize))} / {num(total)}
      </span>
      <button className="icon-btn" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Oldingi sahifa">
        <ChevronLeft size={16} />
      </button>
      <b>
        {page} / {pages}
      </b>
      <button className="icon-btn" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Keyingi sahifa">
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="sa-filters">{children}</div>;
}

/** Matn qidiruvi (debounce bilan). */
export function SearchInput({ value, onChange, placeholder = "Qidirish…" }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  const [text, setText] = useState(value);
  const first = useRef(true);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = window.setTimeout(() => text !== value && onChange(text), 300);
    return () => window.clearTimeout(t);
  }, [text, value, onChange]);
  return <input className="input sa-search" type="search" placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} aria-label={placeholder} />;
}

export function Select<T extends string>({ value, onChange, options, label }: { value: T; onChange: (value: T) => void; options: [T, string][]; label: string }) {
  return (
    <select className="select sa-select" value={value} onChange={(e) => onChange(e.target.value as T)} aria-label={label}>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

/* ----------------------------------------------------------------- drawer --- */
export function DetailDrawer({ title, subtitle, onClose, children, actions, wide }: { title: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode; actions?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="sa-drawer-layer" role="dialog" aria-modal="true">
      <button className="sa-drawer-backdrop" aria-label="Yopish" onClick={onClose} />
      <aside className={`sa-drawer ${wide ? "wide" : ""}`}>
        <header>
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions}
          <button className="icon-btn" onClick={onClose} aria-label="Yopish">
            <X size={18} />
          </button>
        </header>
        <div className="sa-drawer-body">{children}</div>
      </aside>
    </div>
  );
}

/** Tasdiq: xavfli amalda — kompaniya nomini yozish talab qilinishi mumkin. */
export function ConfirmDialog({
  title,
  text,
  confirmLabel = "Tasdiqlash",
  danger,
  typed,
  reason,
  onConfirm,
  onClose,
}: {
  title: string;
  text: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  typed?: string;
  reason?: { label: string; required?: boolean; min?: number };
  onConfirm: (reason: string) => Promise<unknown> | unknown;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [why, setWhy] = useState("");
  const ready = (!typed || confirmText.trim() === typed) && (!reason?.required || why.trim().length >= (reason.min || 3));
  return (
    <Modal title={title} onClose={onClose} size="narrow">
      <div className="muted sa-confirm-text">{text}</div>
      {reason && (
        <label className="field">
          <span className="label">{reason.label}</span>
          <textarea className="textarea" rows={2} value={why} onChange={(e) => setWhy(e.target.value)} />
        </label>
      )}
      {typed && (
        <label className="field">
          <span className="label">
            Tasdiqlash uchun <b>{typed}</b> deb yozing
          </span>
          <input className="input" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
        </label>
      )}
      {error && <p className="sa-error-line">{error}</p>}
      <div className="form-actions">
        <button className="btn" onClick={onClose} disabled={busy}>
          Bekor qilish
        </button>
        <button
          className={`btn ${danger ? "btn-danger-solid" : "btn-primary"}`}
          disabled={busy || !ready}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await onConfirm(why.trim());
              onClose();
            } catch (reason) {
              setError(errorText(reason));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <LoaderCircle size={15} className="spin" />}
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/** Bir marta ko‘rsatiladigan maxfiy qiymat (parol, API kalit, webhook secret). */
export function SecretReveal({ label, value, note }: { label: string; value: string; note?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="sa-secret">
      <span>
        <small>{label}</small>
        <code>{value}</code>
        {note && <em>{note}</em>}
      </span>
      <button
        className="btn btn-sm"
        onClick={() => {
          void navigator.clipboard?.writeText(value);
          setCopied(true);
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Nusxalandi" : "Nusxalash"}
      </button>
    </div>
  );
}

/* --------------------------------------------------------------- vaqt chizig‘i --- */
export type TimelineItem = { id: string; at: string; title: ReactNode; meta?: ReactNode; tone?: "default" | "good" | "warn" | "bad" };
export function ActivityTimeline({ items, empty = "Hozircha voqea yo‘q" }: { items: TimelineItem[]; empty?: string }) {
  if (!items.length) return <p className="muted sa-empty">{empty}</p>;
  return (
    <ol className="sa-timeline">
      {items.map((item) => (
        <li key={item.id} className={item.tone || "default"}>
          <i aria-hidden />
          <div>
            <b>{item.title}</b>
            <small>
              {item.meta ? <>{item.meta} · </> : null}
              <time dateTime={item.at} title={dateTime(item.at)}>
                {ago(item.at)}
              </time>
            </small>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* -------------------------------------------------------------- sana oralig‘i --- */
export type DateRange = { range: "today" | "7" | "30" | "90" | "custom"; from?: string; to?: string };
export const rangeQuery = (r: DateRange) => ({ range: r.range, from: r.range === "custom" ? r.from : undefined, to: r.range === "custom" ? r.to : undefined });
export function DateRangeFilter({ value, onChange }: { value: DateRange; onChange: (value: DateRange) => void }) {
  const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
  return (
    <div className="sa-range" role="group" aria-label="Sana oralig‘i">
      {(
        [
          ["today", "Bugun"],
          ["7", "7 kun"],
          ["30", "30 kun"],
          ["90", "90 kun"],
          ["custom", "Oraliq"],
        ] as [DateRange["range"], string][]
      ).map(([key, label]) => (
        <button key={key} className={value.range === key ? "on" : ""} aria-pressed={value.range === key} onClick={() => onChange(key === "custom" ? { range: "custom", from: value.from || today, to: value.to || today } : { range: key })}>
          {label}
        </button>
      ))}
      {value.range === "custom" && (
        <span className="sa-range-custom">
          <input className="input" type="date" max={today} value={value.from || ""} onChange={(e) => onChange({ ...value, from: e.target.value })} aria-label="Boshlanish" />
          <span>—</span>
          <input className="input" type="date" max={today} value={value.to || ""} onChange={(e) => onChange({ ...value, to: e.target.value })} aria-label="Tugash" />
        </span>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- yordamchilar --- */
/** Amalni bajaradi, toast chiqaradi, 428 bo‘lsa parol so‘raydi. */
export function useAction() {
  const reauth = useReauth();
  return useCallback(
    async <T,>(run: () => Promise<T>, toast: (text: string, tone?: "success" | "error") => void, success?: string) => {
      try {
        const result = await reauth(run);
        if (success) toast(success);
        return result;
      } catch (reason) {
        if (reason instanceof Error && reason.message === "Amal bekor qilindi.") return undefined;
        toast(errorText(reason), "error");
        return undefined;
      }
    },
    [reauth],
  );
}

export function Section({ title, subtitle, actions, children, className }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card sa-section ${className || ""}`}>
      {(title || actions) && (
        <div className="sa-section-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="toolbar">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function KeyValue({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="sa-kv">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export async function downloadFile(path: string, fallbackName: string) {
  const res = await fetch(`/api${path}`, { credentials: "include", headers: authHeaders() });
  if (!res.ok) {
    let message = `Yuklab bo‘lmadi (${res.status})`;
    let code: string | undefined;
    try {
      const body = (await res.json()) as { message?: string; code?: string };
      message = body.message || message;
      code = body.code;
    } catch {
      /* JSON emas */
    }
    throw new ApiError(message, res.status, code);
  }
  const blob = await res.blob();
  const name = /filename="?([^";]+)"?/.exec(res.headers.get("content-disposition") || "")?.[1];
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name ? decodeURIComponent(name) : fallbackName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Faylni o‘qib bo‘lmadi."));
    reader.readAsDataURL(file);
  });
}

export { api };
