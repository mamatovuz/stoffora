import { useCallback, useState } from "react";
import { Ban, LogOut, Unlock } from "lucide-react";
import { patch, post, put } from "../../api";
import { useApi } from "../../hooks";
import { Field, PageHeader, useToast } from "../../components/ui";
import { roleLabels } from "../../auth";
import {
  ConfirmDialog,
  DataTable,
  DetailDrawer,
  FilterBar,
  KeyValue,
  Pager,
  PermissionGuard,
  SearchInput,
  Section,
  Select,
  Skeleton,
  StatusBadge,
  ago,
  dateTime,
  useAction,
  useServerList,
} from "./kit";

/*
 * Global foydalanuvchilar va rahbarlar: barcha kompaniyalar bo‘yicha qidiruv, rol, holat, oxirgi kirish,
 * faol sessiyalar; bloklash, sessiyalarni bekor qilish, rol, qo‘shimcha kompaniyalarga kirish.
 */

export type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  companyId: string | null;
  company: string | null;
  extraCompanyIds: string[];
  telegramLinked: boolean;
  twoFactor: boolean;
  blockedAt: string | null;
  blockReason: string | null;
  lastLoginAt: string | null;
  lastSeenAt: string | null;
  activeSessions: number;
};

const ROLE_OPTIONS: [string, string][] = [
  ["", "Barcha rollar"],
  ["COMPANY_OWNER", "Kompaniya egasi"],
  ["HR_ADMIN", "HR"],
  ["FINANCE", "Moliya"],
  ["IT_ADMIN", "IT administrator"],
  ["BRANCH_MANAGER", "Filial rahbari"],
];

function UsersList({ leaders }: { leaders: boolean }) {
  const [state, setState] = useState({ q: "", role: "", status: "", companyId: "", page: 1 });
  const { data, loading, error, reload } = useServerList<UserRow>("/super-admin/users", { ...state, scope: leaders ? "leaders" : undefined, pageSize: 30 });
  const [open, setOpen] = useState<string | null>(null);
  const onQuery = useCallback((q: string) => setState((s) => ({ ...s, q, page: 1 })), []);
  return (
    <>
      <PageHeader title={leaders ? "Rahbarlar" : "Foydalanuvchilar"} subtitle={leaders ? "Kompaniya egalari, HR, moliya, IT va filial rahbarlari" : "Barcha kompaniyalarning panel foydalanuvchilari"} />
      <Section>
        <FilterBar>
          <SearchInput value={state.q} onChange={onQuery} placeholder="Ism, email yoki kompaniya…" />
          <Select label="Rol" value={state.role} onChange={(role) => setState({ ...state, role, page: 1 })} options={ROLE_OPTIONS} />
          <Select
            label="Holat"
            value={state.status}
            onChange={(status) => setState({ ...state, status, page: 1 })}
            options={[
              ["", "Barchasi"],
              ["active", "Faol"],
              ["online", "Hozir onlayn (12 soat)"],
              ["blocked", "Bloklangan"],
            ]}
          />
        </FilterBar>
        <DataTable
          rows={data?.rows}
          rowKey={(r) => r.id}
          loading={loading}
          error={error}
          onRetry={() => void reload()}
          onRowClick={(r) => setOpen(r.id)}
          columns={[
            { key: "name", label: "Foydalanuvchi", render: (r) => <span className="stack"><b>{r.name}</b><small>{r.email}</small></span> },
            { key: "company", label: "Kompaniya", render: (r) => <span className="stack"><span>{r.company || "—"}</span>{r.extraCompanyIds.length > 0 && <small>+{r.extraCompanyIds.length} kompaniya</small>}</span> },
            { key: "role", label: "Rol", render: (r) => <span className="badge gray plain">{roleLabels[r.role as keyof typeof roleLabels] || r.role}</span> },
            { key: "login", label: "Oxirgi kirish", render: (r) => <span className="muted">{ago(r.lastLoginAt)}</span> },
            { key: "sessions", label: "Faol sessiyalar", className: "num", hideOnMobile: true, render: (r) => r.activeSessions },
            { key: "2fa", label: "2FA", hideOnMobile: true, render: (r) => (r.twoFactor ? "✓" : "—") },
            { key: "status", label: "Holat", render: (r) => (r.blockedAt ? <StatusBadge value="SUSPENDED" label="Bloklangan" /> : <StatusBadge value="ACTIVE" />) },
          ]}
        />
        {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => setState({ ...state, page })} />}
      </Section>
      {open && <UserDrawer id={open} onClose={() => setOpen(null)} onChanged={() => void reload(true)} />}
    </>
  );
}

type UserDetail = { user: UserRow; pages: string[]; branches: string[]; extraCompanies: { id: string; name: string }[]; sessions: { id: string; label: string; device: string; ip: string; createdAt: string; lastSeenAt: string; revokedAt: string | null }[] };

export function UserDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const run = useAction();
  const { data, reload } = useApi<UserDetail>(`/super-admin/users/${id}`);
  const { data: companies } = useApi<{ rows: { id: string; name: string }[] }>("/super-admin/companies?pageSize=200");
  const [blocking, setBlocking] = useState(false);
  const [extra, setExtra] = useState<string[] | null>(null);
  const changed = () => {
    void reload(true);
    onChanged();
  };
  const u = data?.user;
  return (
    <DetailDrawer title={u?.name || "…"} subtitle={u ? `${u.email} · ${u.company || "—"}` : undefined} onClose={onClose}>
      {!data || !u ? (
        <Skeleton rows={8} />
      ) : (
        <>
          <KeyValue
            items={[
              ["Rol", roleLabels[u.role as keyof typeof roleLabels] || u.role],
              ["Holat", u.blockedAt ? `Bloklangan: ${u.blockReason || ""} (${dateTime(u.blockedAt)})` : "Faol"],
              ["Oxirgi kirish", dateTime(u.lastLoginAt)],
              ["Telegram / 2FA", `${u.telegramLinked ? "ulangan" : "ulanmagan"} · ${u.twoFactor ? "2FA yoqilgan" : "2FA yo‘q"}`],
              ["Filiallar", data.branches.join(", ") || "—"],
            ]}
          />
          <PermissionGuard perm="users.manage">
            <div className="sa-actions-grid">
              {u.role !== "COMPANY_OWNER" && (
                <Field label="Rolni o‘zgartirish">
                  <select
                    className="select"
                    value={u.role}
                    onChange={(e) => run(() => patch(`/super-admin/users/${u.id}`, { role: e.target.value }), toast, "Rol o‘zgartirildi").then(changed)}
                  >
                    {ROLE_OPTIONS.filter(([v]) => v && v !== "COMPANY_OWNER").map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {u.blockedAt ? (
                <button className="btn" onClick={() => run(() => post(`/super-admin/users/${u.id}/unblock`, {}), toast, "Blokdan chiqarildi").then(changed)}>
                  <Unlock size={14} /> Blokdan chiqarish
                </button>
              ) : (
                <button className="btn btn-danger" onClick={() => setBlocking(true)}>
                  <Ban size={14} /> Bloklash
                </button>
              )}
            </div>
          </PermissionGuard>
          <PermissionGuard perm="sessions.manage">
            <button className="btn" onClick={() => run(() => post<{ revoked: number }>(`/super-admin/users/${u.id}/revoke-sessions`, {}), toast, "Barcha sessiyalar yopildi").then(changed)}>
              <LogOut size={14} /> Barcha sessiyalarni yopish
            </button>
          </PermissionGuard>

          <h4 className="sa-sub">Bir nechta kompaniyaga kirish</h4>
          <p className="muted">Rahbar paneldan kompaniyalar o‘rtasida almashadi. Rol barcha kompaniyalarda bir xil.</p>
          {extra === null ? (
            <>
              <p>{data.extraCompanies.map((c) => c.name).join(", ") || "Qo‘shimcha kompaniya yo‘q"}</p>
              <PermissionGuard perm="users.manage">
                <button className="btn btn-sm" onClick={() => setExtra(data.extraCompanies.map((c) => c.id))}>
                  O‘zgartirish
                </button>
              </PermissionGuard>
            </>
          ) : (
            <div className="sa-multi">
              {(companies?.rows || [])
                .filter((c) => c.id !== u.companyId)
                .map((c) => (
                  <label key={c.id} className="sa-check">
                    <input type="checkbox" checked={extra.includes(c.id)} onChange={(e) => setExtra(e.target.checked ? [...extra, c.id] : extra.filter((x) => x !== c.id))} /> {c.name}
                  </label>
                ))}
              <div className="form-actions">
                <button className="btn" onClick={() => setExtra(null)}>
                  Bekor qilish
                </button>
                <button
                  className="btn btn-primary"
                  onClick={async () => {
                    if (await run(() => put(`/super-admin/users/${u.id}/companies`, { companyIds: extra }), toast, "Saqlandi")) {
                      setExtra(null);
                      changed();
                    }
                  }}
                >
                  Saqlash
                </button>
              </div>
            </div>
          )}

          <h4 className="sa-sub">Ochiladigan sahifalar (rol ruxsatlari)</h4>
          <p className="sa-tags">{data.pages.map((p) => <span key={p} className="badge gray plain">{p}</span>)}</p>

          <h4 className="sa-sub">Sessiyalar</h4>
          <DataTable
            rows={data.sessions}
            rowKey={(s) => s.id}
            empty={<p className="muted">Sessiya yo‘q</p>}
            columns={[
              { key: "d", label: "Qurilma", render: (s) => `${s.label} · ${s.device}` },
              { key: "ip", label: "IP", render: (s) => s.ip },
              { key: "l", label: "Oxirgi faollik", render: (s) => ago(s.lastSeenAt) },
              { key: "s", label: "Holat", render: (s) => (s.revokedAt ? <StatusBadge value="REVOKED" /> : <StatusBadge value="ACTIVE" />) },
            ]}
          />
          {blocking && (
            <ConfirmDialog
              title={`${u.name} — bloklash`}
              text="Foydalanuvchi panelga kira olmaydi, sessiyalari yopiladi."
              danger
              confirmLabel="Bloklash"
              reason={{ label: "Sabab", required: true }}
              onClose={() => setBlocking(false)}
              onConfirm={async (reason) => {
                await post(`/super-admin/users/${u.id}/block`, { reason });
                toast("Bloklandi");
                changed();
              }}
            />
          )}
        </>
      )}
    </DetailDrawer>
  );
}

export default function PeoplePages({ view }: { view: string }) {
  return <UsersList key={view} leaders={view === "leaders"} />;
}
