import { useState } from "react";
import { ArrowRightLeft, CalendarDays, Check, Package, Plus, RotateCcw, Search, Trash2, X } from "lucide-react";
import { api, del, errorText, post, put } from "../api";
import { useApi } from "../hooks";
import { Empty, ErrorBox, Field, Loading, Modal, PageHeader, StatCard, Status, useToast } from "../components/ui";
import { useAuth } from "../auth";
import { can, canAny } from "@/lib/permissions";
import type { Branch, Employee } from "@/lib/types";

/*
 * HR asoslari (sayt): ta’til balanslari, kompaniya kalendari (bayramlar/tadbirlar), aktivlar,
 * xodim profilida — onboarding qadamlari, filialga o‘tkazish va xodimdagi aktivlar.
 */

const dmy = (iso: string) => iso.slice(0, 10).split("-").reverse().join(".");

/* ------------------------------------------------------ ta’til balanslari --- */
type Balance = { employeeId: string; name: string; branch: string; custom: boolean; year: number; annual: number; entitled: number; used: number; pending: number; remaining: number };

export function LeaveBalancesPanel() {
  const toast = useToast();
  const { user } = useAuth();
  const editable = Boolean(user && can(user.role, "employees.edit"));
  const { data, loading, error, reload } = useApi<{ policy: { annualDays: number }; rows: Balance[] }>("/leave-balances");
  const [q, setQ] = useState("");
  const [days, setDays] = useState("");
  const [editing, setEditing] = useState<Balance | null>(null);
  const [custom, setCustom] = useState("");
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error || "Ma’lumot yo‘q"} />;
  const rows = data.rows.filter((r) => `${r.name} ${r.branch}`.toLowerCase().includes(q.toLowerCase()));
  async function savePolicy() {
    try {
      await put("/company/leave-policy", { annualDays: Number(days) });
      toast("Yillik ta’til qoidasi saqlandi");
      setDays("");
      void reload(true);
    } catch (reason) {
      toast(errorText(reason), "error");
    }
  }
  async function saveCustom() {
    if (!editing) return;
    try {
      await put(`/employees/${editing.employeeId}/leave-days`, { days: custom.trim() === "" ? null : Number(custom) });
      toast("Saqlandi");
      setEditing(null);
      void reload(true);
    } catch (reason) {
      toast(errorText(reason), "error");
    }
  }
  return (
    <section className="card">
      <div className="filters">
        <span className="input-icon">
          <Search size={16} />
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Xodim yoki filial…" />
        </span>
        {editable && (
          <span className="lb-policy">
            Yillik ta’til (kalendar kun): <b>{data.policy.annualDays}</b>
            <input className="input" type="number" min={0} max={90} value={days} placeholder="o‘zgartirish" onChange={(e) => setDays(e.target.value)} style={{ width: 110 }} />
            <button className="btn btn-sm" disabled={!days} onClick={() => void savePolicy()}>
              Saqlash
            </button>
          </span>
        )}
      </div>
      <div className="table-wrap">
        <table className="table money-table">
          <thead>
            <tr>
              <th>Xodim</th>
              <th>Filial</th>
              <th className="num">Haqqi ({data.rows[0]?.year || ""})</th>
              <th className="num">Ishlatilgan</th>
              <th className="num">Kutilmoqda</th>
              <th className="num">Qolgan</th>
              {editable && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.employeeId}>
                <td>
                  <b>{r.name}</b>
                  {r.custom && <small className="muted"> · alohida: {r.annual} kun</small>}
                </td>
                <td>{r.branch}</td>
                <td className="num">{r.entitled}</td>
                <td className="num">{r.used || "—"}</td>
                <td className="num">{r.pending || "—"}</td>
                <td className={`num ${r.remaining < 0 ? "minus" : ""}`}>
                  <b>{r.remaining}</b>
                </td>
                {editable && (
                  <td className="actions">
                    <button className="btn btn-sm" onClick={() => (setEditing(r), setCustom(r.custom ? String(r.annual) : ""))}>
                      Kunlar
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <Modal title={`${editing.name} — yillik ta’til`} subtitle="Bo‘sh qoldirilsa — kompaniya qoidasi" onClose={() => setEditing(null)} size="narrow">
          <Field label="Yillik kunlar">
            <input className="input" type="number" min={0} max={90} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={String(data.policy.annualDays)} />
          </Field>
          <div className="form-actions">
            <button className="btn" onClick={() => setEditing(null)}>
              Bekor qilish
            </button>
            <button className="btn btn-primary" onClick={() => void saveCustom()}>
              Saqlash
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

/* ------------------------------------------------------- kompaniya kalendari --- */
type Holiday = { id: string; date: string; title: string; kind: "HOLIDAY" | "EVENT"; dayOff: boolean; branchIds?: string[] };
type Events = { holidays: Holiday[]; leaves: { id: string; employeeId: string; name: string; type: string; startDate: string; endDate: string }[]; birthdays: { employeeId: string; name: string; date: string }[] };

export function CompanyCalendarPanel({ month }: { month: string }) {
  const toast = useToast();
  const { user } = useAuth();
  const editable = Boolean(user && canAny(user.role, ["employees.edit", "settings.manage"]));
  const { data, reload } = useApi<Events>(`/calendar/events?month=${month}`);
  const [form, setForm] = useState({ date: `${month}-01`, endDate: "", title: "", kind: "HOLIDAY" as "HOLIDAY" | "EVENT", dayOff: true });
  const [open, setOpen] = useState(false);
  async function add() {
    try {
      await post("/holidays", { ...form, endDate: form.endDate || undefined });
      toast(form.kind === "HOLIDAY" && form.dayOff ? "Bayram qo‘shildi — xodimlarga xabar yuborildi, grafikda dam olish kuni" : "Qo‘shildi");
      setOpen(false);
      setForm({ ...form, title: "", endDate: "" });
      void reload(true);
    } catch (reason) {
      toast(errorText(reason), "error");
    }
  }
  async function remove(h: Holiday) {
    try {
      await del(`/holidays/${h.id}`);
      void reload(true);
    } catch (reason) {
      toast(errorText(reason), "error");
    }
  }
  const items = [
    ...(data?.holidays || []).map((h) => ({ date: h.date, text: h.title, tone: h.kind === "HOLIDAY" ? (h.dayOff ? "red" : "amber") : "blue", label: h.kind === "HOLIDAY" ? (h.dayOff ? "Bayram · dam" : "Bayram") : "Tadbir", holiday: h })),
    ...(data?.birthdays || []).map((b) => ({ date: b.date, text: `🎂 ${b.name}`, tone: "violet", label: "Tug‘ilgan kun", holiday: undefined })),
    ...(data?.leaves || []).map((l) => ({ date: l.startDate, text: `${l.name} · ${dmy(l.startDate)}–${dmy(l.endDate)}`, tone: "green", label: "Ta’til", holiday: undefined })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="card-head">
        <h3 className="ws-h">
          <CalendarDays size={17} /> Kompaniya kalendari — bayramlar, tadbirlar, ta’tillar, tug‘ilgan kunlar
        </h3>
        {editable && (
          <button className="btn btn-sm btn-primary" onClick={() => setOpen(true)}>
            <Plus size={14} /> Bayram / tadbir
          </button>
        )}
      </div>
      {!items.length ? (
        <Empty icon={CalendarDays} title="Bu oy voqea yo‘q" />
      ) : (
        <div className="cal-list">
          {items.map((it, i) => (
            <div key={i} className="cal-item">
              <time>{dmy(it.date)}</time>
              <span className={`badge ${it.tone}`}>{it.label}</span>
              <span className="cal-text">{it.text}</span>
              {editable && it.holiday && (
                <button className="icon-btn" title="O‘chirish" onClick={() => void remove(it.holiday!)}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {open && (
        <Modal title="Kalendarga qo‘shish" subtitle="Bayram dam olish kuni bo‘lsa — grafikda ish kuni hisoblanmaydi, kelmaslik yozilmaydi" onClose={() => setOpen(false)} size="narrow">
          <div className="form-grid">
            <Field label="Sana">
              <input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </Field>
            <Field label="Tugash (bir necha kun bo‘lsa)">
              <input className="input" type="date" value={form.endDate} min={form.date} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </Field>
          </div>
          <Field label="Nomi">
            <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Masalan: Mustaqillik kuni" />
          </Field>
          <Field label="Turi">
            <select className="select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as "HOLIDAY" | "EVENT" })}>
              <option value="HOLIDAY">Bayram</option>
              <option value="EVENT">Kompaniya tadbiri</option>
            </select>
          </Field>
          {form.kind === "HOLIDAY" && (
            <label className="reward-switch">
              <input type="checkbox" checked={form.dayOff} onChange={(e) => setForm({ ...form, dayOff: e.target.checked })} />
              <span>
                <b>Dam olish kuni</b>
                <small>Grafikdagi ish kuni bekor bo‘ladi, xodimlarga xabar boradi.</small>
              </span>
            </label>
          )}
          <div className="form-actions">
            <button className="btn" onClick={() => setOpen(false)}>
              Bekor qilish
            </button>
            <button className="btn btn-primary" disabled={form.title.trim().length < 2} onClick={() => void add()}>
              <Check size={16} /> Qo‘shish
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- aktivlar --- */
type Asset = { id: string; name: string; code?: string; category: string; quantity: number; note?: string; status: "IN_STOCK" | "ISSUED" | "RETURNED" | "LOST"; employeeId?: string; employeeName?: string; issuedAt?: string; history: { action: string; by: string; at: string }[] };
const CATEGORY: Record<string, string> = { PHONE: "📱 Telefon", LAPTOP: "💻 Noutbuk", KEY: "🔑 Kalit", UNIFORM: "👕 Forma", TOOL: "🛠 Uskuna", OTHER: "📦 Boshqa" };
const STATUS: Record<Asset["status"], [string, string]> = { IN_STOCK: ["Omborda", "SCHEDULED"], ISSUED: ["Berilgan", "APPROVED"], RETURNED: ["Qaytarilgan", "SCHEDULED"], LOST: ["Yo‘qolgan", "REJECTED"] };

export function AssetsPage() {
  const toast = useToast();
  const { data, loading, error, reload, setData } = useApi<Asset[]>("/assets");
  const { data: people } = useApi<{ items: Employee[] }>("/employees?limit=200&status=ACTIVE");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [issue, setIssue] = useState<Asset | null>(null);
  const [form, setForm] = useState({ name: "", code: "", category: "LAPTOP", quantity: 1, employeeId: "", note: "" });
  const [employeeId, setEmployeeId] = useState("");
  const rows = (data || []).filter((a) => `${a.name} ${a.code || ""} ${a.employeeName || ""}`.toLowerCase().includes(q.toLowerCase()));
  const count = (s: Asset["status"]) => (data || []).filter((a) => a.status === s).length;
  async function create() {
    try {
      const row = await post<Asset>("/assets", { ...form, code: form.code || undefined, employeeId: form.employeeId || undefined, note: form.note || undefined });
      setData((list) => [row, ...(list || [])]);
      setAdding(false);
      setForm({ name: "", code: "", category: "LAPTOP", quantity: 1, employeeId: "", note: "" });
      toast("Aktiv qo‘shildi");
    } catch (reason) {
      toast(errorText(reason), "error");
    }
  }
  async function act(a: Asset, action: "issue" | "return" | "lost", body: object = {}) {
    try {
      const row = await post<Asset>(`/assets/${a.id}/${action}`, body);
      setData((list) => list?.map((x) => (x.id === a.id ? row : x)) || null);
      setIssue(null);
      toast(action === "issue" ? "Berildi — xodimga xabar yuborildi" : action === "return" ? "Qaytarib olindi" : "Yo‘qolgan deb belgilandi");
    } catch (reason) {
      toast(errorText(reason), "error");
    }
  }
  return (
    <div className="page">
      <PageHeader
        title="Aktivlar"
        subtitle="Telefon, noutbuk, kalit, forma va uskunalar — kimda va qachondan beri. Ishdan ketishda qaytarilmaganlar ko‘rsatiladi."
        actions={
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            <Plus size={16} /> Aktiv qo‘shish
          </button>
        }
      />
      <div className="stat-grid">
        <StatCard label="Jami" value={data?.length ?? "…"} icon={Package} tone="blue" />
        <StatCard label="Xodimlarda" value={count("ISSUED")} icon={Package} tone="green" />
        <StatCard label="Omborda" value={count("IN_STOCK")} icon={Package} tone="violet" />
        <StatCard label="Yo‘qolgan" value={count("LOST")} icon={Package} tone="red" />
      </div>
      <section className="card">
        <div className="filters">
          <span className="input-icon">
            <Search size={16} />
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nomi, inventar raqami yoki xodim…" />
          </span>
        </div>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <div className="card-body">
            <ErrorBox message={error} />
          </div>
        ) : !rows.length ? (
          <Empty icon={Package} title="Aktivlar yo‘q" text="Noutbuk, telefon, kalit yoki forma qo‘shing va xodimga biriktiring." />
        ) : (
          <div className="table-wrap">
            <table className="table money-table">
              <thead>
                <tr>
                  <th>Aktiv</th>
                  <th>Turi</th>
                  <th>Kimda</th>
                  <th>Holat</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <b>{a.name}</b>
                      {a.code && <small className="muted"> #{a.code}</small>}
                      {a.quantity > 1 && <small className="muted"> · {a.quantity} dona</small>}
                    </td>
                    <td>{CATEGORY[a.category] || a.category}</td>
                    <td>{a.employeeName ? `${a.employeeName}${a.issuedAt ? ` · ${dmy(a.issuedAt)} dan` : ""}` : "—"}</td>
                    <td>
                      <Status value={STATUS[a.status][1]} label={STATUS[a.status][0]} />
                    </td>
                    <td className="actions">
                      {a.status === "ISSUED" ? (
                        <>
                          <button className="btn btn-sm" onClick={() => void act(a, "return")}>
                            <RotateCcw size={14} /> Qaytarish
                          </button>
                          <button className="btn btn-sm" onClick={() => void act(a, "lost")}>
                            <X size={14} /> Yo‘qolgan
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="btn btn-sm btn-primary" onClick={() => (setIssue(a), setEmployeeId(""))}>
                            Berish
                          </button>
                          <button className="icon-btn" title="O‘chirish" onClick={() => void api(`/assets/${a.id}`, { method: "DELETE" }).then(() => reload(true)).catch((r) => toast(errorText(r), "error"))}>
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {adding && (
        <Modal title="Aktiv qo‘shish" onClose={() => setAdding(false)} size="narrow">
          <Field label="Nomi">
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Lenovo T14" />
          </Field>
          <div className="form-grid">
            <Field label="Turi">
              <select className="select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {Object.entries(CATEGORY).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Inventar raqami">
              <input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="LT-00291" />
            </Field>
          </div>
          <div className="form-grid">
            <Field label="Soni">
              <input className="input" type="number" min={1} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) || 1 })} />
            </Field>
            <Field label="Darhol berish (ixtiyoriy)">
              <select className="select" value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}>
                <option value="">— omborda qoladi —</option>
                {(people?.items || []).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.firstName} {e.lastName}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="form-actions">
            <button className="btn" onClick={() => setAdding(false)}>
              Bekor qilish
            </button>
            <button className="btn btn-primary" disabled={form.name.trim().length < 2} onClick={() => void create()}>
              Qo‘shish
            </button>
          </div>
        </Modal>
      )}
      {issue && (
        <Modal title={`${issue.name} — kimga berilsin?`} onClose={() => setIssue(null)} size="narrow">
          <Field label="Xodim">
            <select className="select" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Tanlang</option>
              {(people?.items || []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.firstName} {e.lastName}
                </option>
              ))}
            </select>
          </Field>
          <div className="form-actions">
            <button className="btn" onClick={() => setIssue(null)}>
              Bekor qilish
            </button>
            <button className="btn btn-primary" disabled={!employeeId} onClick={() => void act(issue, "issue", { employeeId })}>
              Berish
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------- xodim profilida: HR amallari --- */
type Transfer = { id: string; from: string; to: string; startDate: string; endDate?: string; temporary: boolean; status: string; reason?: string };

export function EmployeeHrActions({ employee, branches, onboardingSteps, onChanged }: { employee: Employee; branches: Branch[]; onboardingSteps: { key: string; label: string; done: boolean; manual?: boolean }[]; onChanged: () => void }) {
  const toast = useToast();
  const { user } = useAuth();
  const hr = Boolean(user && can(user.role, "employees.edit"));
  const it = Boolean(user && can(user.role, "devices.manage"));
  const transfers = useApi<Transfer[]>(`/employees/${employee.id}/transfers`);
  const assets = useApi<Asset[]>(`/employees/${employee.id}/assets`);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ toBranchId: "", startDate: new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10), endDate: "", temporary: false, reason: "" });
  async function toggle(key: string, done: boolean) {
    try {
      await post(`/employees/${employee.id}/onboarding`, { key, done });
      onChanged();
    } catch (reason) {
      toast(errorText(reason), "error");
    }
  }
  async function transfer() {
    try {
      await post(`/employees/${employee.id}/transfer`, { ...form, endDate: form.temporary ? form.endDate : undefined, reason: form.reason || undefined });
      toast(form.temporary ? "Vaqtinchalik o‘tkazish saqlandi — muddat tugagach qaytadi" : "O‘tkazish saqlandi");
      setOpen(false);
      void transfers.reload(true);
      onChanged();
    } catch (reason) {
      toast(errorText(reason), "error");
    }
  }
  async function cancel(t: Transfer) {
    try {
      await post(`/transfers/${t.id}/cancel`, {});
      void transfers.reload(true);
      onChanged();
    } catch (reason) {
      toast(errorText(reason), "error");
    }
  }
  return (
    <div className="lc-extra">
      {(hr || it) && onboardingSteps.some((s) => s.manual) && (
        <section>
          <h3 className="lc-h">Qo‘lda belgilanadigan qadamlar</h3>
          {onboardingSteps
            .filter((s) => s.manual)
            .map((s) => (
              <label key={s.key} className="lc-check">
                <input type="checkbox" checked={s.done} disabled={!hr && s.key !== "itDevice"} onChange={(e) => void toggle(s.key, e.target.checked)} /> {s.label}
              </label>
            ))}
        </section>
      )}
      <section>
        <div className="lc-row">
          <h3 className="lc-h">Filialga o‘tkazish</h3>
          {hr && employee.status === "ACTIVE" && (
            <button className="btn btn-sm" onClick={() => setOpen(true)}>
              <ArrowRightLeft size={14} /> O‘tkazish
            </button>
          )}
        </div>
        {!transfers.data?.length ? (
          <small className="muted">O‘tkazishlar yo‘q</small>
        ) : (
          transfers.data.map((t) => (
            <div key={t.id} className="lc-transfer">
              <span>
                {t.from} → {t.to} · {dmy(t.startDate)}
                {t.endDate ? ` – ${dmy(t.endDate)}` : ""} {t.temporary ? "(vaqtincha)" : ""}
                <small className="muted"> · {{ PLANNED: "rejalangan", ACTIVE: "amalda", DONE: "yakunlangan", CANCELLED: "bekor" }[t.status] || t.status}</small>
              </span>
              {hr && (t.status === "PLANNED" || t.status === "ACTIVE") && (
                <button className="link" onClick={() => void cancel(t)}>
                  Bekor qilish
                </button>
              )}
            </div>
          ))
        )}
      </section>
      <section>
        <h3 className="lc-h">Xodimdagi aktivlar</h3>
        {!assets.data?.length ? (
          <small className="muted">Biriktirilgan aktiv yo‘q</small>
        ) : (
          assets.data.map((a) => (
            <div key={a.id} className="lc-transfer">
              <span>
                {CATEGORY[a.category] || a.category} {a.name}
                {a.code ? ` #${a.code}` : ""}
                {a.quantity > 1 ? ` · ${a.quantity} dona` : ""}
              </span>
            </div>
          ))
        )}
      </section>
      {open && (
        <Modal title="Filialga o‘tkazish" subtitle="Tarix saqlanadi; vaqtinchalik bo‘lsa muddat tugagach avtomatik qaytadi" onClose={() => setOpen(false)} size="narrow">
          <Field label="Qaysi filialga">
            <select className="select" value={form.toBranchId} onChange={(e) => setForm({ ...form, toBranchId: e.target.value })}>
              <option value="">Tanlang</option>
              {branches
                .filter((b) => b.id !== employee.branchId)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </select>
          </Field>
          <label className="reward-switch">
            <input type="checkbox" checked={form.temporary} onChange={(e) => setForm({ ...form, temporary: e.target.checked })} />
            <span>
              <b>Vaqtincha</b>
              <small>Muddat tugagach eski filialiga qaytadi.</small>
            </span>
          </label>
          <div className="form-grid">
            <Field label="Boshlanish">
              <input className="input" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </Field>
            {form.temporary && (
              <Field label="Tugash">
                <input className="input" type="date" min={form.startDate} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
              </Field>
            )}
          </div>
          <Field label="Sabab (ixtiyoriy)">
            <input className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </Field>
          <div className="form-actions">
            <button className="btn" onClick={() => setOpen(false)}>
              Bekor qilish
            </button>
            <button className="btn btn-primary" disabled={!form.toBranchId || (form.temporary && !form.endDate)} onClick={() => void transfer()}>
              Saqlash
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
