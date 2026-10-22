import { useCallback, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { patch, post } from "../../api";
import { useApi } from "../../hooks";
import { Field, Modal, PageHeader, useToast } from "../../components/ui";
import { MODULES } from "@/lib/modules";
import {
  DataTable,
  DetailDrawer,
  ErrorState,
  FilterBar,
  KeyValue,
  Pager,
  PermissionGuard,
  SearchInput,
  Section,
  Select,
  Skeleton,
  StatusBadge,
  bytes,
  dateOnly,
  dateTime,
  downloadFile,
  money,
  num,
  useAction,
  useServerList,
} from "./kit";
import { ContractUpload } from "./CompanyDetail";

/*
 * Biznes: tariflar (narx/limit/modullar — tahrirlanadi, versiyalanadi), obunalar (muddatlar),
 * hisob-kitob (qo‘lda yuritiladi, «To‘langan» faqat to‘lov dalili bilan), promo kodlar, shartnomalar.
 */

type Plan = { id: string; key: string; name: string; description?: string; price: number | null; currency: string; period: "MONTH" | "YEAR"; limits: { employees?: number | null; branches?: number | null; managers?: number | null }; modules: string[] | "all"; trialDays: number; status: string; version: number; companies: number; updatedAt: string };

const limitText = (v?: number | null) => (v === null || v === undefined ? "∞" : num(v));

function Plans() {
  const { data, error, reload } = useApi<Plan[]>("/super-admin/plans");
  const [edit, setEdit] = useState<Plan | "new" | null>(null);
  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;
  return (
    <>
      <PageHeader
        title="Tariflar"
        subtitle="Narx, limitlar va modullar kodga yozilmagan — shu yerda boshqariladi. O‘zgarish yangi versiya hisoblanadi."
        actions={
          <PermissionGuard perm="plans.manage">
            <button className="btn btn-primary" onClick={() => setEdit("new")}>
              <Plus size={15} /> Tarif
            </button>
          </PermissionGuard>
        }
      />
      {!data ? (
        <Skeleton rows={6} />
      ) : (
        <div className="sa-plan-grid">
          {data.map((p) => (
            <section key={p.id} className={`card sa-plan ${p.status === "ARCHIVED" ? "off" : ""}`}>
              <div className="sa-plan-head">
                <h3>{p.name}</h3>
                <StatusBadge value={p.status} />
              </div>
              <p className="muted">{p.description || "—"}</p>
              <b className="sa-plan-price">{p.price === null ? "Narx belgilanmagan" : `${money(p.price, p.currency)} / ${p.period === "YEAR" ? "yil" : "oy"}`}</b>
              <KeyValue
                items={[
                  ["Xodimlar", limitText(p.limits.employees)],
                  ["Filiallar", limitText(p.limits.branches)],
                  ["Rahbarlar", limitText(p.limits.managers)],
                  ["Modullar", p.modules === "all" ? "Hammasi" : `${p.modules.length} ta`],
                  ["Sinov", p.trialDays ? `${p.trialDays} kun` : "—"],
                  ["Versiya", `v${p.version} · ${dateOnly(p.updatedAt)}`],
                  ["Kompaniyalar", num(p.companies)],
                ]}
              />
              <PermissionGuard perm="plans.manage">
                <button className="btn btn-sm" onClick={() => setEdit(p)}>
                  Tahrirlash
                </button>
              </PermissionGuard>
            </section>
          ))}
        </div>
      )}
      {edit && <PlanModal plan={edit === "new" ? null : edit} onClose={() => setEdit(null)} onSaved={() => (setEdit(null), void reload(true))} />}
    </>
  );
}

function PlanModal({ plan, onClose, onSaved }: { plan: Plan | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    key: plan?.key || "",
    name: plan?.name || "",
    description: plan?.description || "",
    price: plan?.price === null || plan?.price === undefined ? "" : String(plan.price),
    currency: plan?.currency || "UZS",
    period: plan?.period || "MONTH",
    employees: plan?.limits.employees ?? "",
    branches: plan?.limits.branches ?? "",
    managers: plan?.limits.managers ?? "",
    trialDays: String(plan?.trialDays ?? 0),
    allModules: !plan || plan.modules === "all",
    modules: plan && plan.modules !== "all" ? plan.modules : ([] as string[]),
    status: plan?.status || "ACTIVE",
  });
  const lim = (v: string | number | null) => (v === "" || v === null ? null : Number(v));
  return (
    <Modal title={plan ? `${plan.name} — tahrirlash` : "Yangi tarif"} subtitle="Narx, limit yoki modul o‘zgarsa — tarif versiyasi oshadi; shu tarifdagi kompaniyalar limiti yangilanadi" onClose={onClose} size="wide">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const body = {
            ...(plan ? {} : { key: form.key }),
            name: form.name,
            description: form.description || undefined,
            price: form.price === "" ? null : Number(form.price),
            currency: form.currency,
            period: form.period,
            limits: { employees: lim(form.employees), branches: lim(form.branches), managers: lim(form.managers) },
            modules: form.allModules ? "all" : form.modules,
            trialDays: Number(form.trialDays),
            ...(plan ? { status: form.status } : {}),
          };
          try {
            if (plan) await patch(`/super-admin/plans/${plan.id}`, body);
            else await post("/super-admin/plans", body);
            toast("Tarif saqlandi");
            onSaved();
          } catch (reason) {
            toast(reason instanceof Error ? reason.message : "Xatolik", "error");
          }
        }}
      >
        <div className="form-grid cols-3">
          {!plan && (
            <Field label="Kalit (lotin)" hint="masalan: business">
              <input className="input" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} required pattern="[a-z][a-z0-9_-]{1,30}" />
            </Field>
          )}
          <Field label="Nomi">
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} />
          </Field>
          <Field label="Narx" hint="Bo‘sh — belgilanmagan">
            <input className="input" type="number" min={0} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
          </Field>
          <Field label="Valyuta">
            <input className="input" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} maxLength={3} />
          </Field>
          <Field label="Hisob davri">
            <select className="select" value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value as "MONTH" | "YEAR" })}>
              <option value="MONTH">Oylik</option>
              <option value="YEAR">Yillik</option>
            </select>
          </Field>
          <Field label="Sinov (kun)">
            <input className="input" type="number" min={0} max={365} value={form.trialDays} onChange={(e) => setForm({ ...form, trialDays: e.target.value })} />
          </Field>
          <Field label="Maks. xodimlar" hint="Bo‘sh — cheklovsiz">
            <input className="input" type="number" min={0} value={form.employees ?? ""} onChange={(e) => setForm({ ...form, employees: e.target.value })} />
          </Field>
          <Field label="Maks. filiallar">
            <input className="input" type="number" min={0} value={form.branches ?? ""} onChange={(e) => setForm({ ...form, branches: e.target.value })} />
          </Field>
          <Field label="Maks. rahbarlar">
            <input className="input" type="number" min={0} value={form.managers ?? ""} onChange={(e) => setForm({ ...form, managers: e.target.value })} />
          </Field>
          {plan && (
            <Field label="Holat">
              <select className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="ACTIVE">Faol</option>
                <option value="ARCHIVED">Arxiv (yangi kompaniyalarga berilmaydi)</option>
              </select>
            </Field>
          )}
        </div>
        <Field label="Tavsif">
          <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <label className="sa-check">
          <input type="checkbox" checked={form.allModules} onChange={(e) => setForm({ ...form, allModules: e.target.checked })} /> Barcha modullar
        </label>
        {!form.allModules && (
          <div className="sa-multi cols">
            {MODULES.map((m) => (
              <label key={m.key} className="sa-check">
                <input type="checkbox" checked={form.modules.includes(m.key)} onChange={(e) => setForm({ ...form, modules: e.target.checked ? [...form.modules, m.key] : form.modules.filter((x) => x !== m.key) })} /> {m.label}
              </label>
            ))}
          </div>
        )}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Bekor qilish
          </button>
          <button className="btn btn-primary">Saqlash</button>
        </div>
      </form>
    </Modal>
  );
}

type SubRow = { companyId: string; company: string; plan: string; status: string; periodEnd: string | null; daysLeft: number | null; free: boolean; manual: boolean; startedAt: string | null; employeeLimit: number | null };
function Subscriptions() {
  const [state, setState] = useState({ q: "", status: "", expiring: "", page: 1 });
  const { data, loading, error, reload } = useServerList<SubRow, { counts: Record<string, number> }>("/super-admin/subscriptions", { ...state, pageSize: 30 });
  const onQuery = useCallback((q: string) => setState((s) => ({ ...s, q, page: 1 })), []);
  return (
    <>
      <PageHeader title="Obunalar" subtitle="Muddat tugashi ma’lumotni o‘chirmaydi. Ogohlantirishlar (7/3/1 kun) global sozlamalarda yoqiladi." />
      {data && (
        <div className="sa-chipline">
          {Object.entries(data.counts).map(([status, n]) => (
            <button key={status} className={`sa-chip ${state.status === status ? "on" : ""}`} onClick={() => setState({ ...state, status: state.status === status ? "" : status, page: 1 })}>
              <StatusBadge value={status} /> <b>{n}</b>
            </button>
          ))}
        </div>
      )}
      <Section>
        <FilterBar>
          <SearchInput value={state.q} onChange={onQuery} placeholder="Kompaniya…" />
          <Select
            label="Tugashi"
            value={state.expiring}
            onChange={(expiring) => setState({ ...state, expiring, page: 1 })}
            options={[
              ["", "Har qanday muddat"],
              ["7", "7 kun ichida tugaydi"],
              ["30", "30 kun ichida tugaydi"],
            ]}
          />
        </FilterBar>
        <DataTable
          rows={data?.rows}
          rowKey={(r) => r.companyId}
          loading={loading}
          error={error}
          onRetry={() => void reload()}
          columns={[
            { key: "c", label: "Kompaniya", render: (r) => <Link to={`/super-admin/companies/${r.companyId}/plan`}><b>{r.company}</b></Link> },
            { key: "p", label: "Tarif", render: (r) => `${r.plan}${r.free ? " · bepul" : ""}` },
            { key: "s", label: "Holat", render: (r) => <StatusBadge value={r.status} /> },
            { key: "e", label: "Tugash", render: (r) => (r.periodEnd ? `${dateOnly(r.periodEnd)}${r.daysLeft !== null ? ` · ${r.daysLeft} kun` : ""}` : "Muddatsiz") },
            { key: "l", label: "Xodim limiti", className: "num", hideOnMobile: true, render: (r) => limitText(r.employeeLimit) },
          ]}
        />
        {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => setState({ ...state, page })} />}
      </Section>
    </>
  );
}

type Bill = { id: string; number: string; company: string; companyId: string; planName?: string; periodStart: string; periodEnd: string; amount: number; discount?: number; currency: string; promoCode?: string; status: string; dueDate?: string; paidAt?: string; paymentReference?: string; paymentMethod?: string; confirmedBy?: string; note?: string; history: { at: string; by: string; status: string; note?: string }[]; createdAt: string };
function Billing() {
  const [params] = useSearchParams();
  const [state, setState] = useState({ q: "", status: "", companyId: params.get("companyId") || "", page: 1 });
  const { data, loading, error, reload } = useServerList<Bill, { summary: Record<string, { paid: number; outstanding: number; overdue: number }> }>("/super-admin/billing", { ...state, pageSize: 30 });
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Bill | null>(null);
  const onQuery = useCallback((q: string) => setState((s) => ({ ...s, q, page: 1 })), []);
  return (
    <>
      <PageHeader
        title="Hisob-kitob"
        subtitle="To‘lov provayderi ulanmagan: qo‘lda yuritiladigan hisob-faktura. «To‘langan» — faqat to‘lov dalili bilan."
        actions={
          <PermissionGuard perm="billing.manage">
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus size={15} /> Hisob-faktura
            </button>
          </PermissionGuard>
        }
      />
      {data && (
        <div className="sa-chipline">
          {Object.entries(data.summary).map(([currency, s]) => (
            <span key={currency} className="sa-sum">
              <small>{currency}</small>
              <b>To‘langan {money(s.paid, currency)}</b>
              <span>Kutilmoqda {money(s.outstanding, currency)}</span>
              <span className="bad">Muddati o‘tgan {money(s.overdue, currency)}</span>
            </span>
          ))}
        </div>
      )}
      <Section>
        <FilterBar>
          <SearchInput value={state.q} onChange={onQuery} placeholder="Raqam, kompaniya, to‘lov dalili…" />
          <Select
            label="Holat"
            value={state.status}
            onChange={(status) => setState({ ...state, status, page: 1 })}
            options={[
              ["", "Barcha holatlar"],
              ["DRAFT", "Qoralama"],
              ["ISSUED", "Chiqarilgan"],
              ["OVERDUE", "Muddati o‘tgan"],
              ["PAID", "To‘langan"],
              ["VOID", "Bekor"],
            ]}
          />
          {state.companyId && (
            <button className="btn btn-sm" onClick={() => setState({ ...state, companyId: "", page: 1 })}>
              Kompaniya filtrini olib tashlash
            </button>
          )}
        </FilterBar>
        <DataTable
          rows={data?.rows}
          rowKey={(r) => r.id}
          loading={loading}
          error={error}
          onRetry={() => void reload()}
          onRowClick={setOpen}
          columns={[
            { key: "n", label: "Raqam", render: (r) => <b>{r.number}</b> },
            { key: "c", label: "Kompaniya", render: (r) => r.company },
            { key: "p", label: "Davr", hideOnMobile: true, render: (r) => `${dateOnly(r.periodStart)} — ${dateOnly(r.periodEnd)}` },
            { key: "a", label: "Summa", className: "num", render: (r) => <span>{money(r.amount - (r.discount || 0), r.currency)}{r.discount ? <small className="muted"> (−{num(r.discount)})</small> : null}</span> },
            { key: "s", label: "Holat", render: (r) => <StatusBadge value={r.status} /> },
            { key: "d", label: "To‘lov muddati", hideOnMobile: true, render: (r) => dateOnly(r.dueDate) },
          ]}
        />
        {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => setState({ ...state, page })} />}
      </Section>
      {creating && <CreateBill defaultCompanyId={state.companyId} onClose={() => setCreating(false)} onDone={() => (setCreating(false), void reload(true))} />}
      {open && <BillDrawer bill={open} onClose={() => setOpen(null)} onChanged={(b) => (setOpen(b), void reload(true))} />}
    </>
  );
}

function CreateBill({ defaultCompanyId, onClose, onDone }: { defaultCompanyId: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { data: companies } = useApi<{ rows: { id: string; name: string }[] }>("/super-admin/companies?pageSize=200&view=all");
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ companyId: defaultCompanyId, periodStart: today, periodEnd: today, amount: "", currency: "UZS", dueDate: "", note: "", issue: false });
  return (
    <Modal title="Yangi hisob-faktura" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await post("/super-admin/billing", { ...form, amount: Number(form.amount) });
            toast("Hisob-faktura yaratildi");
            onDone();
          } catch (reason) {
            toast(reason instanceof Error ? reason.message : "Xatolik", "error");
          }
        }}
      >
        <Field label="Kompaniya">
          <select className="select" value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })} required>
            <option value="">Tanlang</option>
            {(companies?.rows || []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="form-grid">
          <Field label="Davr boshi">
            <input className="input" type="date" value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} required />
          </Field>
          <Field label="Davr oxiri">
            <input className="input" type="date" value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} required />
          </Field>
          <Field label="Summa">
            <input className="input" type="number" min={0} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          </Field>
          <Field label="Valyuta">
            <input className="input" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} maxLength={3} />
          </Field>
          <Field label="To‘lov muddati">
            <input className="input" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
          </Field>
        </div>
        <Field label="Izoh">
          <input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </Field>
        <label className="sa-check">
          <input type="checkbox" checked={form.issue} onChange={(e) => setForm({ ...form, issue: e.target.checked })} /> Darhol chiqarish (aks holda qoralama)
        </label>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Bekor qilish
          </button>
          <button className="btn btn-primary">Yaratish</button>
        </div>
      </form>
    </Modal>
  );
}

function BillDrawer({ bill, onClose, onChanged }: { bill: Bill; onClose: () => void; onChanged: (b: Bill) => void }) {
  const toast = useToast();
  const run = useAction();
  const [paying, setPaying] = useState(false);
  const [proof, setProof] = useState({ paymentReference: "", paymentMethod: "Bank o‘tkazmasi", paidAt: new Date().toISOString().slice(0, 10), note: "" });
  const setStatus = async (status: string, extra: Record<string, unknown> = {}) => {
    const result = await run(() => post<Bill>(`/super-admin/billing/${bill.id}/status`, { status, ...extra }), toast, "Holat yangilandi");
    if (result) onChanged({ ...bill, ...result });
  };
  const allowed: Record<string, string[]> = { DRAFT: ["ISSUED", "VOID"], ISSUED: ["PAID", "VOID", "OVERDUE"], OVERDUE: ["PAID", "VOID"], PAID: ["VOID"], VOID: [] };
  return (
    <DetailDrawer title={bill.number} subtitle={`${bill.company} · ${bill.planName || ""}`} onClose={onClose}>
      <KeyValue
        items={[
          ["Holat", <StatusBadge key="s" value={bill.status} />],
          ["Davr", `${dateOnly(bill.periodStart)} — ${dateOnly(bill.periodEnd)}`],
          ["Summa", money(bill.amount, bill.currency)],
          ["Chegirma", bill.discount ? `${money(bill.discount, bill.currency)} (${bill.promoCode})` : "—"],
          ["To‘lov muddati", dateOnly(bill.dueDate)],
          ["To‘langan", bill.paidAt ? `${dateTime(bill.paidAt)} · ${bill.paymentMethod || ""}` : "—"],
          ["To‘lov dalili", bill.paymentReference || "—"],
          ["Tasdiqlagan", bill.confirmedBy || "—"],
          ["Izoh", bill.note || "—"],
        ]}
      />
      <PermissionGuard perm="billing.manage">
        <div className="sa-actions-grid">
          {allowed[bill.status].includes("ISSUED") && (
            <button className="btn" onClick={() => setStatus("ISSUED")}>
              Chiqarish
            </button>
          )}
          {allowed[bill.status].includes("PAID") && (
            <button className="btn btn-primary" onClick={() => setPaying(true)}>
              To‘lovni tasdiqlash
            </button>
          )}
          {allowed[bill.status].includes("OVERDUE") && (
            <button className="btn" onClick={() => setStatus("OVERDUE")}>
              Muddati o‘tgan
            </button>
          )}
          {allowed[bill.status].includes("VOID") && (
            <button className="btn btn-danger" onClick={() => setStatus("VOID", { note: "Bekor qilindi" })}>
              Bekor qilish
            </button>
          )}
        </div>
      </PermissionGuard>
      {paying && (
        <div className="sa-inline-form">
          <p className="muted">To‘lov haqiqatda tushganini tasdiqlovchi hujjat yoki tranzaksiya raqamini kiriting.</p>
          <div className="form-grid">
            <Field label="To‘lov dalili (raqam) *">
              <input className="input" value={proof.paymentReference} onChange={(e) => setProof({ ...proof, paymentReference: e.target.value })} />
            </Field>
            <Field label="Usul">
              <input className="input" value={proof.paymentMethod} onChange={(e) => setProof({ ...proof, paymentMethod: e.target.value })} />
            </Field>
            <Field label="Sana">
              <input className="input" type="date" value={proof.paidAt} onChange={(e) => setProof({ ...proof, paidAt: e.target.value })} />
            </Field>
          </div>
          <div className="form-actions">
            <button className="btn" onClick={() => setPaying(false)}>
              Bekor qilish
            </button>
            <button className="btn btn-primary" disabled={proof.paymentReference.trim().length < 3} onClick={() => setStatus("PAID", { ...proof, paidAt: `${proof.paidAt}T12:00:00+05:00` }).then(() => setPaying(false))}>
              Tasdiqlash
            </button>
          </div>
        </div>
      )}
      <h4 className="sa-sub">Tarix</h4>
      <ul className="sa-checks">
        {bill.history.map((h, i) => (
          <li key={i}>
            <StatusBadge value={h.status} />
            <span>
              <b>{h.by}</b>
              <small>
                {dateTime(h.at)}
                {h.note ? ` · ${h.note}` : ""}
              </small>
            </span>
          </li>
        ))}
      </ul>
    </DetailDrawer>
  );
}

type Promo = { id: string; code: string; description?: string; kind: string; value: number; currency?: string; planId?: string; expiresAt?: string; usageLimit?: number; perCompanyLimit: number; companyIds?: string[]; status: string; used: number; effect: string; redemptions: number; createdAt: string; createdBy: string };
function Promos() {
  const toast = useToast();
  const run = useAction();
  const { data, error, reload } = useApi<Promo[]>("/super-admin/promos");
  const { data: plans } = useApi<{ id: string; name: string }[]>("/super-admin/plans");
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Promo | null>(null);
  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;
  return (
    <>
      <PageHeader
        title="Promo kodlar"
        subtitle="Har bir kod kompaniyaga cheklangan marta — tekshiruv va ishlatish bitta tranzaksiyada"
        actions={
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Plus size={15} /> Promo kod
          </button>
        }
      />
      <Section>
        <DataTable
          rows={data || undefined}
          rowKey={(r) => r.id}
          loading={!data}
          onRowClick={setOpen}
          columns={[
            { key: "c", label: "Kod", render: (r) => <code className="sa-code">{r.code}</code> },
            { key: "e", label: "Ta’siri", render: (r) => r.effect },
            { key: "u", label: "Ishlatilgan", className: "num", render: (r) => `${r.used}${r.usageLimit ? ` / ${r.usageLimit}` : ""}` },
            { key: "x", label: "Muddati", render: (r) => dateOnly(r.expiresAt) },
            { key: "s", label: "Holat", render: (r) => <StatusBadge value={r.status} /> },
            {
              key: "a",
              label: "",
              render: (r) => (
                <button className="btn btn-sm" onClick={(e) => (e.stopPropagation(), run(() => patch(`/super-admin/promos/${r.id}`, { status: r.status === "ACTIVE" ? "DISABLED" : "ACTIVE" }), toast, "Saqlandi").then(() => reload(true)))}>
                  {r.status === "ACTIVE" ? "O‘chirish" : "Yoqish"}
                </button>
              ),
            },
          ]}
        />
      </Section>
      {creating && <CreatePromo plans={plans || []} onClose={() => setCreating(false)} onDone={() => (setCreating(false), void reload(true))} />}
      {open && <PromoDrawer promo={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function CreatePromo({ plans, onClose, onDone }: { plans: { id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ code: "", description: "", kind: "TRIAL_EXTENSION", value: "14", currency: "UZS", planId: "", expiresAt: "", usageLimit: "", perCompanyLimit: "1" });
  return (
    <Modal title="Yangi promo kod" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await post("/super-admin/promos", {
              code: form.code,
              description: form.description || undefined,
              kind: form.kind,
              value: Number(form.value),
              currency: form.kind === "FIXED" ? form.currency : undefined,
              planId: form.planId || undefined,
              expiresAt: form.expiresAt || undefined,
              usageLimit: form.usageLimit ? Number(form.usageLimit) : undefined,
              perCompanyLimit: Number(form.perCompanyLimit) || 1,
            });
            toast("Promo kod yaratildi");
            onDone();
          } catch (reason) {
            toast(reason instanceof Error ? reason.message : "Xatolik", "error");
          }
        }}
      >
        <div className="form-grid">
          <Field label="Kod">
            <input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} required minLength={3} />
          </Field>
          <Field label="Turi">
            <select className="select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="TRIAL_EXTENSION">Sinovni uzaytirish (kun)</option>
              <option value="FREE_PLAN">Bepul tarif (kun)</option>
              <option value="PERCENT">Foiz chegirma</option>
              <option value="FIXED">Qat’iy chegirma</option>
            </select>
          </Field>
          <Field label={form.kind === "PERCENT" ? "Foiz" : form.kind === "FIXED" ? "Summa" : "Kunlar"}>
            <input className="input" type="number" min={1} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} required />
          </Field>
          {(form.kind === "FREE_PLAN" || form.kind === "PERCENT" || form.kind === "FIXED") && (
            <Field label={form.kind === "FREE_PLAN" ? "Tarif *" : "Faqat shu tarif uchun"}>
              <select className="select" value={form.planId} onChange={(e) => setForm({ ...form, planId: e.target.value })} required={form.kind === "FREE_PLAN"}>
                <option value="">{form.kind === "FREE_PLAN" ? "Tanlang" : "Har qanday"}</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Amal qilish muddati">
            <input className="input" type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
          </Field>
          <Field label="Jami ishlatish chegarasi" hint="Bo‘sh — cheklovsiz">
            <input className="input" type="number" min={1} value={form.usageLimit} onChange={(e) => setForm({ ...form, usageLimit: e.target.value })} />
          </Field>
          <Field label="Har kompaniya uchun">
            <input className="input" type="number" min={1} max={100} value={form.perCompanyLimit} onChange={(e) => setForm({ ...form, perCompanyLimit: e.target.value })} />
          </Field>
        </div>
        <Field label="Tavsif">
          <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Bekor qilish
          </button>
          <button className="btn btn-primary">Yaratish</button>
        </div>
      </form>
    </Modal>
  );
}

function PromoDrawer({ promo, onClose }: { promo: Promo; onClose: () => void }) {
  const { data } = useApi<{ id: string; company: string; at: string; by: string; effect: string }[]>(`/super-admin/promos/${promo.id}/redemptions`);
  return (
    <DetailDrawer title={promo.code} subtitle={promo.effect} onClose={onClose}>
      <KeyValue
        items={[
          ["Holat", <StatusBadge key="s" value={promo.status} />],
          ["Ishlatilgan", `${promo.used}${promo.usageLimit ? ` / ${promo.usageLimit}` : ""}`],
          ["Har kompaniya uchun", String(promo.perCompanyLimit)],
          ["Muddati", dateOnly(promo.expiresAt)],
          ["Yaratgan", `${promo.createdBy} · ${dateTime(promo.createdAt)}`],
        ]}
      />
      <h4 className="sa-sub">Ishlatilish tarixi</h4>
      <DataTable
        rows={data || undefined}
        rowKey={(r) => r.id}
        loading={!data}
        empty={<p className="muted">Hali ishlatilmagan</p>}
        columns={[
          { key: "c", label: "Kompaniya", render: (r) => r.company },
          { key: "e", label: "Natija", render: (r) => r.effect },
          { key: "a", label: "Vaqt", render: (r) => `${dateTime(r.at)} · ${r.by}` },
        ]}
      />
    </DetailDrawer>
  );
}

type Contract = { id: string; companyId: string; company: string; groupId: string; version: number; type: string; title: string; number?: string; startsAt?: string; endsAt?: string; status: string; fileName: string; size: number; uploadedBy: string; createdAt: string; expired: boolean };
function Contracts() {
  const toast = useToast();
  const run = useAction();
  const [expiring, setExpiring] = useState("");
  const { data, error, reload } = useApi<Contract[]>(`/super-admin/contracts${expiring ? `?expiring=${expiring}` : ""}`);
  const { data: companies } = useApi<{ rows: { id: string; name: string }[] }>("/super-admin/companies?pageSize=200&view=all");
  const [upload, setUpload] = useState<string | null>(null);
  const [pick, setPick] = useState("");
  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;
  return (
    <>
      <PageHeader
        title="Shartnomalar"
        subtitle="Fayllar yopiq saqlanadi, yuklab olish faqat ruxsatli administratorga va auditga yoziladi"
        actions={
          <PermissionGuard perm="contracts.manage">
            <select className="select" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Kompaniya">
              <option value="">Kompaniya…</option>
              {(companies?.rows || []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button className="btn btn-primary" disabled={!pick} onClick={() => setUpload(pick)}>
              <Plus size={15} /> Yuklash
            </button>
          </PermissionGuard>
        }
      />
      <Section>
        <FilterBar>
          <Select
            label="Muddat"
            value={expiring}
            onChange={setExpiring}
            options={[
              ["", "Barcha shartnomalar"],
              ["30", "30 kun ichida tugaydi"],
              ["90", "90 kun ichida tugaydi"],
            ]}
          />
        </FilterBar>
        <DataTable
          rows={data || undefined}
          rowKey={(r) => r.id}
          loading={!data}
          columns={[
            { key: "c", label: "Kompaniya", render: (r) => <Link to={`/super-admin/companies/${r.companyId}/plan`}>{r.company}</Link> },
            { key: "t", label: "Shartnoma", render: (r) => <span className="stack"><b>{r.title} · v{r.version}</b><small>{r.number || r.type} · {bytes(r.size)}</small></span> },
            { key: "d", label: "Muddat", render: (r) => (r.endsAt ? `${dateOnly(r.startsAt)} — ${dateOnly(r.endsAt)}` : "—") },
            { key: "s", label: "Holat", render: (r) => <StatusBadge value={r.expired && r.status === "ACTIVE" ? "EXPIRED" : r.status} /> },
            {
              key: "a",
              label: "",
              render: (r) => (
                <button className="btn btn-sm" onClick={() => run(() => downloadFile(`/super-admin/contracts/${r.id}/file`, r.fileName), toast)}>
                  Yuklab olish
                </button>
              ),
            },
          ]}
        />
      </Section>
      {upload && <ContractUpload companyId={upload} onClose={() => setUpload(null)} onDone={() => (setUpload(null), void reload(true))} />}
    </>
  );
}

export default function BusinessPages({ view }: { view: string }) {
  if (view === "subscriptions") return <Subscriptions />;
  if (view === "billing") return <Billing />;
  if (view === "promos") return <Promos />;
  if (view === "contracts") return <Contracts />;
  return <Plans />;
}
