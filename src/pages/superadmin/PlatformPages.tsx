import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, RotateCcw, Send } from "lucide-react";
import { del, patch, post } from "../../api";
import { useApi } from "../../hooks";
import { Field, Modal, PageHeader, useToast } from "../../components/ui";
import { moduleGroups } from "@/lib/modules";
import {
  ConfirmDialog,
  DataTable,
  DetailDrawer,
  ErrorState,
  FilterBar,
  KeyValue,
  Pager,
  PermissionGuard,
  SecretReveal,
  Section,
  Select,
  Skeleton,
  StatusBadge,
  ago,
  bytes,
  dateOnly,
  dateTime,
  num,
  useAction,
  usePlatform,
  useServerList,
} from "./kit";

/*
 * Platforma: modul katalogi (global holat, standart, bog‘liqlik), feature flaglar (doiralar, rollout, tarix, rollback),
 * integratsiyalar, API kalitlar (bir marta ko‘rsatiladi, xesh saqlanadi), webhooklar (HMAC, qayta urinish), resurslar.
 */

/* ---------------------------------------------------------------- modullar --- */
type CatalogRow = { key: string; label: string; description: string; group: keyof typeof moduleGroups; dependsOn: string[]; dependents: string[]; catalog: { globalEnabled?: boolean; defaultEnabled?: boolean; version?: string; requiredPlan?: string; note?: string }; plans: string[]; companiesEnabled: number; overrides: number; totalCompanies: number };
function Modules() {
  const toast = useToast();
  const run = useAction();
  const { can } = usePlatform();
  const { data, error, reload } = useApi<CatalogRow[]>("/super-admin/modules");
  const [edit, setEdit] = useState<CatalogRow | null>(null);
  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;
  return (
    <>
      <PageHeader title="Modullar" subtitle="Global holat butun platformaga ta’sir qiladi; kompaniya darajasi — kompaniya sahifasida. Modul o‘chirilsa ma’lumot o‘chmaydi." />
      <Section>
        <DataTable
          rows={data || undefined}
          rowKey={(r) => r.key}
          loading={!data}
          onRowClick={can("modules.manage") ? setEdit : undefined}
          columns={[
            { key: "l", label: "Modul", render: (r) => <span className="stack"><b>{r.label}</b><small>{moduleGroups[r.group]} · {r.description}</small></span> },
            { key: "g", label: "Global", render: (r) => <StatusBadge value={r.catalog.globalEnabled === false ? "DISABLED" : "ACTIVE"} label={r.catalog.globalEnabled === false ? "O‘chiq" : "Yoqilgan"} /> },
            { key: "d", label: "Yangi kompaniyalarda", hideOnMobile: true, render: (r) => (r.catalog.defaultEnabled === false ? "O‘chiq" : "Yoqilgan") },
            { key: "u", label: "Foydalanish", render: (r) => <span className="sa-progress"><span className="limit-bar"><i style={{ width: `${r.totalCompanies ? Math.round((r.companiesEnabled / r.totalCompanies) * 100) : 0}%` }} /></span><b className="num">{r.companiesEnabled}/{r.totalCompanies}</b></span> },
            { key: "dep", label: "Bog‘liqlik", hideOnMobile: true, render: (r) => [r.dependsOn.length ? `talab: ${r.dependsOn.join(", ")}` : "", r.dependents.length ? `kerak: ${r.dependents.join(", ")}` : ""].filter(Boolean).join(" · ") || "—" },
            { key: "p", label: "Tariflar", hideOnMobile: true, render: (r) => r.plans.join(", ") || "—" },
            { key: "v", label: "Versiya", hideOnMobile: true, render: (r) => r.catalog.version || "—" },
          ]}
        />
      </Section>
      {edit && (
        <Modal title={edit.label} subtitle="Global modul sozlamalari" onClose={() => setEdit(null)} size="narrow">
          <ModuleForm
            row={edit}
            onSave={async (body) => {
              if (await run(() => patch(`/super-admin/modules/${edit.key}`, body), toast, "Saqlandi")) {
                setEdit(null);
                void reload(true);
              }
            }}
          />
        </Modal>
      )}
    </>
  );
}

function ModuleForm({ row, onSave }: { row: CatalogRow; onSave: (body: Record<string, unknown>) => void }) {
  const [form, setForm] = useState({ globalEnabled: row.catalog.globalEnabled !== false, defaultEnabled: row.catalog.defaultEnabled !== false, version: row.catalog.version || "", requiredPlan: row.catalog.requiredPlan || "", note: row.catalog.note || "" });
  return (
    <>
      <label className="sa-check">
        <input type="checkbox" checked={form.globalEnabled} onChange={(e) => setForm({ ...form, globalEnabled: e.target.checked })} /> Platformada yoqilgan {!form.globalEnabled && <b className="bad">— barcha kompaniyalarda o‘chadi (parol so‘raladi)</b>}
      </label>
      <label className="sa-check">
        <input type="checkbox" checked={form.defaultEnabled} onChange={(e) => setForm({ ...form, defaultEnabled: e.target.checked })} /> Yangi kompaniyalarda standart yoqilgan
      </label>
      <div className="form-grid">
        <Field label="Versiya">
          <input className="input" value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} placeholder="1.0" />
        </Field>
        <Field label="Talab qilinadigan tarif (kalit)">
          <input className="input" value={form.requiredPlan} onChange={(e) => setForm({ ...form, requiredPlan: e.target.value })} placeholder="pro" />
        </Field>
      </div>
      <Field label="Izoh">
        <input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
      </Field>
      <div className="form-actions">
        <button className="btn btn-primary" onClick={() => onSave(form)}>
          Saqlash
        </button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------ feature flaglar --- */
type FlagRule = { scope: "COMPANY" | "PLAN" | "INTERNAL"; ids?: string[]; enabled: boolean };
type Flag = { id: string; key: string; description?: string; enabled: boolean; rollout?: number; rules: FlagRule[]; expiresAt?: string; version: number; history: { version: number; at: string; by: string }[]; updatedAt: string; updatedBy: string };
function Flags() {
  const toast = useToast();
  const run = useAction();
  const { data, error, reload } = useApi<Flag[]>("/super-admin/flags");
  const [edit, setEdit] = useState<Flag | "new" | null>(null);
  const [remove, setRemove] = useState<Flag | null>(null);
  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;
  return (
    <>
      <PageHeader
        title="Feature flaglar"
        subtitle="Yangi funksiyani nazorat bilan chiqarish. Flag xavfsizlik ruxsatini almashtirmaydi."
        actions={
          <button className="btn btn-primary" onClick={() => setEdit("new")}>
            <Plus size={15} /> Flag
          </button>
        }
      />
      <Section>
        <DataTable
          rows={data || undefined}
          rowKey={(r) => r.id}
          loading={!data}
          onRowClick={setEdit}
          empty={<p className="muted sa-empty">Flag yo‘q</p>}
          columns={[
            { key: "k", label: "Kalit", render: (r) => <span className="stack"><code className="sa-code">{r.key}</code><small>{r.description || ""}</small></span> },
            { key: "e", label: "Standart", render: (r) => <StatusBadge value={r.enabled ? "ACTIVE" : "DISABLED"} label={r.enabled ? "Yoqilgan" : "O‘chiq"} /> },
            { key: "r", label: "Rollout", className: "num", render: (r) => (r.rollout !== undefined && r.rollout !== null ? `${r.rollout}%` : "—") },
            { key: "s", label: "Qoidalar", render: (r) => r.rules.map((x) => `${x.scope}${x.ids?.length ? `(${x.ids.length})` : ""}: ${x.enabled ? "on" : "off"}`).join(", ") || "—" },
            { key: "x", label: "Muddat", hideOnMobile: true, render: (r) => dateOnly(r.expiresAt) },
            { key: "v", label: "Versiya", render: (r) => `v${r.version} · ${ago(r.updatedAt)}` },
            {
              key: "a",
              label: "",
              render: (r) => (
                <span className="sa-row-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="btn btn-sm" onClick={() => run(() => patch(`/super-admin/flags/${r.id}`, { enabled: !r.enabled }), toast, "Saqlandi").then(() => reload(true))}>
                    {r.enabled ? "O‘chirish" : "Yoqish"}
                  </button>
                  <button className="btn btn-sm" onClick={() => setRemove(r)}>
                    O‘chirib tashlash
                  </button>
                </span>
              ),
            },
          ]}
        />
      </Section>
      {edit && <FlagDrawer flag={edit === "new" ? null : edit} onClose={() => setEdit(null)} onSaved={() => (setEdit(null), void reload(true))} />}
      {remove && (
        <ConfirmDialog
          title={`${remove.key} — o‘chirib tashlash`}
          text="Flag butunlay olib tashlanadi (audit jurnalida qoladi)."
          danger
          confirmLabel="O‘chirish"
          typed={remove.key}
          onClose={() => setRemove(null)}
          onConfirm={async () => {
            await del(`/super-admin/flags/${remove.id}`);
            toast("O‘chirildi");
            void reload(true);
          }}
        />
      )}
    </>
  );
}

function FlagDrawer({ flag, onClose, onSaved }: { flag: Flag | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const run = useAction();
  const { data: companies } = useApi<{ rows: { id: string; name: string }[] }>("/super-admin/companies?pageSize=200&view=all");
  const { data: plans } = useApi<{ id: string; name: string }[]>("/super-admin/plans");
  const [form, setForm] = useState({
    key: flag?.key || "",
    description: flag?.description || "",
    enabled: flag?.enabled || false,
    rollout: flag?.rollout === undefined || flag?.rollout === null ? "" : String(flag.rollout),
    expiresAt: flag?.expiresAt?.slice(0, 10) || "",
    companies: flag?.rules.find((r) => r.scope === "COMPANY")?.ids || [],
    companiesEnabled: flag?.rules.find((r) => r.scope === "COMPANY")?.enabled ?? true,
    plans: flag?.rules.find((r) => r.scope === "PLAN")?.ids || [],
    plansEnabled: flag?.rules.find((r) => r.scope === "PLAN")?.enabled ?? true,
    internal: flag?.rules.find((r) => r.scope === "INTERNAL")?.enabled ?? null,
  });
  const rules: FlagRule[] = [
    ...(form.companies.length ? [{ scope: "COMPANY" as const, ids: form.companies, enabled: form.companiesEnabled }] : []),
    ...(form.plans.length ? [{ scope: "PLAN" as const, ids: form.plans, enabled: form.plansEnabled }] : []),
    ...(form.internal !== null ? [{ scope: "INTERNAL" as const, enabled: form.internal }] : []),
  ];
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  return (
    <DetailDrawer title={flag ? flag.key : "Yangi feature flag"} subtitle={flag ? `v${flag.version} · ${flag.updatedBy}` : undefined} onClose={onClose} wide>
      <div className="form-grid">
        {!flag && (
          <Field label="Kalit" hint="masalan: payroll.new-ui">
            <input className="input" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value.toLowerCase() })} />
          </Field>
        )}
        <Field label="Rollout (%)" hint="Kompaniyalarning shu foiziga (barqaror)">
          <input className="input" type="number" min={0} max={100} value={form.rollout} onChange={(e) => setForm({ ...form, rollout: e.target.value })} />
        </Field>
        <Field label="Muddat (gacha)">
          <input className="input" type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
        </Field>
      </div>
      <Field label="Tavsif">
        <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>
      <label className="sa-check">
        <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Hamma uchun standart yoqilgan
      </label>
      <h4 className="sa-sub">Ichki (test) kompaniyalar</h4>
      <Select
        label="Ichki"
        value={form.internal === null ? "" : form.internal ? "on" : "off"}
        onChange={(v) => setForm({ ...form, internal: v === "" ? null : v === "on" })}
        options={[
          ["", "Qoida yo‘q"],
          ["on", "Yoqilgan"],
          ["off", "O‘chiq"],
        ]}
      />
      <h4 className="sa-sub">
        Tariflar ·{" "}
        <select className="select sa-mini" value={form.plansEnabled ? "on" : "off"} onChange={(e) => setForm({ ...form, plansEnabled: e.target.value === "on" })} aria-label="Tarif qoidasi">
          <option value="on">yoqish</option>
          <option value="off">o‘chirish</option>
        </select>
      </h4>
      <div className="sa-multi cols">
        {(plans || []).map((p) => (
          <label key={p.id} className="sa-check">
            <input type="checkbox" checked={form.plans.includes(p.id)} onChange={() => setForm({ ...form, plans: toggle(form.plans, p.id) })} /> {p.name}
          </label>
        ))}
      </div>
      <h4 className="sa-sub">
        Aniq kompaniyalar ·{" "}
        <select className="select sa-mini" value={form.companiesEnabled ? "on" : "off"} onChange={(e) => setForm({ ...form, companiesEnabled: e.target.value === "on" })} aria-label="Kompaniya qoidasi">
          <option value="on">yoqish</option>
          <option value="off">o‘chirish</option>
        </select>
      </h4>
      <div className="sa-multi cols">
        {(companies?.rows || []).map((c) => (
          <label key={c.id} className="sa-check">
            <input type="checkbox" checked={form.companies.includes(c.id)} onChange={() => setForm({ ...form, companies: toggle(form.companies, c.id) })} /> {c.name}
          </label>
        ))}
      </div>
      <div className="form-actions">
        <button
          className="btn btn-primary"
          onClick={async () => {
            const body = { description: form.description || undefined, enabled: form.enabled, rollout: form.rollout === "" ? undefined : Number(form.rollout), rules, expiresAt: form.expiresAt || "" };
            const result = await run(() => (flag ? patch(`/super-admin/flags/${flag.id}`, body) : post("/super-admin/flags", { ...body, key: form.key })), toast, "Saqlandi");
            if (result) onSaved();
          }}
        >
          Saqlash
        </button>
      </div>
      {flag && (
        <>
          <h4 className="sa-sub">Tarix va rollback</h4>
          <ul className="sa-checks">
            {[...flag.history].reverse().map((h) => (
              <li key={h.version}>
                <span className="badge gray">v{h.version}</span>
                <span>
                  <b>{h.by}</b>
                  <small>{dateTime(h.at)}</small>
                </span>
                {h.version !== flag.version && (
                  <button className="btn btn-sm" onClick={() => run(() => post(`/super-admin/flags/${flag.id}/rollback`, { version: h.version }), toast, `v${h.version} ga qaytarildi`).then((r) => r && onSaved())}>
                    <RotateCcw size={13} /> Qaytarish
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </DetailDrawer>
  );
}

/* --------------------------------------------------------- integratsiyalar --- */
type IntegrationsData = {
  platformBot: { state: string; mode: string | null; username: string | null; error: string | null };
  email: { configured: boolean; note: string };
  companies: { id: string; name: string; bot: { status: string; username: string | null; lastError: string | null } | null; hrIntegration: { status: string; lastSyncAt: string | null; lastError: string | null } | null; photoChannel: boolean; webhooks: number; failingWebhooks: number; apiKeys: number }[];
};
function Integrations() {
  const { data, error, reload } = useApi<IntegrationsData>("/super-admin/integrations");
  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;
  if (!data) return <Skeleton rows={8} />;
  return (
    <>
      <PageHeader title="Integratsiyalar" subtitle="Tokenlar va maxfiy kalitlar frontendga chiqarilmaydi" />
      <div className="sa-grid-2">
        <Section title="Platforma kanallari">
          <ul className="sa-checks">
            <li>
              <StatusBadge value={data.platformBot.state === "running" ? "OK" : data.platformBot.state === "disabled" ? "NOT_CONFIGURED" : "DOWN"} />
              <span>
                <b>Staffora Telegram boti {data.platformBot.username ? `@${data.platformBot.username}` : ""}</b>
                <small>{data.platformBot.error || `${data.platformBot.mode || ""} · ${data.platformBot.state}`}</small>
              </span>
            </li>
            <li>
              <StatusBadge value="NOT_CONFIGURED" />
              <span>
                <b>Email</b>
                <small>{data.email.note}</small>
              </span>
            </li>
          </ul>
        </Section>
      </div>
      <Section title="Kompaniyalar integratsiyalari">
        <DataTable
          rows={data.companies}
          rowKey={(r) => r.id}
          columns={[
            { key: "c", label: "Kompaniya", render: (r) => <Link to={`/super-admin/companies/${r.id}/integrations`}><b>{r.name}</b></Link> },
            { key: "b", label: "Bot", render: (r) => (r.bot ? <StatusBadge value={r.bot.status === "RUNNING" ? "OK" : r.bot.status === "ERROR" ? "DOWN" : "WARN"} label={r.bot.username ? `@${r.bot.username}` : r.bot.status} /> : "—") },
            { key: "h", label: "HR bot", render: (r) => (r.hrIntegration ? <StatusBadge value={r.hrIntegration.status === "ERROR" ? "DOWN" : "OK"} label={r.hrIntegration.lastSyncAt ? ago(r.hrIntegration.lastSyncAt) : r.hrIntegration.status} /> : "—") },
            { key: "p", label: "Rasm kanali", hideOnMobile: true, render: (r) => (r.photoChannel ? "✓" : "—") },
            { key: "w", label: "Webhooklar", className: "num", render: (r) => `${r.webhooks}${r.failingWebhooks ? ` (${r.failingWebhooks} nosoz)` : ""}` },
            { key: "k", label: "API kalitlar", className: "num", render: (r) => r.apiKeys },
          ]}
        />
      </Section>
    </>
  );
}

/* --------------------------------------------------------------- API kalitlar --- */
type ApiKeyRow = { id: string; companyId: string; company: string; name: string; prefix: string; scopes: string[]; expiresAt?: string; lastUsedAt?: string; createdAt: string; createdBy: string; revokedAt?: string };
function ApiKeys() {
  const toast = useToast();
  const run = useAction();
  const [params] = useSearchParams();
  const [companyId, setCompanyId] = useState(params.get("companyId") || "");
  const { data, error, reload } = useApi<{ scopes: Record<string, string>; keys: ApiKeyRow[] }>(`/super-admin/api-keys${companyId ? `?companyId=${companyId}` : ""}`);
  const { data: companies } = useApi<{ rows: { id: string; name: string }[] }>("/super-admin/companies?pageSize=200");
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ name: string; key: string } | null>(null);
  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;
  return (
    <>
      <PageHeader
        title="API kalitlar"
        subtitle="Kompaniya integratsiyasi uchun: GET /api/v1/employees · /branches · /attendance (Authorization: Bearer stf_…)"
        actions={
          <PermissionGuard perm="integrations.manage">
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus size={15} /> Kalit
            </button>
          </PermissionGuard>
        }
      />
      {secret && <Section title={`${secret.name} — yangi kalit`}><SecretReveal label="API kalit" value={secret.key} note="Faqat hozir ko‘rinadi — bazada faqat xeshi saqlanadi" /></Section>}
      <Section>
        <FilterBar>
          <Select label="Kompaniya" value={companyId} onChange={setCompanyId} options={[["", "Barcha kompaniyalar"], ...((companies?.rows || []).map((c) => [c.id, c.name]) as [string, string][])]} />
        </FilterBar>
        <DataTable
          rows={data?.keys}
          rowKey={(r) => r.id}
          loading={!data}
          empty={<p className="muted sa-empty">Kalit yo‘q</p>}
          columns={[
            { key: "n", label: "Kalit", render: (r) => <span className="stack"><b>{r.name}</b><small><code>{r.prefix}_…</code> · {r.company}</small></span> },
            { key: "s", label: "Ruxsatlar", render: (r) => r.scopes.join(", ") },
            { key: "u", label: "Oxirgi ishlatilgan", render: (r) => ago(r.lastUsedAt) },
            { key: "x", label: "Muddat", hideOnMobile: true, render: (r) => dateOnly(r.expiresAt) },
            { key: "st", label: "Holat", render: (r) => <StatusBadge value={r.revokedAt ? "REVOKED" : r.expiresAt && r.expiresAt < new Date().toISOString() ? "EXPIRED" : "ACTIVE"} /> },
            {
              key: "a",
              label: "",
              render: (r) =>
                !r.revokedAt && (
                  <PermissionGuard perm="integrations.manage">
                    <span className="sa-row-actions">
                      <button className="btn btn-sm" onClick={async () => {
                        const res = await run(() => post<{ key: string; name: string }>(`/super-admin/api-keys/${r.id}/rotate`, {}), toast, "Kalit almashtirildi");
                        if (res) {
                          setSecret({ name: res.name, key: res.key });
                          void reload(true);
                        }
                      }}>
                        Almashtirish
                      </button>
                      <button className="btn btn-sm" onClick={() => run(() => post(`/super-admin/api-keys/${r.id}/revoke`, {}), toast, "Bekor qilindi").then(() => reload(true))}>
                        Bekor qilish
                      </button>
                    </span>
                  </PermissionGuard>
                ),
            },
          ]}
        />
      </Section>
      {creating && data && (
        <CreateKey
          scopes={data.scopes}
          companies={companies?.rows || []}
          defaultCompany={companyId}
          onClose={() => setCreating(false)}
          onDone={(s) => {
            setCreating(false);
            setSecret(s);
            void reload(true);
          }}
        />
      )}
    </>
  );
}

function CreateKey({ scopes, companies, defaultCompany, onClose, onDone }: { scopes: Record<string, string>; companies: { id: string; name: string }[]; defaultCompany: string; onClose: () => void; onDone: (s: { name: string; key: string }) => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ companyId: defaultCompany, name: "", scopes: [] as string[], expiresAt: "" });
  return (
    <Modal title="Yangi API kalit" subtitle="Kalit faqat bir marta ko‘rsatiladi" onClose={onClose} size="narrow">
      <Field label="Kompaniya">
        <select className="select" value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })}>
          <option value="">Tanlang</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Nomi">
        <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="1C integratsiya" />
      </Field>
      <Field label="Ruxsatlar">
        <span className="sa-multi">
          {Object.entries(scopes).map(([key, label]) => (
            <label key={key} className="sa-check">
              <input type="checkbox" checked={form.scopes.includes(key)} onChange={(e) => setForm({ ...form, scopes: e.target.checked ? [...form.scopes, key] : form.scopes.filter((s) => s !== key) })} /> {label} <code>{key}</code>
            </label>
          ))}
        </span>
      </Field>
      <Field label="Muddat (gacha)" hint="Bo‘sh — muddatsiz">
        <input className="input" type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
      </Field>
      <div className="form-actions">
        <button className="btn" onClick={onClose}>
          Bekor qilish
        </button>
        <button
          className="btn btn-primary"
          disabled={!form.companyId || form.name.trim().length < 2 || !form.scopes.length}
          onClick={async () => {
            try {
              const res = await post<{ key: string; name: string }>(`/super-admin/companies/${form.companyId}/api-keys`, { name: form.name, scopes: form.scopes, expiresAt: form.expiresAt });
              onDone({ name: res.name, key: res.key });
            } catch (reason) {
              toast(reason instanceof Error ? reason.message : "Xatolik", "error");
            }
          }}
        >
          Yaratish
        </button>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- webhooklar --- */
type Hook = { id: string; companyId: string; company: string; url: string; description?: string; events: string[]; secretHint: string; enabled: boolean; failures: number; disabledReason?: string; lastDeliveryAt?: string; lastStatus?: number; createdAt: string };
function Webhooks() {
  const toast = useToast();
  const run = useAction();
  const [params] = useSearchParams();
  const [companyId, setCompanyId] = useState(params.get("companyId") || "");
  const { data, error, reload } = useApi<{ events: Record<string, string>; endpoints: Hook[] }>(`/super-admin/webhooks${companyId ? `?companyId=${companyId}` : ""}`);
  const { data: companies } = useApi<{ rows: { id: string; name: string }[] }>("/super-admin/companies?pageSize=200");
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [open, setOpen] = useState<Hook | null>(null);
  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;
  return (
    <>
      <PageHeader
        title="Webhooklar"
        subtitle="HMAC imzo (X-Staffora-Signature: t=…,v1=…), X-Staffora-Delivery (idempotentlik), qayta urinish, SSRF himoyasi"
        actions={
          <PermissionGuard perm="integrations.manage">
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus size={15} /> Webhook
            </button>
          </PermissionGuard>
        }
      />
      {secret && <Section title="Webhook maxfiy kaliti"><SecretReveal label="Imzo kaliti" value={secret} note="Faqat hozir ko‘rinadi" /></Section>}
      <Section>
        <FilterBar>
          <Select label="Kompaniya" value={companyId} onChange={setCompanyId} options={[["", "Barcha kompaniyalar"], ...((companies?.rows || []).map((c) => [c.id, c.name]) as [string, string][])]} />
        </FilterBar>
        <DataTable
          rows={data?.endpoints}
          rowKey={(r) => r.id}
          loading={!data}
          onRowClick={setOpen}
          empty={<p className="muted sa-empty">Webhook yo‘q</p>}
          columns={[
            { key: "u", label: "Manzil", render: (r) => <span className="stack"><b>{new URL(r.url).host}</b><small>{r.company} · {r.events.join(", ")}</small></span> },
            { key: "l", label: "Oxirgi yetkazish", render: (r) => (r.lastDeliveryAt ? `${ago(r.lastDeliveryAt)} · HTTP ${r.lastStatus || "—"}` : "—") },
            { key: "f", label: "Ketma-ket xato", className: "num", render: (r) => r.failures },
            { key: "s", label: "Holat", render: (r) => <StatusBadge value={r.enabled ? "ACTIVE" : "DISABLED"} label={r.enabled ? "Yoqilgan" : r.disabledReason || "O‘chiq"} /> },
          ]}
        />
      </Section>
      {creating && data && (
        <CreateHook
          events={data.events}
          companies={companies?.rows || []}
          defaultCompany={companyId}
          onClose={() => setCreating(false)}
          onDone={(s) => {
            setCreating(false);
            setSecret(s);
            void reload(true);
          }}
        />
      )}
      {open && (
        <HookDrawer
          hook={open}
          onClose={() => setOpen(null)}
          onChanged={() => void reload(true)}
          onSecret={(s) => setSecret(s)}
          run={(fn, msg) => run(fn, toast, msg)}
        />
      )}
    </>
  );
}

function CreateHook({ events, companies, defaultCompany, onClose, onDone }: { events: Record<string, string>; companies: { id: string; name: string }[]; defaultCompany: string; onClose: () => void; onDone: (secret: string) => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ companyId: defaultCompany, url: "https://", events: ["attendance.check_in", "attendance.check_out"], description: "" });
  return (
    <Modal title="Yangi webhook" subtitle="Faqat https; xususiy/lokal manzillar rad etiladi" onClose={onClose} size="narrow">
      <Field label="Kompaniya">
        <select className="select" value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })}>
          <option value="">Tanlang</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="URL">
        <input className="input" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
      </Field>
      <Field label="Hodisalar">
        <span className="sa-multi">
          {Object.entries(events)
            .filter(([key]) => key !== "ping")
            .map(([key, label]) => (
              <label key={key} className="sa-check">
                <input type="checkbox" checked={form.events.includes(key)} onChange={(e) => setForm({ ...form, events: e.target.checked ? [...form.events, key] : form.events.filter((x) => x !== key) })} /> {label} <code>{key}</code>
              </label>
            ))}
        </span>
      </Field>
      <Field label="Izoh">
        <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>
      <div className="form-actions">
        <button className="btn" onClick={onClose}>
          Bekor qilish
        </button>
        <button
          className="btn btn-primary"
          disabled={!form.companyId || !form.events.length}
          onClick={async () => {
            try {
              const res = await post<{ secret: string }>(`/super-admin/companies/${form.companyId}/webhooks`, { url: form.url, events: form.events, description: form.description || undefined });
              onDone(res.secret);
            } catch (reason) {
              toast(reason instanceof Error ? reason.message : "Xatolik", "error");
            }
          }}
        >
          Yaratish
        </button>
      </div>
    </Modal>
  );
}

type Delivery = { id: string; event: string; status: string; attempts: number; responseStatus: number | null; error: string | null; durationMs: number | null; createdAt: string; nextAttemptAt: string };
function HookDrawer({ hook, onClose, onChanged, onSecret, run }: { hook: Hook; onClose: () => void; onChanged: () => void; onSecret: (s: string) => void; run: <T>(fn: () => Promise<T>, msg?: string) => Promise<T | undefined> }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const { data, reload } = useServerList<Delivery>(`/super-admin/webhooks/${hook.id}/deliveries`, { page, status, pageSize: 20 });
  const [remove, setRemove] = useState(false);
  return (
    <DetailDrawer title={new URL(hook.url).host} subtitle={hook.url} onClose={onClose} wide>
      <KeyValue
        items={[
          ["Kompaniya", hook.company],
          ["Hodisalar", hook.events.join(", ")],
          ["Imzo kaliti", `whsec_…${hook.secretHint}`],
          ["Holat", hook.enabled ? "Yoqilgan" : hook.disabledReason || "O‘chiq"],
          ["Yaratilgan", dateTime(hook.createdAt)],
        ]}
      />
      <PermissionGuard perm="integrations.manage">
        <div className="sa-actions-grid">
          <button className="btn" onClick={() => run(() => post(`/super-admin/webhooks/${hook.id}/test`, {}), "Sinov hodisasi yuborildi").then(() => setTimeout(() => void reload(true), 2500))} disabled={!hook.enabled}>
            <Send size={14} /> Sinov (ping)
          </button>
          <button className="btn" onClick={() => run(() => patch(`/super-admin/webhooks/${hook.id}`, { enabled: !hook.enabled }), hook.enabled ? "O‘chirildi" : "Yoqildi").then(() => (onChanged(), onClose()))}>
            {hook.enabled ? "O‘chirish" : "Yoqish"}
          </button>
          <button
            className="btn"
            onClick={async () => {
              const res = await run(() => post<{ secret: string }>(`/super-admin/webhooks/${hook.id}/rotate-secret`, {}), "Kalit almashtirildi");
              if (res) onSecret(res.secret);
            }}
          >
            Kalitni almashtirish
          </button>
          <button className="btn btn-danger" onClick={() => setRemove(true)}>
            O‘chirib tashlash
          </button>
        </div>
      </PermissionGuard>
      <h4 className="sa-sub">Yetkazish jurnali</h4>
      <FilterBar>
        <Select
          label="Holat"
          value={status}
          onChange={(v) => (setStatus(v), setPage(1))}
          options={[
            ["", "Barchasi"],
            ["DELIVERED", "Yetkazildi"],
            ["PENDING", "Kutilmoqda"],
            ["FAILED", "Xato"],
          ]}
        />
      </FilterBar>
      <DataTable
        rows={data?.rows}
        rowKey={(r) => r.id}
        loading={!data}
        empty={<p className="muted">Yetkazish yo‘q</p>}
        columns={[
          { key: "e", label: "Hodisa", render: (r) => <span className="stack"><b>{r.event}</b><small><code>{r.id.slice(0, 8)}</code></small></span> },
          { key: "s", label: "Holat", render: (r) => <StatusBadge value={r.status} /> },
          { key: "h", label: "HTTP", render: (r) => (r.responseStatus ? `${r.responseStatus} · ${r.durationMs} ms` : r.error || "—") },
          { key: "a", label: "Urinish", className: "num", render: (r) => r.attempts },
          { key: "t", label: "Vaqt", render: (r) => ago(r.createdAt) },
          {
            key: "x",
            label: "",
            render: (r) =>
              r.status === "FAILED" && (
                <button className="btn btn-sm" onClick={() => run(() => post(`/super-admin/webhook-deliveries/${r.id}/retry`, {}), "Qayta navbatga qo‘yildi").then(() => reload(true))}>
                  Qayta
                </button>
              ),
          },
        ]}
      />
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      {remove && (
        <ConfirmDialog
          title="Webhookni o‘chirish"
          text="Endpoint o‘chiriladi, navbatdagi yetkazishlar bekor qilinadi."
          danger
          confirmLabel="O‘chirish"
          onClose={() => setRemove(false)}
          onConfirm={async () => {
            await del(`/super-admin/webhooks/${hook.id}`);
            onChanged();
            onClose();
          }}
        />
      )}
    </DetailDrawer>
  );
}

/* ---------------------------------------------------------------- resurslar --- */
type ResourceRow = { id: string; name: string; files: number; storageBytes: number; attachments: number; requests30d: number; errors30d: number; exports: number; jobs: number; integrations: number };
function Resources() {
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useServerList<ResourceRow, { totals: { storageBytes: number; files: number; requests30d: number }; note: string }>("/super-admin/resources", { page, pageSize: 30 });
  return (
    <>
      <PageHeader title="Resurslar" subtitle={data?.note || "Kompaniyalar bo‘yicha haqiqiy foydalanish"} />
      {data && (
        <div className="sa-chipline">
          <span className="sa-sum">
            <small>Saqlangan fayllar</small>
            <b>{bytes(data.totals.storageBytes)}</b>
            <span>{num(data.totals.files)} ta fayl</span>
          </span>
          <span className="sa-sum">
            <small>API so‘rovlar (30 kun)</small>
            <b>{num(data.totals.requests30d)}</b>
          </span>
        </div>
      )}
      <Section>
        <DataTable
          rows={data?.rows}
          rowKey={(r) => r.id}
          loading={loading}
          error={error}
          onRetry={() => void reload()}
          columns={[
            { key: "n", label: "Kompaniya", render: (r) => <Link to={`/super-admin/companies/${r.id}`}><b>{r.name}</b></Link> },
            { key: "s", label: "Fayllar", className: "num", render: (r) => `${bytes(r.storageBytes)} · ${r.files}` },
            { key: "a", label: "Biriktirmalar", className: "num", hideOnMobile: true, render: (r) => r.attachments },
            { key: "r", label: "API (30 kun)", className: "num", render: (r) => `${num(r.requests30d)}${r.errors30d ? ` · ${r.errors30d} xato` : ""}` },
            { key: "e", label: "Eksportlar", className: "num", hideOnMobile: true, render: (r) => r.exports },
            { key: "j", label: "Fon ishlari", className: "num", hideOnMobile: true, render: (r) => r.jobs },
            { key: "i", label: "Integratsiyalar", className: "num", render: (r) => r.integrations },
          ]}
        />
        {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </Section>
    </>
  );
}

export default function PlatformPages({ view }: { view: string }) {
  if (view === "flags") return <Flags />;
  if (view === "integrations") return <Integrations />;
  if (view === "apikeys") return <ApiKeys />;
  if (view === "webhooks") return <Webhooks />;
  if (view === "resources") return <Resources />;
  return <Modules />;
}
