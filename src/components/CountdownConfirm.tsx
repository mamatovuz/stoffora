import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, LoaderCircle } from "lucide-react";
import { Modal, ErrorBox } from "./ui";

/**
 * Xavfli amal uchun tasdiq: «Ha» tugmasi 5 soniya sanaydi (5, 4, 3, 2, 1),
 * shundan keyingina bosiladi. Tasodifan bosib yuborishning oldini oladi.
 */
export function CountdownConfirm({
  title,
  children,
  confirmLabel = "Ha, o‘chirish",
  seconds = 5,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  seconds?: number;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}) {
  const [left, setLeft] = useState(seconds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (left <= 0) return;
    const timer = window.setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [left]);
  return (
    <Modal title={title} onClose={busy ? () => undefined : onClose} size="narrow">
      <div className="danger-confirm">
        <span className="danger-icon">
          <AlertTriangle size={26} />
        </span>
        <div className="danger-text">{children}</div>
        <ErrorBox message={error} />
        <div className="form-actions">
          <button className="btn" onClick={onClose} disabled={busy}>
            Yo‘q, bekor qilish
          </button>
          <button
            className="btn btn-danger-solid countdown-btn"
            disabled={left > 0 || busy}
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
            {busy ? <LoaderCircle size={16} className="spin" /> : left > 0 ? <span className="countdown-num">{left}</span> : null}
            {left > 0 ? "Kuting…" : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
