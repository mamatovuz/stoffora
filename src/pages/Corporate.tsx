import { useMemo, useState, type FormEvent } from "react";
import { Building2, CircleDollarSign, FileCheck2, Landmark, Plus, RefreshCw, Scale, ShieldCheck, Users } from "lucide-react";
import { api, errorText, post } from "../api";
import { useApi } from "../hooks";
import { PageHeader, Status } from "../components/ui";

type Me = { participant: { id: string; name: string; role: string; status: string }; permissions: string[]; requiredAgreement: null | { agreementId: string; versionId: string; title: string; version: number } };
type Dashboard = { participants: number; investors: number; founders: { id: string; name: string; role: string }[]; finance: { incomeMinor: number; expensesMinor: number; netMinor: number; cashMinor: number; balanced: boolean }; wallet: { availableMinor: number; reservedMinor: number; distributedMinor: number }; reserveMinor: number; pendingApprovals: number; recentTransactions: Transaction[]; economicInterest?: { version: number; title: string; allocations: { id: string; subject: string; shareBps: number; kind: string }[] }; legalNotice: string };
type Participant = { id: string; name: string; email?: string; role: string; status: string };
type Transaction = { id: string; type: string; category: string; amountMinor: number; currency: string; description: string; occurredAt: string; status: string };
type Approval = { id: string; actionType: string; entityType: string; status: string; amountMinor?: number; createdAt: string; expiresAt: string; initiatorParticipantId: string };
type Agreement = { id: string; title: string; type: string; status: string; assignedParticipantIds: string[]; versions: { id: string; version: number; status: string; createdAt: string }[] };

const money = (value = 0) => `${new Intl.NumberFormat("uz-UZ").format(Math.round(value / 100))} so‘m`;
const date = (value: string) => new Date(value).toLocaleString("uz-UZ", { dateStyle: "medium", timeStyle: "short" });
const roleName: Record<string, string> = { FOUNDER: "Founder", CO_FOUNDER: "Co-Founder", CEO: "CEO", INVESTOR: "Investor", FINANCE_MANAGER: "Finance Manager", CORPORATE_ADMIN: "Corporate Admin", OBSERVER: "Observer" };

export function CorporatePage() {
  const [tab, setTab] = useState("overview");
  const me = useApi<Me>("/corporate/me");
  const dashboard = useApi<Dashboard>(me.data ? "/corporate/dashboard" : null);
  const participants = useApi<Participant[]>(me.data?.permissions.includes("participants.read") ? "/corporate/participants" : null);
  const transactions = useApi<Transaction[]>(me.data?.permissions.includes("finance.read") ? "/corporate/transactions" : null);
  const approvals = useApi<Approval[]>(me.data ? "/corporate/approvals" : null);
  const agreements = useApi<Agreement[]>(me.data?.permissions.includes("agreements.read") ? "/corporate/agreements" : null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const reload = async () => Promise.all([me.reload(true), dashboard.reload(true), participants.reload(true), transactions.reload(true), approvals.reload(true), agreements.reload(true)]);
  async function run(action: () => Promise<unknown>, ok: string) { setError(""); setMessage(""); try { await action(); setMessage(ok); await reload(); } catch (reason) { setError(errorText(reason)); } }

  if (me.loading) return <div className="page"><div className="card empty-state">Corporate Management yuklanmoqda…</div></div>;
  if (me.error) return <div className="page"><PageHeader title="Corporate Management" subtitle="Ta’sischilar, iqtisodiy manfaatlar va korporativ moliya" /><div className="notice error">{me.error}</div></div>;
  const tabs = [
    ["overview", "Xulosa", Building2], ["participants", "Ishtirokchilar", Users], ["finance", "Moliya", CircleDollarSign],
    ["approvals", "Tasdiqlashlar", ShieldCheck], ["agreements", "Kelishuvlar", FileCheck2], ["ownership", "Ulushlar", Scale],
  ] as const;
  return <div className="page corporate-page">
    <PageHeader title="Corporate Management" subtitle={`${me.data?.participant.name} · ${roleName[me.data?.participant.role || ""] || me.data?.participant.role}`} actions={<><a className="btn" href="/api/corporate/reports.xlsx">Excel</a><a className="btn" href="/api/corporate/reports.pdf" target="_blank" rel="noreferrer">PDF</a><button className="btn" onClick={() => void reload()}><RefreshCw size={15}/> Yangilash</button></>} />
    <div className="corporate-legal"><Scale size={18}/><span><b>Huquqiy eslatma:</b> tizimdagi rol va economic interest rasmiy yuridik egalikni avtomatik anglatmaydi. Yuridik egalik faqat tasdiqlangan hujjat bilan qayd etiladi.</span></div>
    {me.data?.requiredAgreement && <AgreementGate item={me.data.requiredAgreement} onDone={() => void reload()} />}
    {message && <div className="notice success">{message}</div>}{error && <div className="notice error">{error}</div>}
    <nav className="corporate-tabs">{tabs.map(([key,label,Icon]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}><Icon size={16}/>{label}</button>)}</nav>
    {tab === "overview" && <Overview data={dashboard.data} />}
    {tab === "participants" && <Participants rows={participants.data || []} canManage={Boolean(me.data?.permissions.includes("participants.manage"))} onCreate={(payload) => run(() => post("/corporate/participants", payload), "Ishtirokchi qo‘shildi.")} />}
    {tab === "finance" && <Finance rows={transactions.data || []} canCreate={Boolean(me.data?.permissions.includes("transactions.create"))} onCreate={(payload) => run(() => post("/corporate/transactions", payload), "Tranzaksiya ledgerga yozildi.")} />}
    {tab === "approvals" && <Approvals rows={approvals.data || []} canDecide={Boolean(me.data?.permissions.includes("approvals.decide"))} onDecision={(id, decision) => run(() => post(`/corporate/approvals/${id}/${decision}`, {}), decision === "approve" ? "So‘rov tasdiqlandi." : "So‘rov rad etildi.")} />}
    {tab === "agreements" && <Agreements rows={agreements.data || []} />}
    {tab === "ownership" && <Ownership me={me.data!} />}
  </div>;
}

function Overview({ data }: { data: Dashboard | null }) {
  if (!data) return <div className="card empty-state">Ma’lumot yuklanmoqda…</div>;
  const cards = [["Jami ishtirokchi", data.participants, "faol korporativ profil"], ["Sof natija", money(data.finance.netMinor), `Daromad ${money(data.finance.incomeMinor)}`], ["Mening hamyonim", money(data.wallet.availableMinor), `Band qilingan ${money(data.wallet.reservedMinor)}`], ["Development reserve", money(data.reserveMinor), `${data.pendingApprovals} ta ochiq approval`]];
  return <div className="corporate-stack"><div className="corp-kpis">{cards.map(([title,value,note]) => <article className="corp-kpi" key={title}><small>{title}</small><strong>{value}</strong><span>{note}</span></article>)}</div>
    <div className="corp-grid"><section className="card"><h3>Economic interest</h3><p className="muted">Foyda taqsimoti modeli — yuridik ulush emas.</p>{data.economicInterest ? <><div className="corp-version">v{data.economicInterest.version} · {data.economicInterest.title}</div><div className="allocation-list">{data.economicInterest.allocations.map((row) => <div key={row.id}><span>{row.subject}<small>{row.kind === "RESERVE" ? "Development reserve" : "Participant"}</small></span><b>{(row.shareBps / 100).toFixed(0)}%</b></div>)}</div></> : <p>Sxema topilmadi.</p>}</section>
    <section className="card"><div className="card-head"><h3>So‘nggi tranzaksiyalar</h3><span className={`badge ${data.finance.balanced ? "green" : "red"}`}>{data.finance.balanced ? "Ledger balansda" : "Tekshiruv kerak"}</span></div><TransactionTable rows={data.recentTransactions}/></section></div></div>;
}

function Participants({ rows, canManage, onCreate }: { rows: Participant[]; canManage: boolean; onCreate: (payload: unknown) => Promise<void> }) {
  const [open,setOpen] = useState(false); const [form,setForm] = useState({ name:"", email:"", role:"CO_FOUNDER" });
  return <section className="card"><div className="card-head"><div><h3>Korporativ ishtirokchilar</h3><p className="muted">Tizim roli, majburiyat va ruxsatlarni boshqaradi.</p></div>{canManage && <button className="btn btn-primary" onClick={() => setOpen(!open)}><Plus size={15}/> Ishtirokchi</button>}</div>
    {open && <form className="corp-inline-form" onSubmit={(e) => { e.preventDefault(); void onCreate(form).then(() => { setOpen(false); setForm({name:"",email:"",role:"CO_FOUNDER"}); }); }}><label>Ism<input required value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})}/></label><label>Email<input type="email" value={form.email} onChange={(e)=>setForm({...form,email:e.target.value})}/></label><label>Rol<select value={form.role} onChange={(e)=>setForm({...form,role:e.target.value})}>{["CO_FOUNDER","CEO","INVESTOR","FINANCE_MANAGER","CORPORATE_ADMIN","OBSERVER"].map((x)=><option key={x} value={x}>{roleName[x]}</option>)}</select></label><button className="btn btn-primary" type="submit">Saqlash</button></form>}
    <div className="table-wrap"><table><thead><tr><th>Ishtirokchi</th><th>Rol</th><th>Holat</th></tr></thead><tbody>{rows.map((row)=><tr key={row.id}><td><b>{row.name}</b><small>{row.email || "Foydalanuvchi bog‘lanmagan"}</small></td><td>{roleName[row.role] || row.role}</td><td><Status value={row.status}/></td></tr>)}</tbody></table></div></section>;
}

function Finance({ rows, canCreate, onCreate }: { rows: Transaction[]; canCreate: boolean; onCreate: (payload: unknown) => Promise<void> }) {
  const [open,setOpen]=useState(false); const [form,setForm]=useState({type:"INCOME",category:"Savdo",amount:"",description:""});
  async function submit(e:FormEvent){e.preventDefault(); await onCreate({...form,amountMinor:Math.round(Number(form.amount)*100),currency:"UZS",idempotencyKey:crypto.randomUUID()});setOpen(false);setForm({type:"INCOME",category:"Savdo",amount:"",description:""});}
  return <section className="card"><div className="card-head"><div><h3>Korporativ moliya</h3><p className="muted">Har bir yozuv double-entry ledgerda balanslanadi; o‘chirish o‘rniga reversal ishlatiladi.</p></div>{canCreate&&<button className="btn btn-primary" onClick={()=>setOpen(!open)}><Plus size={15}/> Tranzaksiya</button>}</div>
    {open&&<form className="corp-inline-form" onSubmit={(e)=>void submit(e)}><label>Turi<select value={form.type} onChange={(e)=>setForm({...form,type:e.target.value})}>{["INCOME","EXPENSE","INVESTMENT","REFUND","ADJUSTMENT"].map(x=><option key={x}>{x}</option>)}</select></label><label>Kategoriya<input required value={form.category} onChange={(e)=>setForm({...form,category:e.target.value})}/></label><label>Summa (so‘m)<input required type="number" min="1" value={form.amount} onChange={(e)=>setForm({...form,amount:e.target.value})}/></label><label>Izoh<input required value={form.description} onChange={(e)=>setForm({...form,description:e.target.value})}/></label><button className="btn btn-primary" type="submit">Ledgerga yozish</button></form>}
    <TransactionTable rows={rows}/></section>;
}

function TransactionTable({rows}:{rows:Transaction[]}){return <div className="table-wrap"><table><thead><tr><th>Vaqt</th><th>Turi / kategoriya</th><th>Holat</th><th className="right">Summa</th></tr></thead><tbody>{rows.length?rows.map(x=><tr key={x.id}><td>{date(x.occurredAt)}</td><td><b>{x.type}</b><small>{x.category} · {x.description}</small></td><td><Status value={x.status}/></td><td className="right"><b>{money(x.amountMinor)}</b></td></tr>):<tr><td colSpan={4} className="empty-cell">Tranzaksiya hali yo‘q.</td></tr>}</tbody></table></div>}

function Approvals({ rows, canDecide, onDecision }:{rows:Approval[];canDecide:boolean;onDecision:(id:string,d:"approve"|"reject")=>Promise<void>}) { return <section className="card"><div className="card-head"><div><h3>Tasdiqlash markazi</h3><p className="muted">Yuqori xavfli amallar maker-checker qoidasi bilan boshqa vakil tomonidan tasdiqlanadi.</p></div></div><div className="approval-list">{rows.length?rows.map(x=><article key={x.id}><div><b>{x.actionType.replaceAll("_"," ")}</b><small>{x.entityType} · {date(x.createdAt)} · muddati {date(x.expiresAt)}</small>{x.amountMinor!==undefined&&<strong>{money(x.amountMinor)}</strong>}</div><Status value={x.status}/>{canDecide&&["PENDING","PARTIALLY_APPROVED"].includes(x.status)&&<div className="row-actions"><button className="btn btn-sm btn-primary" onClick={()=>void onDecision(x.id,"approve")}>Tasdiqlash</button><button className="btn btn-sm" onClick={()=>void onDecision(x.id,"reject")}>Rad etish</button></div>}</article>):<div className="empty-state">Approval so‘rovlari yo‘q.</div>}</div></section> }

function Agreements({rows}:{rows:Agreement[]}) { return <section className="card"><div className="card-head"><div><h3>Kelishuvlar va versiyalar</h3><p className="muted">Final versiya, SHA-256 iz va foydalanuvchi roziligi auditda saqlanadi.</p></div></div><div className="agreement-list">{rows.length?rows.map(x=><article key={x.id}><FileCheck2/><div><b>{x.title}</b><small>{x.type} · {x.versions.length} versiya</small></div><Status value={x.status}/><a className="btn btn-sm" href={`/api/corporate/agreements/${x.id}/pdf`} target="_blank" rel="noreferrer">Hujjat</a></article>):<div className="empty-state">Kelishuvlar hali yaratilmagan.</div>}</div></section> }

function Ownership({me}:{me:Me}) { const legal=useApi<{notice:string;rows:{id:string;holderName:string;shareBps:number;status:string;basis:string}[]}>("/corporate/ownership"); const economic=useApi<{notice:string;versions:{id:string;version:number;title:string;status:string;allocations:{id:string;subject:string;shareBps:number;kind:string}[]}[]}>("/corporate/economic-interests"); return <div className="corp-grid"><section className="card"><h3>Legal ownership</h3><p className="muted">{legal.data?.notice}</p>{legal.data?.rows.map(x=><div className="ownership-row" key={x.id}><span><b>{x.holderName}</b><small>{x.basis}</small></span><strong>{(x.shareBps/100).toFixed(2)}%</strong><Status value={x.status}/></div>)||<div className="empty-state">Yuklanmoqda…</div>}</section><section className="card"><h3>Economic interest</h3><p className="muted">{economic.data?.notice}</p>{economic.data?.versions.map(v=><div className="economic-version" key={v.id}><div><b>v{v.version} · {v.title}</b><Status value={v.status}/></div>{v.allocations.map(x=><div className="ownership-row" key={x.id}><span>{x.subject}<small>{x.kind}</small></span><strong>{(x.shareBps/100).toFixed(2)}%</strong></div>)}</div>)}</section></div> }

function AgreementGate({item,onDone}:{item:NonNullable<Me["requiredAgreement"]>;onDone:()=>void}) { const [busy,setBusy]=useState(false); const [error,setError]=useState(""); async function accept(){setBusy(true);setError("");try{await post("/corporate/agreements/accept",{agreementId:item.agreementId,versionId:item.versionId});onDone();}catch(e){setError(errorText(e));}finally{setBusy(false)}} return <div className="agreement-gate"><Landmark/><div><b>Kelishuvni qabul qilish talab qilinadi</b><span>{item.title} · v{item.version}. Rozilikdan keyin 48 soat ichida qaytarib olish so‘rovi yuborish mumkin.</span>{error&&<small>{error}</small>}</div><a className="btn" href={`/api/corporate/agreements/${item.agreementId}/pdf?versionId=${item.versionId}`} target="_blank" rel="noreferrer">O‘qish</a><button className="btn btn-primary" disabled={busy} onClick={()=>void accept()}>{busy?"Saqlanmoqda…":"Qabul qilaman"}</button></div> }
