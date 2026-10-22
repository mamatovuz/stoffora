import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FlaskConical, Plus } from "lucide-react";
import { post } from "../../api";
import { Field, Modal, PageHeader, useToast } from "../../components/ui";
import { MODULE_PRESETS } from "@/lib/modules";
import {
  ConfirmDialog,
  DataTable,
  FilterBar,
  Pager,
  PermissionGuard,
  SearchInput,
  SecretReveal,
  Section,
  Select,
  StatusBadge,
  ago,
  dateOnly,
  num,
  useAction,
  useServerList,
  type Column,
} from "./kit";

/*
 * Kompaniyalar: ro‘yxat (qidiruv: nomi, ID, rahbar; filtrlar: holat, tarif, sana, faolsizlik; saralash),
 * arxiv, yangi kompaniya, bir tugmada demo kompaniya, onboarding.
 */

export type CompanyRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
  plan: string;
  planId?: string;
  subscriptionStatus: string | null;
  periodEnd: string | null;
  daysLeft: number | null;
  employees: number;
  employeeLimit: number | null;
  branches: number;
  leaders: number;
  owner: { id: string; name: string; email: string } | null;
  ownerName: string;
  modulesOn: number;
  modulesTotal: number;
  lastActivity: string | null;
  archive: { at: string; by: string; reason: string } | null;
  demo: { expiresAt: string } | null;
  internal: boolean;
  bot: string;
};
type Facets = { facets: { plans: { id: string; name: string }[]; views: Record<string, number> } };

function CompanyList({ view }: { view: "live" | "archived" | "demo" | "all" }) {
  const navigate = useNavigate();
  const toast = useToast();
  const run = useAction();
  const [state, setState] = useState({ q: "", status: "", plan: "", createdFrom: "", createdTo: "", inactiveDays: "", sort: "created", dir: "desc" as "asc" | "desc", page: 1 });
  const [tab, setTab] = useState(view);
  const set = (patch: Partial<typeof state>) => setState((s) => ({ ...s, page: 1, ...patch }));
  const { data, loading, error, reload } = useServerList<CompanyRow, Facets>("/super-admin/companies", { ...state, view: tab, pageSize: 25 });
  const [creating, setCreating] = useState(false);
  const [demo, setDemo] = useState(false);
  const [secret, setSecret] = useState<{ email: string; password?: string; name: string } | null>(null);
  const onQuery = useCallback((q: string) => set({ q }), []);
  const columns: Column<CompanyRow>[] = [
    {
      key: "name",
      label: "Kompaniya",
      sortable: true,
      render: (r) => (
        <span className="stack">
          <b>
            {r.name} {r.demo && <span className="badge violet">Demo</span>} {r.internal && !r.demo && <span className="badge gray">Ichki</span>}
          </b>
          <small>{r.owner ? `${r.owner.name} · ${r.owner.email}` : r.ownerName}</small>
        </span>
      ),
    },
    { key: "status", label: "Holat", render: (r) => (r.archive ? <StatusBadge value="ARCHIVED" /> : <StatusBadge value={r.status} />) },
    {
      key: "plan",
      label: "Tarif",
      render: (r) => (
        <span className="stack">
          <span>{r.plan || "—"}</span>
          {r.subscriptionStatus && (
            <small>
              <StatusBadge value={r.subscriptionStatus} />
              {r.daysLeft !== null && r.daysLeft >= 0 ? ` · ${r.daysLeft} kun` : ""}
            </small>
          )}
        </span>
      ),
    },
    { key: "employees", label: "Xodimlar", sortable: true, className: "num", render: (r) => <span className="num">{num(r.employees)}{r.employeeLimit ? <small> / {num(r.employeeLimit)}</small> : null}</span> },
    { key: "branches", label: "Filiallar", sortable: true, className: "num", hideOnMobile: true, render: (r) => num(r.branches) },
    { key: "modules", label: "Modullar", sortable: true, className: "num", hideOnMobile: true, render: (r) => `${r.modulesOn}/${r.modulesTotal}` },
    { key: "activity", label: "Oxirgi faollik", sortable: true, render: (r) => <span className="muted">{ago(r.lastActivity)}</span> },
    { key: "created", label: "Yaratilgan", sortable: true, hideOnMobile: true, render: (r) => <span className="muted">{dateOnly(r.createdAt)}</span> },
  ];
  const views = data?.facets.views;
  return (
    <>
      <PageHeader
        title={view === "archived" ? "Arxivlangan kompaniyalar" : "Kompaniyalar"}
        subtitle={view === "archived" ? "Arxiv ma’lumotni o‘chirmaydi — istalgan vaqt tiklash mumkin" : "Barcha kompaniyalar, tariflar va holat"}
        actions={
          view !== "archived" ? (
            <PermissionGuard perm="companies.create">
              <button className="btn" onClick={() => setDemo(true)}>
                <FlaskConical size={15} /> Demo kompaniya
              </button>
              <button className="btn btn-primary" onClick={() => setCreating(true)}>
                <Plus size={15} /> Kompaniya
              </button>
            </PermissionGuard>
          ) : undefined
        }
      />
      {secret && (
        <Section title={`${secret.name} — kirish ma’lumoti`} subtitle="Parol faqat hozir ko‘rinadi, uni egasiga xavfsiz yo‘l bilan bering">
          <SecretReveal label={secret.email} value={secret.password || "(o‘zingiz kiritgan parol)"} />
        </Section>
      )}
      <Section>
        {view !== "archived" && views && (
          <div className="segmented sa-views" role="tablist">
            {(
              [
                ["live", "Faol ro‘yxat"],
                ["demo", "Demo"],
                ["all", "Hammasi"],
              ] as const
            ).map(([key, label]) => (
              <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "active" : ""} onClick={() => (setTab(key), set({}))}>
                {label}
                <small>{views[key]}</small>
              </button>
            ))}
          </div>
        )}
        <FilterBar>
          <SearchInput value={state.q} onChange={onQuery} placeholder="Nomi, ID, rahbar yoki email…" />
          <Select
            label="Holat"
            value={state.status}
            onChange={(status) => set({ status })}
            options={[
              ["", "Barcha holatlar"],
              ["ACTIVE", "Faol"],
              ["TRIAL", "Sinov"],
              ["SUSPENDED", "Bloklangan"],
              ["GRACE", "Imtiyozli davr"],
              ["EXPIRED", "Muddati tugagan"],
            ]}
          />
          <Select label="Tarif" value={state.plan} onChange={(plan) => set({ plan })} options={[["", "Barcha tariflar"], ...((data?.facets.plans || []).map((p) => [p.id, p.name]) as [string, string][])]} />
          <Select
            label="Faolsizlik"
            value={state.inactiveDays}
            onChange={(inactiveDays) => set({ inactiveDays })}
            options={[
              ["", "Har qanday faollik"],
              ["7", "7 kundan beri faol emas"],
              ["30", "30 kundan beri faol emas"],
            ]}
          />
          <label className="sa-inline">
            <span>Yaratilgan</span>
            <input className="input" type="date" value={state.createdFrom} onChange={(e) => set({ createdFrom: e.target.value })} aria-label="Yaratilgan (dan)" />
            <input className="input" type="date" value={state.createdTo} onChange={(e) => set({ createdTo: e.target.value })} aria-label="Yaratilgan (gacha)" />
          </label>
        </FilterBar>
        <DataTable
          columns={columns}
          rows={data?.rows}
          rowKey={(r) => r.id}
          loading={loading}
          error={error}
          onRetry={() => void reload()}
          onRowClick={(r) => navigate(`/super-admin/companies/${r.id}`)}
          sort={{ key: state.sort, dir: state.dir }}
          onSort={(key) => set({ sort: key, dir: state.sort === key && state.dir === "desc" ? "asc" : "desc" })}
        />
        {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => setState((s) => ({ ...s, page }))} />}
      </Section>
      {creating && (
        <CreateCompany
          onClose={() => setCreating(false)}
          onCreated={(result) => {
            setCreating(false);
            setSecret({ name: result.company.name, email: result.owner.email, password: result.owner.password });
            toast("Kompaniya yaratildi");
            void reload(true);
          }}
          plans={data?.facets.plans || []}
        />
      )}
      {demo && (
        <ConfirmDialog
          title="Demo kompaniya yaratish"
          text="Sintetik ma’lumotli demo kompaniya yaratiladi: 2 filial, 10 xodim, 14 kunlik davomat, ish grafigi. U analitikaga qo‘shilmaydi va muddati tugagach avtomatik tozalanadi."
          confirmLabel="Yaratish"
          onClose={() => setDemo(false)}
          onConfirm={async () => {
            const result = await run(() => post<{ company: { id: string; name: string }; owner: { email: string; password: string } }>("/super-admin/demo-companies", {}), toast, "Demo kompaniya yaratildi");
            if (result) {
              setSecret({ name: result.company.name, email: result.owner.email, password: result.owner.password });
              setTab("demo");
              void reload(true);
            }
          }}
        />
      )}
    </>
  );
}

function CreateCompany({ onClose, onCreated, plans }: { onClose: () => void; onCreated: (r: { company: { id: string; name: string }; owner: { email: string; password?: string } }) => void; plans: { id: string; name: string }[] }) {
  const [form, setForm] = useState({ name: "", ownerName: "", ownerEmail: "", ownerPassword: "", planId: "", status: "TRIAL", timezone: "Asia/Tashkent", preset: "all", internal: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [key]: e.target.value });
  return (
    <Modal title="Yangi kompaniya" subtitle="Egasi shu email bilan panelga kiradi" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            onCreated(await post("/super-admin/companies", { ...form, planId: form.planId || undefined }));
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Xatolik");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Kompaniya nomi *">
          <input className="input" value={form.name} onChange={set("name")} required minLength={2} autoFocus />
        </Field>
        <div className="form-grid">
          <Field label="Egasi F.I.Sh. *">
            <input className="input" value={form.ownerName} onChange={set("ownerName")} required minLength={2} />
          </Field>
          <Field label="Egasi email *">
            <input className="input" type="email" value={form.ownerEmail} onChange={set("ownerEmail")} required />
          </Field>
          <Field label="Parol" hint="Bo‘sh qoldirilsa — vaqtinchalik parol yaratiladi va bir marta ko‘rsatiladi">
            <input className="input" value={form.ownerPassword} onChange={set("ownerPassword")} minLength={10} autoComplete="new-password" />
          </Field>
          <Field label="Tarif" hint="Bo‘sh — sinov uchun Pro, faol uchun Free">
            <select className="select" value={form.planId} onChange={set("planId")}>
              <option value="">Avtomatik</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Holat">
            <select className="select" value={form.status} onChange={set("status")}>
              <option value="TRIAL">Sinov</option>
              <option value="ACTIVE">Faol</option>
            </select>
          </Field>
          <Field label="Vaqt mintaqasi">
            <input className="input" value={form.timezone} onChange={set("timezone")} />
          </Field>
        </div>
        <Field label="Modullar">
          <div className="sa-chips">
            {MODULE_PRESETS.map((p) => (
              <button type="button" key={p.key} className={form.preset === p.key ? "on" : ""} title={p.description} onClick={() => setForm({ ...form, preset: p.key })}>
                {p.label}
              </button>
            ))}
          </div>
        </Field>
        <label className="sa-check">
          <input type="checkbox" checked={form.internal} onChange={(e) => setForm({ ...form, internal: e.target.checked })} /> Ichki (test) kompaniya — feature flaglarning «ichki» doirasi
        </label>
        {error && <p className="sa-error-line">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Bekor qilish
          </button>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "Yaratilmoqda…" : "Yaratish"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

type OnboardingRow = { id: string; name: string; createdAt: string; status: string; percent: number; completed: number; total: number; attention: number; steps: { key: string; label: string; status: string; detail: string }[] };

function Onboarding() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState("incomplete");
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useServerList<OnboardingRow, { summary: { total: number; completed: number; attention: number } }>("/super-admin/onboarding", { filter, page, pageSize: 20 });
  return (
    <>
      <PageHeader title="Onboarding" subtitle="Har bir qadam holati haqiqiy ma’lumotdan hisoblanadi" />
      <Section>
        <FilterBar>
          <Select
            label="Filtr"
            value={filter}
            onChange={(v) => (setFilter(v), setPage(1))}
            options={[
              ["incomplete", "Yakunlanmagan"],
              ["attention", "E’tibor kerak"],
              ["done", "Yakunlangan"],
              ["all", "Hammasi"],
            ]}
          />
          {data && (
            <span className="muted">
              Jami {data.summary.total} · yakunlangan {data.summary.completed} · e’tibor kerak {data.summary.attention}
            </span>
          )}
        </FilterBar>
        <DataTable
          columns={[
            { key: "name", label: "Kompaniya", render: (r) => <b>{r.name}</b> },
            {
              key: "progress",
              label: "Progress",
              render: (r) => (
                <span className="sa-progress" title={`${r.completed}/${r.total}`}>
                  <span className="limit-bar">
                    <i style={{ width: `${r.percent}%` }} className={r.percent === 100 ? "" : r.attention ? "full" : "warn"} />
                  </span>
                  <b className="num">{r.percent}%</b>
                </span>
              ),
            },
            {
              key: "steps",
              label: "Qadamlar",
              render: (r) => (
                <span className="sa-steps">
                  {r.steps.map((s) => (
                    <i key={s.key} className={s.status.toLowerCase()} title={`${s.label}: ${s.detail || s.status}`} aria-label={`${s.label}: ${s.status}`} />
                  ))}
                </span>
              ),
            },
            { key: "next", label: "Keyingi qadam", render: (r) => <span className="muted">{r.steps.find((s) => s.status !== "COMPLETED")?.label || "—"}</span> },
            { key: "created", label: "Yaratilgan", hideOnMobile: true, render: (r) => <span className="muted">{dateOnly(r.createdAt)}</span> },
          ]}
          rows={data?.rows}
          rowKey={(r) => r.id}
          loading={loading}
          error={error}
          onRetry={() => void reload()}
          onRowClick={(r) => navigate(`/super-admin/companies/${r.id}/overview`)}
        />
        {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
        <p className="sa-legend">
          <span>
            <i className="completed" /> Bajarildi
          </span>
          <span>
            <i className="in_progress" /> Jarayonda
          </span>
          <span>
            <i className="pending" /> Kutilmoqda
          </span>
          <span>
            <i className="needs_attention" /> E’tibor kerak
          </span>
        </p>
      </Section>
    </>
  );
}

export default function CompaniesPages({ view }: { view: string }) {
  if (view === "onboarding") return <Onboarding />;
  if (view === "archived") return <CompanyList view="archived" />;
  return <CompanyList view="live" />;
}
