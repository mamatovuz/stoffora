import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowLeftRight, Check, ChevronDown, Download, FileText, LoaderCircle, Share2, Upload, Wallet, X } from "lucide-react";
import { confirmNative, downloadMiniFile, haptic, shareText } from "./mini/tg";
import { Sheet } from "./mini/shared";
import { api, errorText, post } from "../api";
import { SkeletonList } from "./mini/shared";
import { getCached, setCached } from "./miniCache";
import { fileToDataUrl, DOCUMENT_LABELS } from "../components/Documents";
import { dateUz, duration, tashkentIsoDate } from "@/lib/format";
import type { DocumentType, PayslipLine, ShiftSwapRequest } from "@/lib/types";

/* Mini App qo‘shimcha bo‘limlari: smena almashish, hujjatlar, hisob varaqalari. */

type Toast = (text: string, tone?: "ok" | "error") => void;
const som = (value: number) => `${Math.round(value).toLocaleString("ru-RU").replace(/\s/g, " ")} so‘m`;

/* ---------------------------------------------------- smena almashish --- */
type Swap = ShiftSwapRequest & { requesterName: string; colleagueName: string; giveShift?: string; takeShift?: string; incoming: boolean };

const swapChip: Record<ShiftSwapRequest["status"], [string, string]> = {
  OPEN: ["Ochiq taklif", "warn"],
  PENDING_COLLEAGUE: ["Hamkasb javobi", "warn"],
  PENDING_MANAGER: ["Rahbar tasdig‘i", "warn"],
  APPROVED: ["Tasdiqlandi", "ok"],
  REJECTED: ["Rad etildi", "bad"],
  CANCELLED: ["Bekor qilindi", ""],
};

export function MiniSwaps({ onToast }: { onToast: Toast }) {
  const [data, setData] = useState<{ swaps: Swap[]; colleagues: { id: string; name: string }[]; offers?: Swap[] } | null>(() => getCached("swaps"));
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(
    () =>
      api<{ swaps: Swap[]; colleagues: { id: string; name: string }[]; offers?: Swap[] }>("/mini/swaps")
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
  async function act(id: string, path: string, body: object, message: string, confirm?: string) {
    if (confirm && !(await confirmNative(confirm, { ok: "Ha", destructive: true }))) return;
    setBusy(id);
    try {
      await post(`/mini/swaps/${id}/${path}`, body);
      onToast(message);
      haptic.success();
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
      {!!data?.offers?.length && (
        <section className="mini-card sw-incoming">
          <div className="sw-head">Ochiq takliflar — siz shu kuni bo‘shsiz</div>
          {data.offers.map((s) => (
            <div className="sw-item" key={s.id}>
              <p>
                <b>{s.requesterName}</b> {dateUz(s.giveDate)}
                {s.giveShift ? ` (${s.giveShift})` : ""} kungi smenasini bermoqchi.
              </p>
              {s.reason && <small>«{s.reason}»</small>}
              <div className="sw-actions">
                <button className="mini-btn sm" disabled={busy === s.id} onClick={() => void act(s.id, "claim", {}, "Smena olindi — rahbar tasdig‘i kutilmoqda", `${dateUz(s.giveDate)} kungi smenani olasizmi?`)}>
                  <Check size={16} /> Olaman
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
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
                <button className="mini-btn sm ghost" disabled={busy === s.id} onClick={() => void act(s.id, "respond", { accept: false }, "Rad etildi", `${s.requesterName} so‘rovini rad etasizmi?`)}>
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
                    <b>{s.status === "OPEN" ? "Ochiq taklif" : s.incoming ? s.requesterName : s.colleagueName}</b>
                    <small>
                      {dateUz(s.giveDate)} — <span>{s.incoming ? "siz ishlaysiz" : "hamkasb ishlaydi"}</span>
                    </small>
                    {s.takeDate && (
                      <small>
                        {dateUz(s.takeDate)} — <span>{s.incoming ? "hamkasb ishlaydi" : "siz ishlaysiz"}</span>
                      </small>
                    )}
                    {!s.incoming && ["OPEN", "PENDING_COLLEAGUE", "PENDING_MANAGER"].includes(s.status) && (
                      <button className="mini-link-danger" disabled={busy === s.id} onClick={() => void act(s.id, "cancel", {}, "So‘rov bekor qilindi", "Smena almashish so‘rovini bekor qilasizmi?")}>
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
          onSaved={(market) => {
            setOpen(false);
            onToast(market ? "Taklif bo‘sh hamkasblarga yuborildi" : "So‘rov hamkasbingizga yuborildi");
            void load();
          }}
        />
      )}
    </>
  );
}

function SwapSheet({ colleagues, onClose, onSaved }: { colleagues: { id: string; name: string }[]; onClose: () => void; onSaved: (market: boolean) => void }) {
  const today = tashkentIsoDate();
  const [form, setForm] = useState({ colleagueId: "", giveDate: today, takeDate: "", reason: "" });
  const [exchange, setExchange] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Hamkasb tanlanmasa — ochiq taklif (marketplace): shu kuni bo‘sh hamkasblarga yuboriladi.
  const swapBack = exchange && Boolean(form.colleagueId);
  const valid = Boolean(form.giveDate && (!swapBack || form.takeDate));
  async function save(event?: React.FormEvent) {
    event?.preventDefault();
    if (!valid) return setError("Sanani tanlang (evaz kuni faqat aniq hamkasb bilan).");
    setBusy(true);
    setError("");
    try {
      await post("/mini/swaps", { ...form, colleagueId: form.colleagueId || undefined, takeDate: swapBack ? form.takeDate : "" });
      onSaved(!form.colleagueId);
    } catch (reason) {
      setError(errorText(reason, "So‘rov yuborilmadi."));
    } finally {
      setBusy(false);
    }
  }
  const colleague = colleagues.find((c) => c.id === form.colleagueId);
  return (
    <Sheet
      title="Smena almashish"
      subtitle="Hamkasb rozi bo‘lgach, rahbar tasdiqlaydi"
      onClose={onClose}
      primary={{ text: form.colleagueId ? "So‘rov yuborish" : "Ochiq taklif qilish", onClick: () => void save(), busy, disabled: !valid }}
      secondary={
        colleague
          ? {
              text: "Chatda so‘rash",
              onClick: () =>
                void shareText(
                  "Smena almashish",
                  `🔄 ${colleague.name.split(" ")[0]}, ${form.giveDate.split("-").reverse().join(".")} kungi smenamni olib bera olasizmi?${exchange && form.takeDate ? ` Evaziga ${form.takeDate.split("-").reverse().join(".")} kuni sizning o‘rningizga chiqaman.` : ""} Rozi bo‘lsangiz, Staffora’da tasdiqlang.`,
                ),
            }
          : null
      }
    >
        <form onSubmit={save}>
          <label>
            Hamkasb
            <select value={form.colleagueId} onChange={(e) => setForm({ ...form, colleagueId: e.target.value })} required>
              <option value="">Hammaga (shu kuni bo‘sh hamkasblar)</option>
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
          {form.colleagueId && <label className="sw-toggle">
            <input type="checkbox" checked={exchange} onChange={(e) => setExchange(e.target.checked)} />
            <span>Evaziga uning bir ish kunini olaman</span>
          </label>}
          {swapBack && (
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
        </form>
    </Sheet>
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
  const [downloading, setDownloading] = useState<string | null>(null);
  async function download(id: string) {
    setDownloading(id);
    try {
      await downloadMiniFile({ kind: "document", id });
    } catch (reason) {
      onToast(errorText(reason, "Yuklab bo‘lmadi."), "error");
    } finally {
      setDownloading(null);
    }
  }
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
  const list = docs || [];
  const expired = list.filter((d) => d.status === "EXPIRED").length;
  const soon = list.filter((d) => d.status === "SOON").length;
  const missing = (["PASSPORT", "MEDICAL", "SANITARY"] as DocumentType[]).filter((t) => docs && !list.some((d) => d.type === t));
  const left = (iso: string) => Math.round((Date.parse(iso) - Date.parse(new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10))) / 86_400_000);
  const uploadAs = (t: DocumentType) => {
    setType(t);
    window.setTimeout(() => input.current?.click(), 30);
  };
  return (
    <>
      <div className="mp-group-title">Hujjatlarim</div>
      {docs !== null && (
        <div className="md-summary">
          <span>
            <b>{list.length}</b> hujjat
          </span>
          <span className={soon ? "warn" : ""}>
            <b>{soon}</b> tugayapti
          </span>
          <span className={expired ? "bad" : ""}>
            <b>{expired}</b> muddati o‘tgan
          </span>
        </div>
      )}
      {missing.length > 0 && (
        <section className="mp-group">
          {missing.map((t) => (
            <button className="mp-row link" key={t} onClick={() => uploadAs(t)} disabled={busy}>
              <span className="md-title">
                <FileText size={15} /> {DOCUMENT_LABELS[t]}
              </span>
              <b className="warn">
                Yuklanmagan · <Upload size={14} />
              </b>
            </button>
          ))}
        </section>
      )}
      <section className="mp-group">
        {docs === null ? (
          <SkeletonList rows={3} />
        ) : !list.length ? (
          <div className="mini-empty">Hali hujjat yo‘q — pasport, tibbiy ma’lumotnoma va boshqalarni yuklang. HR ham ko‘radi.</div>
        ) : (
          list.map((d) => (
            <button className="mp-row link" key={d.id} onClick={() => void download(d.id)} disabled={downloading === d.id}>
              <span className="md-title">
                <FileText size={15} /> {d.title}
              </span>
              <b className={d.status === "EXPIRED" ? "bad" : d.status === "SOON" ? "warn" : ""}>
                {d.expiresAt ? (d.status === "EXPIRED" ? "Muddati o‘tgan" : d.status === "SOON" ? `${left(d.expiresAt)} kun qoldi` : `${dateUz(d.expiresAt)} gacha`) : "✓"}
                {downloading === d.id ? <LoaderCircle size={14} className="spin" /> : <Download size={14} />}
              </b>
            </button>
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
          <label className="md-expiry">
            <span>Amal qilish muddati (ixtiyoriy)</span>
            <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} aria-label="Amal qilish muddati (ixtiyoriy)" />
          </label>
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

export function MiniPayslips({ onToast, focusMonth }: { onToast?: Toast; focusMonth?: string }) {
  const [rows, setRows] = useState<Payslip[] | null>(null);
  const [open, setOpen] = useState<string | null>(focusMonth || null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    void api<Payslip[]>("/mini/payslips")
      .then(setRows)
      .catch(() => setRows([]));
  }, [focusMonth]);
  async function download(month: string) {
    setBusy(month);
    try {
      await downloadMiniFile({ kind: "payslip", month });
      haptic.success();
    } catch (reason) {
      onToast?.(errorText(reason, "Yuklab bo‘lmadi."), "error");
    } finally {
      setBusy(null);
    }
  }
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
                {line.lateDeduction > 0 && <Line label={`Kechikish (${duration(line.lateMinutes)})`} value={`−${som(line.lateDeduction)}`} tone="bad" />}
                {line.absenceDeduction > 0 && <Line label={`Kelmagan ${line.absentDays} kun`} value={`−${som(line.absenceDeduction)}`} tone="bad" />}
                {line.fine > 0 && <Line label="Jarima" value={`−${som(line.fine)}`} tone="bad" />}
                {line.advance > 0 && <Line label="Avans" value={`−${som(line.advance)}`} />}
                <Line label="Ish kunlari" value={`${line.days} / ${line.expectedDays}`} />
                <Line label="Qo‘lga" value={som(line.net)} strong />
                <div className="ps-actions">
                  <button className="mini-btn sm soft" disabled={busy === month} onClick={() => void download(month)}>
                    {busy === month ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />} Excel’da yuklab olish
                  </button>
                  <button
                    className="mini-btn sm ghost-neutral"
                    aria-label="Ulashish"
                    onClick={() => void shareText("Hisob varaqasi", `🧾 ${label}: qo‘lga ${som(line.net)} (${line.days}/${line.expectedDays} kun)`)}
                  >
                    <Share2 size={15} />
                  </button>
                </div>
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
