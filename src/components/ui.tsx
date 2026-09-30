import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  CheckCircle2,
  Inbox,
  LoaderCircle,
  X,
  type LucideIcon,
} from "lucide-react";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="toolbar">{actions}</div>}
    </div>
  );
}

const statusMap: Record<string, [string, string]> = {
  ACTIVE: ["Faol", "green"],
  PRESENT: ["Vaqtida", "green"],
  WORKING: ["Ishda", "green"],
  CHECKED_OUT: ["Ketdi", "blue"],
  APPROVED: ["Tasdiqlangan", "green"],
  SENT: ["Yuborilgan", "green"],
  CONNECTED: ["Ulangan", "green"],
  LATE: ["Kechikdi", "amber"],
  PENDING: ["Kutilmoqda", "amber"],
  TRIAL: ["Sinov", "amber"],
  SCHEDULED: ["Rejalangan", "blue"],
  ABSENT: ["Kelmadi", "red"],
  REJECTED: ["Rad etilgan", "red"],
  SUSPENDED: ["To‘xtatilgan", "red"],
  INACTIVE: ["Nofaol", "gray"],
  ARCHIVED: ["Ishdan bo‘shagan", "gray"],
  DISMISSED: ["Ishdan bo‘shagan", "gray"],
  BLOCKED: ["Bloklangan", "red"],
  ON_LEAVE: ["Ta’tilda", "violet"],
  DRAFT: ["Qoralama", "gray"],
  CANCELLED: ["Bekor qilingan", "gray"],
  // kunlik ro‘yxat holatlari
  IN: ["Ishda", "green"],
  LEFT: ["Ketdi", "blue"],
  DAY_OFF: ["Dam olish", "gray"],
  NOT_YET: ["Kutilmoqda", "gray"],
  UPCOMING: ["Reja", "gray"],
};

export function Status({
  value,
  label,
  live,
}: {
  value: string;
  label?: string;
  live?: boolean;
}) {
  const [text, tone] = statusMap[value] || [value, "gray"];
  return (
    <span className={`badge ${tone} ${live ? "live" : ""}`}>
      {label || text}
    </span>
  );
}

export function Avatar({
  first,
  last,
  photo,
  size,
}: {
  first: string;
  last?: string;
  photo?: string;
  size?: "sm" | "lg" | "xl";
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [photo]);
  return (
    <span className={`avatar ${size || ""}`}>
      {photo && !broken ? (
        <img src={photo} alt="" onError={() => setBroken(true)} />
      ) : (
        `${first?.[0] || ""}${last?.[0] || ""}`.toUpperCase() || "?"
      )}
    </span>
  );
}

export function Person({
  first,
  last,
  photo,
  sub,
}: {
  first: string;
  last?: string;
  photo?: string;
  sub?: ReactNode;
}) {
  return (
    <span className="person">
      <Avatar first={first} last={last} photo={photo} />
      <span>
        <b>
          {first} {last}
        </b>
        {sub && <small>{sub}</small>}
      </span>
    </span>
  );
}

export function Loading() {
  return (
    <div className="skeleton" aria-label="Yuklanmoqda" aria-busy="true">
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="error-box" role="alert">
      <AlertCircle size={18} />
      <span>{message}</span>
    </div>
  );
}

export function Empty({
  icon: Icon = Inbox,
  title = "Ma’lumot topilmadi",
  text = "Hozircha ko‘rsatish uchun ma’lumot yo‘q.",
  action,
}: {
  icon?: LucideIcon;
  title?: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={24} />
      </span>
      <b>{title}</b>
      <p>{text}</p>
      {action}
    </div>
  );
}

export function Modal({
  title,
  subtitle,
  children,
  onClose,
  size,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  size?: "wide" | "narrow";
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label={title}>
      <button className="modal-backdrop" aria-label="Yopish" onClick={onClose} />
      <div className={`modal ${size || ""}`}>
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-btn" aria-label="Yopish" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Confirm({
  title,
  text,
  confirmLabel = "Tasdiqlash",
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  text: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => Promise<unknown> | unknown;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title={title} onClose={onClose} size="narrow">
      <p className="muted" style={{ marginBottom: 16 }}>
        {text}
      </p>
      <ErrorBox message={error} />
      <div className="form-actions">
        <button className="btn" onClick={onClose} disabled={busy}>
          Bekor qilish
        </button>
        <button
          className={`btn ${danger ? "btn-danger-solid" : "btn-primary"}`}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await onConfirm();
              onClose();
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : "Xatolik");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <LoaderCircle size={16} className="spin" />}
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`field ${className || ""}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function StatCard({
  label,
  value,
  note,
  icon: Icon,
  tone,
  onClick,
  selected,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  icon: LucideIcon;
  tone?: "green" | "amber" | "red" | "blue" | "violet";
  onClick?: () => void;
  selected?: boolean;
}) {
  const content = (
    <>
      <div className="stat-top">
        <span>{label}</span>
        <span className="stat-icon">
          <Icon size={16} />
        </span>
      </div>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </>
  );
  return onClick ? (
    <button
      className={`card stat ${tone || ""} ${selected ? "selected" : ""}`}
      onClick={onClick}
    >
      {content}
    </button>
  ) : (
    <div className={`card stat ${tone || ""}`}>{content}</div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; count?: number }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          aria-selected={value === option.value}
          className={value === option.value ? "active" : ""}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count !== undefined && <small>{option.count}</small>}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- toasts --- */
type Toast = { id: number; tone: "success" | "error"; text: string };
const ToastContext = createContext<(text: string, tone?: Toast["tone"]) => void>(
  () => undefined,
);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "success") => {
    const id = Date.now() + Math.random();
    setItems((list) => [...list.slice(-3), { id, tone, text }]);
    window.setTimeout(
      () => setItems((list) => list.filter((item) => item.id !== id)),
      tone === "error" ? 6000 : 3500,
    );
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={`toast ${item.tone}`}>
            {item.tone === "success" ? (
              <CheckCircle2 size={18} />
            ) : (
              <AlertCircle size={18} />
            )}
            <span>{item.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);
