import { AlertCircle, Inbox, X } from "lucide-react";
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
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
export function Status({ value }: { value: string }) {
  const green = [
      "ACTIVE",
      "PRESENT",
      "WORKING",
      "CHECKED_OUT",
      "APPROVED",
      "SENT",
      "CONNECTED",
    ],
    amber = ["LATE", "PENDING", "TRIAL", "SCHEDULED"],
    red = [
      "ABSENT",
      "REJECTED",
      "SUSPENDED",
      "INACTIVE",
      "ARCHIVED",
      "BLOCKED",
    ];
  const labels: Record<string, string> = {
    ACTIVE: "Faol",
    PRESENT: "Vaqtida",
    WORKING: "Ishlamoqda",
    CHECKED_OUT: "Ishdan chiqdi",
    APPROVED: "Tasdiqlangan",
    SENT: "Yuborilgan",
    CONNECTED: "Ulangan",
    LATE: "Kechikdi",
    PENDING: "Kutilmoqda",
    TRIAL: "Sinov",
    SCHEDULED: "Rejalangan",
    ABSENT: "Kelmagan",
    REJECTED: "Rad etilgan",
    SUSPENDED: "Bloklangan",
    INACTIVE: "Nofaol",
    ARCHIVED: "Arxiv",
    ON_LEAVE: "Ta’tilda",
    DRAFT: "Qoralama",
    CANCELLED: "Bekor qilingan",
  };
  return (
    <span
      className={`badge ${green.includes(value) ? "badge-green" : amber.includes(value) ? "badge-amber" : red.includes(value) ? "badge-red" : "badge-blue"}`}
    >
      {labels[value] || value}
    </span>
  );
}
export function Avatar({
  first,
  last,
  photo,
}: {
  first: string;
  last?: string;
  photo?: string;
}) {
  return (
    <span className="avatar">
      {photo ? (
        <img src={photo} alt={`${first} ${last || ""}`} />
      ) : (
        `${first[0] || ""}${last?.[0] || ""}`.toUpperCase()
      )}
    </span>
  );
}
export function Loading() {
  return (
    <div className="loading" aria-label="Yuklanmoqda" aria-busy="true">
      <span className="skeleton-line skeleton-title" />
      <span className="skeleton-line" />
      <span className="skeleton-line skeleton-short" />
    </div>
  );
}
export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="error-box">
      <AlertCircle size={18} />
      {message}
    </div>
  );
}
export function Empty({
  title = "Ma’lumot topilmadi",
  text = "Hozircha ko‘rsatish uchun ma’lumot yo‘q.",
}: {
  title?: string;
  text?: string;
}) {
  return (
    <div className="empty">
      <Inbox size={32} />
      <b>{title}</b>
      <p>{text}</p>
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="modal-layer" role="dialog" aria-modal>
      <button className="modal-backdrop" onClick={onClose} />
      <div className="modal">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
