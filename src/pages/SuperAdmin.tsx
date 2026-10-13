import { useMemo, useState } from "react";
import { Activity, Blocks, Building2, Check, Copy, KeyRound, LogOut, Plus, Search, Send, Users } from "lucide-react";
import { api, errorText, patch, post } from "../api";
import { useApi } from "../hooks";
import { Confirm, ErrorBox, Field, Loading, Modal, PageHeader, Segmented, StatCard, Status, useToast } from "../components/ui";
import { Logo } from "../components/Logo";
import { roleLabels, useAuth } from "../auth";
import { dateUz } from "@/lib/format";
import { MODULE_PRESETS, MODULES, moduleGroups, presetState, type ModuleGroup, type ModuleKey } from "@/lib/modules";
import type { AuditLog, Company, Lead, Role } from "@/lib/types";

type CompanyRow = Company & {
  employees: number;
  branches: number;
  users: number;
  owner?: string;
  botStatus?: string;
  integrationStatus?: string;
  eventsToday: number;
  lastActivity?: string;
  disabledModules: string[];
};
type Overview = {
  stats: { companies: number; active: number; trial: number; employees: number; eventsToday: number };
  telegram: { state: string; username?: string; error?: string; mode?: string };
  companies: CompanyRow[];
};
type Detail = {
  company: Company;
  disabledModules: string[];
  counts: { active: number; dismissed: number; branches: number; telegram: number; face: number; attendance7d: number };
  users: { id: string; name: string; email: string; role: Role }[];
  bot?: { enabled: boolean; username?: string; status?: string; lastError?: string };
  integration?: { status: string; baseUrl: string; lastSyncAt?: string; lastError?: string };
  audit: AuditLog[];
};
type StatusFilter = "ALL" | Company["status"];

const TOTAL = MODULES.length;

/** «2 soat oldin», «3 kun oldin» — oxirgi faollik uchun. */
function ago(iso?: string) {
  if (!iso) return "—";
  const minutes = Math.round((Date.now() - Date.parse(iso.length === 10 ? `${iso}T12:00:00+05:00` : iso)) / 60_000);
  if (!Number.isFinite(minutes)) return "—";
  if (minutes < 60) return minutes <= 1 ? "hozir" : `${minutes} daq oldin`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} soat oldin`;
  const days = Math.round(minutes / 1440);
  return days < 30 ? `${days} kun oldin` : dateUz(iso);
}

export function SuperAdminPage() {
  const { data, loading, error, reload } = useApi<Overview>("/admin/overview");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const toast = useToast();
  const { user } = useAuth();
  async function logout() {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    location.href = "/login";
  }
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.companies || [])
      .filter((c) => status === "ALL" || c.status === status)
      .filter((c) => !q || `${c.name} ${c.ownerName} ${c.owner || ""} ${c.slug}`.toLowerCase().includes(q));
  }, [data, query, status]);
  const countBy = (s: Company["status"]) => data?.companies.filter((c) => c.status === s).length || 0;
  const open = data?.companies.find((c) => c.id === openId);

  return (
    <div className="sa">
      <header className="admin-top">
        <div className="admin-top-inner">
          <Logo />
          <span className="admin-divider" />
          <span className="admin-label">Platforma</span>
          <div className="admin-user">
            <span>
              <b>{user?.name}</b>
              <small>{user?.email}</small>
            </span>
            <button className="btn btn-sm" onClick={logout}>
              <LogOut size={14} /> Chiqish
            </button>
          </div>
        </div>
      </header>
      <div className="page">
        <PageHeader
          title="Kompaniyalar"
          subtitle="Tarif, chegaralar va har bir kompaniyaning modullari"
          actions={
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus size={15} /> Kompaniya
            </button>
          }
        />
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorBox message={error} />
        ) : (
          data && (
            <>
              <div className="stat-grid">
                <StatCard label="Kompaniyalar" value={data.stats.companies} note={`${data.stats.active} faol · ${data.stats.trial} sinov`} icon={Building2} />
                <StatCard label="Faol xodimlar" value={data.stats.employees} icon={Users} />
                <StatCard label="Bugungi qaydlar" value={data.stats.eventsToday} icon={Activity} />
                <StatCard
                  label="Telegram bot"
                  value={({ running: "Ishlayapti", disabled: "O‘chiq", starting: "Ishga tushmoqda", error: "Xato" } as Record<string, string>)[data.telegram.state] || data.telegram.state}
                  note={data.telegram.username ? `@${data.telegram.username}` : data.telegram.error}
                  icon={Send}
                  tone={data.telegram.state === "running" ? "green" : "red"}
                />
              </div>

              <section className="card">
                <div className="filters">
                  <div className="input-icon">
                    <Search size={15} />
                    <input className="input" placeholder="Kompaniya, egasi yoki email…" value={query} onChange={(e) => setQuery(e.target.value)} />
                  </div>
                  <Segmented<StatusFilter>
                    value={status}
                    onChange={setStatus}
                    options={[
                      { value: "ALL", label: "Hammasi", count: data.companies.length },
                      { value: "ACTIVE", label: "Faol", count: countBy("ACTIVE") },
                      { value: "TRIAL", label: "Sinov", count: countBy("TRIAL") },
                      { value: "SUSPENDED", label: "To‘xtatilgan", count: countBy("SUSPENDED") },
                    ]}
                  />
                </div>
                {!rows.length ? (
                  <p className="muted sa-empty">Mos kompaniya topilmadi</p>
                ) : (
                  <div className="table-wrap">
                    <table className="table table-cards sa-table">
                      <thead>
                        <tr>
                          <th>Kompaniya</th>
                          <th>Xodimlar</th>
                          <th>Modullar</th>
                          <th>Holat</th>
                          <th>Faollik</th>
                          <th aria-label="Amallar" />
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((c) => {
                          const on = TOTAL - c.disabledModules.length;
                          const percent = c.employeeLimit ? Math.min(100, Math.round((c.employees / c.employeeLimit) * 100)) : 0;
                          return (
                            <tr key={c.id} className="clickable" onClick={() => setOpenId(c.id)}>
                              <td>
                                <span className="stack">
                                  <b>{c.name}</b>
                                  <small>{c.owner || c.ownerName}</small>
                                </span>
                              </td>
                              <td data-label="Xodimlar">
                                <span className="sa-usage">
                                  <span className="num">
                                    {c.employees}
                                    <small> / {c.employeeLimit || "∞"}</small>
                                  </span>
                                  {c.employeeLimit ? (
                                    <span className="limit-bar">
                                      <i style={{ width: `${percent}%` }} className={percent >= 100 ? "full" : percent >= 90 ? "warn" : ""} />
                                    </span>
                                  ) : null}
                                </span>
                              </td>
                              <td data-label="Modullar">
                                <span className={`sa-mods ${on < TOTAL ? "partial" : ""}`}>
                                  <Blocks size={13} /> {on}/{TOTAL}
                                </span>
                              </td>
                              <td data-label="Holat">
                                <Status value={c.status} />
                              </td>
                              <td data-label="Faollik" className="muted">
                                {ago(c.lastActivity)}
                              </td>
                              <td className="sa-open">
                                <button
                                  className="btn btn-sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenId(c.id);
                                  }}
                                >
                                  Boshqarish
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <ModuleUsage companies={data.companies} />
              <LeadsCard />
            </>
          )
        )}
        {creating && (
          <CompanyForm
            onClose={() => setCreating(false)}
            onSaved={() => {
              setCreating(false);
              toast("Kompaniya yaratildi");
              void reload(true);
            }}
          />
        )}
        {open && <CompanyPanel row={open} onClose={() => setOpenId(null)} onChanged={() => void reload(true)} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------- kompaniya paneli --- */
type PanelTab = "general" | "modules" | "access" | "log";

function CompanyPanel({ row, onClose, onChanged }: { row: CompanyRow; onClose: () => void; onChanged: () => void }) {
  const [tab, setTab] = useState<PanelTab>("general");
  const { data, reload } = useApi<Detail>(`/admin/companies/${row.id}`);
  const changed = () => {
    onChanged();
    void reload(true);
  };
  return (
    <Modal title={row.name} subtitle={`${row.slug} · ${row.plan} · ${dateUz(row.createdAt)} dan`} onClose={onClose} size="wide">
      <div className="sa-tabs" role="tablist">
        {(
          [
            ["general", "Umumiy"],
            ["modules", `Modullar · ${TOTAL - row.disabledModules.length}/${TOTAL}`],
            ["access", "Kirish"],
            ["log", "Jurnal"],
          ] as [PanelTab, string][]
        ).map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      {tab === "general" && <GeneralTab row={row} detail={data} onSaved={changed} />}
      {tab === "modules" && <ModulesTab row={row} onSaved={changed} />}
      {tab === "access" && <AccessTab row={row} detail={data} />}
      {tab === "log" && <LogTab detail={data} />}
    </Modal>
  );
}

function GeneralTab({ row, detail, onSaved }: { row: CompanyRow; detail: Detail | null; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: row.name,
    plan: row.plan,
    status: row.status,
    employeeLimit: row.employeeLimit ? String(row.employeeLimit) : "",
    limitContact: row.limitContact || "@mamatov_ads",
    adminNote: row.adminNote || "",
  });
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [key]: e.target.value });
  const c = detail?.counts;
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await patch(`/admin/companies/${row.id}`, { ...form, employeeLimit: form.employeeLimit ? Number(form.employeeLimit) : null });
          toast("Saqlandi");
          onSaved();
        } catch (reason) {
          toast(errorText(reason), "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="sa-kpis">
        {(
          [
            ["Faol xodim", c?.active],
            ["Filial", c?.branches],
            ["Telegram ulangan", c?.telegram],
            ["Face ID", c?.face],
            ["7 kunlik qayd", c?.attendance7d],
            ["Bo‘shagan", c?.dismissed],
          ] as [string, number | undefined][]
        ).map(([label, value]) => (
          <div key={label}>
            <small>{label}</small>
            <b className="num">{value ?? "…"}</b>
          </div>
        ))}
      </div>
      <div className="form-grid">
        <Field label="Kompaniya nomi">
          <input className="input" value={form.name} onChange={set("name")} required minLength={2} />
        </Field>
        <Field label="Tarif">
          <select className="select" value={form.plan} onChange={set("plan")}>
            {[...new Set(["Standard", "Business", "Enterprise", form.plan])].map((plan) => (
              <option key={plan}>{plan}</option>
            ))}
          </select>
        </Field>
        <Field label="Holat" hint={form.status === "SUSPENDED" ? "Kompaniya paneli va botlari to‘xtaydi" : undefined}>
          <select className="select" value={form.status} onChange={set("status")}>
            <option value="ACTIVE">Faol</option>
            <option value="TRIAL">Sinov</option>
            <option value="SUSPENDED">To‘xtatilgan</option>
          </select>
        </Field>
        <Field label="Maksimal faol xodim" hint={`Hozir ${row.employees} ta. Bo‘sh — cheklovsiz`}>
          <input className="input" type="number" min={1} value={form.employeeLimit} onChange={set("employeeLimit")} placeholder="∞" />
        </Field>
      </div>
      <div className="sa-chips">
        {[50, 100, 200, 500, 1000].map((n) => (
          <button type="button" key={n} className={form.employeeLimit === String(n) ? "on" : ""} onClick={() => setForm({ ...form, employeeLimit: String(n) })}>
            {n}
          </button>
        ))}
        <button type="button" className={!form.employeeLimit ? "on" : ""} onClick={() => setForm({ ...form, employeeLimit: "" })}>
          ∞
        </button>
      </div>
      <Field label="Chegaradan oshganda aloqa">
        <input className="input" value={form.limitContact} onChange={set("limitContact")} placeholder="@mamatov_ads" />
      </Field>
      <Field label="Ichki izoh" hint="Faqat platforma administratorlariga ko‘rinadi">
        <textarea className="textarea" rows={2} value={form.adminNote} onChange={set("adminNote")} placeholder="Shartnoma, to‘lov, aloqa…" />
      </Field>
      <div className="form-actions">
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "Saqlanmoqda…" : "Saqlash"}
        </button>
      </div>
    </form>
  );
}

/** Modullarni yoqish/o‘chirish — guruhlangan, tayyor to‘plamlar bilan. */
function ModulesTab({ row, onSaved }: { row: CompanyRow; onSaved: () => void }) {
  const toast = useToast();
  const initial = () => Object.fromEntries(MODULES.map((m) => [m.key, !row.disabledModules.includes(m.key)])) as Record<ModuleKey, boolean>;
  const [state, setState] = useState<Record<ModuleKey, boolean>>(initial);
  const [busy, setBusy] = useState(false);
  const dirty = MODULES.some((m) => state[m.key] !== !row.disabledModules.includes(m.key));
  const on = MODULES.filter((m) => state[m.key]).length;
  const groups = Object.entries(moduleGroups) as [ModuleGroup, string][];
  return (
    <div className="sa-modules">
      <div className="sa-presets">
        <span className="muted">
          <b>{on}</b> / {TOTAL} yoqilgan
        </span>
        <div className="sa-chips">
          {MODULE_PRESETS.map((preset) => (
            <button key={preset.key} type="button" title={preset.description} onClick={() => setState(presetState(preset))}>
              {preset.label}
            </button>
          ))}
        </div>
      </div>
      <p className="sa-note">
        O‘chirilgan modul kompaniya panelida, sozlamalarda va xodimlarning Mini App’ida ko‘rinmaydi, API yo‘llari yopiladi. Ma’lumotlar o‘chmaydi — qayta yoqilsa
        hammasi joyida.
      </p>
      {groups.map(([group, title]) => {
        const items = MODULES.filter((m) => m.group === group);
        if (!items.length) return null;
        return (
          <section key={group} className="sa-group">
            <h4>{title}</h4>
            {items.map((m) => (
              <label key={m.key} className={`sa-module ${state[m.key] ? "" : "off"}`}>
                <span>
                  <b>{m.label}</b>
                  <small>{m.description}</small>
                </span>
                <span className="switch">
                  <input type="checkbox" checked={state[m.key]} onChange={(e) => setState({ ...state, [m.key]: e.target.checked })} />
                  <span />
                </span>
              </label>
            ))}
          </section>
        );
      })}
      <div className="sa-sticky">
        <button type="button" className="btn" disabled={!dirty || busy} onClick={() => setState(initial())}>
          Bekor qilish
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!dirty || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await patch(`/admin/companies/${row.id}`, { modules: state });
              toast("Modullar saqlandi");
              onSaved();
            } catch (reason) {
              toast(errorText(reason), "error");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saqlanmoqda…" : "Saqlash"}
        </button>
      </div>
    </div>
  );
}

function AccessTab({ row, detail }: { row: CompanyRow; detail: Detail | null }) {
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);
  return (
    <div className="sa-access">
      <div className="sa-owner">
        <div>
          <small>Kompaniya egasi</small>
          <b>{row.ownerName}</b>
          <span className="muted">{row.owner || "login yo‘q"}</span>
        </div>
        <button className="btn" onClick={() => setConfirm(true)} disabled={!row.owner}>
          <KeyRound size={15} /> Parolni tiklash
        </button>
      </div>
      {result && (
        <div className="sa-secret">
          <span>
            <small>Vaqtinchalik parol — faqat hozir ko‘rinadi</small>
            <code>{result.password}</code>
          </span>
          <button
            className="btn btn-sm"
            onClick={() => {
              void navigator.clipboard?.writeText(`${result.email}\n${result.password}`);
              setCopied(true);
            }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Nusxalandi" : "Nusxalash"}
          </button>
        </div>
      )}
      <h4 className="sa-sub">Panel foydalanuvchilari · {detail?.users.length ?? row.users}</h4>
      <div className="sa-list">
        {detail?.users.map((u) => (
          <div key={u.id}>
            <span>
              <b>{u.name}</b>
              <small>{u.email}</small>
            </span>
            <span className="badge gray plain">{roleLabels[u.role] || u.role}</span>
          </div>
        )) || <Loading />}
      </div>
      <h4 className="sa-sub">Kanallar</h4>
      <div className="sa-list">
        <div>
          <span>
            <b>Kompaniya boti</b>
            <small>{detail?.bot?.username ? `@${detail.bot.username}` : "Ulanmagan"}</small>
          </span>
          {detail?.bot?.enabled ? <Status value={detail.bot.status === "RUNNING" ? "ACTIVE" : detail.bot.status === "ERROR" ? "BLOCKED" : "INACTIVE"} /> : <span className="muted">—</span>}
        </div>
        <div>
          <span>
            <b>Xodimlar boti integratsiyasi</b>
            <small>{detail?.integration ? `${detail.integration.baseUrl}${detail.integration.lastSyncAt ? ` · ${ago(detail.integration.lastSyncAt)}` : ""}` : "Ulanmagan"}</small>
          </span>
          {detail?.integration ? <Status value={detail.integration.status === "ERROR" ? "BLOCKED" : detail.integration.status} /> : <span className="muted">—</span>}
        </div>
      </div>
      {confirm && (
        <Confirm
          title="Parolni tiklash"
          text={`${row.owner} uchun yangi vaqtinchalik parol yaratiladi. Egasining barcha qurilmalardagi sessiyalari yopiladi.`}
          confirmLabel="Tiklash"
          onClose={() => setConfirm(false)}
          onConfirm={async () => {
            setResult(await post<{ email: string; password: string }>(`/admin/companies/${row.id}/reset-owner-password`, {}));
            setCopied(false);
          }}
        />
      )}
    </div>
  );
}

function LogTab({ detail }: { detail: Detail | null }) {
  if (!detail) return <Loading />;
  if (!detail.audit.length) return <p className="muted sa-empty">Hozircha yozuv yo‘q</p>;
  return (
    <div className="sa-list sa-log">
      {detail.audit.map((log) => (
        <div key={log.id}>
          <span>
            <b>{log.action}</b>
            <small>{log.actor}</small>
          </span>
          <small className="muted">{ago(log.createdAt)}</small>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------- modul statistikasi --- */
function ModuleUsage({ companies }: { companies: CompanyRow[] }) {
  if (!companies.length) return null;
  return (
    <section className="card sa-usage-card">
      <div className="card-head">
        <div>
          <h2>Modullardan foydalanish</h2>
          <p>Nechta kompaniyada yoqilgan</p>
        </div>
      </div>
      <div className="sa-usage-grid">
        {MODULES.map((m) => {
          const on = companies.filter((c) => !c.disabledModules.includes(m.key)).length;
          return (
            <div key={m.key}>
              <span>{m.label}</span>
              <span className="limit-bar">
                <i style={{ width: `${Math.round((on / companies.length) * 100)}%` }} />
              </span>
              <b className="num">{on}</b>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------- yangi kompaniya --- */
function CompanyForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: "",
    ownerName: "",
    ownerEmail: "",
    ownerPassword: "",
    plan: "Standard",
    status: "TRIAL",
    employeeLimit: "",
  });
  const [preset, setPreset] = useState("all");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const company = await post<Company>("/admin/companies", { ...form, employeeLimit: form.employeeLimit ? Number(form.employeeLimit) : undefined });
      const chosen = MODULE_PRESETS.find((p) => p.key === preset);
      if (chosen && chosen.enabled !== "all") await patch(`/admin/companies/${company.id}`, { modules: presetState(chosen) });
      onSaved();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title="Yangi kompaniya" subtitle="Egasi shu email va parol bilan panelga kiradi" onClose={onClose}>
      <form onSubmit={save}>
        <Field label="Kompaniya nomi *">
          <input className="input" value={form.name} onChange={set("name")} required minLength={2} />
        </Field>
        <div className="form-grid">
          <Field label="Egasi F.I.Sh. *">
            <input className="input" value={form.ownerName} onChange={set("ownerName")} required minLength={2} />
          </Field>
          <Field label="Egasi email *">
            <input className="input" type="email" value={form.ownerEmail} onChange={set("ownerEmail")} required />
          </Field>
          <Field label="Vaqtinchalik parol *" hint="Kamida 10 belgi">
            <input className="input" value={form.ownerPassword} onChange={set("ownerPassword")} required minLength={10} autoComplete="new-password" />
          </Field>
          <Field label="Tarif">
            <select className="select" value={form.plan} onChange={set("plan")}>
              <option>Standard</option>
              <option>Business</option>
              <option>Enterprise</option>
            </select>
          </Field>
          <Field label="Maksimal xodim" hint="Bo‘sh — cheklovsiz">
            <input className="input" type="number" min={1} value={form.employeeLimit} onChange={set("employeeLimit")} placeholder="500" />
          </Field>
          <Field label="Holat">
            <select className="select" value={form.status} onChange={set("status")}>
              <option value="TRIAL">Sinov</option>
              <option value="ACTIVE">Faol</option>
            </select>
          </Field>
        </div>
        <Field label="Modullar" hint="Keyin «Boshqarish → Modullar» da bittalab o‘zgartiriladi">
          <div className="sa-chips">
            {MODULE_PRESETS.map((p) => (
              <button type="button" key={p.key} className={preset === p.key ? "on" : ""} title={p.description} onClick={() => setPreset(p.key)}>
                {p.label}
              </button>
            ))}
          </div>
        </Field>
        <ErrorBox message={error} />
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Bekor qilish
          </button>
          <button className="btn btn-primary" disabled={saving}>
            {saving ? "Yaratilmoqda…" : "Yaratish"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------ demo so‘rovlar --- */
const LEAD_STATUS: Record<Lead["status"], string> = { NEW: "Yangi", CONTACTED: "Bog‘lanildi", CLOSED: "Yopildi" };

/** Saytdagi «Demo so‘rash» formasidan kelgan arizalar. */
function LeadsCard() {
  const { data, reload } = useApi<Lead[]>("/admin/leads");
  const toast = useToast();
  async function setStatus(lead: Lead, status: Lead["status"]) {
    try {
      await patch(`/admin/leads/${lead.id}`, { status });
      void reload(true);
    } catch (reason) {
      toast(errorText(reason), "error");
    }
  }
  const fresh = data?.filter((l) => l.status === "NEW").length || 0;
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Demo so‘rovlari{fresh ? ` · ${fresh} yangi` : ""}</h2>
          <p>Landing sahifadagi formadan</p>
        </div>
      </div>
      {!data?.length ? (
        <p className="muted sa-empty">Hozircha so‘rov yo‘q</p>
      ) : (
        <div className="table-wrap">
          <table className="table table-cards">
            <thead>
              <tr>
                <th>Sana</th>
                <th>Ism</th>
                <th>Kompaniya</th>
                <th>Telefon</th>
                <th>Izoh</th>
                <th>Holat</th>
              </tr>
            </thead>
            <tbody>
              {data.map((l) => (
                <tr key={l.id}>
                  <td data-label="Sana">{dateUz(l.createdAt)}</td>
                  <td data-label="Ism">{l.name}</td>
                  <td data-label="Kompaniya">
                    {l.company}
                    {l.employees ? <small className="muted"> · {l.employees} xodim</small> : null}
                  </td>
                  <td data-label="Telefon">
                    <a href={`tel:${l.phone.replace(/[^\d+]/g, "")}`}>{l.phone}</a>
                  </td>
                  <td data-label="Izoh">{l.message || "—"}</td>
                  <td data-label="Holat">
                    <select className="select" value={l.status} onChange={(e) => void setStatus(l, e.target.value as Lead["status"])}>
                      {Object.entries(LEAD_STATUS).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
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
