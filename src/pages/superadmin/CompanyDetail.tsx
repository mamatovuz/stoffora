import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Ban, Eye, KeyRound, LifeBuoy, Plus, RotateCcw, ShieldCheck, Trash2, Unlock } from "lucide-react";
import { patch, post } from "../../api";
import { useApi } from "../../hooks";
import { Field, Modal, useToast } from "../../components/ui";
import { roleLabels } from "../../auth";
import { moduleGroups, type ModuleGroup } from "@/lib/modules";
import {
  ActivityTimeline,
  ConfirmDialog,
  DataTable,
  ErrorState,
  FilterBar,
  KeyValue,
  Pager,
  PermissionGuard,
  SearchInput,
  SecretReveal,
  Section,
  Select,
  Skeleton,
  StatusBadge,
  ago,
  bytes,
  dateOnly,
  dateTime,
  money,
  num,
  readFileAsDataUrl,
  downloadFile,
  useAction,
  usePlatform,
  useServerList,
} from "./kit";
import { ChartCard, Columns, TrendLine } from "./charts";
import type { CompanyRow } from "./Companies";

/*
 * Kompaniya boshqaruvi — 12 tab, har biri haqiqiy companyId bilan ishlaydi.
 */

type Detail = {
  company: { id: string; name: string; slug: string; status: string; timezone: string; createdAt: string; adminNote?: string; internal?: boolean; limitContact?: string; archive?: { at: string; by: string; reason: string }; demo?: { expiresAt: string }; onboardingNotes?: Record<string, string>; plan: string };
  row: CompanyRow;
  plan: { id: string; name: string; limits: Record<string, number | null>; modules: string[] | "all" } | null;
  subscription: { planId: string; status: string; computedStatus: string; daysLeft: number | null; periodEnd: string | null; startedAt: string; graceDays: number; free?: boolean; manual?: boolean; limits?: Record<string, number | null>; note?: string; pausedAt?: string } | null;
  counts: { activeEmployees: number; dismissed: number; branches: number; users: number; leaders: number; telegramLinked: number; faceEnrolled: number; attendance7d: number; attendanceTotal: number; openTickets: number };
  traffic7d: { requests: number; errors: number };
  health: { score: number; grade: string; components: Record<string, number> };
  onboarding: { percent: number; steps: { key: string; label: string; status: string; detail: string }[] };
  previews: { id: string; adminName: string; mode: string; status: string; createdAt: string; expiresAt: string; reason?: string; approvedBy?: string }[];
};

const TABS = [
  ["overview", "Umumiy"],
  ["leaders", "Rahbarlar"],
  ["employees", "Xodimlar"],
  ["branches", "Filiallar"],
  ["modules", "Modullar"],
  ["plan", "Tarif va limitlar"],
  ["activity", "Faollik"],
  ["audit", "Audit"],
  ["devices", "Qurilmalar"],
  ["integrations", "Integratsiyalar"],
  ["support", "Murojaatlar"],
  ["settings", "Sozlamalar"],
] as const;
type Tab = (typeof TABS)[number][0];

export default function CompanyDetailPage() {
  const { id = "", tab = "overview" } = useParams();
  const navigate = useNavigate();
  const { data, error, reload } = useApi<Detail>(`/super-admin/companies/${id}`);
  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;
  if (!data) return <Skeleton rows={10} />;
  const c = data.company;
  const current = (TABS.some(([k]) => k === tab) ? tab : "overview") as Tab;
  const refresh = () => void reload(true);
  return (
    <>
      <Link to="/super-admin/companies" className="back-link">
        <ArrowLeft size={15} /> Kompaniyalar
      </Link>
      <div className="sa-company-head">
        <div>
          <h1 className="page-title">
            {c.name} {c.demo && <span className="badge violet">Demo</span>}
          </h1>
          <p className="page-subtitle">
            {c.archive ? <StatusBadge value="ARCHIVED" /> : <StatusBadge value={c.status} />} · {data.row.plan || "—"} · {c.slug} · {dateOnly(c.createdAt)} dan · ID <code>{c.id}</code>
          </p>
        </div>
        <PreviewButton companyId={c.id} />
      </div>
      <nav className="sa-tabs" role="tablist" aria-label="Kompaniya bo‘limlari">
        {TABS.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={current === key} className={current === key ? "active" : ""} onClick={() => navigate(`/super-admin/companies/${c.id}/${key}`)}>
            {label}
            {key === "support" && data.counts.openTickets > 0 && <em className="sa-badge">{data.counts.openTickets}</em>}
          </button>
        ))}
      </nav>
      <div className="sa-tab-body">
        {current === "overview" && <OverviewTab data={data} />}
        {current === "leaders" && <LeadersTab companyId={c.id} onChanged={refresh} />}
        {current === "employees" && <EmployeesTab companyId={c.id} />}
        {current === "branches" && <BranchesTab companyId={c.id} />}
        {current === "modules" && <ModulesTab companyId={c.id} onChanged={refresh} />}
        {current === "plan" && <PlanTab data={data} onChanged={refresh} />}
        {current === "activity" && <ActivityTab companyId={c.id} />}
        {current === "audit" && <AuditTab companyId={c.id} />}
        {current === "devices" && <DevicesTab companyId={c.id} />}
        {current === "integrations" && <IntegrationsTab companyId={c.id} />}
        {current === "support" && <SupportTab companyId={c.id} />}
        {current === "settings" && <SettingsTab data={data} onChanged={refresh} />}
      </div>
    </>
  );
}

function PreviewButton({ companyId }: { companyId: string }) {
  const toast = useToast();
  const run = useAction();
  return (
    <PermissionGuard perm="companies.preview">
      <button
        className="btn btn-primary"
        onClick={async () => {
          const result = await run(() => post<{ url: string; expiresAt: string }>(`/super-admin/companies/${companyId}/preview`, {}), toast);
          if (result) {
            window.open(result.url, "_blank", "noopener");
            toast(`Ko‘rish rejimi ${dateTime(result.expiresAt)} gacha`);
          }
        }}
      >
        <Eye size={15} /> Panelni ko‘rish
      </button>
    </PermissionGuard>
  );
}

/* ----------------------------------------------------------------- umumiy --- */
const HEALTH_LABELS: Record<string, [string, number]> = {
  activity: ["Faollik", 30],
  reliability: ["Barqarorlik", 20],
  integrations: ["Integratsiya", 10],
  modules: ["Modullar", 10],
  setup: ["Sozlash", 20],
  incidents: ["Incidentlar", 10],
};
function OverviewTab({ data }: { data: Detail }) {
  const k = data.counts;
  return (
    <div className="sa-grid-2">
      <Section title="Ko‘rsatkichlar">
        <KeyValue
          items={[
            ["Faol xodimlar", `${num(k.activeEmployees)}${data.row.employeeLimit ? ` / ${num(data.row.employeeLimit)}` : ""}`],
            ["Ishdan bo‘shaganlar", num(k.dismissed)],
            ["Filiallar", num(k.branches)],
            ["Panel foydalanuvchilari", `${num(k.users)} (rahbarlar ${num(k.leaders)})`],
            ["Telegram ulangan", num(k.telegramLinked)],
            ["Face ID", num(k.faceEnrolled)],
            ["Davomat (7 kun)", num(k.attendance7d)],
            ["API so‘rovlar (7 kun)", `${num(data.traffic7d.requests)} · xato ${num(data.traffic7d.errors)}`],
            ["Oxirgi faollik", ago(data.row.lastActivity)],
          ]}
        />
      </Section>
      <Section title="Sog‘liq bahosi" subtitle="Platformadan foydalanish va texnik holat (xodimlarni baholash uchun emas)">
        <div className="sa-health">
          <b className={`sa-score ${data.health.grade.toLowerCase()}`}>{data.health.score}</b>
          <StatusBadge value={data.health.grade} />
        </div>
        <ul className="sa-bars">
          {Object.entries(data.health.components).map(([key, value]) => (
            <li key={key}>
              <span>{HEALTH_LABELS[key]?.[0] || key}</span>
              <span className="limit-bar">
                <i style={{ width: `${Math.round((value / (HEALTH_LABELS[key]?.[1] || 10)) * 100)}%` }} />
              </span>
              <b className="num">
                {value}/{HEALTH_LABELS[key]?.[1]}
              </b>
            </li>
          ))}
        </ul>
      </Section>
      <Section title={`Onboarding · ${data.onboarding.percent}%`}>
        <ul className="sa-checks">
          {data.onboarding.steps.map((s) => (
            <li key={s.key}>
              <StatusBadge value={s.status} />
              <span>
                <b>{s.label}</b>
                {s.detail && <small>{s.detail}</small>}
              </span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Obuna">
        {data.subscription ? (
          <KeyValue
            items={[
              ["Tarif", data.plan?.name || data.row.plan],
              ["Holat", <StatusBadge key="s" value={data.subscription.computedStatus} />],
              ["Tugash sanasi", data.subscription.periodEnd ? `${dateOnly(data.subscription.periodEnd)} (${data.subscription.daysLeft} kun)` : "Muddatsiz"],
              ["Imtiyozli davr", `${data.subscription.graceDays} kun`],
              ["Belgilar", [data.subscription.free ? "Bepul" : "", data.subscription.manual ? "Qo‘lda berilgan" : ""].filter(Boolean).join(" · ") || "—"],
            ]}
          />
        ) : (
          <p className="muted">Obuna hali biriktirilmagan (eski kompaniya: tarif — «{data.row.plan}»). «Tarif va limitlar» tabidan tarif tanlang.</p>
        )}
      </Section>
    </div>
  );
}

/* --------------------------------------------------------------- rahbarlar --- */
type Leader = { id: string; name: string; email: string; role: string; primary: boolean; telegramLinked: boolean; twoFactor: boolean; blockedAt: string | null; blockReason: string | null; lastLoginAt: string | null; lastSeenAt: string | null; activeSessions: number; autoRole: boolean };
function LeadersTab({ companyId, onChanged }: { companyId: string; onChanged: () => void }) {
  const toast = useToast();
  const run = useAction();
  const { data, error, reload } = useApi<{ users: Leader[] }>(`/super-admin/companies/${companyId}/leaders`);
  const [adding, setAdding] = useState(false);
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);
  const [blocking, setBlocking] = useState<Leader | null>(null);
  const [owner, setOwner] = useState<Leader | null>(null);
  const changed = () => {
    void reload(true);
    onChanged();
  };
  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;
  return (
    <Section
      title="Rahbarlar va panel foydalanuvchilari"
      actions={
        <PermissionGuard perm="users.manage">
          <button
            className="btn"
            onClick={async () => {
              const r = await run(() => post<{ email: string; password: string }>(`/super-admin/companies/${companyId}/reset-owner-password`, {}), toast, "Egasining paroli tiklandi");
              if (r) setSecret(r);
            }}
          >
            <KeyRound size={15} /> Egasi parolini tiklash
          </button>
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            <Plus size={15} /> Rahbar qo‘shish
          </button>
        </PermissionGuard>
      }
    >
      {secret && <SecretReveal label={`${secret.email} — vaqtinchalik parol`} value={secret.password} note="Faqat hozir ko‘rinadi" />}
      <DataTable
        rows={data?.users}
        rowKey={(r) => r.id}
        loading={!data}
        columns={[
          {
            key: "name",
            label: "Foydalanuvchi",
            render: (r) => (
              <span className="stack">
                <b>
                  {r.name} {!r.primary && <span className="badge gray">qo‘shimcha kirish</span>}
                </b>
                <small>{r.email}</small>
              </span>
            ),
          },
          { key: "role", label: "Rol", render: (r) => <span className="badge gray plain">{roleLabels[r.role as keyof typeof roleLabels] || r.role}{r.autoRole ? " · avto" : ""}</span> },
          { key: "2fa", label: "2FA", render: (r) => (r.twoFactor ? <StatusBadge value="ACTIVE" label="Yoqilgan" /> : r.telegramLinked ? <span className="muted">Telegram ulangan</span> : <span className="muted">—</span>) },
          { key: "seen", label: "Oxirgi faollik", render: (r) => <span className="muted">{ago(r.lastSeenAt || r.lastLoginAt)}</span> },
          { key: "status", label: "Holat", render: (r) => (r.blockedAt ? <StatusBadge value="SUSPENDED" label="Bloklangan" /> : <StatusBadge value="ACTIVE" />) },
          {
            key: "actions",
            label: "",
            render: (r) => (
              <PermissionGuard perm="users.manage">
                <span className="sa-row-actions" onClick={(e) => e.stopPropagation()}>
                  {r.role !== "COMPANY_OWNER" && r.primary && !r.blockedAt && (
                    <button className="btn btn-sm" onClick={() => setOwner(r)}>
                      Ega qilish
                    </button>
                  )}
                  {r.blockedAt ? (
                    <button className="btn btn-sm" onClick={() => run(() => post(`/super-admin/users/${r.id}/unblock`, {}), toast, "Blokdan chiqarildi").then(changed)}>
                      <Unlock size={13} /> Blokdan chiqarish
                    </button>
                  ) : (
                    <button className="btn btn-sm" onClick={() => setBlocking(r)}>
                      <Ban size={13} /> Bloklash
                    </button>
                  )}
                  <button className="btn btn-sm" onClick={() => run(() => post<{ revoked: number }>(`/super-admin/users/${r.id}/revoke-sessions`, {}), toast, "Sessiyalar bekor qilindi").then(changed)}>
                    Sessiyalarni yopish
                  </button>
                </span>
              </PermissionGuard>
            ),
          },
        ]}
      />
      {adding && <AddLeader companyId={companyId} onClose={() => setAdding(false)} onDone={(s) => (setAdding(false), setSecret(s), changed())} />}
      {blocking && (
        <ConfirmDialog
          title={`${blocking.name} — bloklash`}
          text="Foydalanuvchi panelga kira olmaydi, barcha sessiyalari yopiladi. Ma’lumotlari o‘chmaydi."
          danger
          confirmLabel="Bloklash"
          reason={{ label: "Sabab", required: true }}
          onClose={() => setBlocking(null)}
          onConfirm={async (reason) => {
            await post(`/super-admin/users/${blocking.id}/block`, { reason });
            toast("Bloklandi");
            changed();
          }}
        />
      )}
      {owner && (
        <ConfirmDialog
          title="Egalikni o‘tkazish"
          text={`${owner.name} kompaniya egasi bo‘ladi, hozirgi ega HR administrator roliga o‘tadi.`}
          confirmLabel="O‘tkazish"
          onClose={() => setOwner(null)}
          onConfirm={async () => {
            await run(() => post(`/super-admin/companies/${companyId}/owner`, { userId: owner.id }), toast, "Egalik o‘tkazildi");
            changed();
          }}
        />
      )}
    </Section>
  );
}

function AddLeader({ companyId, onClose, onDone }: { companyId: string; onClose: () => void; onDone: (s: { email: string; password: string }) => void }) {
  const [form, setForm] = useState({ name: "", email: "", role: "HR_ADMIN" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Rahbar qo‘shish" subtitle="Vaqtinchalik parol bir marta ko‘rsatiladi" onClose={onClose} size="narrow">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            onDone(await post(`/super-admin/companies/${companyId}/leaders`, form));
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Xatolik");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="F.I.Sh.">
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} autoFocus />
        </Field>
        <Field label="Email">
          <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        </Field>
        <Field label="Rol">
          <select className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {["HR_ADMIN", "FINANCE", "IT_ADMIN", "BRANCH_MANAGER"].map((r) => (
              <option key={r} value={r}>
                {roleLabels[r as keyof typeof roleLabels]}
              </option>
            ))}
          </select>
        </Field>
        {error && <p className="sa-error-line">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Bekor qilish
          </button>
          <button className="btn btn-primary" disabled={busy}>
            Qo‘shish
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------------------------------------------------- xodimlar, filiallar --- */
type EmployeeRow = { id: string; employeeNo: string; name: string; status: string; branch: string; position: string; telegram: boolean; face: boolean; startDate: string };
function EmployeesTab({ companyId }: { companyId: string }) {
  const [state, setState] = useState({ q: "", status: "ACTIVE", page: 1 });
  const { data, loading, error, reload } = useServerList<EmployeeRow>(`/super-admin/companies/${companyId}/employees`, { ...state, pageSize: 30 });
  return (
    <Section title="Xodimlar" subtitle="Faqat zarur maydonlar — telefon, manzil, oylik ko‘rsatilmaydi">
      <FilterBar>
        <SearchInput value={state.q} onChange={(q) => setState({ ...state, q, page: 1 })} placeholder="Ism yoki tabel raqami…" />
        <Select
          label="Holat"
          value={state.status}
          onChange={(status) => setState({ ...state, status, page: 1 })}
          options={[
            ["ACTIVE", "Faol"],
            ["DISMISSED", "Bo‘shagan"],
            ["ALL", "Hammasi"],
          ]}
        />
      </FilterBar>
      <DataTable
        rows={data?.rows}
        rowKey={(r) => r.id}
        loading={loading}
        error={error}
        onRetry={() => void reload()}
        columns={[
          { key: "no", label: "№", render: (r) => <span className="num">{r.employeeNo}</span> },
          { key: "name", label: "Xodim", render: (r) => <b>{r.name}</b> },
          { key: "branch", label: "Filial", render: (r) => r.branch },
          { key: "position", label: "Lavozim", hideOnMobile: true, render: (r) => r.position },
          { key: "tg", label: "Telegram", render: (r) => (r.telegram ? "✓" : "—") },
          { key: "face", label: "Face ID", render: (r) => (r.face ? "✓" : "—") },
          { key: "status", label: "Holat", render: (r) => <StatusBadge value={r.status} /> },
        ]}
      />
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => setState({ ...state, page })} />}
    </Section>
  );
}

function BranchesTab({ companyId }: { companyId: string }) {
  const { data, error, reload } = useApi<{ id: string; name: string; address: string; status: string; radiusMeters: number; attendanceMode: string | null; employees: number; today: number }[]>(`/super-admin/companies/${companyId}/branches`);
  return (
    <Section title="Filiallar">
      <DataTable
        rows={data || undefined}
        rowKey={(r) => r.id}
        loading={!data}
        error={error}
        onRetry={() => void reload()}
        columns={[
          { key: "name", label: "Filial", render: (r) => <span className="stack"><b>{r.name}</b><small>{r.address}</small></span> },
          { key: "mode", label: "Usul", render: (r) => r.attendanceMode || "—" },
          { key: "radius", label: "Radius", className: "num", render: (r) => `${r.radiusMeters} m` },
          { key: "employees", label: "Xodimlar", className: "num", render: (r) => num(r.employees) },
          { key: "today", label: "Bugungi qaydlar", className: "num", render: (r) => num(r.today) },
          { key: "status", label: "Holat", render: (r) => <StatusBadge value={r.status} /> },
        ]}
      />
    </Section>
  );
}

/* ---------------------------------------------------------------- modullar --- */
type ModuleRow = { key: string; label: string; description: string; group: ModuleGroup; dependsOn: string[]; base: boolean; enabled: boolean; reason: string; override: { enabled: boolean; expiresAt?: string; trial?: boolean; note?: string } | null; global: { globalEnabled?: boolean } | null };
const REASONS: Record<string, string> = { ON: "Yoqilgan", GLOBAL_OFF: "Platformada o‘chirilgan", OVERRIDE_ON: "Vaqtinchalik yoqilgan", OVERRIDE_OFF: "Vaqtinchalik o‘chirilgan", COMPANY_OFF: "O‘chirilgan", PLAN_EXCLUDED: "Tarifga kirmaydi" };
function ModulesTab({ companyId, onChanged }: { companyId: string; onChanged: () => void }) {
  const toast = useToast();
  const run = useAction();
  const { can } = usePlatform();
  const { data, error, reload } = useApi<{ presets: { key: string; label: string; description: string }[]; modules: ModuleRow[] }>(`/super-admin/companies/${companyId}/modules`);
  const [override, setOverride] = useState<ModuleRow | null>(null);
  const [cascade, setCascade] = useState<{ row: ModuleRow; enabled: boolean; message: string } | null>(null);
  const changed = () => {
    void reload(true);
    onChanged();
  };
  const toggle = async (row: ModuleRow, enabled: boolean, withCascade = false) => {
    try {
      await patch(`/super-admin/companies/${companyId}/modules/${row.key}`, { mode: "base", enabled, cascade: withCascade });
      toast(enabled ? "Modul yoqildi" : "Modul o‘chirildi — ma’lumotlar saqlanadi");
      changed();
    } catch (reason) {
      const err = reason as { code?: string; message: string };
      if (err.code === "MODULE_DEPENDENCY") setCascade({ row, enabled, message: err.message });
      else toast(err.message, "error");
    }
  };
  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;
  if (!data) return <Skeleton rows={8} />;
  const editable = can("modules.manage");
  return (
    <Section
      title="Modullar"
      subtitle="O‘chirilgan modul UI’da yashiriladi va API’da ham yopiladi; ma’lumotlar o‘chmaydi — qayta yoqilsa hammasi joyida"
      actions={
        editable && (
          <span className="sa-chips">
            {data.presets.map((p) => (
              <button key={p.key} type="button" title={p.description} onClick={() => run(() => post(`/super-admin/companies/${companyId}/modules/preset`, { preset: p.key }), toast, `«${p.label}» qo‘llandi`).then(changed)}>
                {p.label}
              </button>
            ))}
          </span>
        )
      }
    >
      {(Object.entries(moduleGroups) as [ModuleGroup, string][]).map(([group, title]) => {
        const items = data.modules.filter((m) => m.group === group);
        if (!items.length) return null;
        return (
          <div key={group} className="sa-group">
            <h4>{title}</h4>
            {items.map((m) => (
              <div key={m.key} className={`sa-module ${m.enabled ? "" : "off"}`}>
                <span>
                  <b>{m.label}</b>
                  <small>
                    {m.description}
                    {m.dependsOn.length ? ` · talab: ${m.dependsOn.join(", ")}` : ""}
                  </small>
                  <small className="sa-module-state">
                    <StatusBadge value={m.enabled ? "ACTIVE" : "DISABLED"} label={REASONS[m.reason] || m.reason} />
                    {m.override?.expiresAt && ` · ${dateOnly(m.override.expiresAt)} gacha`}
                    {m.override?.trial && " · sinov"}
                  </small>
                </span>
                {editable && (
                  <span className="sa-row-actions">
                    <button className="btn btn-sm" onClick={() => setOverride(m)}>
                      Vaqtinchalik
                    </button>
                    <label className="switch" title={m.base ? "O‘chirish" : "Yoqish"}>
                      <input type="checkbox" checked={m.base} onChange={(e) => void toggle(m, e.target.checked)} aria-label={`${m.label} — asosiy holat`} />
                      <span />
                    </label>
                  </span>
                )}
              </div>
            ))}
          </div>
        );
      })}
      {override && <OverrideModal companyId={companyId} row={override} onClose={() => setOverride(null)} onSaved={() => (setOverride(null), changed())} />}
      {cascade && (
        <ConfirmDialog
          title="Bog‘liq modullar"
          text={`${cascade.message}. Bog‘liq modullar ham birga ${cascade.enabled ? "yoqilsinmi" : "o‘chirilsinmi"}?`}
          confirmLabel="Ha, birga"
          onClose={() => setCascade(null)}
          onConfirm={() => toggle(cascade.row, cascade.enabled, true)}
        />
      )}
    </Section>
  );
}

function OverrideModal({ companyId, row, onClose, onSaved }: { companyId: string; row: ModuleRow; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ enabled: row.override?.enabled ?? true, expiresAt: row.override?.expiresAt?.slice(0, 10) || "", trial: row.override?.trial || false, note: row.override?.note || "" });
  return (
    <Modal title={`${row.label} — vaqtinchalik kirish`} subtitle="Muddat tugagach asosiy holatga qaytadi" onClose={onClose} size="narrow">
      <Field label="Holat">
        <select className="select" value={form.enabled ? "on" : "off"} onChange={(e) => setForm({ ...form, enabled: e.target.value === "on" })}>
          <option value="on">Yoqilgan</option>
          <option value="off">O‘chirilgan</option>
        </select>
      </Field>
      <Field label="Muddat (gacha)" hint="Bo‘sh — muddatsiz">
        <input className="input" type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
      </Field>
      <label className="sa-check">
        <input type="checkbox" checked={form.trial} onChange={(e) => setForm({ ...form, trial: e.target.checked })} /> Sinov (trial) kirishi
      </label>
      <Field label="Izoh">
        <input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
      </Field>
      <div className="form-actions">
        {row.override && (
          <button
            className="btn"
            onClick={async () => {
              await patch(`/super-admin/companies/${companyId}/modules/${row.key}`, { mode: "clear_override" }).catch((e) => toast(e.message, "error"));
              onSaved();
            }}
          >
            Olib tashlash
          </button>
        )}
        <button
          className="btn btn-primary"
          onClick={async () => {
            try {
              await patch(`/super-admin/companies/${companyId}/modules/${row.key}`, { mode: "override", ...form });
              toast("Saqlandi");
              onSaved();
            } catch (reason) {
              toast(reason instanceof Error ? reason.message : "Xatolik", "error");
            }
          }}
        >
          Saqlash
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------- tarif va limitlar --- */
type Plan = { id: string; name: string; status: string; limits: Record<string, number | null> };
type Bill = { id: string; number: string; amount: number; discount?: number; currency: string; status: string; periodStart: string; periodEnd: string; createdAt: string };
type Promo = { id: string; code: string; effect: string; status: string };
function PlanTab({ data, onChanged }: { data: Detail; onChanged: () => void }) {
  const toast = useToast();
  const run = useAction();
  const { can } = usePlatform();
  const companyId = data.company.id;
  const { data: plans } = useApi<Plan[]>("/super-admin/plans");
  const { data: bills, reload: reloadBills } = useServerList<Bill & { company: string }>(can("billing.read") ? "/super-admin/billing" : null, { companyId, pageSize: 20 });
  const { data: promos } = useApi<Promo[]>(can("promos.manage") ? "/super-admin/promos" : null);
  const [action, setAction] = useState<null | "change_plan" | "extend_trial" | "grant_free" | "set_period" | "set_limits" | "set_grace">(null);
  const sub = data.subscription;
  const act = async (body: Record<string, unknown>, message: string) => {
    const result = await run(() => post(`/super-admin/companies/${companyId}/subscription`, body), toast, message);
    if (result) {
      setAction(null);
      onChanged();
    }
  };
  return (
    <div className="sa-grid-2">
      <Section title="Obuna" subtitle="To‘lov provayderi ulanmagan — amallar qo‘lda, auditga yoziladi">
        {sub ? (
          <KeyValue
            items={[
              ["Tarif", data.plan?.name || "—"],
              ["Holat", <StatusBadge key="s" value={sub.computedStatus} />],
              ["Boshlangan", dateOnly(sub.startedAt)],
              ["Tugash", sub.periodEnd ? `${dateOnly(sub.periodEnd)} · ${sub.daysLeft} kun` : "Muddatsiz"],
              ["Imtiyozli davr", `${sub.graceDays} kun`],
              ["Limitlar", `Xodim ${data.plan?.limits.employees ?? "∞"}${sub.limits?.employees !== undefined ? ` → ${sub.limits.employees ?? "∞"}` : ""} · filial ${data.plan?.limits.branches ?? "∞"}${sub.limits?.branches !== undefined ? ` → ${sub.limits.branches ?? "∞"}` : ""} · rahbar ${data.plan?.limits.managers ?? "∞"}${sub.limits?.managers !== undefined ? ` → ${sub.limits.managers ?? "∞"}` : ""}`],
              ["Izoh", sub.note || "—"],
            ]}
          />
        ) : (
          <p className="muted">Obuna yo‘q — tarif tanlang.</p>
        )}
        <PermissionGuard perm="subscriptions.manage">
          <div className="sa-actions-grid">
            <button className="btn" onClick={() => setAction("change_plan")}>
              Tarifni almashtirish
            </button>
            <button className="btn" onClick={() => setAction("extend_trial")} disabled={!sub}>
              Sinovni uzaytirish
            </button>
            <button className="btn" onClick={() => setAction("grant_free")}>
              Bepul tarif berish
            </button>
            <button className="btn" onClick={() => setAction("set_period")} disabled={!sub}>
              Davr tugash sanasi
            </button>
            <button className="btn" onClick={() => setAction("set_limits")} disabled={!sub}>
              Limitlarni o‘zgartirish
            </button>
            <button className="btn" onClick={() => setAction("set_grace")} disabled={!sub}>
              Imtiyozli davr
            </button>
            {sub &&
              (sub.pausedAt ? (
                <button className="btn" onClick={() => act({ action: "resume" }, "Obuna davom ettirildi")}>
                  Davom ettirish
                </button>
              ) : (
                <button className="btn" onClick={() => act({ action: "pause" }, "Obuna to‘xtatildi")}>
                  Vaqtincha to‘xtatish
                </button>
              ))}
          </div>
        </PermissionGuard>
      </Section>
      <PermissionGuard perm="promos.manage">
        <Section title="Promo kod qo‘llash">
          <PromoApply companyId={companyId} promos={promos || []} bills={bills?.rows || []} onDone={() => (onChanged(), void reloadBills(true))} />
        </Section>
      </PermissionGuard>
      <PermissionGuard perm="billing.read">
        <Section title="Hisob-fakturalar" actions={<Link className="btn btn-sm" to={`/super-admin/billing?companyId=${companyId}`}>Hisob-kitob</Link>}>
          <DataTable
            rows={bills?.rows}
            rowKey={(r) => r.id}
            loading={!bills}
            empty={<p className="muted sa-empty">Hisob-faktura yo‘q</p>}
            columns={[
              { key: "n", label: "Raqam", render: (r) => <b>{r.number}</b> },
              { key: "p", label: "Davr", render: (r) => `${dateOnly(r.periodStart)} — ${dateOnly(r.periodEnd)}` },
              { key: "a", label: "Summa", className: "num", render: (r) => money(r.amount - (r.discount || 0), r.currency) },
              { key: "s", label: "Holat", render: (r) => <StatusBadge value={r.status} /> },
            ]}
          />
        </Section>
      </PermissionGuard>
      <PermissionGuard perm="contracts.read">
        <ContractsBox companyId={companyId} />
      </PermissionGuard>
      {action && <SubscriptionModal action={action} plans={(plans || []).filter((p) => p.status === "ACTIVE")} current={sub} onClose={() => setAction(null)} onSubmit={act} />}
    </div>
  );
}

function SubscriptionModal({
  action,
  plans,
  current,
  onClose,
  onSubmit,
}: {
  action: "change_plan" | "extend_trial" | "grant_free" | "set_period" | "set_limits" | "set_grace";
  plans: Plan[];
  current: Detail["subscription"];
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>, message: string) => Promise<void>;
}) {
  const [planId, setPlanId] = useState(current?.planId || plans[0]?.id || "");
  const [days, setDays] = useState("30");
  const [date, setDate] = useState(current?.periodEnd?.slice(0, 10) || "");
  const [limits, setLimits] = useState({ employees: current?.limits?.employees ?? "", branches: current?.limits?.branches ?? "", managers: current?.limits?.managers ?? "" } as Record<string, string | number | null>);
  const [grace, setGrace] = useState(String(current?.graceDays ?? 7));
  const [note, setNote] = useState("");
  const titles = { change_plan: "Tarifni almashtirish", extend_trial: "Sinovni uzaytirish", grant_free: "Bepul tarif berish", set_period: "Davr tugash sanasi", set_limits: "Kompaniyaga xos limitlar", set_grace: "Imtiyozli davr" };
  const toLimit = (v: string | number | null) => (v === "" || v === null ? null : Number(v));
  return (
    <Modal title={titles[action]} onClose={onClose} size="narrow">
      {(action === "change_plan" || action === "grant_free") && (
        <Field label="Tarif">
          <select className="select" value={planId} onChange={(e) => setPlanId(e.target.value)}>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {(action === "extend_trial" || action === "grant_free") && (
        <Field label="Kunlar">
          <input className="input" type="number" min={1} max={3650} value={days} onChange={(e) => setDays(e.target.value)} />
        </Field>
      )}
      {action === "set_period" && (
        <Field label="Tugash sanasi" hint="Bo‘sh — muddatsiz">
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      )}
      {action === "set_limits" && (
        <div className="form-grid">
          {(["employees", "branches", "managers"] as const).map((key) => (
            <Field key={key} label={{ employees: "Xodimlar", branches: "Filiallar", managers: "Rahbarlar" }[key]} hint="Bo‘sh — tarifdagi qiymat">
              <input className="input" type="number" min={0} value={limits[key] ?? ""} onChange={(e) => setLimits({ ...limits, [key]: e.target.value })} placeholder="tarif bo‘yicha" />
            </Field>
          ))}
        </div>
      )}
      {action === "set_grace" && (
        <Field label="Imtiyozli davr (kun)">
          <input className="input" type="number" min={0} max={90} value={grace} onChange={(e) => setGrace(e.target.value)} />
        </Field>
      )}
      <Field label="Izoh (auditga)">
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="form-actions">
        <button className="btn" onClick={onClose}>
          Bekor qilish
        </button>
        <button
          className="btn btn-primary"
          onClick={() => {
            const base = { note: note || undefined };
            if (action === "change_plan") void onSubmit({ action, planId, ...base }, "Tarif almashtirildi");
            if (action === "extend_trial") void onSubmit({ action, days: Number(days), ...base }, "Sinov uzaytirildi");
            if (action === "grant_free") void onSubmit({ action, planId, days: Number(days), ...base }, "Bepul tarif berildi");
            if (action === "set_period") void onSubmit({ action, endsAt: date ? `${date}T23:59:59+05:00` : null, ...base }, "Davr yangilandi");
            if (action === "set_limits")
              void onSubmit(
                { action, limits: Object.fromEntries(Object.entries(limits).filter(([, v]) => v !== "" && v !== null).map(([k, v]) => [k, toLimit(v)])), ...base },
                "Limitlar saqlandi",
              );
            if (action === "set_grace") void onSubmit({ action, graceDays: Number(grace), ...base }, "Imtiyozli davr saqlandi");
          }}
        >
          Saqlash
        </button>
      </div>
    </Modal>
  );
}

function PromoApply({ companyId, promos, bills, onDone }: { companyId: string; promos: Promo[]; bills: Bill[]; onDone: () => void }) {
  const toast = useToast();
  const run = useAction();
  const [promoId, setPromoId] = useState("");
  const [billId, setBillId] = useState("");
  const active = promos.filter((p) => p.status === "ACTIVE");
  const chosen = active.find((p) => p.id === promoId);
  const needsBill = chosen && /chegirma/.test(chosen.effect);
  return (
    <div className="sa-form-row">
      <select className="select" value={promoId} onChange={(e) => setPromoId(e.target.value)} aria-label="Promo kod">
        <option value="">Promo kodni tanlang</option>
        {active.map((p) => (
          <option key={p.id} value={p.id}>
            {p.code} — {p.effect}
          </option>
        ))}
      </select>
      {needsBill && (
        <select className="select" value={billId} onChange={(e) => setBillId(e.target.value)} aria-label="Hisob-faktura">
          <option value="">Hisob-faktura</option>
          {bills.filter((b) => ["DRAFT", "ISSUED"].includes(b.status)).map((b) => (
            <option key={b.id} value={b.id}>
              {b.number} — {money(b.amount, b.currency)}
            </option>
          ))}
        </select>
      )}
      <button
        className="btn btn-primary"
        disabled={!promoId || (needsBill && !billId)}
        onClick={async () => {
          const r = await run(() => post(`/super-admin/promos/${promoId}/redeem`, { companyId, billingRecordId: billId || undefined }), toast, "Promo kod qo‘llandi");
          if (r) {
            setPromoId("");
            setBillId("");
            onDone();
          }
        }}
      >
        Qo‘llash
      </button>
    </div>
  );
}

type Contract = { id: string; groupId: string; version: number; type: string; title: string; number?: string; startsAt?: string; endsAt?: string; status: string; fileName: string; size: number; uploadedBy: string; createdAt: string };
function ContractsBox({ companyId }: { companyId: string }) {
  const toast = useToast();
  const run = useAction();
  const { data, reload } = useApi<Contract[]>(`/super-admin/contracts?companyId=${companyId}`);
  const [uploading, setUploading] = useState<{ groupId?: string } | null>(null);
  return (
    <Section
      title="Shartnomalar"
      actions={
        <PermissionGuard perm="contracts.manage">
          <button className="btn btn-sm" onClick={() => setUploading({})}>
            <Plus size={14} /> Yuklash
          </button>
        </PermissionGuard>
      }
    >
      <DataTable
        rows={data || undefined}
        rowKey={(r) => r.id}
        loading={!data}
        empty={<p className="muted sa-empty">Shartnoma yuklanmagan</p>}
        columns={[
          { key: "t", label: "Shartnoma", render: (r) => <span className="stack"><b>{r.title} · v{r.version}</b><small>{r.number || r.type} · {bytes(r.size)}</small></span> },
          { key: "d", label: "Muddat", render: (r) => (r.endsAt ? `${dateOnly(r.startsAt)} — ${dateOnly(r.endsAt)}` : "—") },
          { key: "s", label: "Holat", render: (r) => <StatusBadge value={r.status} /> },
          {
            key: "a",
            label: "",
            render: (r) => (
              <span className="sa-row-actions">
                <button className="btn btn-sm" onClick={() => run(() => downloadFile(`/super-admin/contracts/${r.id}/file`, r.fileName), toast)}>
                  Yuklab olish
                </button>
                <PermissionGuard perm="contracts.manage">
                  <button className="btn btn-sm" onClick={() => setUploading({ groupId: r.groupId })}>
                    Yangi versiya
                  </button>
                </PermissionGuard>
              </span>
            ),
          },
        ]}
      />
      {uploading && <ContractUpload companyId={companyId} groupId={uploading.groupId} onClose={() => setUploading(null)} onDone={() => (setUploading(null), void reload(true))} />}
    </Section>
  );
}

export function ContractUpload({ companyId, groupId, onClose, onDone }: { companyId: string; groupId?: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ type: "SERVICE", title: "", number: "", startsAt: "", endsAt: "", note: "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={groupId ? "Shartnomaning yangi versiyasi" : "Shartnoma yuklash"} subtitle="PDF yoki rasm, 1,4 MB gacha · yopiq saqlanadi" onClose={onClose}>
      <div className="form-grid">
        <Field label="Turi">
          <select className="select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="SERVICE">Xizmat shartnomasi</option>
            <option value="NDA">NDA</option>
            <option value="DPA">Ma’lumotlarni qayta ishlash (DPA)</option>
            <option value="ADDENDUM">Qo‘shimcha kelishuv</option>
            <option value="OTHER">Boshqa</option>
          </select>
        </Field>
        <Field label="Nomi *">
          <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="Raqami">
          <input className="input" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} />
        </Field>
        <Field label="Boshlanish">
          <input className="input" type="date" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
        </Field>
        <Field label="Tugash">
          <input className="input" type="date" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} />
        </Field>
        <Field label="Fayl *">
          <input className="input" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </Field>
      </div>
      <div className="form-actions">
        <button className="btn" onClick={onClose}>
          Bekor qilish
        </button>
        <button
          className="btn btn-primary"
          disabled={busy || !file || form.title.trim().length < 2}
          onClick={async () => {
            if (!file) return;
            setBusy(true);
            try {
              await post("/super-admin/contracts", { ...form, companyId, groupId, fileName: file.name, dataUrl: await readFileAsDataUrl(file) });
              toast("Shartnoma yuklandi");
              onDone();
            } catch (reason) {
              toast(reason instanceof Error ? reason.message : "Xatolik", "error");
            } finally {
              setBusy(false);
            }
          }}
        >
          Yuklash
        </button>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- faollik --- */
function ActivityTab({ companyId }: { companyId: string }) {
  const [days, setDays] = useState("30");
  const { data, error, reload } = useApi<{ series: { date: string; attendance: number; late: number; requests: number; errors: number; activeUsers: number; employeeRequests: number }[] }>(`/super-admin/companies/${companyId}/activity?days=${days}`);
  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;
  if (!data) return <Skeleton rows={6} />;
  const table = { headers: ["Sana", "Davomat", "Kechikkan", "API so‘rovlar", "Xatolar", "Faol rahbarlar"], rows: data.series.map((r) => [r.date, r.attendance, r.late, r.requests, r.errors, r.activeUsers]) };
  return (
    <>
      <FilterBar>
        <Select
          label="Davr"
          value={days}
          onChange={setDays}
          options={[
            ["7", "7 kun"],
            ["30", "30 kun"],
            ["90", "90 kun"],
          ]}
        />
      </FilterBar>
      <div className="sa-grid-2">
        <ChartCard title="Davomat qaydlari" subtitle="Kunlik" table={table}>
          <Columns data={data.series} x="date" y="attendance" name="Qaydlar" />
        </ChartCard>
        <ChartCard title="Kechikkanlar" subtitle="Kunlik (alohida grafik)" table={table}>
          <Columns data={data.series} x="date" y="late" name="Kechikkan" color="var(--chart-late)" />
        </ChartCard>
        <ChartCard title="API so‘rovlar" subtitle="Panel + Mini App" table={table}>
          <Columns data={data.series} x="date" y="requests" name="So‘rovlar" />
        </ChartCard>
        <ChartCard title="Faol panel foydalanuvchilari" subtitle="Kunlik noyob" table={table}>
          <TrendLine data={data.series} x="date" y="activeUsers" name="Foydalanuvchilar" />
        </ChartCard>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ audit --- */
function AuditTab({ companyId }: { companyId: string }) {
  const [page, setPage] = useState(1);
  const { data, error, reload } = useServerList<{ id: string; at: string; source: string; action: string; title: string; actor: string }>(`/super-admin/companies/${companyId}/timeline`, { page, pageSize: 40 });
  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;
  return (
    <Section title="Kompaniya tarixi" subtitle="Platforma auditi va kompaniyaning o‘z jurnali birlashtirilgan">
      {data ? <ActivityTimeline items={data.rows.map((r) => ({ id: r.id, at: r.at, title: r.title, meta: `${r.source === "platform" ? "Platforma" : r.source === "company" ? "Kompaniya" : "Tizim"}${r.actor ? ` · ${r.actor}` : ""}`, tone: r.source === "platform" ? "warn" : "default" }))} /> : <Skeleton rows={8} />}
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </Section>
  );
}

/* --------------------------------------------------------------- qurilmalar --- */
function DevicesTab({ companyId }: { companyId: string }) {
  const toast = useToast();
  const run = useAction();
  const { data, error, reload } = useApi<{
    panel: { id: string; user: string; label: string; device: string; ip: string; createdAt: string; lastSeenAt: string; revokedAt: string | null }[];
    mobile: { id: string; employee: string; platform: string; model: string | null; appVersion: string | null; status: string; lastSeenAt: string | null; revokedAt: string | null }[];
    biometric: number;
  }>(`/super-admin/companies/${companyId}/devices`);
  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;
  if (!data) return <Skeleton rows={6} />;
  return (
    <>
      <Section title="Panel sessiyalari" subtitle="Brauzer va qurilma turi (fingerprint yig‘ilmaydi)">
        <DataTable
          rows={data.panel}
          rowKey={(r) => r.id}
          empty={<p className="muted sa-empty">Sessiya yo‘q</p>}
          columns={[
            { key: "u", label: "Foydalanuvchi", render: (r) => <b>{r.user}</b> },
            { key: "d", label: "Qurilma", render: (r) => `${r.label} · ${r.device}` },
            { key: "ip", label: "IP", hideOnMobile: true, render: (r) => r.ip },
            { key: "s", label: "Oxirgi faollik", render: (r) => <span className="muted">{ago(r.lastSeenAt)}</span> },
            { key: "st", label: "Holat", render: (r) => (r.revokedAt ? <StatusBadge value="REVOKED" /> : <StatusBadge value="ACTIVE" />) },
            {
              key: "a",
              label: "",
              render: (r) =>
                !r.revokedAt && (
                  <PermissionGuard perm="sessions.manage">
                    <button className="btn btn-sm" onClick={() => run(() => post(`/super-admin/sessions/${r.id}/revoke`, { kind: "panel" }), toast, "Sessiya yopildi").then(() => reload(true))}>
                      Yopish
                    </button>
                  </PermissionGuard>
                ),
            },
          ]}
        />
      </Section>
      <Section title={`Mobil qurilmalar · biometrik ulangan: ${data.biometric}`}>
        <DataTable
          rows={data.mobile}
          rowKey={(r) => r.id}
          empty={<p className="muted sa-empty">Mobil qurilma yo‘q</p>}
          columns={[
            { key: "e", label: "Xodim", render: (r) => <b>{r.employee}</b> },
            { key: "p", label: "Qurilma", render: (r) => `${r.platform === "ios" ? "iOS" : "Android"}${r.model ? ` · ${r.model}` : ""}` },
            { key: "v", label: "Ilova", hideOnMobile: true, render: (r) => r.appVersion || "—" },
            { key: "s", label: "Oxirgi faollik", render: (r) => <span className="muted">{ago(r.lastSeenAt)}</span> },
            { key: "st", label: "Holat", render: (r) => <StatusBadge value={r.status} /> },
          ]}
        />
      </Section>
    </>
  );
}

/* ---------------------------------------------------------- integratsiyalar --- */
function IntegrationsTab({ companyId }: { companyId: string }) {
  const { data, error, reload } = useApi<{
    bot: { enabled: boolean; username: string | null; status: string | null; lastError: string | null } | null;
    integration: { name: string; status: string; baseUrl: string; lastSyncAt: string | null; lastError: string | null } | null;
    photoChannel: { enabled: boolean } | null;
    apiKeys: { id: string; name: string; prefix: string; scopes: string[]; revokedAt?: string; lastUsedAt?: string; expiresAt?: string }[];
    webhooks: { id: string; url: string; events: string[]; enabled: boolean; failures: number; lastStatus?: number; lastDeliveryAt?: string }[];
  }>(`/super-admin/companies/${companyId}/integrations`);
  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;
  if (!data) return <Skeleton rows={6} />;
  return (
    <div className="sa-grid-2">
      <Section title="Kanallar">
        <ul className="sa-checks">
          <li>
            <StatusBadge value={!data.bot?.enabled ? "NOT_CONFIGURED" : data.bot.status === "RUNNING" ? "OK" : data.bot.status === "ERROR" ? "DOWN" : "WARN"} />
            <span>
              <b>Kompaniya boti {data.bot?.username ? `@${data.bot.username}` : ""}</b>
              <small>{data.bot?.lastError || (data.bot?.enabled ? data.bot.status : "Ulanmagan")}</small>
            </span>
          </li>
          <li>
            <StatusBadge value={!data.integration ? "NOT_CONFIGURED" : data.integration.status === "ERROR" ? "DOWN" : "OK"} />
            <span>
              <b>Xodimlar boti (HR integratsiya)</b>
              <small>{data.integration ? `${data.integration.baseUrl} · ${data.integration.lastSyncAt ? ago(data.integration.lastSyncAt) : "sinxronlanmagan"}${data.integration.lastError ? ` · ${data.integration.lastError}` : ""}` : "Ulanmagan"}</small>
            </span>
          </li>
          <li>
            <StatusBadge value={data.photoChannel?.enabled ? "OK" : "NOT_CONFIGURED"} />
            <span>
              <b>Rasm kanali</b>
              <small>{data.photoChannel?.enabled ? "Yoqilgan" : "O‘chiq"}</small>
            </span>
          </li>
        </ul>
      </Section>
      <Section title="API kalitlar va webhooklar" actions={<Link className="btn btn-sm" to={`/super-admin/api-keys?companyId=${companyId}`}>Boshqarish</Link>}>
        <KeyValue
          items={[
            ["Faol API kalitlar", String(data.apiKeys.filter((k) => !k.revokedAt).length)],
            ["Webhooklar", `${data.webhooks.filter((w) => w.enabled).length} faol / ${data.webhooks.length}`],
            ["Nosoz webhooklar", String(data.webhooks.filter((w) => w.failures >= 5).length)],
          ]}
        />
        <p className="muted">
          <Link to={`/super-admin/webhooks?companyId=${companyId}`}>Webhooklar sahifasi →</Link>
        </p>
      </Section>
    </div>
  );
}

/* --------------------------------------------------------------- murojaatlar --- */
function SupportTab({ companyId }: { companyId: string }) {
  const navigate = useNavigate();
  const { data, error, reload } = useServerList<{ id: string; number: number; subject: string; priority: string; status: string; updatedAt: string; unread: boolean; assignedName: string | null }>("/super-admin/support/tickets", { companyId, pageSize: 50 });
  return (
    <Section title="Murojaatlar" actions={<Link className="btn btn-sm" to="/super-admin/support"><LifeBuoy size={14} /> Support Center</Link>}>
      <DataTable
        rows={data?.rows}
        rowKey={(r) => r.id}
        loading={!data}
        error={error}
        onRetry={() => void reload()}
        empty={<p className="muted sa-empty">Murojaat yo‘q</p>}
        onRowClick={(r) => navigate(`/super-admin/support?ticket=${r.id}`)}
        columns={[
          { key: "n", label: "#", render: (r) => <b>#{r.number}</b> },
          { key: "s", label: "Mavzu", render: (r) => <span className={r.unread ? "sa-unread" : ""}>{r.subject}</span> },
          { key: "p", label: "Muhimlik", render: (r) => <StatusBadge value={r.priority} /> },
          { key: "st", label: "Holat", render: (r) => <StatusBadge value={r.status} /> },
          { key: "a", label: "Mas’ul", hideOnMobile: true, render: (r) => r.assignedName || "—" },
          { key: "u", label: "Yangilangan", render: (r) => <span className="muted">{ago(r.updatedAt)}</span> },
        ]}
      />
    </Section>
  );
}

/* --------------------------------------------------------------- sozlamalar --- */
function SettingsTab({ data, onChanged }: { data: Detail; onChanged: () => void }) {
  const toast = useToast();
  const run = useAction();
  const navigate = useNavigate();
  const c = data.company;
  const [form, setForm] = useState({ name: c.name, timezone: c.timezone, adminNote: c.adminNote || "", internal: Boolean(c.internal), limitContact: c.limitContact || "" });
  const [confirm, setConfirm] = useState<null | "block" | "archive" | "support" | "demo">(null);
  const [minutes, setMinutes] = useState("30");
  return (
    <div className="sa-grid-2">
      <Section title="Asosiy sozlamalar">
        <PermissionGuard perm="companies.manage" fallback={<KeyValue items={[["Nomi", c.name], ["Vaqt mintaqasi", c.timezone], ["Ichki izoh", c.adminNote || "—"]]} />}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run(() => patch(`/super-admin/companies/${c.id}`, form), toast, "Saqlandi")) onChanged();
            }}
          >
            <div className="form-grid">
              <Field label="Kompaniya nomi">
                <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} minLength={2} required />
              </Field>
              <Field label="Vaqt mintaqasi">
                <input className="input" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} />
              </Field>
              <Field label="Limit oshganda aloqa">
                <input className="input" value={form.limitContact} onChange={(e) => setForm({ ...form, limitContact: e.target.value })} placeholder="@mamatov_ads" />
              </Field>
            </div>
            <Field label="Ichki izoh" hint="Faqat platforma administratorlariga ko‘rinadi">
              <textarea className="textarea" rows={3} value={form.adminNote} onChange={(e) => setForm({ ...form, adminNote: e.target.value })} />
            </Field>
            <label className="sa-check">
              <input type="checkbox" checked={form.internal} onChange={(e) => setForm({ ...form, internal: e.target.checked })} /> Ichki (test) kompaniya
            </label>
            <div className="form-actions">
              <button className="btn btn-primary">Saqlash</button>
            </div>
          </form>
        </PermissionGuard>
      </Section>
      <Section title="Holat va xavfli amallar">
        <div className="sa-danger-list">
          <PermissionGuard perm="companies.manage">
            {c.status === "SUSPENDED" && !c.archive ? (
              <div>
                <span>
                  <b>Kompaniya bloklangan</b>
                  <small>Panel va botlar ishlamayapti</small>
                </span>
                <button className="btn" onClick={() => run(() => post(`/super-admin/companies/${c.id}/status`, { status: "ACTIVE" }), toast, "Faollashtirildi").then(onChanged)}>
                  <Unlock size={14} /> Faollashtirish
                </button>
              </div>
            ) : (
              !c.archive && (
                <div>
                  <span>
                    <b>Bloklash</b>
                    <small>Kirish va botlar to‘xtaydi, ma’lumot saqlanadi</small>
                  </span>
                  <button className="btn btn-danger" onClick={() => setConfirm("block")}>
                    <Ban size={14} /> Bloklash
                  </button>
                </div>
              )
            )}
          </PermissionGuard>
          <PermissionGuard perm="companies.archive">
            <div>
              <span>
                <b>{c.archive ? "Arxivdan tiklash" : "Arxivlash"}</b>
                <small>{c.archive ? `${dateTime(c.archive.at)} · ${c.archive.by}: ${c.archive.reason}` : "Ma’lumot o‘chirilmaydi, istalgan vaqt tiklanadi"}</small>
              </span>
              {c.archive ? (
                <button className="btn" onClick={() => run(() => post(`/super-admin/companies/${c.id}/restore`, {}), toast, "Tiklandi").then(onChanged)}>
                  <RotateCcw size={14} /> Tiklash
                </button>
              ) : (
                <button className="btn btn-danger" onClick={() => setConfirm("archive")}>
                  Arxivlash
                </button>
              )}
            </div>
          </PermissionGuard>
          <PermissionGuard perm="companies.support">
            <div>
              <span>
                <b>Yordam kirishi (yozish huquqi)</b>
                <small>Sabab, vaqt chegarasi, Owner tasdig‘i; har bir amal auditga yoziladi. Global sozlamada yoqilgan bo‘lishi kerak.</small>
              </span>
              <button className="btn" onClick={() => setConfirm("support")}>
                <ShieldCheck size={14} /> So‘rash
              </button>
            </div>
          </PermissionGuard>
          {c.demo && (
            <PermissionGuard perm="companies.create">
              <div>
                <span>
                  <b>Demo kompaniyani tozalash</b>
                  <small>Faqat sintetik ma’lumot · avtomatik tozalash: {dateOnly(c.demo.expiresAt)}</small>
                </span>
                <button className="btn btn-danger" onClick={() => setConfirm("demo")}>
                  <Trash2 size={14} /> Tozalash
                </button>
              </div>
            </PermissionGuard>
          )}
        </div>
      </Section>
      <Section title="Ko‘rish va yordam sessiyalari">
        <DataTable
          rows={data.previews}
          rowKey={(r) => r.id}
          empty={<p className="muted sa-empty">Sessiya yo‘q</p>}
          columns={[
            { key: "a", label: "Administrator", render: (r) => <span className="stack"><b>{r.adminName}</b><small>{r.mode === "SUPPORT" ? `Yordam: ${r.reason || ""}` : "Faqat o‘qish"}</small></span> },
            { key: "t", label: "Vaqt", render: (r) => `${dateTime(r.createdAt)} → ${dateTime(r.expiresAt)}` },
            { key: "s", label: "Holat", render: (r) => <StatusBadge value={r.status} /> },
            {
              key: "x",
              label: "",
              render: (r) => (
                <span className="sa-row-actions">
                  {r.status === "PENDING_APPROVAL" && (
                    <PermissionGuard perm="admins.manage">
                      <button className="btn btn-sm" onClick={() => run(() => post(`/super-admin/preview-sessions/${r.id}/approve`, {}), toast, "Tasdiqlandi").then(onChanged)}>
                        Tasdiqlash
                      </button>
                    </PermissionGuard>
                  )}
                  {r.status === "ACTIVE" && r.mode === "SUPPORT" && (
                    <button
                      className="btn btn-sm"
                      onClick={async () => {
                        const link = await run(() => post<{ url: string }>(`/super-admin/preview-sessions/${r.id}/link`, {}), toast);
                        if (link) window.open(link.url, "_blank", "noopener");
                      }}
                    >
                      Ochish
                    </button>
                  )}
                  {(r.status === "ACTIVE" || r.status === "PENDING_APPROVAL") && (
                    <button className="btn btn-sm" onClick={() => run(() => post(`/super-admin/preview-sessions/${r.id}/end`, {}), toast, "Tugatildi").then(onChanged)}>
                      Tugatish
                    </button>
                  )}
                </span>
              ),
            },
          ]}
        />
      </Section>
      {confirm === "block" && (
        <ConfirmDialog
          title="Kompaniyani bloklash"
          text="Kompaniya foydalanuvchilari panelga kira olmaydi, botlar to‘xtaydi. Ma’lumotlar o‘chmaydi."
          danger
          confirmLabel="Bloklash"
          typed={c.name}
          reason={{ label: "Sabab", required: true }}
          onClose={() => setConfirm(null)}
          onConfirm={async (reason) => {
            await post(`/super-admin/companies/${c.id}/status`, { status: "SUSPENDED", reason });
            toast("Kompaniya bloklandi");
            onChanged();
          }}
        />
      )}
      {confirm === "archive" && (
        <ConfirmDialog
          title="Kompaniyani arxivlash"
          text="Kompaniya to‘xtatiladi va arxivga o‘tadi. Hech qanday ma’lumot o‘chirilmaydi — istalgan vaqt tiklash mumkin. Parolingiz so‘ralishi mumkin."
          danger
          confirmLabel="Arxivlash"
          typed={c.name}
          reason={{ label: "Arxivlash sababi", required: true }}
          onClose={() => setConfirm(null)}
          onConfirm={async (reason) => {
            if (await run(() => post(`/super-admin/companies/${c.id}/archive`, { reason }), toast, "Arxivlandi")) onChanged();
          }}
        />
      )}
      {confirm === "support" && (
        <ConfirmDialog
          title="Yordam kirishini so‘rash"
          text={
            <>
              Kompaniya paneliga <b>yozish huquqi</b> bilan vaqtinchalik kirish. Har bir amal auditga yoziladi.
              <label className="field" style={{ marginTop: 12 }}>
                <span className="label">Davomiyligi (daqiqa, 5–60)</span>
                <input className="input" type="number" min={5} max={60} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
              </label>
            </>
          }
          confirmLabel="So‘rash"
          reason={{ label: "Sabab (kamida 10 belgi)", required: true, min: 10 }}
          onClose={() => setConfirm(null)}
          onConfirm={async (reason) => {
            const result = await run(() => post<{ session: { status: string }; url: string | null }>(`/super-admin/companies/${c.id}/support-access`, { reason, minutes: Number(minutes) }), toast);
            if (result?.url) window.open(result.url, "_blank", "noopener");
            else if (result) toast("So‘rov yuborildi — Owner tasdig‘i kutilmoqda");
            onChanged();
          }}
        />
      )}
      {confirm === "demo" && (
        <ConfirmDialog
          title="Demo kompaniyani tozalash"
          text="Demo kompaniya va uning barcha sintetik ma’lumotlari o‘chiriladi. Bu amal faqat demo kompaniyalar uchun."
          danger
          confirmLabel="Tozalash"
          typed={c.name}
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            if (await run(() => post(`/super-admin/companies/${c.id}/demo/cleanup`, {}), toast, "Demo tozalandi")) navigate("/super-admin/companies");
          }}
        />
      )}
    </div>
  );
}
