import { useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, Banknote, CalendarClock, Check, CircleDollarSign, Clock3, HandCoins, History, Package, Plus, Search, Wallet, X } from "lucide-react";
import { errorText, post } from "../api";
import { useApi } from "../hooks";
import { Avatar, Empty, Field, Modal, useToast } from "./ui";
import { money, tashkentIsoDate } from "@/lib/format";

/*
 * Ish haqi moduli bo‘limlari (PayrollPage tablarida): umumiy ko‘rinish, xodim stavkalari (tur + tarix),
 * ishbay natijalar (tasdiqlash bilan) va to‘lovlar (qisman/to‘liq). Hamma raqam — serverdan.
 */
export type PayType = "MONTHLY" | "DAILY" | "HOURLY" | "PIECE";
export const PAY_TYPE: Record<PayType, { label: string; unit: string; tone: string }> = {
  MONTHLY: { label: "Oylik", unit: "oyiga", tone: "blue" },
  DAILY: { label: "Kunlik", unit: "kuniga", tone: "teal" },
  HOURLY: { label: "Soatbay", unit: "soatiga", tone: "violet" },
  PIECE: { label: "Ishbay", unit: "birlik narxi yozuvda", tone: "amber" },
};
const METHOD: Record<string, string> = { CASH: "Naqd", CARD: "Karta", BANK: "Bank o‘tkazmasi" };
const dmy = (iso: string) => iso.slice(0, 10).split("-").reverse().join(".");

type Overview = {
  month: string;
  label: string;
  closed: boolean;
  stageLabel: string;
  totals: {
    employees: number;
    gross: number;
    net: number;
    paid: number;
    partial: number;
    remaining: number;
    advances: number;
    bonuses: number;
    deductions: number;
    paidPeople: number;
    partialPeople: number;
    unpaidPeople: number;
    openDays: number;
    pendingPiece: number;
  };
  byPayType: { payType: PayType; label: string; employees: number; net: number }[];
  byBranch: { branch: string; employees: number; net: number }[];
  recentPayments: { id: string; name: string; month: string; amount: number; method: string; paidAt: string }[];
};

export function PayTypeBadge({ type }: { type?: PayType }) {
  const info = PAY_TYPE[type || "MONTHLY"];
  return <span className={`tp-badge ${info.tone}`}>{info.label}</span>;
}

/* ------------------------------------------------------ umumiy ko‘rinish --- */
export function PayrollOverview({ month, onOpen }: { month: string; onOpen: (tab: "calc" | "piece" | "payments") => void }) {
  const { data, error } = useApi<Overview>(`/payroll/overview?month=${month}`);
  if (error) return <div className="notice error">{error}</div>;
  if (!data)
    return (
      <div className="tp-stats">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="tp-card db-sk-card" style={{ height: 96 }} />
        ))}
      </div>
    );
  const t = data.totals;
  const maxType = Math.max(1, ...data.byPayType.map((x) => x.net));
  const maxBranch = Math.max(1, ...data.byBranch.map((x) => x.net));
  const paidPct = t.net ? Math.round((t.paid / t.net) * 100) : 0;
  return (
    <div className="pm-stack">
      <section className="tp-stats" aria-label="Ish haqi ko‘rsatkichlari">
        <Tile tone="blue" icon={CircleDollarSign} label="Hisoblangan ish haqi" value={money(t.gross)} note={`${t.employees} xodim · bonus ${money(t.bonuses)}`} />
        <Tile tone="amber" icon={Wallet} label="To‘lanishi kerak" value={money(t.remaining)} note={`Qo‘lga jami ${money(t.net)} · ${t.unpaidPeople} xodim kutmoqda`} />
        <Tile tone="green" icon={Banknote} label="To‘langan" value={money(t.paid)} note={`${t.paidPeople} xodim to‘liq · ${t.partialPeople} qisman (${money(t.partial)})`} />
        <Tile tone="red" icon={HandCoins} label="Avans va ushlanmalar" value={money(t.advances + t.deductions)} note={`Avans ${money(t.advances)} · ushlanma ${money(t.deductions)}`} />
      </section>

      {(t.openDays > 0 || t.pendingPiece > 0 || !data.closed) && (
        <div className="pm-alerts">
          {!data.closed && (
            <button type="button" className="pm-alert info" onClick={() => onOpen("calc")}>
              <CalendarClock size={16} />
              <span>
                <b>{data.label}: {data.stageLabel}</b>
                <small>Raqamlar jonli davomatdan hisoblanmoqda. To‘lov qayd etish uchun oy tasdiqlanib yopilishi kerak.</small>
              </span>
            </button>
          )}
          {t.openDays > 0 && (
            <button type="button" className="pm-alert warn" onClick={() => onOpen("calc")}>
              <AlertTriangle size={16} />
              <span>
                <b>{t.openDays} kun chiqish belgilanmagan</b>
                <small>Kunlik va soatbay xodimlarda bu kunlar to‘lanmaydi — davomatni tekshiring.</small>
              </span>
            </button>
          )}
          {t.pendingPiece > 0 && (
            <button type="button" className="pm-alert warn" onClick={() => onOpen("piece")}>
              <Package size={16} />
              <span>
                <b>{t.pendingPiece} ta ishbay natija tasdiq kutmoqda</b>
                <small>Tasdiqlanmaguncha ish haqiga qo‘shilmaydi.</small>
              </span>
            </button>
          )}
        </div>
      )}

      <div className="pm-grid">
        <section className="tp-card">
          <div className="tp-card-head">
            <div className="tp-title">
              <h2>To‘lov holati</h2>
              <span className="tp-muted">{data.label}</span>
            </div>
            <button type="button" className="tp-link" onClick={() => onOpen("payments")}>
              To‘lovlar →
            </button>
          </div>
          <div className="pm-progress">
            <div className="pm-progress-bar" role="img" aria-label={`${paidPct}% to‘langan`}>
              <i style={{ width: `${paidPct}%` }} />
            </div>
            <div className="pm-progress-legend">
              <span>
                <b>{paidPct}%</b> to‘langan
              </span>
              <span>
                {money(t.paid)} / {money(t.net)}
              </span>
            </div>
          </div>
          <ul className="pm-bars">
            {data.byPayType.map((x) => (
              <li key={x.payType}>
                <span>
                  <PayTypeBadge type={x.payType} />
                  <small>{x.employees} xodim</small>
                </span>
                <span className="tp-meter">
                  <i className="blue" style={{ width: `${(x.net / maxType) * 100}%` }} />
                </span>
                <b>{money(x.net)}</b>
              </li>
            ))}
          </ul>
        </section>
        <section className="tp-card">
          <div className="tp-card-head">
            <div className="tp-title">
              <h2>Filiallar bo‘yicha xarajat</h2>
            </div>
          </div>
          {data.byBranch.length ? (
            <ul className="pm-bars">
              {data.byBranch.map((x) => (
                <li key={x.branch}>
                  <span>
                    <b>{x.branch}</b>
                    <small>{x.employees} xodim</small>
                  </span>
                  <span className="tp-meter">
                    <i className="green" style={{ width: `${(x.net / maxBranch) * 100}%` }} />
                  </span>
                  <b>{money(x.net)}</b>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={Wallet} title="Ma’lumot yo‘q" text="Xodimlar qo‘shilgach, filiallar kesimida xarajat shu yerda ko‘rinadi." />
          )}
        </section>
        <section className="tp-card">
          <div className="tp-card-head">
            <div className="tp-title">
              <h2>Oxirgi to‘lovlar</h2>
            </div>
          </div>
          {data.recentPayments.length ? (
            <ol className="tp-feed">
              {data.recentPayments.map((p) => (
                <li key={p.id}>
                  <span className="tp-feed-icon green">
                    <Banknote size={13} />
                  </span>
                  <span className="tp-feed-text">
                    <b>{p.name}</b>
                    <small>
                      {p.month} · {METHOD[p.method] || p.method} · {dmy(p.paidAt)}
                    </small>
                  </span>
                  <b className="t-green">{money(p.amount)}</b>
                </li>
              ))}
            </ol>
          ) : (
            <Empty icon={History} title="To‘lovlar hali yo‘q" text="Oy yopilgach, «To‘lovlar» bo‘limida qayd eting." />
          )}
        </section>
      </div>
    </div>
  );
}

function Tile({ tone, icon: Icon, label, value, note }: { tone: string; icon: typeof Wallet; label: string; value: string; note: string }) {
  return (
    <div className={`tp-stat ${tone}`}>
      <span className="tp-stat-icon" aria-hidden>
        <Icon size={18} strokeWidth={1.9} />
      </span>
      <span className="tp-stat-text">
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{note}</em>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------- stavkalar --- */
type RateRow = {
  employeeId: string;
  name: string;
  employeeNo: string;
  photoDataUrl?: string;
  branch?: string;
  position?: string;
  current: { payType: PayType; rate: number; effectiveFrom?: string };
  upcoming: { payType: PayType; rate: number; effectiveFrom: string } | null;
  history: { id: string; payType: PayType; rate: number; effectiveFrom: string; note?: string; createdAt: string; createdBy: string }[];
};

export function PayRatesPanel({ canEdit }: { canEdit: boolean }) {
  const { data, error, loading, reload } = useApi<RateRow[]>("/payroll/rates");
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"ALL" | PayType>("ALL");
  const [edit, setEdit] = useState<RateRow | null>(null);
  const [history, setHistory] = useState<RateRow | null>(null);
  const rows = useMemo(
    () => (data || []).filter((r) => (type === "ALL" || r.current.payType === type) && `${r.name} ${r.employeeNo} ${r.position || ""}`.toLowerCase().includes(query.trim().toLowerCase())),
    [data, query, type],
  );
  return (
    <section className="tp-card">
      <div className="tp-card-head">
        <div className="tp-title">
          <h2>Xodimlar stavkalari</h2>
          <span className="tp-muted">ish haqi turi va kuchga kirish sanasi bilan; eski oylar o‘z stavkasida qoladi</span>
        </div>
      </div>
      <div className="tp-filters">
        <label className="tp-search">
          <Search size={14} aria-hidden />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Xodim qidirish" aria-label="Xodim qidirish" />
        </label>
        <label className={`tp-select ${type !== "ALL" ? "on" : ""}`}>
          <select value={type} onChange={(e) => setType(e.target.value as typeof type)} aria-label="Ish haqi turi">
            <option value="ALL">Barcha turlar</option>
            {(Object.keys(PAY_TYPE) as PayType[]).map((k) => (
              <option key={k} value={k}>
                {PAY_TYPE[k].label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? (
        <div className="notice error pm-pad">{error}</div>
      ) : loading && !data ? (
        <div className="tp-sk-rows">
          <span className="db-sk db-sk-row" />
        </div>
      ) : !rows.length ? (
        <Empty icon={Wallet} title="Xodim topilmadi" text="Qidiruv yoki turni o‘zgartiring." />
      ) : (
        <div className="table-wrap tp-table-wrap">
          <table className="tp-table">
            <thead>
              <tr>
                <th>Xodim</th>
                <th>Filial</th>
                <th>Turi</th>
                <th className="num">Stavka</th>
                <th>Kuchga kirgan</th>
                <th>Rejada</th>
                <th className="right">Amallar</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const [first, ...rest] = r.name.split(" ");
                return (
                  <tr key={r.employeeId}>
                    <td>
                      <span className="tp-person">
                        <Avatar first={first} last={rest.join(" ")} photo={r.photoDataUrl} size="sm" />
                        <span>
                          <b>{r.name}</b>
                          <small>{r.position || r.employeeNo}</small>
                        </span>
                      </span>
                    </td>
                    <td className="tp-muted">{r.branch || "—"}</td>
                    <td>
                      <PayTypeBadge type={r.current.payType} />
                    </td>
                    <td className="num">
                      {r.current.payType === "PIECE" ? <span className="tp-muted">yozuvlarda</span> : r.current.rate ? <b>{money(r.current.rate)}</b> : <span className="t-red">Kiritilmagan</span>}
                      {r.current.payType !== "PIECE" && r.current.rate > 0 && <small className="pm-unit"> {PAY_TYPE[r.current.payType].unit}</small>}
                    </td>
                    <td className="tp-muted nowrap">{r.current.effectiveFrom ? dmy(r.current.effectiveFrom) : "xodim kartasi"}</td>
                    <td className="nowrap">{r.upcoming ? <span className="tp-tag blue">{`${PAY_TYPE[r.upcoming.payType].label} ${money(r.upcoming.rate)} · ${dmy(r.upcoming.effectiveFrom)}`}</span> : <span className="tp-muted">—</span>}</td>
                    <td className="right">
                      <span className="tp-row-actions">
                        <button type="button" className="btn btn-sm" onClick={() => setHistory(r)} disabled={!r.history.length} title="Stavka tarixi">
                          <History size={14} /> {r.history.length}
                        </button>
                        {canEdit && (
                          <button type="button" className="btn btn-sm btn-primary" onClick={() => setEdit(r)}>
                            Stavka
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {edit && (
        <RateModal
          row={edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            void reload(true);
          }}
        />
      )}
      {history && (
        <Modal title="Stavka tarixi" subtitle={history.name} onClose={() => setHistory(null)}>
          <ul className="pm-history">
            {history.history.map((h) => (
              <li key={h.id}>
                <PayTypeBadge type={h.payType} />
                <span>
                  <b>{h.payType === "PIECE" ? "Ishbay" : money(h.rate)}</b>
                  <small>
                    {dmy(h.effectiveFrom)} dan · {h.createdBy}
                    {h.note ? ` · ${h.note}` : ""}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </section>
  );
}

function RateModal({ row, onClose, onSaved }: { row: RateRow; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ payType: row.current.payType, rate: String(row.current.rate || ""), effectiveFrom: tashkentIsoDate(), note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post("/payroll/rates", { ...form, rate: form.payType === "PIECE" ? 0 : Math.round(Number(form.rate)), note: form.note || undefined });
      toast("Stavka saqlandi");
      onSaved();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }
  const example =
    form.payType === "DAILY"
      ? "Tasdiqlangan (kirish va chiqish bor) ish kunlari × kunlik stavka"
      : form.payType === "HOURLY"
        ? "Haqiqiy ish soatlari × soatlik stavka; chiqish belgilanmagan kun hisoblanmaydi"
        : form.payType === "PIECE"
          ? "Tasdiqlangan miqdor × birlik narxi — «Ishbay ishlar» bo‘limida kiritiladi"
          : "Oylik maosh; oy o‘rtasida kirgan yoki ketgan xodimga ish kunlariga proporsional";
  return (
    <Modal title="Stavka belgilash" subtitle={row.name} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)}>
        <div className="pm-types" role="radiogroup" aria-label="Ish haqi turi">
          {(Object.keys(PAY_TYPE) as PayType[]).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={form.payType === k} className={form.payType === k ? "on" : ""} onClick={() => setForm({ ...form, payType: k })}>
              {PAY_TYPE[k].label}
            </button>
          ))}
        </div>
        <p className="pm-hint">{example}</p>
        <div className="form-grid">
          {form.payType !== "PIECE" && (
            <Field label={`Stavka (so‘m, ${PAY_TYPE[form.payType].unit})`}>
              <input className="input" required type="number" min="1" step="1" inputMode="numeric" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />
            </Field>
          )}
          <Field label="Kuchga kirish sanasi" hint="Yopilgan oyga orqaga qarab kiritilmaydi">
            <input className="input" required type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} />
          </Field>
          <Field label="Izoh (ixtiyoriy)" className="span-2">
            <input className="input" value={form.note} maxLength={300} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Masalan: lavozim o‘zgardi" />
          </Field>
        </div>
        {error && <div className="notice error">{error}</div>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Bekor qilish
          </button>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "Saqlanmoqda…" : "Saqlash"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------- ishbay --- */
type PieceRow = { id: string; employeeId: string; name: string; employeeNo?: string; date: string; workType: string; unit: string; quantity: number; unitPrice: number; amount: number; status: "PENDING" | "APPROVED" | "REJECTED"; createdBy: string; decidedBy?: string; note?: string };
const PIECE_STATUS: Record<PieceRow["status"], [string, string]> = { PENDING: ["Tasdiq kutmoqda", "amber"], APPROVED: ["Tasdiqlangan", "green"], REJECTED: ["Rad etilgan", "red"] };

export function PieceWorkPanel({ month, canEdit, canAdd, employees }: { month: string; canEdit: boolean; canAdd: boolean; employees: { id: string; name: string }[] }) {
  const toast = useToast();
  const { data, error, reload } = useApi<PieceRow[]>(`/payroll/piece?month=${month}`);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const rows = data || [];
  async function decide(row: PieceRow, approve: boolean) {
    setBusy(row.id);
    try {
      await post(`/payroll/piece/${row.id}/decide`, { approve });
      toast(approve ? "Tasdiqlandi — ish haqiga qo‘shildi" : "Rad etildi");
      await reload(true);
    } catch (reason) {
      toast(errorText(reason), "error");
    } finally {
      setBusy("");
    }
  }
  const approved = rows.filter((r) => r.status === "APPROVED").reduce((s, r) => s + r.amount, 0);
  return (
    <section className="tp-card">
      <div className="tp-card-head">
        <div className="tp-title">
          <h2>Ishbay ishlar</h2>
          <span className="tp-muted">tasdiqlangan: {money(approved)}</span>
        </div>
        {canAdd && (
          <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
            <Plus size={15} /> Natija kiritish
          </button>
        )}
      </div>
      {error ? (
        <div className="notice error pm-pad">{error}</div>
      ) : !rows.length ? (
        <Empty icon={Package} title="Bu oyda ishbay natija yo‘q" text="Bajarilgan ish, mahsulot yoki xizmat miqdorini kiriting — rahbar tasdiqlagach ish haqiga qo‘shiladi." />
      ) : (
        <div className="table-wrap tp-table-wrap">
          <table className="tp-table">
            <thead>
              <tr>
                <th>Sana</th>
                <th>Xodim</th>
                <th>Ish turi</th>
                <th className="num">Miqdor</th>
                <th className="num">Narx</th>
                <th className="num">Summa</th>
                <th>Holat</th>
                <th className="right">Amallar</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const [label, tone] = PIECE_STATUS[r.status];
                return (
                  <tr key={r.id}>
                    <td className="tp-muted nowrap">{dmy(r.date)}</td>
                    <td>
                      <b>{r.name}</b>
                    </td>
                    <td className="tp-reason" title={r.note}>
                      {r.workType}
                    </td>
                    <td className="num">
                      {String(r.quantity).replace(".", ",")} {r.unit}
                    </td>
                    <td className="num">{money(r.unitPrice)}</td>
                    <td className="num">
                      <b>{money(r.amount)}</b>
                    </td>
                    <td>
                      <span className={`tp-badge ${tone}`}>{label}</span>
                    </td>
                    <td className="right">
                      {canEdit && r.status === "PENDING" ? (
                        <span className="tp-row-actions">
                          <button type="button" className="tp-act ok" disabled={busy === r.id} title="Tasdiqlash" aria-label="Tasdiqlash" onClick={() => void decide(r, true)}>
                            <Check size={15} />
                          </button>
                          <button type="button" className="tp-act no" disabled={busy === r.id} title="Rad etish" aria-label="Rad etish" onClick={() => void decide(r, false)}>
                            <X size={15} />
                          </button>
                        </span>
                      ) : (
                        <span className="tp-muted">{r.decidedBy || "—"}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <PieceModal
          employees={employees}
          month={month}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            void reload(true);
          }}
        />
      )}
    </section>
  );
}

function PieceModal({ employees, month, onClose, onSaved }: { employees: { id: string; name: string }[]; month: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const today = tashkentIsoDate();
  const [form, setForm] = useState({ employeeId: employees[0]?.id || "", date: today.startsWith(month) ? today : `${month}-01`, workType: "", unit: "dona", quantity: "", unitPrice: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const total = Math.round((Number(form.quantity) || 0) * (Number(form.unitPrice) || 0));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post("/payroll/piece", { ...form, quantity: Number(form.quantity), unitPrice: Math.round(Number(form.unitPrice)), note: form.note || undefined });
      toast("Natija kiritildi — tasdiq kutmoqda");
      onSaved();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [key]: e.target.value });
  return (
    <Modal title="Ishbay natija kiritish" subtitle="Tasdiqlangandan keyin ish haqiga qo‘shiladi" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)}>
        <div className="form-grid">
          <Field label="Xodim" className="span-2">
            <select className="input" required value={form.employeeId} onChange={set("employeeId")}>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Sana">
            <input className="input" required type="date" max={today} value={form.date} onChange={set("date")} />
          </Field>
          <Field label="Ish turi">
            <input className="input" required minLength={2} value={form.workType} onChange={set("workType")} placeholder="Masalan: qadoqlash" />
          </Field>
          <Field label="Miqdor">
            <input className="input" required type="number" min="0.01" step="0.01" value={form.quantity} onChange={set("quantity")} />
          </Field>
          <Field label="O‘lchov birligi">
            <input className="input" required value={form.unit} onChange={set("unit")} />
          </Field>
          <Field label="Birlik narxi (so‘m)">
            <input className="input" required type="number" min="0" step="1" value={form.unitPrice} onChange={set("unitPrice")} />
          </Field>
          <Field label="Jami">
            <input className="input" readOnly value={money(total)} />
          </Field>
          <Field label="Izoh (ixtiyoriy)" className="span-2">
            <input className="input" maxLength={300} value={form.note} onChange={set("note")} />
          </Field>
        </div>
        {error && <div className="notice error">{error}</div>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Bekor qilish
          </button>
          <button className="btn btn-primary" disabled={busy || !form.employeeId}>
            {busy ? "Saqlanmoqda…" : "Kiritish"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------------------------------------------------- to‘lovlar --- */
type PaymentRow = { id: string; employeeId: string; name: string; month: string; amount: number; method: string; paidAt: string; note?: string; createdBy: string };
type Line = { employeeId: string; name: string; net: number; payType?: PayType };

export function PaymentsPanel({ month, lines, closed, canEdit }: { month: string; lines: Line[]; closed: boolean; canEdit: boolean }) {
  const { data, error, reload } = useApi<PaymentRow[]>(`/payroll/payments?month=${month}`);
  const [payFor, setPayFor] = useState<Line | null>(null);
  const [query, setQuery] = useState("");
  const paid = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of data || []) map.set(p.employeeId, (map.get(p.employeeId) || 0) + p.amount);
    return map;
  }, [data]);
  const shown = lines.filter((l) => l.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="pm-stack">
      <section className="tp-card">
        <div className="tp-card-head">
          <div className="tp-title">
            <h2>To‘lov qaydnomasi</h2>
            <span className="tp-muted">{closed ? "tasdiqlangan summalar bo‘yicha" : "oy hali yopilmagan — to‘lov qayd etib bo‘lmaydi"}</span>
          </div>
          <label className="tp-search pm-search">
            <Search size={14} aria-hidden />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Xodim qidirish" aria-label="Xodim qidirish" />
          </label>
        </div>
        {!lines.length ? (
          <Empty icon={Wallet} title="Qaydnoma bo‘sh" text="Bu oy uchun hisob-kitob qatorlari yo‘q." />
        ) : (
          <div className="table-wrap tp-table-wrap">
            <table className="tp-table">
              <thead>
                <tr>
                  <th>Xodim</th>
                  <th>Turi</th>
                  <th className="num">Qo‘lga</th>
                  <th className="num">To‘langan</th>
                  <th className="num">Qoldiq</th>
                  <th>Holat</th>
                  <th className="right">Amal</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => {
                  const got = paid.get(l.employeeId) || 0;
                  const left = Math.max(0, l.net - got);
                  const [label, tone] = l.net <= 0 ? ["To‘lov yo‘q", "gray"] : got >= l.net ? ["To‘langan", "green"] : got > 0 ? ["Qisman to‘langan", "amber"] : ["To‘lanmagan", "red"];
                  return (
                    <tr key={l.employeeId}>
                      <td>
                        <b>{l.name}</b>
                      </td>
                      <td>
                        <PayTypeBadge type={l.payType} />
                      </td>
                      <td className="num">
                        <b>{money(l.net)}</b>
                      </td>
                      <td className="num t-green">{got ? money(got) : "—"}</td>
                      <td className="num">{left ? money(left) : "—"}</td>
                      <td>
                        <span className={`tp-badge ${tone}`}>{label}</span>
                      </td>
                      <td className="right">
                        {canEdit && closed && left > 0 ? (
                          <button type="button" className="btn btn-sm btn-primary" onClick={() => setPayFor(l)}>
                            <Banknote size={14} /> To‘lash
                          </button>
                        ) : (
                          <span className="tp-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="tp-card">
        <div className="tp-card-head">
          <div className="tp-title">
            <h2>To‘lovlar tarixi</h2>
            <span className="tp-muted">{(data || []).length} ta yozuv</span>
          </div>
        </div>
        {error ? (
          <div className="notice error pm-pad">{error}</div>
        ) : !(data || []).length ? (
          <Empty icon={Clock3} title="To‘lovlar qayd etilmagan" text="Har bir to‘lov summa, sana, usul va kim kiritgani bilan saqlanadi." />
        ) : (
          <div className="table-wrap tp-table-wrap">
            <table className="tp-table">
              <thead>
                <tr>
                  <th>Sana</th>
                  <th>Xodim</th>
                  <th>Usul</th>
                  <th>Izoh</th>
                  <th>Kiritgan</th>
                  <th className="num">Summa</th>
                </tr>
              </thead>
              <tbody>
                {(data || []).map((p) => (
                  <tr key={p.id}>
                    <td className="tp-muted nowrap">{dmy(p.paidAt)}</td>
                    <td>
                      <b>{p.name}</b>
                    </td>
                    <td>{METHOD[p.method] || p.method}</td>
                    <td className="tp-reason">{p.note || "—"}</td>
                    <td className="tp-muted">{p.createdBy}</td>
                    <td className="num t-green">
                      <b>{money(p.amount)}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {payFor && (
        <PaymentModal
          line={payFor}
          month={month}
          remaining={Math.max(0, payFor.net - (paid.get(payFor.employeeId) || 0))}
          onClose={() => setPayFor(null)}
          onSaved={() => {
            setPayFor(null);
            void reload(true);
          }}
        />
      )}
    </div>
  );
}

function PaymentModal({ line, month, remaining, onClose, onSaved }: { line: Line; month: string; remaining: number; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ amount: String(remaining), method: "CARD", paidAt: tashkentIsoDate(), note: "" });
  const [key] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const amount = Math.round(Number(form.amount) || 0);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post("/payroll/payments", { employeeId: line.employeeId, month, amount, method: form.method, paidAt: form.paidAt, note: form.note || undefined, idempotencyKey: key });
      toast(amount < remaining ? "Qisman to‘lov qayd etildi" : "To‘lov qayd etildi");
      onSaved();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="To‘lovni qayd etish" subtitle={`${line.name} · qoldiq ${money(remaining)}`} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)}>
        <div className="form-grid">
          <Field label="Summa (so‘m)" hint={amount && amount < remaining ? "Qisman to‘lov" : "To‘liq to‘lov"}>
            <input className="input" required type="number" min="1" max={remaining} step="1" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </Field>
          <Field label="To‘lov usuli">
            <select className="input" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
              {Object.entries(METHOD).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="To‘lov sanasi">
            <input className="input" required type="date" value={form.paidAt} onChange={(e) => setForm({ ...form, paidAt: e.target.value })} />
          </Field>
          <Field label="Izoh (ixtiyoriy)">
            <input className="input" maxLength={300} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Masalan: to‘lov raqami" />
          </Field>
        </div>
        <div className="notice">Tizim bankdan pul o‘tkazmaydi — bu yozuv to‘lov allaqachon amalga oshirilganini qayd etadi va auditga tushadi.</div>
        {error && <div className="notice error">{error}</div>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Bekor qilish
          </button>
          <button className="btn btn-primary" disabled={busy || amount <= 0 || amount > remaining}>
            {busy ? "Saqlanmoqda…" : "Qayd etish"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
