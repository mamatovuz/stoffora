import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Building2,
  CalendarClock,
  CheckCircle2,
  Columns3,
  Download,
  FileSpreadsheet,
  MessageSquareText,
  Network,
  BriefcaseBusiness,
  ToggleLeft,
  Upload,
  X,
  AlertTriangle,
} from "lucide-react";
import { errorText, post } from "../api";
import { ErrorBox, Field, Modal } from "./ui";
import type { Meta } from "../types";

/* ------------------------------------------------------------ saralash --- */
export type SortState = { key: string; dir: "asc" | "desc" };

/** Bosilganda saralaydigan ustun sarlavhasi (o‘sish → kamayish). */
export function SortTh({ label, sortKey, sort, onSort, className }: { label: string; sortKey: string; sort: SortState; onSort: (next: SortState) => void; className?: string }) {
  const active = sort.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={className} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className={`th-sort ${active ? "on" : ""}`} onClick={() => onSort({ key: sortKey, dir: active && sort.dir === "asc" ? "desc" : "asc" })}>
        {label}
        <Icon size={13} />
      </button>
    </th>
  );
}

/* ------------------------------------------------------ ustunlar menyusi --- */
export type ColumnOption = { key: string; label: string };

/** Ustunlar tanlovi brauzerda saqlanadi (har bir foydalanuvchi o‘zi uchun). */
export function useColumns(storageKey: string, defaults: string[]) {
  const [visible, setVisible] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      return Array.isArray(saved) ? saved : defaults;
    } catch {
      return defaults;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(visible));
    } catch {
      /* xususiy rejim */
    }
  }, [storageKey, visible]);
  const toggle = (key: string) => setVisible((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  return { visible, toggle, reset: () => setVisible(defaults), show: (key: string) => visible.includes(key) };
}

export function ColumnsMenu({ options, visible, onToggle, onReset }: { options: ColumnOption[]; visible: string[]; onToggle: (key: string) => void; onReset: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => !box.current?.contains(event.target as Node) && setOpen(false);
    const esc = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="cols-menu" ref={box}>
      <button type="button" className="btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Columns3 size={16} /> Ustunlar
      </button>
      {open && (
        <div className="cols-pop" role="menu">
          <small>Jadvalda ko‘rsatish</small>
          {options.map((o) => (
            <label key={o.key} className="checkbox-row">
              <input type="checkbox" checked={visible.includes(o.key)} onChange={() => onToggle(o.key)} />
              {o.label}
            </label>
          ))}
          <button type="button" className="link" onClick={onReset}>
            Standart holatga qaytarish
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------ ommaviy amallar --- */
type BulkAction = "schedule" | "branch" | "department" | "position" | "status" | "message";
const ACTIONS: { key: BulkAction; label: string; icon: typeof Building2 }[] = [
  { key: "branch", label: "Filial", icon: Building2 },
  { key: "schedule", label: "Grafik", icon: CalendarClock },
  { key: "department", label: "Bo‘lim", icon: Network },
  { key: "position", label: "Lavozim", icon: BriefcaseBusiness },
  { key: "status", label: "Holat", icon: ToggleLeft },
  { key: "message", label: "Xabar yuborish", icon: MessageSquareText },
];

export function BulkBar({ count, onAction, onClear, canEdit, canMessage }: { count: number; onAction: (a: BulkAction) => void; onClear: () => void; canEdit: boolean; canMessage: boolean }) {
  return (
    <div className="bulk-bar" role="toolbar" aria-label="Tanlangan xodimlar bilan amallar">
      <b>{count} ta tanlandi</b>
      <div>
        {ACTIONS.filter((a) => (a.key === "message" ? canMessage : canEdit)).map((a) => (
          <button key={a.key} type="button" className="btn btn-sm" onClick={() => onAction(a.key)}>
            <a.icon size={14} /> {a.label}
          </button>
        ))}
      </div>
      <button type="button" className="icon-btn" aria-label="Tanlovni bekor qilish" title="Tanlovni bekor qilish" onClick={onClear}>
        <X size={16} />
      </button>
    </div>
  );
}

export function BulkModal({ action, ids, meta, onClose, onDone }: { action: BulkAction; ids: string[]; meta?: Meta; onClose: () => void; onDone: (text: string) => void }) {
  const [value, setValue] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const options: Record<Exclude<BulkAction, "message" | "status">, { id: string; name: string }[]> = {
    branch: meta?.branches || [],
    schedule: meta?.schedules || [],
    department: meta?.departments || [],
    position: meta?.positions || [],
  };
  const titles: Record<BulkAction, string> = {
    branch: "Filialga o‘tkazish",
    schedule: "Ish grafigini o‘zgartirish",
    department: "Bo‘limni o‘zgartirish",
    position: "Lavozimni o‘zgartirish",
    status: "Holatni o‘zgartirish",
    message: "Xabar yuborish",
  };
  return (
    <Modal title={titles[action]} subtitle={`${ids.length} ta xodim`} onClose={onClose} size="narrow">
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            const out = await post<{ updated: number; delivered?: number }>("/employees/bulk", { ids, action, value: value || undefined, message: message || undefined });
            onDone(
              action === "message"
                ? `${out.updated} ta xodimga xabar yuborildi${out.delivered !== undefined ? ` (Telegram: ${out.delivered})` : ""}`
                : `${out.updated} ta xodim yangilandi`,
            );
          } catch (reason) {
            setError(errorText(reason));
          } finally {
            setBusy(false);
          }
        }}
      >
        {action === "message" ? (
          <Field label="Xabar" hint="Xodimlarga ilovada va Telegram’da yetkaziladi">
            <textarea className="textarea" rows={5} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Masalan: Ertaga soat 9:00 da umumiy yig‘ilish bo‘ladi." required />
          </Field>
        ) : action === "status" ? (
          <Field label="Yangi holat">
            <select className="select" value={value} onChange={(e) => setValue(e.target.value)} required>
              <option value="">Tanlang…</option>
              <option value="ACTIVE">Faol</option>
              <option value="INACTIVE">Nofaol (vaqtincha)</option>
            </select>
          </Field>
        ) : (
          <Field label={titles[action]}>
            <select className="select" value={value} onChange={(e) => setValue(e.target.value)} required>
              <option value="">Tanlang…</option>
              {options[action].map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <ErrorBox message={error} />
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Bekor qilish
          </button>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "Saqlanmoqda…" : action === "message" ? "Yuborish" : "Qo‘llash"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* -------------------------------------------------------- Excel import --- */
type CheckedRow = { row: number; name: string; errors: string[]; warnings: string[] };
type ImportResult = { summary: { total: number; valid: number; invalid: number; created?: number }; rows: CheckedRow[] };

const readFile = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Faylni o‘qib bo‘lmadi."));
    reader.readAsDataURL(file);
  });

export function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: (created: number) => void }) {
  const [file, setFile] = useState<{ name: string; data: string } | null>(null);
  const [createMissing, setCreateMissing] = useState(true);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);

  async function check(next: { name: string; data: string }, create = createMissing) {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setResult(await post<ImportResult>("/employees/import", { file: next.data, commit: false, createMissing: create }));
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }
  async function pick(f?: File | null) {
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) return setError("Faqat .xlsx fayl (Excel 2007+).");
    if (f.size > 1_400_000) return setError("Fayl juda katta (1.4 MB gacha).");
    const next = { name: f.name, data: await readFile(f) };
    setFile(next);
    void check(next);
  }

  const problems = result?.rows.filter((r) => r.errors.length || r.warnings.length) || [];
  return (
    <Modal title="Excel’dan xodimlarni yuklash" subtitle="Shablonni to‘ldiring va yuklang — avval tekshiriladi, keyin qo‘shiladi" onClose={onClose} size="wide">
      <ol className="imp-steps">
        <li>
          <span className="ob-num">1</span>
          <div>
            <b>Shablonni yuklab oling</b>
            <small>Filial, bo‘lim, lavozim va grafiklar ochiladigan ro‘yxat sifatida tayyor.</small>
          </div>
          <a className="btn btn-sm" href="/api/employees/import-template.xlsx" download>
            <Download size={14} /> Shablon (.xlsx)
          </a>
        </li>
        <li>
          <span className="ob-num">2</span>
          <div>
            <b>To‘ldirilgan faylni yuklang</b>
            <small>Har bir qator — bitta xodim. Xatolar qator raqami bilan ko‘rsatiladi.</small>
          </div>
        </li>
      </ol>
      <label
        className={`imp-drop ${drag ? "on" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void pick(e.dataTransfer.files[0]);
        }}
      >
        <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => void pick(e.target.files?.[0])} hidden />
        <FileSpreadsheet size={26} />
        <b>{file ? file.name : "Faylni shu yerga tashlang yoki tanlang"}</b>
        <small>{busy ? "Tekshirilmoqda…" : ".xlsx, 1.4 MB gacha"}</small>
      </label>
      <label className="checkbox-row" style={{ margin: "10px 0 0" }}>
        <input
          type="checkbox"
          checked={createMissing}
          onChange={(e) => {
            setCreateMissing(e.target.checked);
            if (file) void check(file, e.target.checked);
          }}
        />
        Topilmagan bo‘lim va lavozimlarni avtomatik yaratish
      </label>
      <ErrorBox message={error} />
      {result && (
        <div className="imp-result">
          <div className="imp-summary">
            <span className="ok">
              <CheckCircle2 size={16} /> {result.summary.valid} ta tayyor
            </span>
            {result.summary.invalid > 0 && (
              <span className="bad">
                <AlertTriangle size={16} /> {result.summary.invalid} ta xato
              </span>
            )}
            <span className="muted">Jami {result.summary.total} qator</span>
          </div>
          {problems.length > 0 && (
            <div className="imp-list">
              {problems.map((r) => (
                <div key={r.row} className={r.errors.length ? "bad" : "warn"}>
                  <span className="num">{r.row}-qator</span>
                  <b>{r.name}</b>
                  <p>{[...r.errors, ...r.warnings].join(" · ")}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onClose}>
          Yopish
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!file || !result?.summary.valid || busy}
          onClick={async () => {
            if (!file) return;
            setBusy(true);
            setError("");
            try {
              const out = await post<ImportResult>("/employees/import", { file: file.data, commit: true, createMissing });
              onDone(out.summary.created || 0);
            } catch (reason) {
              setError(errorText(reason));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Upload size={15} /> {result?.summary.valid ? `${result.summary.valid} ta xodimni qo‘shish` : "Qo‘shish"}
        </button>
      </div>
    </Modal>
  );
}

export function Cell({ show, label, children, className }: { show: boolean; label: string; children: ReactNode; className?: string }) {
  return show ? (
    <td data-label={label} className={className}>
      {children}
    </td>
  ) : null;
}
