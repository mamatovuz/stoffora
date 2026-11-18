import { useMemo, useState, type CSSProperties, type FormEvent } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  CircleDollarSign,
  FileCheck2,
  Landmark,
  Plus,
  Scale,
  ShieldCheck,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { errorText, post } from "../api";
import { useApi } from "../hooks";
import { Empty, Status } from "../components/ui";

/*
 * Corporate portal — Staffora ta’sischilari va investorlari uchun.
 * «Umumiy ko‘rinish»: platformaning o‘zi (mijoz kompaniyalar, xodimlar, MRR, tushum, o‘sish) va
 * shaxsiy iqtisodiy manfaat. Qolgan bo‘limlar — korporativ moliya, ulushlar, tasdiqlash va kelishuvlar.
 * Barcha raqamlar serverdan; ruxsat bo‘lmagan bo‘limlar ko‘rinmaydi (server ham tekshiradi).
 */

export type CorporateMe = {
  participant: { id: string; name: string; role: string; status: string; shareBps?: number };
  permissions: string[];
  requiredAgreement: null | { agreementId: string; versionId: string; title: string; version: number };
};
type Platform = {
  generatedAt: string;
  companies: { total: number; active: number; trial: number; suspended: number; newThisMonth: number; paying: number };
  employees: { active: number; newThisMonth: number; checkedInToday: number; branches: number };
  revenue: { mrr: number; arr: number; arpa: number; thisMonth: number; total: number; outstanding: number };
  growth: { month: string; companies: number; employees: number; revenue: number }[];
  companiesGrowthPct: number | null;
  activity: { date: string; employees: number }[];
  plans: { plan: string; companies: number }[];
};
type Dashboard = {
  participants: number;
  investors: number;
  founders: { id: string; name: string; role: string }[];
  finance: { incomeMinor: number; expensesMinor: number; netMinor: number; cashMinor: number; balanced: boolean };
  wallet: { availableMinor: number; reservedMinor: number; distributedMinor: number };
  reserveMinor: number;
  pendingApprovals: number;
  recentTransactions: Transaction[];
  economicInterest?: { version: number; title: string; status?: string; allocations: { id: string; participantId?: string; subject: string; shareBps: number; kind: string }[] };
};
type Participant = { id: string; name: string; email?: string; login?: string; role: string; status: string; shareBps?: number; lastLoginAt?: string };
type Transaction = { id: string; type: string; category: string; amountMinor: number; currency: string; description: string; occurredAt: string; status: string };
type Approval = { id: string; actionType: string; entityType: string; status: string; amountMinor?: number; createdAt: string; expiresAt: string; initiatorParticipantId: string };
type Agreement = { id: string; title: string; type: string; status: string; assignedParticipantIds: string[]; versions: { id: string; version: number; status: string; createdAt: string }[] };

export type CorporateTab = "overview" | "finance" | "ownership" | "approvals" | "agreements" | "participants";
export const roleName: Record<string, string> = {
  FOUNDER: "Founder",
  CO_FOUNDER: "Co-Founder",
  CEO: "CEO",
  INVESTOR: "Investor",
  FINANCE_MANAGER: "Moliya menejeri",
  CORPORATE_ADMIN: "Corporate admin",
  OBSERVER: "Kuzatuvchi",
};
const TX_LABEL: Record<string, string> = {
  INCOME: "Daromad",
  EXPENSE: "Xarajat",
  INVESTMENT: "Investitsiya",
  INVESTMENT_RETURN: "Investitsiya qaytarildi",
  PROFIT_DISTRIBUTION: "Foyda taqsimoti",
  RESERVE_ALLOCATION: "Reserve ajratmasi",
  PAYOUT: "To‘lov",
  REFUND: "Qaytarish",
  ADJUSTMENT: "Tuzatish",
  REVERSAL: "Bekor qilish (reversal)",
};
const ACTION_LABEL: Record<string, string> = { PROFIT_DISTRIBUTION: "Foyda taqsimoti", WITHDRAWAL: "Pul yechish", RESERVE_EXPENSE: "Reserve xarajati" };

const num = (n: number) => Math.round(n).toLocaleString("ru-RU").replace(/[  ]/g, " ");
const som = (value = 0) => `${num(value)} so‘m`;
/** Korporativ ledger — tiyinda (minor unit). */
const minor = (value = 0) => som(value / 100);
const compact = (value: number) => (value >= 1e9 ? `${(value / 1e9).toFixed(1).replace(".", ",")} mlrd` : value >= 1e6 ? `${(value / 1e6).toFixed(1).replace(".", ",")} mln` : num(value));
const dateTime = (value: string) => new Date(value).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const MONTHS = ["yan", "fev", "mar", "apr", "may", "iyn", "iyl", "avg", "sen", "okt", "noy", "dek"];
const monthShort = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;
const pct = (bps = 0) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;
const tooltipStyle = { borderRadius: 10, border: "1px solid var(--line)", fontSize: 12 };

export function CorporateWorkspace({ me, tab }: { me: CorporateMe; tab: CorporateTab }) {
  const can = (permission: string) => me.permissions.includes("*") || me.permissions.includes(permission);
  if (tab === "finance" && can("finance.read")) return <FinanceSection canCreate={can("transactions.create")} />;
  if (tab === "ownership") return <OwnershipSection />;
  if (tab === "approvals") return <ApprovalsSection canDecide={can("approvals.decide")} />;
  if (tab === "agreements" && can("agreements.read")) return <AgreementsSection />;
  if (tab === "participants" && can("participants.read")) return <ParticipantsSection canManage={can("participants.manage")} />;
  return <Overview me={me} />;
}

/* ------------------------------------------------------- umumiy ko‘rinish --- */
function Overview({ me }: { me: CorporateMe }) {
  const platform = useApi<Platform>("/corporate/platform");
  const dashboard = useApi<Dashboard>("/corporate/dashboard");
  const p = platform.data;
  const d = dashboard.data;
  const myAllocation = d?.economicInterest?.allocations.find((a) => a.participantId === me.participant.id);
  const myShare = myAllocation?.shareBps ?? me.participant.shareBps ?? 0;
  const growth = useMemo(() => (p?.growth || []).map((g) => ({ ...g, label: monthShort(g.month) })), [p]);

  if (platform.error) return <div className="notice error">{platform.error}</div>;
  if (!p)
    return (
      <div className="tp-stats">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="tp-card db-sk-card" style={{ height: 96 }} />
        ))}
      </div>
    );
  return (
    <div className="cp-stack">
      <section className="tp-stats" aria-label="Platforma ko‘rsatkichlari">
        <Kpi
          tone="blue"
          icon={Building2}
          label="Mijoz kompaniyalar"
          value={num(p.companies.total)}
          note={`${p.companies.active} faol · ${p.companies.trial} sinovda · bu oy +${p.companies.newThisMonth}`}
          trend={p.companiesGrowthPct}
        />
        <Kpi tone="green" icon={Users} label="Platformadagi xodimlar" value={num(p.employees.active)} note={`Bugun belgilagan ${num(p.employees.checkedInToday)} · ${num(p.employees.branches)} filial`} />
        <Kpi tone="teal" icon={TrendingUp} label="MRR — oylik tushum" value={som(p.revenue.mrr)} note={`ARR ${compact(p.revenue.arr)} so‘m · ${p.companies.paying} ta pullik mijoz`} />
        <Kpi tone="amber" icon={CircleDollarSign} label="Jami tushum" value={som(p.revenue.total)} note={`Bu oy ${compact(p.revenue.thisMonth)} · kutilmoqda ${compact(p.revenue.outstanding)}`} />
      </section>

      <div className="cp-grid-2">
        <section className="tp-card">
          <div className="tp-card-head">
            <div className="tp-title">
              <h2>Platforma o‘sishi</h2>
              <span className="tp-muted">so‘nggi 12 oy</span>
            </div>
            <div className="tp-legend" aria-hidden>
              <span>
                <i style={{ background: "var(--brand)" }} /> Faol xodimlar
              </span>
              <span>
                <i style={{ background: "var(--green)" }} /> Kompaniyalar
              </span>
            </div>
          </div>
          <div className="cp-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={growth} margin={{ left: -6, right: 8, top: 8 }}>
                <defs>
                  <linearGradient id="cpEmp" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "var(--chart-axis)", fontSize: 11 }} />
                <YAxis yAxisId="e" axisLine={false} tickLine={false} width={44} tick={{ fill: "var(--chart-axis)", fontSize: 11 }} allowDecimals={false} />
                <YAxis yAxisId="c" orientation="right" axisLine={false} tickLine={false} width={30} tick={{ fill: "var(--chart-axis)", fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number, name: string) => [num(v), name === "employees" ? "Xodimlar" : "Kompaniyalar"]} />
                <Area yAxisId="e" type="monotone" dataKey="employees" stroke="var(--brand)" strokeWidth={2} fill="url(#cpEmp)" isAnimationActive={false} />
                <Area yAxisId="c" type="monotone" dataKey="companies" stroke="var(--green)" strokeWidth={2} fill="transparent" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="tp-card">
          <div className="tp-card-head">
            <div className="tp-title">
              <h2>Oylik tushum</h2>
              <span className="tp-muted">to‘langan hisoblar, so‘m</span>
            </div>
          </div>
          <div className="cp-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={growth} margin={{ left: -4, right: 8, top: 8 }}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "var(--chart-axis)", fontSize: 11 }} />
                <YAxis axisLine={false} tickLine={false} width={52} tick={{ fill: "var(--chart-axis)", fontSize: 11 }} tickFormatter={(v: number) => compact(v)} />
                <Tooltip cursor={{ fill: "var(--hover-tint)" }} contentStyle={tooltipStyle} formatter={(v: number) => [som(v), "Tushum"]} />
                <Bar dataKey="revenue" fill="var(--brand)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <div className="cp-grid-3">
        <section className="tp-card">
          <div className="tp-card-head">
            <div className="tp-title">
              <h2>Mening ulushim</h2>
            </div>
            <span className="tp-badge blue">{roleName[me.participant.role] || me.participant.role}</span>
          </div>
          <div className="cp-share-body">
            <div className="cp-ring" style={{ "--p": `${myShare / 100}` } as CSSProperties}>
              <b>{pct(myShare)}</b>
              <small>iqtisodiy manfaat</small>
            </div>
            <dl>
              <div>
                <dt>Yechish mumkin</dt>
                <dd>{d ? minor(d.wallet.availableMinor) : "…"}</dd>
              </div>
              <div>
                <dt>Taqsimlangan foyda</dt>
                <dd>{d ? minor(d.wallet.distributedMinor) : "…"}</dd>
              </div>
              <div>
                <dt>Band qilingan</dt>
                <dd>{d ? minor(d.wallet.reservedMinor) : "…"}</dd>
              </div>
            </dl>
          </div>
          <p className="cp-note">
            <Scale size={13} aria-hidden /> Foiz — kelishilgan foyda taqsimoti, rasmiy yuridik egalik emas.
          </p>
        </section>
        <section className="tp-card">
          <div className="tp-card-head">
            <div className="tp-title">
              <h2>Foyda taqsimoti modeli</h2>
              {d?.economicInterest && <span className="tp-muted">v{d.economicInterest.version}</span>}
            </div>
          </div>
          {d?.economicInterest?.allocations.length ? (
            <ul className="cp-alloc">
              {d.economicInterest.allocations.map((a) => (
                <li key={a.id} className={a.participantId === me.participant.id ? "me" : ""}>
                  <span>
                    <b>{a.subject}</b>
                    <small>{a.kind === "RESERVE" ? "Rivojlanish zaxirasi" : a.participantId === me.participant.id ? "Siz" : "Ishtirokchi"}</small>
                  </span>
                  <span className="tp-meter">
                    <i className={a.kind === "RESERVE" ? "amber" : "blue"} style={{ width: `${a.shareBps / 100}%` }} />
                  </span>
                  <strong>{pct(a.shareBps)}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={Scale} title="Taqsimot sxemasi yo‘q" text="Super Admin ishtirokchilarni qo‘shganda sxema avtomatik tuziladi." />
          )}
        </section>
        <section className="tp-card">
          <div className="tp-card-head">
            <div className="tp-title">
              <h2>Tariflar bo‘yicha mijozlar</h2>
            </div>
          </div>
          {p.plans.length ? (
            <ul className="cp-alloc">
              {p.plans.slice(0, 6).map((plan) => (
                <li key={plan.plan}>
                  <span>
                    <b>{plan.plan}</b>
                    <small>{plan.companies} ta kompaniya</small>
                  </span>
                  <span className="tp-meter">
                    <i className="green" style={{ width: `${p.companies.total ? (plan.companies / p.companies.total) * 100 : 0}%` }} />
                  </span>
                  <strong>{p.companies.total ? Math.round((plan.companies / p.companies.total) * 100) : 0}%</strong>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={Building2} title="Mijozlar hali yo‘q" text="Kompaniyalar ulanganda tariflar taqsimoti shu yerda ko‘rinadi." />
          )}
        </section>
      </div>

      <div className="cp-grid-2">
        <section className="tp-card">
          <div className="tp-card-head">
            <div className="tp-title">
              <h2>Kunlik faollik</h2>
              <span className="tp-muted">so‘nggi 30 kunda davomat belgilagan xodimlar</span>
            </div>
          </div>
          <div className="cp-chart sm">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={p.activity} margin={{ left: -6, right: 8, top: 6 }}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: "var(--chart-axis)", fontSize: 10 }} tickFormatter={(v: string) => String(Number(v.slice(8)))} interval={2} />
                <YAxis axisLine={false} tickLine={false} width={40} tick={{ fill: "var(--chart-axis)", fontSize: 11 }} allowDecimals={false} />
                <Tooltip cursor={{ fill: "var(--hover-tint)" }} contentStyle={tooltipStyle} formatter={(v: number) => [num(v), "Xodimlar"]} labelFormatter={(v: string) => v.split("-").reverse().join(".")} />
                <Bar dataKey="employees" fill="var(--green)" radius={[3, 3, 0, 0]} maxBarSize={14} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="tp-card">
          <div className="tp-card-head">
            <div className="tp-title">
              <h2>Korporativ moliya</h2>
              {d && <span className={`tp-badge ${d.finance.balanced ? "green" : "red"}`}>{d.finance.balanced ? "Ledger balansda" : "Tekshiruv kerak"}</span>}
            </div>
          </div>
          {d ? (
            <>
              <div className="cp-mini">
                <div>
                  <small>Daromad</small>
                  <b className="t-green">{minor(d.finance.incomeMinor)}</b>
                </div>
                <div>
                  <small>Xarajat</small>
                  <b className="t-red">{minor(d.finance.expensesMinor)}</b>
                </div>
                <div>
                  <small>Sof natija</small>
                  <b>{minor(d.finance.netMinor)}</b>
                </div>
                <div>
                  <small>Development reserve</small>
                  <b>{minor(d.reserveMinor)}</b>
                </div>
              </div>
              <TransactionRows rows={d.recentTransactions.slice(0, 4)} />
            </>
          ) : (
            <div className="tp-sk-rows">
              <span className="db-sk db-sk-row" />
            </div>
          )}
        </section>
      </div>
      <p className="cp-foot">Ma’lumot {dateTime(p.generatedAt)} holatiga. Mijoz kompaniyalar nomi va xodimlarning shaxsiy ma’lumotlari bu portalda ko‘rsatilmaydi.</p>
    </div>
  );
}

function Kpi({ tone, icon: Icon, label, value, note, trend }: { tone: string; icon: LucideIcon; label: string; value: string; note: string; trend?: number | null }) {
  return (
    <div className={`tp-stat ${tone}`}>
      <span className="tp-stat-icon" aria-hidden>
        <Icon size={18} strokeWidth={1.9} />
      </span>
      <span className="tp-stat-text">
        <small>
          {label}
          {trend !== undefined && trend !== null && (
            <span className={`cp-trend ${trend >= 0 ? "up" : "down"}`}>
              {trend >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
              {Math.abs(trend).toString().replace(".", ",")}%
            </span>
          )}
        </small>
        <strong>{value}</strong>
        <em>{note}</em>
      </span>
    </div>
  );
}

function TransactionRows({ rows }: { rows: Transaction[] }) {
  if (!rows.length) return <p className="cp-empty-tx">Tranzaksiyalar hali yo‘q.</p>;
  return (
    <ul className="cp-tx">
      {rows.map((x) => {
        const outflow = ["EXPENSE", "REFUND", "PAYOUT", "PROFIT_DISTRIBUTION"].includes(x.type);
        return (
          <li key={x.id}>
            <span className={`tp-feed-icon ${outflow ? "red" : "green"}`}>{outflow ? <ArrowDownRight size={13} /> : <ArrowUpRight size={13} />}</span>
            <span className="tp-feed-text">
              <b>{TX_LABEL[x.type] || x.type}</b>
              <small>
                {x.category} · {x.description}
              </small>
            </span>
            <strong className={outflow ? "t-red" : "t-green"}>
              {outflow ? "−" : "+"}
              {minor(x.amountMinor)}
            </strong>
          </li>
        );
      })}
    </ul>
  );
}

/* --------------------------------------------------------------- moliya --- */
function FinanceSection({ canCreate }: { canCreate: boolean }) {
  const transactions = useApi<Transaction[]>("/corporate/transactions");
  const empty = { type: "INCOME", category: "Obuna to‘lovlari", amount: "", description: "" };
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post("/corporate/transactions", { ...form, amountMinor: Math.round(Number(form.amount) * 100), currency: "UZS", idempotencyKey: crypto.randomUUID() });
      setOpen(false);
      setForm(empty);
      await transactions.reload(true);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }
  const rows = transactions.data || [];
  return (
    <section className="tp-card">
      <div className="tp-card-head">
        <div className="tp-title">
          <h2>Korporativ moliya</h2>
          <span className="tp-muted">double-entry ledger · o‘chirish o‘rniga reversal</span>
        </div>
        {canCreate && (
          <button className="btn btn-primary" onClick={() => setOpen(!open)}>
            <Plus size={15} /> Tranzaksiya
          </button>
        )}
      </div>
      {open && (
        <form className="cp-form" onSubmit={(e) => void submit(e)}>
          <label>
            Turi
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {["INCOME", "EXPENSE", "INVESTMENT", "REFUND", "ADJUSTMENT"].map((x) => (
                <option key={x} value={x}>
                  {TX_LABEL[x]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Kategoriya
            <input required value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          </label>
          <label>
            Summa (so‘m)
            <input required type="number" min="1" step="1" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </label>
          <label className="wide">
            Izoh
            <input required minLength={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </label>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? "Yozilmoqda…" : "Ledgerga yozish"}
          </button>
          {error && <div className="notice error wide">{error}</div>}
        </form>
      )}
      {transactions.error ? (
        <div className="notice error cp-pad">{transactions.error}</div>
      ) : (
        <div className="table-wrap tp-table-wrap">
          <table className="tp-table">
            <thead>
              <tr>
                <th>Vaqt</th>
                <th>Turi</th>
                <th>Kategoriya / izoh</th>
                <th>Holat</th>
                <th className="num">Summa</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((x) => (
                  <tr key={x.id}>
                    <td className="tp-muted nowrap">{dateTime(x.occurredAt)}</td>
                    <td>
                      <b>{TX_LABEL[x.type] || x.type}</b>
                    </td>
                    <td className="tp-reason">
                      {x.category} · {x.description}
                    </td>
                    <td>
                      <Status value={x.status} />
                    </td>
                    <td className="num">
                      <b>{minor(x.amountMinor)}</b>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="empty-cell">
                    {transactions.loading ? "Yuklanmoqda…" : "Tranzaksiya hali yo‘q."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* --------------------------------------------------------------- ulushlar --- */
function OwnershipSection() {
  const legal = useApi<{ notice: string; rows: { id: string; holderName: string; shareBps: number; status: string; basis: string }[] }>("/corporate/ownership");
  const economic = useApi<{ notice: string; versions: { id: string; version: number; title: string; status: string; allocations: { id: string; subject: string; shareBps: number; kind: string }[] }[] }>(
    "/corporate/economic-interests",
  );
  const versions = (economic.data?.versions || []).slice().reverse().slice(0, 6);
  return (
    <div className="cp-stack">
      <div className="cp-legal">
        <Scale size={18} aria-hidden />
        <span>
          <b>Uchta alohida tushuncha:</b> tizim roli (portaldagi vakolat), iqtisodiy manfaat (kelishilgan foyda taqsimoti) va yuridik egalik (faqat tasdiqlangan hujjat bilan). Foiz
          o‘z-o‘zidan aksiyadorlik yoki mulk huquqini anglatmaydi.
        </span>
      </div>
      <div className="cp-grid-2">
        <section className="tp-card">
          <div className="tp-card-head">
            <div className="tp-title">
              <h2>Iqtisodiy manfaat</h2>
              <span className="tp-muted">versiyalar tarixi</span>
            </div>
          </div>
          {economic.error ? (
            <div className="notice error cp-pad">{economic.error}</div>
          ) : versions.length ? (
            <div className="cp-versions">
              {versions.map((v) => (
                <article key={v.id}>
                  <header>
                    <b>
                      v{v.version} · {v.title}
                    </b>
                    <Status value={v.status} />
                  </header>
                  <ul className="cp-alloc">
                    {v.allocations.map((a) => (
                      <li key={a.id}>
                        <span>
                          <b>{a.subject}</b>
                          <small>{a.kind === "RESERVE" ? "Rivojlanish zaxirasi" : "Ishtirokchi"}</small>
                        </span>
                        <span className="tp-meter">
                          <i className={a.kind === "RESERVE" ? "amber" : "blue"} style={{ width: `${a.shareBps / 100}%` }} />
                        </span>
                        <strong>{pct(a.shareBps)}</strong>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          ) : (
            <Empty icon={Scale} title="Versiyalar yo‘q" text="Iqtisodiy manfaat sxemasi hali tuzilmagan." />
          )}
        </section>
        <section className="tp-card">
          <div className="tp-card-head">
            <div className="tp-title">
              <h2>Yuridik egalik</h2>
              <span className="tp-muted">hujjat bilan tasdiqlangan yozuvlar</span>
            </div>
          </div>
          {legal.error ? (
            <div className="notice error cp-pad">{legal.error}</div>
          ) : (legal.data?.rows || []).length ? (
            <ul className="cp-alloc">
              {legal.data!.rows.map((x) => (
                <li key={x.id}>
                  <span>
                    <b>{x.holderName}</b>
                    <small>{x.basis}</small>
                  </span>
                  <Status value={x.status} />
                  <strong>{pct(x.shareBps)}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={Landmark} title="Yuridik egalik qayd etilmagan" text="Kompaniya ro‘yxatdan o‘tgach, tasdiqlangan hujjatlar asosida kiritiladi." />
          )}
        </section>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- tasdiqlashlar --- */
function ApprovalsSection({ canDecide }: { canDecide: boolean }) {
  const approvals = useApi<Approval[]>("/corporate/approvals");
  const [error, setError] = useState("");
  async function decide(id: string, decision: "approve" | "reject") {
    setError("");
    try {
      await post(`/corporate/approvals/${id}/${decision}`, {});
      await approvals.reload(true);
    } catch (reason) {
      setError(errorText(reason));
    }
  }
  const rows = approvals.data || [];
  return (
    <section className="tp-card">
      <div className="tp-card-head">
        <div className="tp-title">
          <h2>Tasdiqlash markazi</h2>
          <span className="tp-muted">yuqori xavfli amallarni boshqa vakil tasdiqlaydi (maker-checker)</span>
        </div>
      </div>
      {error && <div className="notice error cp-pad">{error}</div>}
      {!rows.length ? (
        <Empty icon={ShieldCheck} title="So‘rovlar yo‘q" text="Foyda taqsimoti, pul yechish va reserve xarajatlari shu yerda tasdiqlanadi." />
      ) : (
        <div className="table-wrap tp-table-wrap">
          <table className="tp-table">
            <thead>
              <tr>
                <th>Amal</th>
                <th>Yaratilgan</th>
                <th>Muddati</th>
                <th className="num">Summa</th>
                <th>Holat</th>
                <th className="right">Qaror</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.id}>
                  <td>
                    <b>{ACTION_LABEL[x.actionType] || x.actionType.replaceAll("_", " ")}</b>
                  </td>
                  <td className="tp-muted nowrap">{dateTime(x.createdAt)}</td>
                  <td className="tp-muted nowrap">{dateTime(x.expiresAt)}</td>
                  <td className="num">{x.amountMinor !== undefined ? minor(x.amountMinor) : "—"}</td>
                  <td>
                    <Status value={x.status} />
                  </td>
                  <td className="right">
                    {canDecide && ["PENDING", "PARTIALLY_APPROVED"].includes(x.status) ? (
                      <span className="tp-row-actions">
                        <button className="btn btn-sm btn-primary" onClick={() => void decide(x.id, "approve")}>
                          Tasdiqlash
                        </button>
                        <button className="btn btn-sm" onClick={() => void decide(x.id, "reject")}>
                          Rad etish
                        </button>
                      </span>
                    ) : (
                      <span className="tp-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------- kelishuvlar --- */
function AgreementsSection() {
  const agreements = useApi<Agreement[]>("/corporate/agreements");
  const rows = agreements.data || [];
  return (
    <section className="tp-card">
      <div className="tp-card-head">
        <div className="tp-title">
          <h2>Kelishuvlar va versiyalar</h2>
          <span className="tp-muted">final versiya, SHA-256 iz va rozilik auditda saqlanadi</span>
        </div>
      </div>
      {!rows.length ? (
        <Empty icon={FileCheck2} title="Kelishuvlar hali yaratilmagan" text="Founder yoki Corporate admin kelishuv loyihasini qo‘shganda shu yerda ko‘rinadi." />
      ) : (
        <ul className="cp-docs">
          {rows.map((x) => (
            <li key={x.id}>
              <span className="tp-branch-icon">
                <FileCheck2 size={14} />
              </span>
              <span className="tp-feed-text">
                <b>{x.title}</b>
                <small>
                  {x.type} · {x.versions.length} versiya
                </small>
              </span>
              <Status value={x.status} />
              <a className="btn btn-sm" href={`/api/corporate/agreements/${x.id}/pdf`} target="_blank" rel="noreferrer">
                Hujjat
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* --------------------------------------------------------- ishtirokchilar --- */
function ParticipantsSection({ canManage }: { canManage: boolean }) {
  const participants = useApi<Participant[]>("/corporate/participants");
  const rows = participants.data || [];
  return (
    <section className="tp-card">
      <div className="tp-card-head">
        <div className="tp-title">
          <h2>Ishtirokchilar</h2>
          <span className="tp-muted">ta’sischilar, investorlar va boshqaruv</span>
        </div>
        {canManage && <span className="tp-muted">Yangi hisob — Super Admin → Corporate hisoblar</span>}
      </div>
      <div className="table-wrap tp-table-wrap">
        <table className="tp-table">
          <thead>
            <tr>
              <th>Ishtirokchi</th>
              <th>Rol</th>
              <th className="num">Iqtisodiy manfaat</th>
              <th>Oxirgi kirish</th>
              <th>Holat</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((x) => (
                <tr key={x.id}>
                  <td>
                    <span className="tp-person">
                      <span className="avatar sm">
                        {x.name
                          .split(/\s+/)
                          .map((w) => w[0])
                          .slice(0, 2)
                          .join("")
                          .toUpperCase()}
                      </span>
                      <span>
                        <b>{x.name}</b>
                        <small>{x.login ? `@${x.login}` : x.email || "—"}</small>
                      </span>
                    </span>
                  </td>
                  <td>{roleName[x.role] || x.role}</td>
                  <td className="num">{x.shareBps ? pct(x.shareBps) : "—"}</td>
                  <td className="tp-muted nowrap">{x.lastLoginAt ? dateTime(x.lastLoginAt) : "Hali kirmagan"}</td>
                  <td>
                    <Status value={x.status} />
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="empty-cell">
                  {participants.loading ? "Yuklanmoqda…" : "Ishtirokchilar yo‘q."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
