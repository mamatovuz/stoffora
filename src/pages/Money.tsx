import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Banknote, Check, CreditCard, Download, Eye, Flame, Gavel, HandCoins, Plus, Search, Trash2, Trophy, Wallet, X } from "lucide-react";
import { api, errorText, notifyChange, post, put } from "../api";
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

/* ========================================================== rag‘batlantirish === */
type RewardRule = { days: number; amount: number };
type RewardsData = {
  settings: { enabled: boolean; rules: RewardRule[]; announce: boolean };
  awards: { id: string; employeeName: string; photoDataUrl?: string; branch: string; days: number; amount: number; createdAt: string }[];
  leaders: { id: string; name: string; photoDataUrl?: string; branch: string; streak: number }[];
};

export function RewardsPage() {
  const toast = useToast();
  const { user } = useAuth();
  const editable = Boolean(user && can(user.role, "payroll.edit"));
  const [month, setMonth] = useState(thisMonth());
  const { data, loading, error, reload } = useApi<RewardsData>(`/rewards?month=${month}`);
  const [form, setForm] = useState<RewardsData["settings"] | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (data && !form) setForm({ ...data.settings, rules: data.settings.rules.length ? data.settings.rules : [{ days: 10, amount: 100_000 }] });
  }, [data, form]);
  const awards = data?.awards || [];
  const total = awards.reduce((s, a) => s + a.amount, 0);
  const top = form?.rules.length ? Math.max(...form.rules.map((r) => r.days)) : 0;

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      const saved = await put<RewardsData["settings"]>("/company/rewards", form);
      setForm(saved);
      toast(saved.enabled ? "Rag‘batlantirish yoqildi — xodimlarga motivatsiya xabarlari boradi" : "Saqlandi");
      void reload(true);
    } catch (reason) {
      toast(errorText(reason), "error");
    } finally {
      setSaving(false);
    }
  }
  const setRule = (i: number, patch: Partial<RewardRule>) => form && setForm({ ...form, rules: form.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  return (
    <div className="page">
      <PageHeader title="Rag‘batlantirish" subtitle="Ketma-ket vaqtida kelgan xodimlarga avtomatik mukofot — shu oy oyligiga qo‘shiladi" actions={<MonthPicker value={month} onChange={setMonth} />} />
      <div className="stat-grid">
        <StatCard
          label="Holat"
          value={data?.settings.enabled ? "Yoqilgan" : "O‘chiq"}
          note={data?.settings.rules.map((r) => `${r.days} kun → ${money(r.amount)}`).join(" · ") || "bosqich yo‘q"}
          icon={Trophy}
          tone={data?.settings.enabled ? "green" : undefined}
        />
        <StatCard label="Berilgan mukofotlar" value={awards.length} note={monthYearUz(`${month}-15`)} icon={HandCoins} tone="blue" />
        <StatCard label="Jami summa" value={money(total)} note="oyliklarga qo‘shildi" icon={Wallet} tone="violet" />
        <StatCard label="Eng uzun seriya" value={data?.leaders[0] ? `${data.leaders[0].streak} kun` : "—"} note={data?.leaders[0]?.name || "hali yo‘q"} icon={Flame} tone="amber" />
      </div>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} />
      ) : (
        <div className="reward-grid">
          <section className="card card-body">
            <h3 className="reward-h">Sozlama</h3>
            {form && (
              <>
                <label className="reward-switch">
                  <input type="checkbox" checked={form.enabled} disabled={!editable} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
                  <span>
                    <b>Rag‘batlantirish yoqilgan</b>
                    <small>Seriya bosqichga yetgan kuni bonus avtomatik yoziladi va xodimga tabrik boradi.</small>
                  </span>
                </label>
                <div className="reward-rules">
                  {form.rules.map((rule, i) => (
                    <div className="reward-rule" key={i}>
                      <span>Ketma-ket</span>
                      <input className="input" type="number" min={2} max={120} value={rule.days || ""} disabled={!editable} onChange={(e) => setRule(i, { days: Number(e.target.value) })} />
                      <span>ish kuni vaqtida →</span>
                      <input className="input money-input" inputMode="numeric" value={rule.amount ? rule.amount.toLocaleString("ru-RU") : ""} disabled={!editable} onChange={(e) => setRule(i, { amount: parseAmount(e.target.value) })} />
                      <span>so‘m</span>
                      {editable && form.rules.length > 1 && (
                        <button className="icon-btn" title="Olib tashlash" onClick={() => setForm({ ...form, rules: form.rules.filter((_, j) => j !== i) })}>
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  ))}
                  {editable && form.rules.length < 6 && (
                    <button className="btn btn-sm" style={{ justifySelf: "start" }} onClick={() => setForm({ ...form, rules: [...form.rules, { days: (top || 10) + 10, amount: 200_000 }] })}>
                      <Plus size={14} /> Bosqich qo‘shish
                    </button>
                  )}
                </div>
                <label className="reward-switch">
                  <input type="checkbox" checked={form.announce} disabled={!editable} onChange={(e) => setForm({ ...form, announce: e.target.checked })} />
                  <span>
                    <b>Boshqa xodimlarga xabar</b>
                    <small>«Hamkasblaringiz mukofot oldi — siz ham vaqtida keling» (ilova va Mini App bildirishnomasi).</small>
                  </span>
                </label>
                <p className="hint">Kechikish yoki kelmaslik seriyani uzadi. Dam olish va ta’til kunlari uzmaydi. Yoqilgan paytdagi mavjud seriyalar uchun orqaga qarab pul berilmaydi.</p>
                {editable && (
                  <div className="form-actions">
                    <button className="btn btn-primary" disabled={saving} onClick={() => void save()}>
                      <Check size={16} /> {saving ? "Saqlanmoqda…" : "Saqlash"}
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
          <section className="card">
            <div className="card-head">
              <h3 className="reward-h">Hozirgi seriyalar — yetakchilar</h3>
            </div>
            {!data?.leaders.length ? (
              <Empty icon={Flame} title="Hali seriya yo‘q" />
            ) : (
              <div className="reward-list">
                {data.leaders.map((l, i) => {
                  const [first, last] = split(l.name);
                  const next = form?.rules.find((r) => r.days > l.streak);
                  return (
                    <div key={l.id} className="reward-row">
                      <span className="reward-rank">{i + 1}</span>
                      <Person first={first} last={last} photo={l.photoDataUrl} sub={l.branch} />
                      <span className="reward-streak">
                        <b>{l.streak} kun</b>
                        {next && (
                          <small>
                            yana {next.days - l.streak} kun → {money(next.amount)}
                          </small>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
      <section className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <h3 className="reward-h">Berilgan mukofotlar — {monthYearUz(`${month}-15`)}</h3>
        </div>
        {!awards.length ? (
          <Empty icon={Trophy} title="Bu oy mukofot berilmagan" />
        ) : (
          <div className="reward-list">
            {awards.map((a) => {
              const [first, last] = split(a.employeeName);
              return (
                <div key={a.id} className="reward-row">
                  <Person first={first} last={last} photo={a.photoDataUrl} sub={`${a.branch} · ${dateUz(a.createdAt)}`} />
                  <span className="reward-streak">
                    <b className="plus">+ {money(a.amount)}</b>
                    <small>{a.days} kun ketma-ket vaqtida</small>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

/* ============================================================ moliya xulosasi === */
type Summary = {
  month: string;
  label: string;
  closed: boolean;
  employees: number;
  base: number;
  net: number;
  deductions: number;
  fine: number;
  bonus: number;
  overtime: number;
  advance: number;
  advances: { requested: number; pendingCount: number; approved: number; paid: number; unpaidCount: number };
  forecast: { fund: number; payable: number; current: boolean };
  rewards: { count: number; amount: number };
  pendingFines: number;
  noSalary: number;
  branches: { id: string; name: string; employees: number; base: number; net: number; advance: number; fine: number; bonus: number }[];
  trend: { month: string; label: string; net: number; fine: number; advance: number; closed: boolean }[];
};

export function FinancePage() {
  const [month, setMonth] = useState(thisMonth());
  const { data, loading, error } = useApi<Summary>(`/finance/summary?month=${month}`);
  const max = Math.max(1, ...(data?.trend || []).map((t) => t.net));
  const alerts = data
    ? [
        data.advances.pendingCount ? { to: "/payroll", text: `${data.advances.pendingCount} ta avans so‘rovi ko‘rib chiqilmagan (${money(data.advances.requested)})` } : null,
        data.advances.unpaidCount ? { to: "/advances", text: `${data.advances.unpaidCount} ta tasdiqlangan avans hali to‘lanmagan` } : null,
        data.pendingFines ? { to: "/fines", text: `${data.pendingFines} ta jarima taklifi tasdiq kutmoqda` } : null,
        data.noSalary ? { to: "/payroll", text: `${data.noSalary} ta xodimning oyligi kiritilmagan` } : null,
      ].filter((a): a is { to: string; text: string } => Boolean(a))
    : [];
  return (
    <div className="page">
      <PageHeader
        title="Moliya xulosasi"
        subtitle={`${monthYearUz(`${month}-15`)}${data?.closed ? " · oy yopilgan, raqamlar muzlatilgan" : " · bugungacha hisob (taxminiy)"}`}
        actions={
          <>
            <MonthPicker value={month} onChange={setMonth} />
            <a className="btn" href={`/api/reports/payroll.xlsx?month=${month}`} download>
              <Download size={16} /> Vedomost (Excel)
            </a>
          </>
        }
      />
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} />
      ) : data ? (
        <>
          <div className="stat-grid">
            <StatCard label="Qo‘lga beriladi" value={money(data.net)} note={`${data.employees} xodim · oklad ${money(data.base)}`} icon={Wallet} tone="green" />
            <StatCard label="Avans berilgan" value={money(data.advance)} note={`to‘langan ${money(data.advances.paid)}`} icon={HandCoins} tone="blue" />
            <StatCard label="Ushlanmalar" value={money(data.deductions + data.fine)} note={`jarima ${money(data.fine)} · kechikish/kelmaslik ${money(data.deductions)}`} icon={Gavel} tone="amber" />
            <StatCard label="Bonus va qo‘shimcha" value={money(data.bonus + data.overtime)} note={`rag‘batlantirish: ${data.rewards.count} ta · ${money(data.rewards.amount)}`} icon={Trophy} tone="violet" />
          </div>
          {data.forecast.current && (
            <div className="alert info" style={{ marginBottom: 16 }}>
              <Wallet size={18} />
              <div>
                <b>Oy oxiriga prognoz: ish haqi fondi ≈ {money(data.forecast.fund)}</b>
                <p>Avanslardan keyin to‘lanadi ≈ {money(data.forecast.payable)} (to‘liq oklad − ma’lum ushlanmalar + bonus va qo‘shimcha ish).</p>
              </div>
            </div>
          )}
          {alerts.length > 0 && (
            <section className="card fin-alerts">
              {alerts.map((a) => (
                <Link key={a.text} to={a.to} className="fin-alert">
                  <Banknote size={16} />
                  <span>{a.text}</span>
                  <b>→</b>
                </Link>
              ))}
            </section>
          )}
          <div className="reward-grid">
            <section className="card">
              <div className="card-head">
                <h3 className="reward-h">Filiallar kesimi</h3>
              </div>
              {!data.branches.length ? (
                <Empty icon={Wallet} title="Ma’lumot yo‘q" />
              ) : (
                <div className="table-wrap">
                  <table className="table money-table">
                    <thead>
                      <tr>
                        <th>Filial</th>
                        <th className="num">Xodim</th>
                        <th className="num">Qo‘lga</th>
                        <th className="num">Avans</th>
                        <th className="num">Jarima</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.branches.map((b) => (
                        <tr key={b.id}>
                          <td>
                            <b>{b.name}</b>
                          </td>
                          <td className="num">{b.employees}</td>
                          <td className="num">
                            <b>{money(b.net)}</b>
                          </td>
                          <td className="num">{b.advance ? money(b.advance) : "—"}</td>
                          <td className="num minus">{b.fine ? `− ${money(b.fine)}` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <section className="card card-body">
              <h3 className="reward-h">Qo‘lga beriladigan — 6 oy</h3>
              <div className="fin-trend">
                {data.trend.map((t) => (
                  <div key={t.month} className={`fin-bar ${t.month === month ? "on" : ""}`} title={`${t.label}: ${money(t.net)}`}>
                    <small>{t.net ? `${Math.round(t.net / 1_000_000)} mln` : "—"}</small>
                    <i style={{ height: `${Math.max(2, (t.net / max) * 100)}%` }} />
                    <span>{t.label.split(" ")[0].slice(0, 3)}</span>
                  </div>
                ))}
              </div>
              <p className="hint">Yopilgan oylar — muzlatilgan vedomost bo‘yicha; joriy oy — bugungacha.</p>
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}
