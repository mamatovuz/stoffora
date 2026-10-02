import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Banknote, Check, CreditCard, Download, Eye, Gavel, HandCoins, Plus, Search, Trash2, Wallet, X } from "lucide-react";
import { api, errorText, notifyChange, post } from "../api";
import { useApi, useDebounced, usePolling } from "../hooks";
import { Confirm, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Person, Segmented, StatCard, Status, useToast } from "../components/ui";
import { useAuth } from "../auth";
import { can, canAny } from "@/lib/permissions";
import { dateUz, money, monthYearUz, tashkentIsoDate } from "@/lib/format";
import type { Employee } from "@/lib/types";

/*
 * Moliya bo‘limi (sayt): avans oluvchilar ro‘yxati va jarimalar.
 * Huquqlar serverda: jarimani HR / direktor / moliya darhol qo‘llaydi; filial rahbari taklif qiladi → HR tasdiqlaydi.
 */

const thisMonth = () => tashkentIsoDate().slice(0, 7);
const split = (name: string) => {
  const [first = "", ...rest] = name.split(" ");
  return [first, rest.join(" ")] as const;
};
const parseAmount = (value: string) => Number(value.replace(/[^\d]/g, "")) || 0;
const formatAmount = (value: string) => {
  const n = parseAmount(value);
  return n ? n.toLocaleString("ru-RU").replace(/\s/g, " ") : "";
};

function MonthPicker({ value, onChange }: { value: string; onChange: (month: string) => void }) {
  return (
    <div className="date-nav">
      <input type="month" value={value} max={thisMonth()} onChange={(e) => e.target.value && onChange(e.target.value)} aria-label="Oy" />
    </div>
  );
}

/* ================================================================ avanslar === */
type AdvanceRow = {
  id: string;
  source: "REQUEST" | "MANUAL";
  employeeId: string;
  employeeName: string;
  employeeNo?: string;
  photoDataUrl?: string;
  branchName: string;
  baseSalary: number;
  amount: number;
  status: "PENDING" | "HR_APPROVED" | "APPROVED";
  method?: "CARD" | "CASH";
  cardMask?: string;
  cardBrand?: string;
  holder?: string;
  reason?: string;
  paidAt?: string;
};

export function AdvancesPage() {
  const toast = useToast();
  const { user } = useAuth();
  const finance = Boolean(user && can(user.role, "payroll.edit"));
  const [month, setMonth] = useState(thisMonth());
  const { data, loading, error, reload } = useApi<{ label: string; rows: AdvanceRow[] }>(`/advances/recipients?month=${month}`);
  usePolling(() => void reload(true), 60_000);
  const [q, setQ] = useState("");
  const [branch, setBranch] = useState("");
  const [cards, setCards] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const rows = data?.rows || [];
  const branches = useMemo(() => [...new Set(rows.map((r) => r.branchName))].sort(), [rows]);
  const visible = rows.filter((r) => (!branch || r.branchName === branch) && `${r.employeeName} ${r.employeeNo || ""}`.toLowerCase().includes(q.toLowerCase()));
  const total = visible.reduce((s, r) => s + r.amount, 0);
  const paid = visible.filter((r) => r.paidAt);
  const waiting = visible.filter((r) => r.status !== "APPROVED");

  async function reveal(row: AdvanceRow) {
    try {
      const res = await post<{ number: string; holder?: string }>(`/payroll/advances/${row.id}/card`, {});
      setCards((c) => ({ ...c, [row.id]: res.number }));
    } catch (reason) {
      toast(errorText(reason), "error");
    }
  }
  async function markPaid(row: AdvanceRow) {
    setBusy(row.id);
    try {
      await post(`/payroll/advances/${row.id}/paid`, {});
      toast(`${row.employeeName}: avans to‘landi deb belgilandi`);
      void reload(true);
    } catch (reason) {
      toast(errorText(reason), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Avans oluvchilar"
        subtitle={`${monthYearUz(`${month}-15`)} · avans so‘ragan va avans berilgan xodimlar`}
        actions={
          <>
            <MonthPicker value={month} onChange={setMonth} />
            <a className="btn" href={`/api/reports/advances.xlsx?month=${month}`} download>
              <Download size={16} /> Excel
            </a>
            {finance && (
              <a className="btn" href={`/api/reports/advances.xlsx?month=${month}&cards=1`} download title="To‘liq karta raqamlari bilan (auditga yoziladi)">
                <CreditCard size={16} /> Excel (karta bilan)
              </a>
            )}
          </>
        }
      />
      <div className="stat-grid">
        <StatCard label="Avans oluvchilar" value={visible.length} note={branch || "barcha filiallar"} icon={HandCoins} tone="blue" />
        <StatCard label="Jami avans" value={money(total)} note="shu oy oylikdan ushlanadi" icon={Wallet} tone="green" />
        <StatCard label="To‘langan" value={paid.length} note={money(paid.reduce((s, r) => s + r.amount, 0))} icon={Check} tone="violet" />
        <StatCard label="Ko‘rib chiqilmoqda" value={waiting.length} note={waiting.length ? "Ish haqi → Avans so‘rovlari" : "hammasi hal qilingan"} icon={Banknote} tone="amber" />
      </div>
      <section className="card">
        <div className="filters">
          <span className="input-icon">
            <Search size={16} />
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Xodim qidirish…" />
          </span>
          <select className="select" style={{ maxWidth: 220 }} value={branch} onChange={(e) => setBranch(e.target.value)}>
            <option value="">Barcha filiallar</option>
            {branches.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
          {waiting.length > 0 && (
            <Link className="btn btn-sm" to="/payroll">
              Kutilayotganlarni ko‘rib chiqish →
            </Link>
          )}
        </div>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <div className="card-body">
            <ErrorBox message={error} />
          </div>
        ) : !visible.length ? (
          <Empty icon={HandCoins} title="Bu oy avans oluvchilar yo‘q" text="Xodimlar Mini App yoki ilovadagi «Mening oyligim» bo‘limidan avans so‘raydi." />
        ) : (
          <div className="table-wrap">
            <table className="table table-cards money-table">
              <thead>
                <tr>
                  <th className="num" style={{ width: 44 }}>№</th>
                  <th>Xodim</th>
                  <th>Filial</th>
                  <th>Karta</th>
                  <th className="num">Asl oylik</th>
                  <th className="num">Avans</th>
                  <th>Holat</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((r, i) => {
                  const [first, last] = split(r.employeeName);
                  return (
                    <tr key={r.id}>
                      <td className="num muted">{i + 1}</td>
                      <td>
                        <Person first={first} last={last} photo={r.photoDataUrl} sub={r.reason ? `«${r.reason}»` : r.employeeNo} />
                      </td>
                      <td data-label="Filial">{r.branchName}</td>
                      <td data-label="Karta">
                        {r.method === "CASH" ? (
                          <span className="muted">Naqd</span>
                        ) : r.cardMask ? (
                          <span className="stack">
                            <span className="mono">{cards[r.id] || r.cardMask}</span>
                            <small>
                              {r.cardBrand} {r.holder ? `· ${r.holder}` : ""}
                              {finance && r.source === "REQUEST" && !cards[r.id] && (
                                <button className="link" style={{ marginLeft: 6 }} onClick={() => void reveal(r)}>
                                  <Eye size={12} /> ko‘rish
                                </button>
                              )}
                            </small>
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td data-label="Asl oylik" className="num">{r.baseSalary ? money(r.baseSalary) : "—"}</td>
                      <td data-label="Avans" className="num">
                        <b>{money(r.amount)}</b>
                        {r.baseSalary ? <small className="muted"> · {Math.round((r.amount / r.baseSalary) * 100)}%</small> : null}
                      </td>
                      <td data-label="Holat">
                        {r.paidAt ? (
                          <Status value="APPROVED" label={`To‘landi · ${dateUz(r.paidAt)}`} />
                        ) : r.status === "APPROVED" ? (
                          <Status value="SCHEDULED" label="Tasdiqlangan" />
                        ) : (
                          <Status value="PENDING" label={r.status === "HR_APPROVED" ? "Moliyada" : "HR ko‘rmoqda"} />
                        )}
                      </td>
                      <td className="actions">
                        {finance && r.source === "REQUEST" && r.status === "APPROVED" && !r.paidAt && (
                          <button className="btn btn-sm btn-primary" disabled={busy === r.id} onClick={() => void markPaid(r)}>
                            <Check size={14} /> To‘landi
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}>Jami: {visible.length} xodim</td>
                  <td className="num">
                    <b>{money(total)}</b>
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/* ================================================================ jarimalar === */
export type FineRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNo?: string;
  photoDataUrl?: string;
  branchName: string;
  position?: string;
  month: string;
  amount: number;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdBy: string;
  proposedBy?: string;
  decidedBy?: string;
  decidedNote?: string;
  createdAt: string;
};
type Tab = "ALL" | "PENDING" | "REJECTED";

export function FinesPage() {
  const toast = useToast();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const focusId = params.get("id");
  const direct = Boolean(user && canAny(user.role, ["employees.edit", "payroll.edit"]));
  const [month, setMonth] = useState(thisMonth());
  const [tab, setTab] = useState<Tab>("ALL");
  const { data, loading, error, reload, setData } = useApi<FineRow[]>(`/fines?month=${month}`);
  const pendingAll = useApi<FineRow[]>("/fines?status=PENDING");
  usePolling(() => {
    void reload(true);
    void pendingAll.reload(true);
  }, 45_000);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<FineRow | null>(null);
  const [rejecting, setRejecting] = useState<FineRow | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");

  // Bildirishnomadan kelgan taklif boshqa oyda bo‘lsa — o‘sha oyga o‘tamiz.
  useEffect(() => {
    const row = pendingAll.data?.find((r) => r.id === focusId);
    if (row && row.month !== month) setMonth(row.month);
    if (row) setTab("PENDING");
  }, [focusId, pendingAll.data, month]);
  useEffect(() => {
    if (focusId && data?.some((r) => r.id === focusId)) setTimeout(() => document.getElementById(`fine-${focusId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
  }, [focusId, data]);

  const rows = (data || []).filter((r) => (tab === "ALL" ? r.status !== "REJECTED" : r.status === tab) && `${r.employeeName} ${r.reason}`.toLowerCase().includes(q.toLowerCase()));
  const applied = (data || []).filter((r) => r.status === "APPROVED");
  const total = applied.reduce((s, r) => s + r.amount, 0);
  const pending = (data || []).filter((r) => r.status === "PENDING").length;

  async function decide(row: FineRow, approve: boolean, reason?: string) {
    setBusy(row.id);
    try {
      const saved = await post<FineRow>(`/fines/${row.id}/decide`, { approve, note: reason || undefined });
      setData((list) => list?.map((r) => (r.id === row.id ? saved : r)) || null);
      toast(approve ? `${row.employeeName}: jarima qo‘llandi` : "Taklif rad etildi");
      setRejecting(null);
      setNote("");
      if (focusId === row.id) setParams({}, { replace: true });
      void pendingAll.reload(true);
      notifyChange("notifications");
    } catch (reason) {
      toast(errorText(reason), "error");
    } finally {
      setBusy(null);
    }
  }
  async function remove(row: FineRow) {
    await api(`/fines/${row.id}`, { method: "DELETE" });
    setData((list) => list?.filter((r) => r.id !== row.id) || null);
    toast("Jarima bekor qilindi — xodimga xabar yuborildi");
  }

  return (
    <div className="page">
      <PageHeader
        title="Jarimalar"
        subtitle={direct ? "Jarima darhol qo‘llanadi va shu oy oylikdan ushlanadi. Filial rahbarlari takliflari shu yerda tasdiqlanadi." : "Siz jarima taklif qilasiz — HR yoki direktor tasdiqlagach qo‘llanadi."}
        actions={
          <>
            <MonthPicker value={month} onChange={setMonth} />
            {direct && (
              <a className="btn" href={`/api/reports/fines.xlsx?month=${month}`} download>
                <Download size={16} /> Excel
              </a>
            )}
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus size={16} /> {direct ? "Jarima yozish" : "Jarima taklif qilish"}
            </button>
          </>
        }
      />
      <div className="stat-grid">
        <StatCard label="Qo‘llangan jarimalar" value={applied.length} note={monthYearUz(`${month}-15`)} icon={Gavel} tone="red" />
        <StatCard label="Jami summa" value={money(total)} note="oyliklardan ushlanadi" icon={Wallet} tone="amber" />
        <StatCard label="Xodimlar" value={new Set(applied.map((r) => r.employeeId)).size} note="jarima olganlar" icon={HandCoins} tone="blue" />
        <StatCard label="Tasdiq kutmoqda" value={pendingAll.data?.length || 0} note="filial rahbarlari takliflari" icon={Banknote} tone="violet" onClick={() => setTab("PENDING")} selected={tab === "PENDING"} />
      </div>
      <section className="card">
        <div className="filters">
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: "ALL", label: "Barchasi", count: (data || []).filter((r) => r.status !== "REJECTED").length },
              { value: "PENDING", label: "Kutilmoqda", count: pending },
              { value: "REJECTED", label: "Rad etilgan" },
            ]}
          />
          <span className="input-icon">
            <Search size={16} />
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Xodim yoki sabab…" />
          </span>
        </div>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <div className="card-body">
            <ErrorBox message={error} />
          </div>
        ) : !rows.length ? (
          <Empty icon={Gavel} title={tab === "PENDING" ? "Kutilayotgan taklif yo‘q" : "Bu oy jarima yo‘q"} />
        ) : (
          <div className="table-wrap">
            <table className="table table-cards money-table">
              <thead>
                <tr>
                  <th className="num" style={{ width: 44 }}>№</th>
                  <th>Xodim</th>
                  <th>Filial</th>
                  <th className="num">Summa</th>
                  <th>Sabab</th>
                  <th>Kim</th>
                  <th>Holat</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const [first, last] = split(r.employeeName);
                  return (
                    <tr key={r.id} id={`fine-${r.id}`} className={focusId === r.id ? "row-focus" : ""}>
                      <td className="num muted">{i + 1}</td>
                      <td>
                        <Person first={first} last={last} photo={r.photoDataUrl} sub={r.position || r.employeeNo} />
                      </td>
                      <td data-label="Filial">{r.branchName}</td>
                      <td data-label="Summa" className="num minus">
                        <b>− {money(r.amount)}</b>
                      </td>
                      <td data-label="Sabab" className="wrap">{r.reason}</td>
                      <td data-label="Kim">
                        <span className="stack">
                          <span>{r.proposedBy ? `${r.proposedBy} (taklif)` : r.createdBy}</span>
                          <small>
                            {dateUz(r.createdAt)}
                            {r.decidedBy && r.proposedBy ? ` · ${r.status === "REJECTED" ? "rad etdi" : "tasdiqladi"}: ${r.decidedBy}` : ""}
                          </small>
                        </span>
                      </td>
                      <td data-label="Holat">
                        <Status value={r.status} label={r.status === "APPROVED" ? "Qo‘llangan" : undefined} />
                      </td>
                      <td className="actions">
                        {r.status === "PENDING" && direct ? (
                          <>
                            <button className="btn btn-sm btn-primary" disabled={busy === r.id} onClick={() => void decide(r, true)}>
                              <Check size={14} /> Tasdiqlash
                            </button>
                            <button className="btn btn-sm btn-danger" disabled={busy === r.id} onClick={() => setRejecting(r)}>
                              <X size={14} /> Rad
                            </button>
                          </>
                        ) : r.status === "APPROVED" && direct ? (
                          <button className="icon-btn" title="Bekor qilish" onClick={() => setRemoving(r)}>
                            <Trash2 size={15} />
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {creating && (
        <FineModal
          direct={direct}
          onClose={() => setCreating(false)}
          onSaved={(row) => {
            setCreating(false);
            if (row.month === month) setData((list) => [row, ...(list || [])]);
            toast(row.status === "APPROVED" ? `${row.employeeName}: ${money(row.amount)} jarima qo‘llandi, xodimga xabar yuborildi` : "Taklif HR’ga yuborildi");
            void pendingAll.reload(true);
          }}
        />
      )}
      {rejecting && (
        <Modal title="Taklifni rad etish" subtitle={`${rejecting.employeeName} · ${money(rejecting.amount)}`} onClose={() => setRejecting(null)} size="narrow">
          <Field label="Izoh (ixtiyoriy)">
            <textarea className="input" rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="form-actions">
            <button className="btn" onClick={() => setRejecting(null)}>
              Bekor qilish
            </button>
            <button className="btn btn-danger" disabled={busy === rejecting.id} onClick={() => void decide(rejecting, false, note.trim())}>
              <X size={16} /> Rad etish
            </button>
          </div>
        </Modal>
      )}
      {removing && (
        <Confirm
          title="Jarimani bekor qilish"
          text={`${removing.employeeName} — ${money(removing.amount)} jarima bekor qilinadi va oylikdan ushlanmaydi. Xodimga xabar boradi.`}
          confirmLabel="Jarimani bekor qilish"
          danger
          onConfirm={() => remove(removing)}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

/** Jarima yozish oynasi: xodimni qidirib tanlash, summa, sabab. */
export function FineModal({ direct, onClose, onSaved, employee: preset }: { direct: boolean; onClose: () => void; onSaved: (row: FineRow) => void; employee?: Pick<Employee, "id" | "firstName" | "lastName"> }) {
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 250);
  const { data: found } = useApi<Employee[]>(preset ? null : `/fines/employees?limit=8&q=${encodeURIComponent(debounced)}`);
  const [picked, setPicked] = useState<(Pick<Employee, "id" | "firstName" | "lastName"> & Partial<Pick<Employee, "photoDataUrl" | "baseSalary">>) | null>(preset || null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const value = parseAmount(amount);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!picked) return setError("Xodimni tanlang.");
    setSaving(true);
    setError("");
    try {
      onSaved(await post<FineRow>("/fines", { employeeId: picked.id, amount: value, reason: reason.trim() }));
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title={direct ? "Jarima yozish" : "Jarima taklif qilish"} subtitle={direct ? "Darhol qo‘llanadi va shu oy oylikdan ushlanadi" : "HR yoki direktor tasdiqlagach qo‘llanadi"} onClose={onClose} size="narrow">
      <form onSubmit={save} className="fine-form">
        <Field label="Xodim">
          {picked ? (
            <div className="fine-picked">
              <Person first={picked.firstName} last={picked.lastName} photo={picked.photoDataUrl} sub={picked.baseSalary ? `Oylik: ${money(picked.baseSalary)}` : undefined} />
              {!preset && (
                <button type="button" className="link" onClick={() => setPicked(null)}>
                  O‘zgartirish
                </button>
              )}
            </div>
          ) : (
            <>
              <span className="input-icon">
                <Search size={16} />
                <input className="input" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ism, familiya yoki ID…" />
              </span>
              <div className="fine-results">
                {(found || []).map((e) => (
                  <button type="button" key={e.id} onClick={() => setPicked(e)}>
                    <Person first={e.firstName} last={e.lastName} photo={e.photoDataUrl} sub={e.employeeNo} />
                  </button>
                ))}
              </div>
            </>
          )}
        </Field>
        <Field label="Summa (so‘m)">
          <input className="input" inputMode="numeric" value={formatAmount(amount)} onChange={(e) => setAmount(e.target.value)} placeholder="300 000" required />
        </Field>
        <div className="fine-quick">
          {[50_000, 100_000, 200_000, 300_000, 500_000].map((n) => (
            <button type="button" key={n} className={value === n ? "on" : ""} onClick={() => setAmount(String(n))}>
              {n.toLocaleString("ru-RU")}
            </button>
          ))}
        </div>
        <Field label="Sabab">
          <textarea className="input" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Masalan: kassa kamomadi, forma kiyilmagan" required minLength={3} />
        </Field>
        <ErrorBox message={error} />
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Bekor qilish
          </button>
          <button className="btn btn-primary" disabled={saving || !picked || value < 1000 || reason.trim().length < 3}>
            <Gavel size={16} /> {saving ? "Saqlanmoqda…" : direct ? `Qo‘llash${value ? ` · ${money(value)}` : ""}` : "Taklif yuborish"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
