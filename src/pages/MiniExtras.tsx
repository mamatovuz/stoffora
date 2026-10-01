import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowLeftRight, Check, ChevronDown, FileText, LoaderCircle, Send, Upload, Wallet, X } from "lucide-react";
import { api, errorText, post } from "../api";
import { SkeletonList } from "./MiniManager";
import { getCached, setCached } from "./miniCache";
import { fileToDataUrl, DOCUMENT_LABELS } from "../components/Documents";
import { dateUz, tashkentIsoDate } from "@/lib/format";
import type { DocumentType, PayslipLine, ShiftSwapRequest } from "@/lib/types";

/* Mini App qo‘shimcha bo‘limlari: smena almashish, hujjatlar, hisob varaqalari. */

type Toast = (text: string, tone?: "ok" | "error") => void;
const som = (value: number) => `${Math.round(value).toLocaleString("ru-RU").replace(/\s/g, " ")} so‘m`;

/* ---------------------------------------------------- smena almashish --- */
type Swap = ShiftSwapRequest & { requesterName: string; colleagueName: string; giveShift?: string; takeShift?: string; incoming: boolean };

const swapChip: Record<ShiftSwapRequest["status"], [string, string]> = {
  PENDING_COLLEAGUE: ["Hamkasb javobi", "warn"],
  PENDING_MANAGER: ["Rahbar tasdig‘i", "warn"],
  APPROVED: ["Tasdiqlandi", "ok"],
  REJECTED: ["Rad etildi", "bad"],
  CANCELLED: ["Bekor qilindi", ""],
};

export function MiniSwaps({ onToast }: { onToast: Toast }) {
  const [data, setData] = useState<{ swaps: Swap[]; colleagues: { id: string; name: string }[] } | null>(() => getCached("swaps"));
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(
    () =>
      api<{ swaps: Swap[]; colleagues: { id: string; name: string }[] }>("/mini/swaps")
        .then((value) => {
          setCached("swaps", value);
          setData(value);
        })
        .catch((e) => onToast(errorText(e), "error")),
    [onToast],
  );
  useEffect(() => {
    void load();
  }, [load]);
  async function act(id: string, path: string, body: object, message: string) {
    setBusy(id);
    try {
      await post(`/mini/swaps/${id}/${path}`, body);
      onToast(message);
      void load();
    } catch (reason) {
      onToast(errorText(reason), "error");
    } finally {
      setBusy(null);
    }
  }
  const incoming = data?.swaps.filter((s) => s.incoming && s.status === "PENDING_COLLEAGUE") || [];
  const rest = data?.swaps.filter((s) => !(s.incoming && s.status === "PENDING_COLLEAGUE")) || [];
  return (
    <>
      <button className="mini-btn" onClick={() => setOpen(true)} disabled={!data?.colleagues.length}>
        <ArrowLeftRight size={18} /> Smenani almashtirish
      </button>
      {data && !data.colleagues.length && <p className="mp-note">Filialingizda boshqa xodim yo‘q.</p>}
      {incoming.length > 0 && (
        <section className="mini-card sw-incoming">
          <div className="sw-head">Sizga so‘rov keldi</div>
          {incoming.map((s) => (
            <div className="sw-item" key={s.id}>
              <p>
                <b>{s.requesterName}</b> {dateUz(s.giveDate)}
                {s.giveShift ? ` (${s.giveShift})` : ""} kuni o‘rniga ishlashingizni so‘ramoqda
                {s.takeDate ? `, evaziga ${dateUz(s.takeDate)} kuni sizning o‘rningizga chiqadi` : ""}.
              </p>
              {s.reason && <small>«{s.reason}»</small>}
              <div className="sw-actions">
                <button className="mini-btn sm" disabled={busy === s.id} onClick={() => void act(s.id, "respond", { accept: true }, "Rozilik yuborildi — rahbar tasdig‘i kutilmoqda")}>
                  <Check size={16} /> Roziman
                </button>
                <button className="mini-btn sm ghost" disabled={busy === s.id} onClick={() => void act(s.id, "respond", { accept: false }, "Rad etildi")}>
                  <X size={16} /> Yo‘q
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
      <section className="mini-card">
        {data === null ? (
          <SkeletonList rows={3} />
        ) : !rest.length ? (
          <div className="mini-empty">
            <ArrowLeftRight size={28} />
            Almashishlar yo‘q
          </div>
        ) : (
          <div className="mini-rows">
            {rest.map((s) => {
              const [label, tone] = swapChip[s.status];
              return (
                <div className="mini-row" key={s.id}>
                  <span className="mini-ico">
                    <ArrowLeftRight size={18} />
                  </span>
                  <span>
                    <b>{s.incoming ? s.requesterName : s.colleagueName}</b>
                    <small>
                      {dateUz(s.giveDate)} — <span>{s.incoming ? "siz ishlaysiz" : "hamkasb ishlaydi"}</span>
                    </small>
                    {s.takeDate && (
                      <small>
                        {dateUz(s.takeDate)} — <span>{s.incoming ? "hamkasb ishlaydi" : "siz ishlaysiz"}</span>
                      </small>
                    )}
                    {!s.incoming && ["PENDING_COLLEAGUE", "PENDING_MANAGER"].includes(s.status) && (
                      <button className="mini-link-danger" disabled={busy === s.id} onClick={() => void act(s.id, "cancel", {}, "So‘rov bekor qilindi")}>
                        Bekor qilish
                      </button>
                    )}
                  </span>
                  <span className={`mini-chip ${tone}`}>{label}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>
      {open && data && (
        <SwapSheet
          colleagues={data.colleagues}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            onToast("So‘rov hamkasbingizga yuborildi");
            void load();
          }}
        />
      )}
    </>
  );
}

function SwapSheet({ colleagues, onClose, onSaved }: { colleagues: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const today = tashkentIsoDate();
  const [form, setForm] = useState({ colleagueId: "", giveDate: today, takeDate: "", reason: "" });
  const [exchange, setExchange] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post("/mini/swaps", { ...form, takeDate: exchange ? form.takeDate : "" });
      onSaved();
    } catch (reason) {
      setError(errorText(reason, "So‘rov yuborilmadi."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="sheet-layer">
      <button className="sheet-backdrop" onClick={onClose} aria-label="Yopish" />
      <section className="sheet">
        <div className="sheet-head">
          <div>
            <b>Smena almashish</b>
            <small>Hamkasb rozi bo‘lgach, rahbar tasdiqlaydi</small>
          </div>
          <button className="sheet-close" onClick={onClose} aria-label="Yopish">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={save}>
          <label>
            Hamkasb
            <select value={form.colleagueId} onChange={(e) => setForm({ ...form, colleagueId: e.target.value })} required>
              <option value="">Tanlang</option>
              {colleagues.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Men bermoqchi bo‘lgan ish kunim
            <input type="date" min={today} value={form.giveDate} onChange={(e) => setForm({ ...form, giveDate: e.target.value })} required />
          </label>
          <label className="sw-toggle">
            <input type="checkbox" checked={exchange} onChange={(e) => setExchange(e.target.checked)} />
            <span>Evaziga uning bir ish kunini olaman</span>
          </label>
          {exchange && (
            <label>
              Men ishlab beradigan kun
              <input type="date" min={today} value={form.takeDate} onChange={(e) => setForm({ ...form, takeDate: e.target.value })} required />
            </label>
          )}
          <label>
            Sabab (ixtiyoriy)
            <textarea value={form.reason} maxLength={200} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Masalan: shifokor qabuli" />
          </label>
          {error && (
            <div className="mini-alert">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}
          <button className="mini-btn" disabled={busy}>
            {busy ? <LoaderCircle size={17} className="spin" /> : <Send size={17} />}
            {busy ? "Yuborilmoqda…" : "Yuborish"}
          </button>
        </form>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------- hujjatlar --- */
type MiniDoc = { id: string; type: DocumentType; title: string; expiresAt?: string; createdAt: string; status: "OK" | "SOON" | "EXPIRED" };

export function MiniDocuments({ onToast }: { onToast: Toast }) {
  const [docs, setDocs] = useState<MiniDoc[] | null>(() => getCached("docs"));
  const [type, setType] = useState<DocumentType>("PASSPORT");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const load = useCallback(
    () =>
      api<MiniDoc[]>("/mini/documents")
        .then((value) => {
          setCached("docs", value);
          setDocs(value);
        })
        .catch(() => setDocs((current) => current || [])),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  async function upload(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      await post("/mini/documents", { type, expiresAt, dataUrl });
      onToast("Hujjat yuklandi — HR ko‘radi");
      setExpiresAt("");
      void load();
    } catch (reason) {
      onToast(errorText(reason, "Yuklab bo‘lmadi."), "error");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <>
      <div className="mp-group-title">Hujjatlarim</div>
      <section className="mp-group">
        {docs === null ? (
          <SkeletonList rows={3} />
        ) : (
          docs.map((d) => (
            <div className="mp-row" key={d.id}>
              <span className="md-title">
                <FileText size={15} /> {d.title}
              </span>
              <b className={d.status === "EXPIRED" ? "bad" : d.status === "SOON" ? "warn" : ""}>
                {d.expiresAt ? (d.status === "EXPIRED" ? "Muddati o‘tgan" : `${dateUz(d.expiresAt)} gacha`) : "✓"}
              </b>
            </div>
          ))
        )}
        <div className="md-upload">
          <select value={type} onChange={(e) => setType(e.target.value as DocumentType)} aria-label="Hujjat turi">
            {Object.entries(DOCUMENT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} aria-label="Amal qilish muddati" title="Amal qilish muddati (ixtiyoriy)" />
          <button className="mini-btn sm" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? <LoaderCircle size={16} className="spin" /> : <Upload size={16} />} Yuklash
          </button>
          <input ref={input} type="file" accept="image/*,application/pdf" hidden onChange={(e) => void upload(e.target.files?.[0])} />
        </div>
      </section>
    </>
  );
}

/* --------------------------------------------------- hisob varaqalari --- */
type Payslip = { month: string; label: string; closedAt: string; line: PayslipLine };

export function MiniPayslips() {
  const [rows, setRows] = useState<Payslip[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    void api<Payslip[]>("/mini/payslips").then(setRows).catch(() => setRows([]));
  }, []);
  if (!rows?.length) return null;
  return (
    <>
      <div className="mp-group-title">Hisob varaqalari</div>
      <section className="mp-group">
        {rows.map(({ month, label, line }) => (
          <div key={month} className={`ps-item ${open === month ? "open" : ""}`}>
            <button className="mp-row ps-toggle" onClick={() => setOpen(open === month ? null : month)}>
              <span className="md-title">
                <Wallet size={15} /> {label}
              </span>
              <b>
                {som(line.net)} <ChevronDown size={14} />
              </b>
            </button>
            {open === month && (
              <div className="ps-body">
                <Line label="Oylik" value={som(line.base)} />
                {line.overtimeAmount > 0 && <Line label="Qo‘shimcha ish" value={`+${som(line.overtimeAmount)}`} tone="ok" />}
                {line.bonus > 0 && <Line label="Bonus" value={`+${som(line.bonus)}`} tone="ok" />}
                {line.lateDeduction > 0 && <Line label={`Kechikish (${line.lateMinutes} daq)`} value={`−${som(line.lateDeduction)}`} tone="bad" />}
                {line.absenceDeduction > 0 && <Line label={`Kelmagan ${line.absentDays} kun`} value={`−${som(line.absenceDeduction)}`} tone="bad" />}
                {line.fine > 0 && <Line label="Jarima" value={`−${som(line.fine)}`} tone="bad" />}
                {line.advance > 0 && <Line label="Avans" value={`−${som(line.advance)}`} />}
                <Line label="Ish kunlari" value={`${line.days} / ${line.expectedDays}`} />
                <Line label="Qo‘lga" value={som(line.net)} strong />
              </div>
            )}
          </div>
        ))}
      </section>
    </>
  );
}

function Line({ label, value, tone, strong }: { label: string; value: string; tone?: string; strong?: boolean }) {
  return (
    <div className={`ps-line ${strong ? "strong" : ""}`}>
      <span>{label}</span>
      <b className={tone}>{value}</b>
    </div>
  );
}
