import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Building2, Check, ChevronRight, ClipboardCheck, Inbox, ShieldAlert, Smartphone, UserCheck, Users, Wallet, X } from "lucide-react";
import { api, errorText, notifyChange, post } from "../api";
import { useApi, usePolling } from "../hooks";
import { Avatar, Empty, Field, Loading, Modal, PageHeader, Segmented, StatCard, useToast } from "../components/ui";
import { useAuth } from "../auth";
import { can, canAny } from "@/lib/permissions";
import { money } from "@/lib/format";
import { SetupChecklist, type SetupData } from "../components/SetupChecklist";

/*
 * Ish stoli — har bir rol kirganda: «bugun nima qilishim kerak» (Action Center), yagona tasdiqlashlar
 * Inbox’i, direktor uchun Control Center, filial rahbari uchun smena markazi, IT uchun qurilmalar markazi.
 */

type Action = { level: "red" | "orange" | "yellow" | "info"; text: string; count: number; link?: string };
type InboxItem = {
  kind: string;
  id: string;
  label: string;
  title: string;
  sub: string;
  detail?: string;
  urgent: boolean;
  stage?: string;
  photoDataUrl?: string;
  employeeId?: string;
  decide: { method: "POST" | "PATCH"; path: string; rejectPath?: string; approve: Record<string, unknown>; reject: Record<string, unknown> };
};
type Overview = {
  today: { employees: number; planned: number; came: number; late: number; absent: number; notYet: number; noCheckout: number };
  money: { net: number; advance: number; bonus: number; fine: number; overtime: number } | null;
  branches: { id: string; name: string; planned: number; came: number; late: number; absent: number; rate: number }[];
  trend: { date: string; came: number; late: number; absent: number; planned: number }[];
};
type Shift = {
  id: string;
  name: string;
  today: { planned: number; came: number; late: number; absent: number; notYet: number; noCheckout: number };
  window: { start: string; end: string } | null;
  issues: { employeeId: string; name: string; text: string; tone: "bad" | "warn" }[];
  tomorrow: { date: string; planned: number; onLeave: number; required?: number; shortage: number };
};
type Devices = {
  stats: { active: number; pushUnavailable: number; revoked: number; replacement: number; ios: number; android: number; inactive7d: number };
  latest?: string;
  versions: { version: string; count: number; outdated: boolean }[];
  events: { at: string; actor: string; text: string; tone: string; employee: string }[];
};

const DOT: Record<Action["level"], string> = { red: "🔴", orange: "🟠", yellow: "🟡", info: "🔵" };
const time = (iso: string) => new Date(iso).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function WorkspacePage() {
  const { user } = useAuth();
  const role = user?.role || "EMPLOYEE";
  const actions = useApi<{ actions: Action[]; inbox: { total: number; urgent: number } }>("/workspace/actions");
  const overview = useApi<Overview>(can(role, "attendance.view") && role !== "BRANCH_MANAGER" ? "/workspace/overview" : null);
  const shifts = useApi<Shift[]>(role === "BRANCH_MANAGER" ? "/workspace/branch-shift" : null);
  // Yangi kompaniya: sozlash qadamlari (egasi va HR) — «Bosh sahifa» menyudan olib tashlangan.
  const dashboard = useApi<SetupData>(role === "COMPANY_OWNER" || role === "HR_ADMIN" ? "/dashboard?days=7" : null);
  const devices = useApi<Devices>(canAny(role, ["devices.manage"]) && !can(role, "employees.edit") ? "/workspace/devices" : null);
  usePolling(() => {
    void actions.reload(true);
    void overview.reload(true);
    void shifts.reload(true);
  }, 60_000);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const list = (actions.data?.actions || []).filter((a) => !onlyProblems || a.level === "red" || a.level === "orange");

  return (
    <div className="page">
      <PageHeader title="Ish stoli" subtitle={`${user?.name || ""} · bugun nima qilish kerak`} />
      {dashboard.data && <SetupChecklist data={dashboard.data} />}
      {overview.data && <ControlCenter data={overview.data} />}
      {shifts.data?.map((s) => <ShiftCenter key={s.id} shift={s} />)}
      {devices.data && <DeviceCenter data={devices.data} />}
      <div className="ws-grid">
        <section className="card">
          <div className="card-head">
            <h3 className="ws-h">
              <ClipboardCheck size={17} /> Sizning bugungi ishlaringiz
            </h3>
          </div>
          <div className="filters">
            <Segmented<"all" | "problems">
              value={onlyProblems ? "problems" : "all"}
              onChange={(v) => setOnlyProblems(v === "problems")}
              options={[
                { value: "all", label: "Hammasi" },
                { value: "problems", label: "Faqat muammolar" },
              ]}
            />
          </div>
          {actions.loading && !actions.data ? (
            <Loading />
          ) : !list.length ? (
            <Empty icon={Check} title="Hammasi joyida" text="Hozircha e’tibor talab qiladigan ish yo‘q." />
          ) : (
            <div className="ws-actions">
              {list.map((a) => {
                const body = (
                  <>
                    <span className="ws-dot">{DOT[a.level]}</span>
                    <b>{a.count}</b>
                    <span className="ws-text">{a.text}</span>
                    {a.link && <ChevronRight size={16} />}
                  </>
                );
                return a.link ? (
                  <Link key={a.text} to={a.link} className={`ws-action ${a.level}`}>
                    {body}
                  </Link>
                ) : (
                  <div key={a.text} className={`ws-action ${a.level}`}>
                    {body}
                  </div>
                );
              })}
            </div>
          )}
        </section>
        <InboxCard onChanged={() => void actions.reload(true)} />
      </div>
      <DelegationCard />
    </div>
  );
}

/** Yagona tasdiqlashlar: rol va filialga ko‘ra; tur bo‘yicha filtr. */
export function InboxCard({ onChanged, full }: { onChanged?: () => void; full?: boolean }) {
  const toast = useToast();
  const { data, loading, reload, setData } = useApi<InboxItem[]>("/workspace/inbox");
  usePolling(() => void reload(true), 45_000);
  const [kind, setKind] = useState("ALL");
  const [busy, setBusy] = useState<string | null>(null);
  const kinds = useMemo(() => [...new Map((data || []).map((i) => [i.kind, i.label])).entries()], [data]);
  const rows = (data || []).filter((i) => kind === "ALL" || i.kind === kind);
  async function decide(item: InboxItem, approve: boolean) {
    setBusy(item.id);
    try {
      const body = approve ? item.decide.approve : item.decide.reject;
      await api(!approve && item.decide.rejectPath ? item.decide.rejectPath : item.decide.path, { method: item.decide.method, body: JSON.stringify(body) });
      setData((list) => list?.filter((x) => !(x.id === item.id && x.kind === item.kind)) || null);
      toast(`${item.label}: ${item.title} — ${approve ? "tasdiqlandi" : "rad etildi"}`);
      onChanged?.();
      notifyChange("notifications");
      notifyChange("leave");
    } catch (reason) {
      toast(errorText(reason), "error");
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="card">
      <div className="card-head">
        <h3 className="ws-h">
          <Inbox size={17} /> Tasdiqlashlar {data ? <em className="ws-count">{data.length}</em> : null}
        </h3>
        {!full && (
          <Link className="link" to="/inbox">
            Hammasi →
          </Link>
        )}
      </div>
      {kinds.length > 1 && (
        <div className="filters">
          <Segmented<string> value={kind} onChange={setKind} options={[{ value: "ALL", label: "Barchasi", count: data?.length }, ...kinds.map(([k, l]) => ({ value: k, label: l, count: data?.filter((i) => i.kind === k).length }))]} />
        </div>
      )}
      {loading && !data ? (
        <Loading />
      ) : !rows.length ? (
        <Empty icon={Inbox} title="Tasdiqlash kutayotgan narsa yo‘q" />
      ) : (
        <div className="ws-inbox">
          {(full ? rows : rows.slice(0, 8)).map((i) => {
            const [first = "", last = ""] = i.title.split(" ");
            return (
              <article key={`${i.kind}:${i.id}`} className={`ws-item ${i.urgent ? "urgent" : ""}`}>
                <Avatar first={first} last={last} photo={i.photoDataUrl} />
                <div className="ws-item-main">
                  <div className="ws-item-head">
                    <span className="ws-tag">{i.label}</span>
                    {i.urgent && <span className="ws-tag red">Shoshilinch</span>}
                    <b>{i.employeeId ? <Link to={`/employees/${i.employeeId}`}>{i.title}</Link> : i.title}</b>
                  </div>
                  <small>{i.sub}</small>
                  {i.stage && <small className="ws-stage">{i.stage}</small>}
                  {i.detail && <p>«{i.detail}»</p>}
                </div>
                <div className="ws-item-actions">
                  <button className="btn btn-sm btn-primary" disabled={busy === i.id} onClick={() => void decide(i, true)}>
                    <Check size={14} /> Tasdiqlash
                  </button>
                  <button className="btn btn-sm" disabled={busy === i.id} onClick={() => void decide(i, false)}>
                    <X size={14} /> Rad
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function InboxPage() {
  return (
    <div className="page narrow">
      <PageHeader title="Tasdiqlashlar" subtitle="Barcha so‘rovlar bitta joyda — rolingiz ruxsat bergan turlar" />
      <InboxCard full />
    </div>
  );
}

function ControlCenter({ data }: { data: Overview }) {
  const t = data.today;
  const max = Math.max(1, ...data.trend.map((d) => d.planned));
  return (
    <>
      <div className="stat-grid">
        <StatCard label="Xodimlar" value={t.employees} note={`rejada ${t.planned}`} icon={Users} tone="blue" />
        <StatCard label="Keldi" value={t.came} note={`${t.planned ? Math.round((t.came / t.planned) * 100) : 0}% · hali ${t.notYet} kutilmoqda`} icon={Check} tone="green" />
        <StatCard label="Kechikdi" value={t.late} note={`chiqish belgilanmagan: ${t.noCheckout}`} icon={AlertTriangle} tone="amber" />
        <StatCard label="Kelmadi" value={t.absent} note="sababsiz (ta’tildagilar hisobga olinmaydi)" icon={X} tone="red" />
      </div>
      {data.money && (
        <div className="stat-grid">
          <StatCard label="Ish haqi (bu oy)" value={money(data.money.net)} note="qo‘lga beriladi, bugungacha" icon={Wallet} tone="green" />
          <StatCard label="Avans" value={money(data.money.advance)} icon={Wallet} tone="blue" />
          <StatCard label="Bonus va overtime" value={money(data.money.bonus + data.money.overtime)} icon={Wallet} tone="violet" />
          <StatCard label="Jarima" value={money(data.money.fine)} icon={Wallet} tone="amber" />
        </div>
      )}
      <div className="ws-grid">
        <section className="card">
          <div className="card-head">
            <h3 className="ws-h">
              <Building2 size={17} /> Filiallar — bugun
            </h3>
          </div>
          <div className="ws-branches">
            {data.branches.map((b) => (
              <div key={b.id} className="ws-branch">
                <span className="ws-branch-name">{b.name}</span>
                <span className="ws-meter">
                  <i className={b.rate >= 90 ? "ok" : b.rate >= 70 ? "warn" : "bad"} style={{ width: `${b.rate}%` }} />
                </span>
                <span className="ws-branch-num">
                  {b.came}/{b.planned}
                  {b.late ? <small> · {b.late} kech</small> : null}
                  {b.absent ? <small className="bad"> · {b.absent} yo‘q</small> : null}
                </span>
              </div>
            ))}
          </div>
        </section>
        <section className="card card-body">
          <h3 className="ws-h">So‘nggi 14 kun — keldi / kechikdi / kelmadi</h3>
          <div className="ws-trend">
            {data.trend.map((d) => (
              <div key={d.date} className="ws-trend-col" title={`${d.date}: keldi ${d.came}, kechikdi ${d.late}, kelmadi ${d.absent}`}>
                <div className="ws-trend-stack" style={{ height: `${(d.planned / max) * 100}%` }}>
                  <i className="bad" style={{ flex: d.absent }} />
                  <i className="warn" style={{ flex: d.late }} />
                  <i className="ok" style={{ flex: Math.max(0, d.came - d.late) }} />
                </div>
                <small>{d.date.slice(8)}</small>
              </div>
            ))}
          </div>
          <p className="hint">Yashil — vaqtida, sariq — kechikkan, qizil — kelmagan.</p>
        </section>
      </div>
    </>
  );
}

function ShiftCenter({ shift }: { shift: Shift }) {
  const t = shift.today;
  return (
    <section className="card ws-shift">
      <div className="card-head">
        <h3 className="ws-h">
          <Building2 size={17} /> {shift.name} · bugun {shift.window ? `${shift.window.start}–${shift.window.end}` : ""}
        </h3>
      </div>
      <div className="ws-shift-nums">
        <div>
          <b>{t.planned}</b>
          <small>Rejada</small>
        </div>
        <div className="ok">
          <b>{t.came}</b>
          <small>Keldi</small>
        </div>
        <div className="warn">
          <b>{t.late}</b>
          <small>Kechikdi</small>
        </div>
        <div className="bad">
          <b>{t.absent}</b>
          <small>Kelmagan</small>
        </div>
      </div>
      {shift.issues.length > 0 && (
        <div className="ws-issues">
          {shift.issues.map((i) => (
            <Link key={`${i.employeeId}:${i.text}`} to={`/employees/${i.employeeId}`} className={i.tone}>
              ⚠ {i.name} — {i.text}
            </Link>
          ))}
        </div>
      )}
      <div className={`ws-tomorrow ${shift.tomorrow.shortage ? "bad" : ""}`}>
        <b>Ertaga ({shift.tomorrow.date.split("-").reverse().join(".")}):</b> rejada {shift.tomorrow.planned} xodim
        {shift.tomorrow.required ? ` · kerak ${shift.tomorrow.required}` : " · kerakli son belgilanmagan (Filiallar → tahrirlash)"}
        {shift.tomorrow.onLeave ? ` · ta’tilda ${shift.tomorrow.onLeave}` : ""}
        {shift.tomorrow.shortage ? ` · ⚠ ${shift.tomorrow.shortage} xodim yetishmaydi` : shift.tomorrow.required ? " · ✓ tayyor" : ""}
      </div>
    </section>
  );
}

function DeviceCenter({ data }: { data: Devices }) {
  const s = data.stats;
  return (
    <>
      <div className="stat-grid">
        <StatCard label="Faol telefonlar" value={s.active} note={`iOS ${s.ios} · Android ${s.android}`} icon={Smartphone} tone="green" />
        <StatCard label="Push ishlamaydi" value={s.pushUnavailable} note="bildirishnoma bormaydi" icon={AlertTriangle} tone="amber" />
        <StatCard label="Almashtirish so‘rovi" value={s.replacement} note={`7 kunda o‘chirilgan: ${s.revoked}`} icon={ShieldAlert} tone="red" />
        <StatCard label="7 kun faol emas" value={s.inactive7d} note={data.latest ? `oxirgi versiya ${data.latest}` : "versiya ma’lumoti yo‘q"} icon={Smartphone} tone="blue" />
      </div>
      <div className="ws-grid">
        <section className="card card-body">
          <h3 className="ws-h">Ilova versiyalari</h3>
          {data.versions.map((v) => (
            <div key={v.version} className="ws-branch">
              <span className="ws-branch-name">v{v.version}</span>
              <span className="ws-meter">
                <i className={v.outdated ? "warn" : "ok"} style={{ width: `${(v.count / Math.max(1, s.active)) * 100}%` }} />
              </span>
              <span className="ws-branch-num">
                {v.count} {v.outdated ? <small className="bad">eski</small> : null}
              </span>
            </div>
          ))}
          <Link className="btn btn-sm" to="/settings?tab=apps" style={{ marginTop: 10 }}>
            Barcha telefonlar →
          </Link>
        </section>
        <section className="card">
          <div className="card-head">
            <h3 className="ws-h">
              <ShieldAlert size={17} /> Xavfsizlik hodisalari (7 kun)
            </h3>
          </div>
          {!data.events.length ? (
            <Empty icon={ShieldAlert} title="Hodisa yo‘q" />
          ) : (
            <div className="ws-events">
              {data.events.map((e, i) => (
                <div key={i} className={`ws-event ${e.tone}`}>
                  <time>{time(e.at)}</time>
                  <span>
                    {e.text}
                    <small>
                      {e.employee !== "—" ? `${e.employee} · ` : ""}
                      {e.actor}
                    </small>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

/* ---------------------------------------------------- vakolat berish (delegation) --- */
type Delegation = { id: string; fromName: string; toName: string; toUserId: string; fromUserId: string; startDate: string; endDate: string; reason?: string; active: boolean; revokedAt?: string };
function DelegationCard() {
  const toast = useToast();
  const { user } = useAuth();
  const { data, reload } = useApi<{ mine: Delegation[]; all?: Delegation[]; candidates: { id: string; name: string; role: string }[] }>("/delegations");
  const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
  const [form, setForm] = useState({ toUserId: "", startDate: today, endDate: today, reason: "" });
  const [open, setOpen] = useState(false);
  if (!data) return null;
  const list = (data.all || data.mine).filter((d) => !d.revokedAt && d.endDate >= today);
  async function save() {
    try {
      await post("/delegations", { ...form, reason: form.reason || undefined });
      toast("Vakolat berildi — muddat tugashi bilan avtomatik o‘chadi");
      setOpen(false);
      void reload(true);
    } catch (reason) {
      toast(errorText(reason), "error");
    }
  }
  async function revoke(d: Delegation) {
    try {
      await post(`/delegations/${d.id}/revoke`, {});
      void reload(true);
    } catch (reason) {
      toast(errorText(reason), "error");
    }
  }
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="card-head">
        <h3 className="ws-h">
          <UserCheck size={17} /> Vakolat (vaqtincha o‘rinbosar)
        </h3>
        <button className="btn btn-sm" onClick={() => setOpen(true)}>
          Vakolat berish
        </button>
      </div>
      {!list.length ? (
        <p className="muted" style={{ padding: "0 18px 14px", margin: 0 }}>
          Masalan, ta’tilga ketsangiz — tasdiqlash vakolatini boshqa mas’ulga bering. U faqat tasdiqlashlarni (so‘rovlar, ish haqi jarayoni) sizning nomingizdan bajaradi; hammasi auditda.
        </p>
      ) : (
        <div className="ws-actions">
          {list.map((d) => (
            <div key={d.id} className="ws-action">
              <span className="ws-text">
                <b>{d.fromName}</b> → <b>{d.toName}</b> · {d.startDate.split("-").reverse().join(".")} – {d.endDate.split("-").reverse().join(".")}
                {d.active ? " · amalda" : " · rejalangan"}
                {d.reason ? ` · ${d.reason}` : ""}
              </span>
              {(d.fromUserId === user?.userId || user?.role === "COMPANY_OWNER") && (
                <button className="btn btn-sm" onClick={() => void revoke(d)}>
                  Bekor qilish
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {open && (
        <Modal title="Vakolat berish" subtitle="O‘rinbosar faqat tasdiqlashlarni sizning nomingizdan bajaradi (sozlamalar va boshqa bo‘limlarga ta’sir qilmaydi)" onClose={() => setOpen(false)} size="narrow">
          <Field label="Kimga">
            <select className="select" value={form.toUserId} onChange={(e) => setForm({ ...form, toUserId: e.target.value })}>
              <option value="">Tanlang</option>
              {data.candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="Boshlanish">
              <input className="input" type="date" value={form.startDate} min={today} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </Field>
            <Field label="Tugash">
              <input className="input" type="date" value={form.endDate} min={form.startDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </Field>
          </div>
          <Field label="Sabab (ixtiyoriy)">
            <input className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Masalan: ta’til" />
          </Field>
          <div className="form-actions">
            <button className="btn" onClick={() => setOpen(false)}>
              Bekor qilish
            </button>
            <button className="btn btn-primary" disabled={!form.toUserId} onClick={() => void save()}>
              Berish
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
