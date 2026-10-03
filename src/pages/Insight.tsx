import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, Bot, Building2, ChevronLeft, ChevronRight, Network, Play, Plus, Trash2, UserRound, Zap } from "lucide-react";
import { api, errorText, post, put } from "../api";
import { useApi } from "../hooks";
import { useAuth } from "../auth";
import { can } from "@/lib/permissions";
import { Empty, ErrorBox, Field, Loading, Modal, PageHeader, Segmented, StatCard, useToast } from "../components/ui";

/* Tashkiliy tuzilma, kunlik faoliyat lentasi va avtomatlashtirish qoidalari. */

/* ========================================================== tuzilma === */
type Person = { id: string; name: string; photoDataUrl?: string; position: string; branch: string };
type Dept = { id: string; name: string; parentId: string | null; head: Person | null; count: number; positions: { id: string; name: string; people: Person[] }[] };
type Org = { company: string; total: number; unassigned: number; departments: Dept[]; branches: { id: string; name: string; count: number; managers: Person[] }[] };

const Avatar = ({ p }: { p: Person }) => (p.photoDataUrl ? <img className="org-av" src={p.photoDataUrl} alt="" /> : <span className="org-av">{p.name.slice(0, 1)}</span>);

export function OrgChartPage() {
  const toast = useToast();
  const { user } = useAuth();
  const editable = Boolean(user && can(user.role, "employees.edit"));
  const { data, loading, error, reload } = useApi<Org>("/org/tree");
  const [view, setView] = useState<"departments" | "branches">("departments");
  const [editing, setEditing] = useState<Dept | null>(null);
  const [open, setOpen] = useState<string[]>([]);
  const children = (parent: string | null) => (data?.departments || []).filter((d) => d.parentId === parent);
  const toggle = (id: string) => setOpen(open.includes(id) ? open.filter((x) => x !== id) : [...open, id]);

  function Node({ d }: { d: Dept }) {
    const kids = children(d.id);
    const expanded = open.includes(d.id);
    return (
      <li>
        <div className="org-node">
          <button className="org-card" onClick={() => toggle(d.id)}>
            <b>{d.name}</b>
            {d.head ? (
              <span className="org-head">
                <Avatar p={d.head} /> {d.head.name}
              </span>
            ) : (
              <small className="muted">Rahbar tayinlanmagan</small>
            )}
            <small className="muted">
              {d.count} xodim · {d.positions.length} lavozim
            </small>
          </button>
          {editable && (
            <button className="btn btn-sm org-edit" onClick={() => setEditing(d)}>
              Sozlash
            </button>
          )}
        </div>
        {expanded && (
          <div className="org-positions">
            {d.positions.map((p) => (
              <div key={p.id} className="org-pos">
                <b>
                  {p.name} <small className="muted">· {p.people.length}</small>
                </b>
                <div className="org-people">
                  {p.people.slice(0, 12).map((x) => (
                    <Link key={x.id} to={`/employees/${x.id}`} className="org-person" title={`${x.name} · ${x.branch}`}>
                      <Avatar p={x} />
                      <span>{x.name}</span>
                    </Link>
                  ))}
                  {p.people.length > 12 && <small className="muted">va yana {p.people.length - 12}</small>}
                </div>
              </div>
            ))}
          </div>
        )}
        {kids.length > 0 && (
          <ul className="org-tree">
            {kids.map((k) => (
              <Node key={k.id} d={k} />
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="Tashkiliy tuzilma"
        subtitle="Bo‘limlar ierarxiyasi, rahbarlar, lavozimlar va xodimlar; filiallar va ularning rahbarlari."
        actions={
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: "departments", label: "Bo‘limlar" },
              { value: "branches", label: "Filiallar" },
            ]}
          />
        }
      />
      {loading && !data ? (
        <Loading />
      ) : error || !data ? (
        <ErrorBox message={error || "Ma’lumot yo‘q"} />
      ) : (
        <>
          <div className="stat-grid">
            <StatCard label="Faol xodimlar" value={data.total} icon={UserRound} tone="blue" />
            <StatCard label="Bo‘limlar" value={data.departments.length} icon={Network} tone="violet" />
            <StatCard label="Filiallar" value={data.branches.length} icon={Building2} tone="green" />
            <StatCard label="Bo‘limsiz xodim" value={data.unassigned} icon={UserRound} tone={data.unassigned ? "amber" : undefined} />
          </div>
          {view === "departments" ? (
            <section className="card org-wrap">
              <div className="org-root">
                <b>{data.company}</b>
              </div>
              {!data.departments.length ? (
                <Empty icon={Network} title="Bo‘limlar yo‘q" text="Avval «Bo‘limlar» sahifasida bo‘lim qo‘shing." />
              ) : (
                <ul className="org-tree top">
                  {children(null).map((d) => (
                    <Node key={d.id} d={d} />
                  ))}
                </ul>
              )}
            </section>
          ) : (
            <div className="org-branches">
              {data.branches.map((b) => (
                <section key={b.id} className="card org-branch">
                  <b>{b.name}</b>
                  <small className="muted">{b.count} xodim</small>
                  {b.managers.length ? (
                    b.managers.map((m) => (
                      <Link key={m.id} to={`/employees/${m.id}`} className="org-person">
                        <Avatar p={m} />
                        <span>
                          {m.name}
                          <small className="muted block">{m.position || "Filial rahbari"}</small>
                        </span>
                      </Link>
                    ))
                  ) : (
                    <small className="muted">Rahbar tayinlanmagan — «Filiallar» sahifasida tayinlang</small>
                  )}
                </section>
              ))}
            </div>
          )}
        </>
      )}
      {editing && data && (
        <DeptModal
          dept={editing}
          all={data.departments}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            toast("Saqlandi");
            void reload(true);
          }}
        />
      )}
    </div>
  );
}

function DeptModal({ dept, all, onClose, onDone }: { dept: Dept; all: Dept[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { data: people } = useApi<{ items: { id: string; firstName: string; lastName: string }[] }>("/employees?limit=500&status=ACTIVE");
  const [parentId, setParentId] = useState(dept.parentId || "");
  const [headId, setHeadId] = useState(dept.head?.id || "");
  async function save() {
    try {
      await put(`/org/departments/${dept.id}`, { parentId: parentId || null, headEmployeeId: headId || null });
      onDone();
    } catch (reason) {
      toast(errorText(reason), "error");
    }
  }
  return (
    <Modal title={dept.name} subtitle="Bo‘lim o‘rni va rahbari" onClose={onClose} size="narrow">
      <Field label="Yuqori bo‘lim">
        <select className="select" value={parentId} onChange={(e) => setParentId(e.target.value)}>
          <option value="">— Eng yuqori (kompaniyaga bo‘ysunadi)</option>
          {all
            .filter((d) => d.id !== dept.id)
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
        </select>
      </Field>
      <Field label="Bo‘lim rahbari">
        <select className="select" value={headId} onChange={(e) => setHeadId(e.target.value)}>
          <option value="">— Tayinlanmagan</option>
          {(people?.items || []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.firstName} {p.lastName}
            </option>
          ))}
        </select>
      </Field>
      <div className="form-actions">
        <button className="btn" onClick={onClose}>
          Bekor qilish
        </button>
        <button className="btn btn-primary" onClick={() => void save()}>
          Saqlash
        </button>
      </div>
    </Modal>
  );
}

/* =================================================== faoliyat lentasi === */
type Feed = { date: string; counts: Record<string, number>; events: { at: string; kind: string; title: string; sub?: string; employeeId?: string; tone?: string }[] };
const KIND: Record<string, string> = { checkin: "Kelish", checkout: "Ketish", request: "So‘rovlar", decision: "Qarorlar", task: "Vazifalar", incident: "Hodisalar", announcement: "E’lonlar", audit: "Amallar" };
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tashkent" });

export function ActivityPage() {
  const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [branchId, setBranchId] = useState("");
  const [kind, setKind] = useState("");
  const { data: branches } = useApi<{ id: string; name: string }[]>("/branches");
  const { data, loading, error } = useApi<Feed>(`/activity?date=${date}${branchId ? `&branchId=${branchId}` : ""}`);
  const events = (data?.events || []).filter((e) => !kind || e.kind === kind);
  return (
    <div className="page narrow">
      <PageHeader
        title="Faoliyat lentasi"
        subtitle="Kun davomida nima bo‘ldi: kelish-ketish, so‘rovlar va qarorlar, vazifalar, hodisalar, e’lonlar va panel amallari."
        actions={
          <>
            <select className="select" style={{ maxWidth: 200 }} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">Barcha filiallar</option>
              {(branches || []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <div className="date-nav">
              <button className="icon-btn" onClick={() => setDate(addDays(date, -1))} aria-label="Oldingi kun">
                <ChevronLeft size={16} />
              </button>
              <input type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} />
              <button className="icon-btn" onClick={() => setDate(addDays(date, 1))} disabled={date >= today} aria-label="Keyingi kun">
                <ChevronRight size={16} />
              </button>
            </div>
          </>
        }
      />
      {data && (
        <div className="ops-chips" style={{ marginBottom: 14 }}>
          <button className={`chip ${!kind ? "on" : ""}`} onClick={() => setKind("")}>
            Hammasi · {data.events.length}
          </button>
          {Object.entries(data.counts).map(([k, n]) => (
            <button key={k} className={`chip ${kind === k ? "on" : ""}`} onClick={() => setKind(kind === k ? "" : k)}>
              {KIND[k] || k} · {n}
            </button>
          ))}
        </div>
      )}
      <section className="card">
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <div className="card-body">
            <ErrorBox message={error} />
          </div>
        ) : !events.length ? (
          <Empty icon={Activity} title="Bu kunda faoliyat yo‘q" />
        ) : (
          <ol className="act-list">
            {events.map((e, i) => (
              <li key={i} className={`act ${e.tone || "info"}`}>
                <time>{clock(e.at)}</time>
                <i />
                <span>
                  {e.employeeId ? (
                    <Link to={`/employees/${e.employeeId}`}>
                      <b>{e.title}</b>
                    </Link>
                  ) : (
                    <b>{e.title}</b>
                  )}
                  {e.sub && <small>{e.sub}</small>}
                </span>
                <em>{KIND[e.kind] || e.kind}</em>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

/* ================================================ avtomatlashtirish === */
type Rule = {
  id: string;
  name: string;
  active: boolean;
  trigger: string;
  conditions: { minutes?: number; count?: number; days?: number; branchIds?: string[] };
  actions: { type: string; message?: string; amount?: number }[];
  lastRunAt?: string;
  runs?: number;
};
type RulesData = { rules: Rule[]; triggers: Record<string, { label: string; hint: string }>; actions: Record<string, string>; templates: Omit<Rule, "id">[]; defaults: Record<string, string> };

export function AutomationPage() {
  const toast = useToast();
  const { data, loading, error, reload } = useApi<RulesData>("/rules");
  const { data: runs, reload: reloadRuns } = useApi<{ id: string; at: string; rule: string; summary: string }[]>("/rules/runs");
  const [editing, setEditing] = useState<Rule | Omit<Rule, "id"> | null>(null);
  async function toggle(r: Rule) {
    try {
      await put(`/rules/${r.id}`, { ...r, active: !r.active });
      void reload(true);
    } catch (reason) {
      toast(errorText(reason), "error");
    }
  }
  const unused = useMemo(() => (data?.templates || []).filter((t) => !(data?.rules || []).some((r) => r.name === t.name)), [data]);
  return (
    <div className="page">
      <PageHeader
        title="Avtomatlashtirish"
        subtitle="«AGAR … BO‘LSA → SHUNI QIL» qoidalari: har 10 daqiqada tekshiriladi, har hodisaga bir marta ishlaydi. Jarima faqat TAKLIF bo‘ladi — HR tasdiqlaydi."
        actions={
          <button className="btn btn-primary" onClick={() => setEditing({ name: "", active: true, trigger: "LATE", conditions: { minutes: 15, branchIds: [] }, actions: [{ type: "NOTIFY_MANAGER" }] })}>
            <Plus size={16} /> Qoida
          </button>
        }
      />
      {loading && !data ? (
        <Loading />
      ) : error || !data ? (
        <ErrorBox message={error || "Ma’lumot yo‘q"} />
      ) : (
        <>
          {unused.length > 0 && (
            <section className="card rl-templates">
              <b>Tayyor namunalar</b>
              <div className="rl-tpl-list">
                {unused.map((t) => (
                  <button key={t.name} className="rl-tpl" onClick={() => setEditing(t)}>
                    <Zap size={15} /> {t.name}
                  </button>
                ))}
              </div>
            </section>
          )}
          <section className="card">
            {!data.rules.length ? (
              <Empty icon={Bot} title="Qoidalar yo‘q" text="Namunadan birini tanlang yoki «Qoida» bilan o‘zingiz yarating." />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Qoida</th>
                      <th>AGAR</th>
                      <th>SHUNI QIL</th>
                      <th>Ishladi</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.rules.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <b>{r.name}</b>
                        </td>
                        <td>
                          {data.triggers[r.trigger]?.label}
                          <small className="muted block">{[r.conditions.minutes ? `${r.conditions.minutes} daq` : "", r.conditions.days ? `${r.conditions.days} kun` : "", r.conditions.count ? `${r.conditions.count} marta` : "", r.conditions.branchIds?.length ? `${r.conditions.branchIds.length} filial` : "barcha filial"].filter(Boolean).join(" · ")}</small>
                        </td>
                        <td>{r.actions.map((a) => data.actions[a.type]).join(", ")}</td>
                        <td>
                          {r.runs || 0} marta
                          {r.lastRunAt && <small className="muted block">{new Date(r.lastRunAt).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent" }).slice(0, 17)}</small>}
                        </td>
                        <td className="actions">
                          <label className="switch" title={r.active ? "O‘chirish" : "Yoqish"}>
                            <input type="checkbox" checked={r.active} onChange={() => void toggle(r)} />
                            <span />
                          </label>
                          <button className="btn btn-sm" onClick={() => setEditing(r)}>
                            Tahrirlash
                          </button>
                          <button className="icon-btn" onClick={() => confirm(`«${r.name}» o‘chirilsinmi?`) && void api(`/rules/${r.id}`, { method: "DELETE" }).then(() => reload(true))}>
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="card" style={{ marginTop: 16 }}>
            <div className="card-head">
              <b>Jurnal</b>
            </div>
            {!runs?.length ? (
              <p className="muted" style={{ padding: "0 18px 16px" }}>
                Hali hech bir qoida ishlamagan.
              </p>
            ) : (
              <ol className="act-list">
                {runs.slice(0, 60).map((r) => (
                  <li key={r.id} className="act info">
                    <time>{new Date(r.at).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent" }).slice(0, 17)}</time>
                    <i />
                    <span>
                      <b>{r.rule}</b>
                      <small>{r.summary}</small>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
      {editing && data && (
        <RuleModal
          rule={editing}
          meta={data}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            toast("Qoida saqlandi");
            void reload(true);
            void reloadRuns(true);
          }}
        />
      )}
    </div>
  );
}

function RuleModal({ rule, meta, onClose, onDone }: { rule: Rule | Omit<Rule, "id">; meta: RulesData; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { data: branches } = useApi<{ id: string; name: string }[]>("/branches");
  const [form, setForm] = useState({ name: rule.name, active: rule.active, trigger: rule.trigger, conditions: { branchIds: [], ...rule.conditions } as Rule["conditions"] & { branchIds: string[] }, actions: rule.actions });
  const [preview, setPreview] = useState<{ count: number; sample: string[] } | null>(null);
  const needs = { minutes: ["LATE", "ABSENT", "NO_CHECKOUT", "INCIDENT_HIGH"].includes(form.trigger), days: ["LATE_STREAK", "DOC_EXPIRING"].includes(form.trigger), count: form.trigger === "LATE_STREAK" };
  const body = () => ({
    ...form,
    conditions: { branchIds: form.conditions.branchIds, ...(needs.minutes ? { minutes: form.conditions.minutes || 15 } : {}), ...(needs.days ? { days: form.conditions.days || 7 } : {}), ...(needs.count ? { count: form.conditions.count || 3 } : {}) },
    actions: form.actions.map((a) => ({ type: a.type, message: a.message?.trim() || undefined, amount: a.type === "PROPOSE_FINE" ? Number(a.amount) || 0 : undefined })),
  });
  async function save() {
    try {
      if ("id" in rule) await put(`/rules/${rule.id}`, body());
      else await post("/rules", body());
      onDone();
    } catch (reason) {
      toast(errorText(reason), "error");
    }
  }
  async function test() {
    try {
      setPreview(await post<{ count: number; sample: string[] }>("/rules/preview", body()));
    } catch (reason) {
      toast(errorText(reason), "error");
    }
  }
  const setAction = (i: number, patch: Partial<Rule["actions"][number]>) => setForm({ ...form, actions: form.actions.map((a, k) => (k === i ? { ...a, ...patch } : a)) });
  return (
    <Modal title={"id" in rule ? "Qoidani tahrirlash" : "Yangi qoida"} onClose={onClose} size="wide">
      <Field label="Nomi">
        <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Masalan: 15 daqiqadan ko‘p kechiksa — rahbarga" />
      </Field>
      <div className="rl-if">
        <span className="rl-tag">AGAR</span>
        <select className="select" value={form.trigger} onChange={(e) => (setForm({ ...form, trigger: e.target.value }), setPreview(null))}>
          {Object.entries(meta.triggers).map(([k, t]) => (
            <option key={k} value={k}>
              {t.label}
            </option>
          ))}
        </select>
        {needs.minutes && (
          <label className="rl-num">
            <input className="input" type="number" min={1} value={form.conditions.minutes || ""} onChange={(e) => setForm({ ...form, conditions: { ...form.conditions, minutes: Number(e.target.value) || undefined } })} /> daqiqa
          </label>
        )}
        {needs.count && (
          <label className="rl-num">
            <input className="input" type="number" min={1} value={form.conditions.count || ""} onChange={(e) => setForm({ ...form, conditions: { ...form.conditions, count: Number(e.target.value) || undefined } })} /> marta
          </label>
        )}
        {needs.days && (
          <label className="rl-num">
            <input className="input" type="number" min={1} value={form.conditions.days || ""} onChange={(e) => setForm({ ...form, conditions: { ...form.conditions, days: Number(e.target.value) || undefined } })} /> kun
          </label>
        )}
      </div>
      <p className="muted" style={{ marginTop: -4 }}>
        {meta.triggers[form.trigger]?.hint}
      </p>
      <Field label="Filiallar (tanlanmasa — barchasi)">
        <div className="ops-chips">
          {(branches || []).map((b) => (
            <button key={b.id} type="button" className={`chip ${form.conditions.branchIds.includes(b.id) ? "on" : ""}`} onClick={() => setForm({ ...form, conditions: { ...form.conditions, branchIds: form.conditions.branchIds.includes(b.id) ? form.conditions.branchIds.filter((x) => x !== b.id) : [...form.conditions.branchIds, b.id] } })}>
              {b.name}
            </button>
          ))}
        </div>
      </Field>
      <div className="rl-then">
        <span className="rl-tag then">SHUNI QIL</span>
        {form.actions.map((a, i) => (
          <div key={i} className="rl-action">
            <select className="select" value={a.type} onChange={(e) => setAction(i, { type: e.target.value })}>
              {Object.entries(meta.actions).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
            {a.type === "PROPOSE_FINE" ? (
              <input className="input" type="number" min={0} step={1000} value={a.amount || ""} onChange={(e) => setAction(i, { amount: Number(e.target.value) || 0 })} placeholder="Summa, so‘m" />
            ) : (
              <input className="input" value={a.message || ""} onChange={(e) => setAction(i, { message: e.target.value })} placeholder={a.type === "CREATE_TASK" ? "Vazifa nomi" : meta.defaults[form.trigger]} />
            )}
            {form.actions.length > 1 && (
              <button className="icon-btn" onClick={() => setForm({ ...form, actions: form.actions.filter((_, k) => k !== i) })}>
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
        {form.actions.length < 6 && (
          <button className="btn btn-sm" onClick={() => setForm({ ...form, actions: [...form.actions, { type: "NOTIFY_HR" }] })}>
            <Plus size={14} /> Amal
          </button>
        )}
        <small className="muted">Xabar matnida: {"{name} {minutes} {time} {branch} {start} {end} {days} {count} {doc} {date} {task}"}</small>
      </div>
      {preview && (
        <div className="alert info" style={{ marginTop: 12 }}>
          Hozir {preview.count} ta holatga ishlardi.{preview.sample.length ? ` Masalan: ${preview.sample.slice(0, 3).join(" | ")}` : ""}
        </div>
      )}
      <div className="form-actions">
        <label className="lc-check" style={{ marginRight: "auto" }}>
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Faol
        </label>
        <button className="btn" onClick={() => void test()}>
          <Play size={14} /> Sinab ko‘rish
        </button>
        <button className="btn btn-primary" disabled={form.name.trim().length < 3 || !form.actions.length} onClick={() => void save()}>
          Saqlash
        </button>
      </div>
    </Modal>
  );
}
