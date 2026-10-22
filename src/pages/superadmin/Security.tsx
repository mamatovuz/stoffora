import { useCallback, useState } from "react";
import { Ban, Download, KeyRound, LogOut, MonitorSmartphone, ShieldAlert, ShieldCheck, Unlock, UserPlus } from "lucide-react";
import { patch, post } from "../../api";
import { useApi } from "../../hooks";
import { Field, Modal, PageHeader, StatCard, useToast } from "../../components/ui";
import {
  ConfirmDialog,
  DataTable,
  DetailDrawer,
  ErrorState,
  FilterBar,
  KeyValue,
  NoAccess,
  Pager,
  PermissionGuard,
  SearchInput,
  SecretReveal,
  Section,
  Select,
  Skeleton,
  StatusBadge,
  ago,
  dateTime,
  num,
  useAction,
  usePlatform,
  useServerList,
} from "./kit";

/*
 * Xavfsizlik: umumiy holat (24 soatlik hodisalar, MFA, shubhali sessiyalar, imtiyozli amallar),
 * audit jurnali (filtr, tafsilot, eksport), sessiyalar (panel / mobil) va platforma administratorlari (RBAC).
 */

const EVENT_LABELS: Record<string, string> = {
  LOGIN_FAILED: "Kirish xatosi",
  LOGIN_BLOCKED: "Bloklangan kirish urinishi",
  LOGIN_SUCCESS_ADMIN: "Administrator kirdi",
  CODE_FAILED: "Telegram kod xatosi",
  REAUTH_FAILED: "Parol tasdig‘i xatosi",
  SESSION_REVOKED: "Sessiya bekor qilindi",
  PREVIEW_STARTED: "Kompaniya ko‘rinishi ochildi",
  SUPPORT_ACCESS: "Yordam kirishi",
  ROLE_CHANGED: "Rol o‘zgartirildi",
  USER_BLOCKED: "Foydalanuvchi bloklandi",
  API_KEY_REJECTED: "API kalit rad etildi",
};

/* ============================================================ xavfsizlik markazi === */
type Overview = {
  last24h: Record<string, number>;
  admins: { id: string; email: string; role: string; twoFactor: boolean; telegramLinked: boolean; blocked: boolean }[];
  sessions: { active: number; expired: number; revoked: number; mobileActive: number };
  suspicious: { id: string; user: string; ip: string; createdAt: string; lastSeenAt: string; reason: string }[];
  privileged: AuditRow[];
  blockedUsers: number;
  requireAdminMfa: boolean;
  checks: { key: string; label: string; ok: boolean; note?: string }[];
};
type SecurityEvent = { id: number; at: string; type: string; severity: string; userId: string | null; subject: string | null; ip: string | null; userAgent: string | null; detail: string | null };

function SecurityCenter() {
  const toast = useToast();
  const run = useAction();
  const { data, error, reload } = useApi<Overview>("/super-admin/security/overview");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const events = useServerList<SecurityEvent>("/super-admin/security/events", { type, page, pageSize: 25 });
  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;
  if (!data) return <Skeleton rows={10} />;
  const c = data.last24h;
  const failed = (c.LOGIN_FAILED || 0) + (c.CODE_FAILED || 0) + (c.REAUTH_FAILED || 0);
  const noMfa = data.admins.filter((a) => !a.twoFactor && !a.blocked).length;
  return (
    <>
      <PageHeader title="Xavfsizlik markazi" subtitle="Oxirgi 24 soatdagi hodisalar, administratorlar himoyasi va sessiyalar" />
      <div className="sa-kpis">
        <StatCard label="Muvaffaqiyatsiz kirishlar" value={num(failed)} note="Parol, Telegram kod, qayta tasdiq" icon={ShieldAlert} tone={failed ? "amber" : undefined} />
        <StatCard label="Bloklangan urinishlar" value={num(c.LOGIN_BLOCKED || 0)} note={`${num(data.blockedUsers)} bloklangan foydalanuvchi`} icon={Ban} tone={c.LOGIN_BLOCKED ? "red" : undefined} />
        <StatCard label="Faol panel sessiyalari" value={num(data.sessions.active)} note={`${num(data.sessions.mobileActive)} mobil · ${num(data.sessions.revoked)} bekor qilingan`} icon={MonitorSmartphone} />
        <StatCard label="2FA yo‘q administratorlar" value={num(noMfa)} note={data.requireAdminMfa ? "2FA talab qilinadi" : "2FA majburiy emas"} icon={KeyRound} tone={noMfa ? "amber" : "green"} />
      </div>

      <div className="sa-grid-2">
        <Section title="Tekshiruvlar" subtitle="Konfiguratsiyadan olinadi — taxminiy emas">
          <ul className="sa-checks">
            {data.checks.map((x) => (
              <li key={x.key}>
                <StatusBadge value={x.ok ? "OK" : "WARN"} label={x.ok ? "Joyida" : "E’tibor"} />
                <span>
                  <b>{x.label}</b>
                  {x.note && <small>{x.note}</small>}
                </span>
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Administratorlar" subtitle="Telegram ulangan va 2FA yoqilgan bo‘lishi tavsiya etiladi">
          <DataTable
            rows={data.admins}
            rowKey={(a) => a.id}
            columns={[
              { key: "e", label: "Administrator", render: (a) => <span className="stack"><b>{a.email}</b><small>{a.role}</small></span> },
              { key: "t", label: "Telegram", render: (a) => (a.telegramLinked ? "ulangan" : <span className="muted">yo‘q</span>) },
              { key: "m", label: "2FA", render: (a) => (a.twoFactor ? <StatusBadge value="OK" label="Yoqilgan" /> : <StatusBadge value="WARN" label="Yo‘q" />) },
              { key: "s", label: "Holat", render: (a) => (a.blocked ? <StatusBadge value="SUSPENDED" label="Bloklangan" /> : <StatusBadge value="ACTIVE" />) },
            ]}
          />
        </Section>
      </div>

      <Section title="Shubhali sessiyalar" subtitle="Administrator sessiyasi ilgari ko‘rilmagan IP manzildan ochilgan">
        <DataTable
          rows={data.suspicious}
          rowKey={(s) => s.id}
          empty={<p className="muted sa-empty">Shubhali sessiya yo‘q</p>}
          columns={[
            { key: "u", label: "Administrator", render: (s) => <b>{s.user}</b> },
            { key: "ip", label: "IP", render: (s) => <code>{s.ip}</code> },
            { key: "c", label: "Ochilgan", render: (s) => dateTime(s.createdAt) },
            { key: "l", label: "Oxirgi faollik", render: (s) => ago(s.lastSeenAt) },
            { key: "r", label: "Sabab", hideOnMobile: true, render: (s) => <span className="muted">{s.reason}</span> },
            {
              key: "a",
              label: "",
              className: "sa-row-actions",
              render: (s) => (
                <PermissionGuard perm="sessions.manage">
                  <button
                    className="btn btn-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      void run(() => post(`/super-admin/sessions/${s.id}/revoke`, { kind: "panel" }), toast, "Sessiya bekor qilindi").then(() => reload(true));
                    }}
                  >
                    <LogOut size={14} /> Bekor qilish
                  </button>
                </PermissionGuard>
              ),
            },
          ]}
        />
      </Section>

      <PermissionGuard perm="audit.read">
        <Section title="Imtiyozli amallar" subtitle="Oxirgi 7 kun: rol o‘zgarishi, arxiv, egalik, kompaniya ko‘rinishi, eksport">
          <DataTable
            rows={data.privileged}
            rowKey={(r) => r.id}
            empty={<p className="muted sa-empty">Imtiyozli amal yo‘q</p>}
            columns={[
              { key: "at", label: "Vaqt", render: (r) => <span title={dateTime(r.at)}>{ago(r.at)}</span> },
              { key: "who", label: "Kim", render: (r) => r.actorName },
              { key: "what", label: "Amal", render: (r) => <span className="stack"><b>{r.summary}</b><small>{r.action}</small></span> },
              { key: "res", label: "Natija", render: (r) => <StatusBadge value={r.result} /> },
            ]}
          />
        </Section>
      </PermissionGuard>

      <Section
        title="Xavfsizlik hodisalari"
        actions={
          <Select
            label="Hodisa turi"
            value={type}
            onChange={(v) => {
              setType(v);
              setPage(1);
            }}
            options={[["", "Barcha hodisalar"], ...Object.entries(EVENT_LABELS)]}
          />
        }
      >
        <DataTable
          rows={events.data?.rows}
          rowKey={(e) => String(e.id)}
          loading={events.loading}
          error={events.error}
          onRetry={() => void events.reload()}
          empty={<p className="muted sa-empty">Hodisa yo‘q</p>}
          columns={[
            { key: "at", label: "Vaqt", render: (e) => <span title={dateTime(e.at)}>{ago(e.at)}</span> },
            { key: "t", label: "Hodisa", render: (e) => <span className="stack"><b>{EVENT_LABELS[e.type] || e.type}</b>{e.subject && <small>{e.subject}</small>}</span> },
            { key: "s", label: "Daraja", render: (e) => <StatusBadge value={e.severity} /> },
            { key: "ip", label: "IP", hideOnMobile: true, render: (e) => (e.ip ? <code>{e.ip}</code> : "—") },
            { key: "d", label: "Tafsilot", hideOnMobile: true, render: (e) => <span className="muted sa-ellipsis">{e.detail || "—"}</span> },
          ]}
        />
        {events.data && <Pager page={events.data.page} pageSize={events.data.pageSize} total={events.data.total} onPage={setPage} />}
      </Section>
    </>
  );
}

/* ================================================================== audit === */
export type AuditRow = {
  id: string;
  at: string;
  actorId: string | null;
  actorName: string;
  actorRole: string | null;
  companyId: string | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  result: string;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
  summary: string;
  details: unknown;
  privileged: boolean;
};

function AuditView() {
  const toast = useToast();
  const run = useAction();
  const { can } = usePlatform();
  const { data: companies } = useApi<{ rows: { id: string; name: string }[] }>("/super-admin/companies?pageSize=200");
  const [state, setState] = useState({ q: "", companyId: "", action: "", result: "", from: "", to: "", privileged: false, page: 1 });
  const list = useServerList<AuditRow>("/super-admin/audit-logs", { ...state, privileged: state.privileged ? "1" : undefined, pageSize: 40 });
  const [open, setOpen] = useState<AuditRow | null>(null);
  const onQuery = useCallback((q: string) => setState((s) => ({ ...s, q, page: 1 })), []);
  const companyName = (id: string | null) => (id ? companies?.rows.find((c) => c.id === id)?.name || id.slice(0, 8) : "Platforma");
  const set = (patchState: Partial<typeof state>) => setState({ ...state, ...patchState, page: 1 });
  return (
    <>
      <PageHeader
        title="Audit jurnali"
        subtitle="Platforma administratorlarining barcha amallari · parol va tokenlar yozilmaydi"
        actions={
          can("audit.export") && (
            <button
              className="btn"
              onClick={() =>
                void run(
                  () => post("/super-admin/exports", { type: "audit", format: "xlsx", from: state.from || undefined, to: state.to || undefined, companyId: state.companyId || undefined }),
                  toast,
                  "Eksport navbatga qo‘yildi — «Eksportlar» bo‘limida yuklab oling",
                )
              }
            >
              <Download size={15} /> Eksport (XLSX)
            </button>
          )
        }
      />
      <Section>
        <FilterBar>
          <SearchInput value={state.q} onChange={onQuery} placeholder="Matn, administrator yoki obyekt…" />
          <Select label="Kompaniya" value={state.companyId} onChange={(companyId) => set({ companyId })} options={[["", "Barcha kompaniyalar"], ...(companies?.rows || []).map((c) => [c.id, c.name] as [string, string])]} />
          <Select
            label="Natija"
            value={state.result}
            onChange={(result) => set({ result })}
            options={[
              ["", "Barcha natijalar"],
              ["SUCCESS", "Muvaffaqiyatli"],
              ["FAILURE", "Xato"],
              ["DENIED", "Rad etildi"],
            ]}
          />
          <input className="input sa-select" placeholder="Amal (masalan company.)" value={state.action} onChange={(e) => set({ action: e.target.value.trim() })} aria-label="Amal" />
          <input className="input sa-select" type="date" value={state.from} onChange={(e) => set({ from: e.target.value })} aria-label="Boshlanish sanasi" />
          <input className="input sa-select" type="date" value={state.to} onChange={(e) => set({ to: e.target.value })} aria-label="Tugash sanasi" />
          <label className="sa-check">
            <input type="checkbox" checked={state.privileged} onChange={(e) => set({ privileged: e.target.checked })} /> Faqat imtiyozli
          </label>
        </FilterBar>
        <DataTable
          rows={list.data?.rows}
          rowKey={(r) => r.id}
          loading={list.loading}
          error={list.error}
          onRetry={() => void list.reload()}
          onRowClick={setOpen}
          columns={[
            { key: "at", label: "Vaqt", render: (r) => <span title={dateTime(r.at)}>{dateTime(r.at)}</span> },
            { key: "who", label: "Administrator", render: (r) => <span className="stack"><b>{r.actorName}</b><small>{r.actorRole || "—"}</small></span> },
            { key: "what", label: "Amal", render: (r) => <span className="stack"><b>{r.summary}</b><small>{r.action}{r.privileged ? " · imtiyozli" : ""}</small></span> },
            { key: "co", label: "Kompaniya", hideOnMobile: true, render: (r) => companyName(r.companyId) },
            { key: "res", label: "Natija", render: (r) => <StatusBadge value={r.result} /> },
          ]}
        />
        {list.data && <Pager page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={(page) => setState({ ...state, page })} />}
      </Section>
      {open && (
        <DetailDrawer title={open.summary} subtitle={dateTime(open.at)} onClose={() => setOpen(null)}>
          <KeyValue
            items={[
              ["Administrator", `${open.actorName}${open.actorRole ? ` (${open.actorRole})` : ""}`],
              ["Amal", <code key="a">{open.action}</code>],
              ["Obyekt", open.entity ? `${open.entity}${open.entityId ? ` · ${open.entityId}` : ""}` : "—"],
              ["Kompaniya", companyName(open.companyId)],
              ["Natija", <StatusBadge key="r" value={open.result} />],
              ["Imtiyozli", open.privileged ? "Ha" : "Yo‘q"],
              ["IP", open.ip || "—"],
              ["Brauzer", open.userAgent || "—"],
              ["Request ID", open.requestId ? <code key="q">{open.requestId}</code> : "—"],
            ]}
          />
          {open.details !== null && open.details !== undefined && (
            <>
              <h4 className="sa-sub">Tafsilotlar (oldin / keyin)</h4>
              <pre className="sa-code">{JSON.stringify(open.details, null, 2)}</pre>
            </>
          )}
        </DetailDrawer>
      )}
    </>
  );
}

/* ============================================================== sessiyalar === */
type SessionRow = {
  id: string;
  kind: "panel" | "mobile";
  company: string;
  who: string;
  role?: string | null;
  device: string;
  ip?: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt?: string;
  state: string;
  current?: boolean;
};

function SessionsView() {
  const toast = useToast();
  const run = useAction();
  const [state, setState] = useState({ kind: "panel" as "panel" | "mobile", status: "active", q: "", page: 1 });
  const { data, loading, error, reload } = useServerList<SessionRow>("/super-admin/sessions", { ...state, pageSize: 30 });
  const onQuery = useCallback((q: string) => setState((s) => ({ ...s, q, page: 1 })), []);
  const [revoking, setRevoking] = useState<SessionRow | null>(null);
  return (
    <>
      <PageHeader title="Sessiyalar" subtitle="Panel (brauzer) va mobil ilova sessiyalari · bekor qilingan sessiya darhol ishlamay qoladi" />
      <Section>
        <div className="sa-tabs" role="tablist" aria-label="Sessiya turi">
          {(
            [
              ["panel", "Panel"],
              ["mobile", "Mobil ilova"],
            ] as const
          ).map(([key, label]) => (
            <button key={key} role="tab" aria-selected={state.kind === key} className={state.kind === key ? "on" : ""} onClick={() => setState({ ...state, kind: key, page: 1 })}>
              {label}
            </button>
          ))}
        </div>
        <FilterBar>
          <SearchInput value={state.q} onChange={onQuery} placeholder={state.kind === "panel" ? "Foydalanuvchi, kompaniya yoki IP…" : "Xodim yoki kompaniya…"} />
          <Select
            label="Holat"
            value={state.status}
            onChange={(status) => setState({ ...state, status, page: 1 })}
            options={[
              ["active", "Faol"],
              ["expired", "Muddati o‘tgan"],
              ["revoked", "Bekor qilingan"],
              ["all", "Barchasi"],
            ]}
          />
        </FilterBar>
        <DataTable
          rows={data?.rows}
          rowKey={(r) => r.id}
          loading={loading}
          error={error}
          onRetry={() => void reload()}
          empty={<p className="muted sa-empty">Sessiya topilmadi</p>}
          columns={[
            { key: "w", label: state.kind === "panel" ? "Foydalanuvchi" : "Xodim", render: (r) => <span className="stack"><b>{r.who}</b><small>{r.company}{r.current ? " · joriy sessiya" : ""}</small></span> },
            { key: "d", label: "Qurilma", render: (r) => r.device },
            ...(state.kind === "panel" ? [{ key: "ip", label: "IP", hideOnMobile: true, render: (r: SessionRow) => (r.ip ? <code>{r.ip}</code> : "—") }] : []),
            { key: "c", label: "Ochilgan", hideOnMobile: true, render: (r) => dateTime(r.createdAt) },
            { key: "l", label: "Oxirgi faollik", render: (r) => ago(r.lastSeenAt) },
            { key: "s", label: "Holat", render: (r) => <StatusBadge value={r.state} label={r.state === "EXPIRED" ? "Muddati o‘tgan" : undefined} /> },
            {
              key: "a",
              label: "",
              className: "sa-row-actions",
              render: (r) =>
                r.state === "ACTIVE" && !r.current ? (
                  <PermissionGuard perm="sessions.manage">
                    <button className="btn btn-sm" onClick={() => setRevoking(r)}>
                      <LogOut size={14} /> Bekor qilish
                    </button>
                  </PermissionGuard>
                ) : null,
            },
          ]}
        />
        {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => setState({ ...state, page })} />}
      </Section>
      {revoking && (
        <ConfirmDialog
          title="Sessiyani bekor qilish"
          text={`${revoking.who} · ${revoking.device}. Foydalanuvchi qayta kirishi kerak bo‘ladi.`}
          confirmLabel="Bekor qilish"
          danger
          onClose={() => setRevoking(null)}
          onConfirm={async () => {
            const ok = await run(() => post(`/super-admin/sessions/${revoking.id}/revoke`, { kind: revoking.kind }), toast, "Sessiya bekor qilindi");
            if (ok) void reload(true);
          }}
        />
      )}
    </>
  );
}

/* ======================================================== administratorlar === */
type AdminRow = { id: string; name: string; email: string; platformRole: string; telegramLinked: boolean; twoFactor: boolean; blockedAt: string | null; blockReason: string | null; lastLoginAt: string | null; activeSessions: number };
type RolesInfo = { permissions: { key: string; label: string }[]; roles: { key: string; label: string; description: string; rank: number; permissions: string[] }[] };

function AdminsView() {
  const toast = useToast();
  const run = useAction();
  const { me } = usePlatform();
  const { data, error, reload } = useApi<AdminRow[]>("/super-admin/admins");
  const { data: roles } = useApi<RolesInfo>("/super-admin/admin-roles");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const [blocking, setBlocking] = useState<AdminRow | null>(null);
  const roleLabel = (key: string) => roles?.roles.find((r) => r.key === key)?.label || key;
  return (
    <>
      <PageHeader
        title="Platforma administratorlari"
        subtitle="Rollar: Owner, Admin, Support, Finance, Analyst · har bir ruxsat serverda tekshiriladi"
        actions={
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <UserPlus size={15} /> Administrator qo‘shish
          </button>
        }
      />
      {created && (
        <Section title="Yangi administrator yaratildi">
          <SecretReveal label={`${created.email} uchun vaqtinchalik parol`} value={created.password} note="Faqat hozir ko‘rsatiladi. Birinchi kirishda parolni almashtirish tavsiya etiladi." />
          <button className="btn btn-sm" onClick={() => setCreated(null)}>
            Yashirish
          </button>
        </Section>
      )}
      <Section>
        {error ? (
          <ErrorState message={error} onRetry={() => void reload()} />
        ) : (
          <DataTable
            rows={data || undefined}
            loading={!data}
            rowKey={(a) => a.id}
            columns={[
              { key: "n", label: "Administrator", render: (a) => <span className="stack"><b>{a.name}{a.id === me?.user.id ? " (siz)" : ""}</b><small>{a.email}</small></span> },
              {
                key: "r",
                label: "Rol",
                render: (a) =>
                  a.id === me?.user.id ? (
                    <span className="badge blue plain">{roleLabel(a.platformRole)}</span>
                  ) : (
                    <select
                      className="select sa-select"
                      value={a.platformRole}
                      aria-label="Platforma roli"
                      onChange={(e) => void run(() => patch(`/super-admin/admins/${a.id}`, { platformRole: e.target.value }), toast, "Rol o‘zgartirildi").then(() => reload(true))}
                    >
                      {(roles?.roles || []).map((r) => (
                        <option key={r.key} value={r.key}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  ),
              },
              { key: "m", label: "2FA", render: (a) => (a.twoFactor ? <StatusBadge value="OK" label="Yoqilgan" /> : <StatusBadge value="WARN" label={a.telegramLinked ? "O‘chiq" : "Telegram yo‘q"} />) },
              { key: "l", label: "Oxirgi kirish", render: (a) => ago(a.lastLoginAt) },
              { key: "s", label: "Sessiyalar", className: "num", hideOnMobile: true, render: (a) => a.activeSessions },
              { key: "b", label: "Holat", render: (a) => (a.blockedAt ? <StatusBadge value="SUSPENDED" label="Bloklangan" /> : <StatusBadge value="ACTIVE" />) },
              {
                key: "a",
                label: "",
                className: "sa-row-actions",
                render: (a) =>
                  a.id === me?.user.id ? null : a.blockedAt ? (
                    <button className="btn btn-sm" onClick={() => void run(() => post(`/super-admin/admins/${a.id}/unblock`, {}), toast, "Blokdan chiqarildi").then(() => reload(true))}>
                      <Unlock size={14} /> Blokdan chiqarish
                    </button>
                  ) : (
                    <button className="btn btn-sm btn-danger" onClick={() => setBlocking(a)}>
                      <Ban size={14} /> Bloklash
                    </button>
                  ),
              },
            ]}
          />
        )}
      </Section>

      {roles && (
        <Section title="Rollar va ruxsatlar" subtitle="Rol ruxsatlari kodda belgilangan — o‘zgartirish faqat deploy orqali (xavfsiz)">
          <div className="sa-role-cards">
            {roles.roles
              .slice()
              .sort((a, b) => b.rank - a.rank)
              .map((r) => (
                <div key={r.key} className="sa-role-card">
                  <b>{r.label}</b>
                  <small>{r.description}</small>
                  <span className="muted">{r.permissions.length} / {roles.permissions.length} ruxsat</span>
                </div>
              ))}
          </div>
          <div className="table-wrap sa-matrix-wrap">
            <table className="table sa-matrix">
              <thead>
                <tr>
                  <th>Ruxsat</th>
                  {roles.roles.map((r) => (
                    <th key={r.key} className="num">
                      {r.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roles.permissions.map((p) => (
                  <tr key={p.key}>
                    <td>
                      <span className="stack">
                        <span>{p.label}</span>
                        <small>
                          <code>{p.key}</code>
                        </small>
                      </span>
                    </td>
                    {roles.roles.map((r) => (
                      <td key={r.key} className="num" aria-label={r.permissions.includes(p.key) ? "Bor" : "Yo‘q"}>
                        {r.permissions.includes(p.key) ? <span className="sa-yes">✓</span> : <span className="sa-no">·</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {creating && roles && (
        <CreateAdmin
          roles={roles.roles}
          onClose={() => setCreating(false)}
          onDone={(result) => {
            setCreating(false);
            setCreated(result);
            void reload(true);
          }}
        />
      )}
      {blocking && (
        <ConfirmDialog
          title={`${blocking.email} — bloklash`}
          text="Administrator panelga kira olmaydi, barcha sessiyalari yopiladi. Oxirgi Owner bloklanmaydi."
          danger
          confirmLabel="Bloklash"
          reason={{ label: "Sabab", required: true }}
          onClose={() => setBlocking(null)}
          onConfirm={async (reason) => {
            const ok = await run(() => post(`/super-admin/admins/${blocking.id}/block`, { reason }), toast, "Bloklandi");
            if (ok) void reload(true);
          }}
        />
      )}
    </>
  );
}

function CreateAdmin({ roles, onClose, onDone }: { roles: RolesInfo["roles"]; onClose: () => void; onDone: (r: { email: string; password: string }) => void }) {
  const toast = useToast();
  const run = useAction();
  const [form, setForm] = useState({ name: "", email: "", platformRole: "SUPPORT" });
  const [busy, setBusy] = useState(false);
  const selected = roles.find((r) => r.key === form.platformRole);
  return (
    <Modal title="Administrator qo‘shish" subtitle="Vaqtinchalik parol bir marta ko‘rsatiladi" onClose={onClose} size="narrow">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const result = await run(() => post<{ id: string; email: string; password: string }>("/super-admin/admins", form), toast, "Administrator qo‘shildi");
          setBusy(false);
          if (result) onDone({ email: result.email, password: result.password });
        }}
      >
        <Field label="Ism">
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} autoFocus />
        </Field>
        <Field label="Email">
          <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        </Field>
        <Field label="Platforma roli" hint={selected?.description}>
          <select className="select" value={form.platformRole} onChange={(e) => setForm({ ...form, platformRole: e.target.value })}>
            {roles.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Bekor qilish
          </button>
          <button className="btn btn-primary" disabled={busy}>
            <ShieldCheck size={15} /> Qo‘shish
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function SecurityPages({ view }: { view: string }) {
  const { can, me } = usePlatform();
  if (!me) return <Skeleton rows={8} />;
  if (view === "audit") return can("audit.read") ? <AuditView /> : <NoAccess />;
  if (view === "sessions") return can("users.read") ? <SessionsView /> : <NoAccess />;
  if (view === "admins") return can("admins.manage") ? <AdminsView /> : <NoAccess />;
  return can("security.read") ? <SecurityCenter /> : <NoAccess />;
}

