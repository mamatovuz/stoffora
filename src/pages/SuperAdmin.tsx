import { useState } from "react";
import { Activity, Building2, LogOut, Plus, Send, Users } from "lucide-react";
import { api, errorText, patch, post } from "../api";
import { useApi } from "../hooks";
import {
  ErrorBox,
  Field,
  Loading,
  Modal,
  PageHeader,
  StatCard,
  useToast,
} from "../components/ui";
import { Logo } from "../components/Logo";
import { useAuth } from "../auth";
import { dateUz } from "@/lib/format";
import type { Company } from "@/lib/types";

type Overview = {
  stats: { companies: number; active: number; trial: number; employees: number; eventsToday: number };
  telegram: { state: string; username?: string; error?: string; mode?: string };
  companies: (Company & { employees: number; branches: number; owner?: string })[];
};

export function SuperAdminPage() {
  const { data, loading, error, reload } = useApi<Overview>("/admin/overview");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const toast = useToast();
  const { user } = useAuth();
  async function logout() {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    location.href = "/login";
  }
  return (
    <div>
      <header className="admin-top">
        <div className="admin-top-inner">
          <Logo />
          <span className="admin-divider" />
          <span className="admin-label">Platforma boshqaruvi</span>
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
          title="Platforma boshqaruvi"
          subtitle="Kompaniyalar va tizim holati"
          actions={
            <button className="btn btn-primary" onClick={() => setOpen(true)}>
              <Plus size={15} /> Kompaniya yaratish
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
                <StatCard label="Faol xodimlar" value={data.stats.employees} icon={Users} tone="green" />
                <StatCard label="Bugungi qaydlar" value={data.stats.eventsToday} icon={Activity} tone="blue" />
                <StatCard
                  label="Telegram bot"
                  value={({ running: "Ishlayapti", disabled: "O‘chirilgan", starting: "Ishga tushmoqda", error: "Xato" } as Record<string, string>)[data.telegram.state] || data.telegram.state}
                  note={data.telegram.username ? `@${data.telegram.username} · ${data.telegram.mode || ""}` : data.telegram.error}
                  icon={Send}
                  tone={data.telegram.state === "running" ? "green" : "red"}
                />
              </div>
              <section className="card">
                <div className="filters">
                  <input
                    className="input"
                    style={{ maxWidth: 320 }}
                    placeholder="Kompaniya yoki egasi…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <span className="muted" style={{ marginLeft: "auto", fontSize: 13 }}>
                    {data.companies.length} ta kompaniya
                  </span>
                </div>
                <div className="table-wrap">
                  <table className="table table-cards">
                    <thead>
                      <tr>
                        <th>Kompaniya</th>
                        <th>Egasi</th>
                        <th>Xodim / filial</th>
                        <th>Xodim chegarasi</th>
                        <th>Tarif</th>
                        <th>Holat</th>
                        <th>Yaratilgan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.companies
                        .filter((c) => `${c.name} ${c.ownerName} ${c.owner || ""}`.toLowerCase().includes(query.toLowerCase()))
                        .map((c) => (
                        <tr key={c.id}>
                          <td>
                            <span className="stack">
                              <b>{c.name}</b>
                              <small>{c.slug}</small>
                            </span>
                          </td>
                          <td data-label="Egasi">
                            <span className="stack">
                              <span>{c.ownerName}</span>
                              <small>{c.owner || "login yo‘q"}</small>
                            </span>
                          </td>
                          <td data-label="Xodim / filial" className="num">
                            {c.employees} / {c.branches}
                          </td>
                          <td data-label="Chegara">
                            <LimitEditor company={c} onSaved={() => void reload(true)} />
                          </td>
                          <td data-label="Tarif">{c.plan}</td>
                          <td data-label="Holat">
                            <select
                              className="select"
                              style={{ minHeight: 32, width: 140 }}
                              value={c.status}
                              onChange={async (e) => {
                                try {
                                  await patch(`/admin/companies/${c.id}`, { status: e.target.value });
                                  toast("Holat yangilandi");
                                  void reload(true);
                                } catch (reason) {
                                  toast(errorText(reason), "error");
                                }
                              }}
                            >
                              <option value="ACTIVE">Faol</option>
                              <option value="TRIAL">Sinov</option>
                              <option value="SUSPENDED">To‘xtatilgan</option>
                            </select>
                          </td>
                          <td data-label="Yaratilgan">{dateUz(c.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )
        )}
        {open && (
          <CompanyForm
            onClose={() => setOpen(false)}
            onSaved={() => {
              setOpen(false);
              toast("Kompaniya yaratildi");
              void reload(true);
            }}
          />
        )}
      </div>
    </div>
  );
}

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
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await post("/admin/companies", { ...form, employeeLimit: form.employeeLimit ? Number(form.employeeLimit) : undefined });
      onSaved();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title="Yangi kompaniya" subtitle="Kompaniya egasi shu email va parol bilan panelga kiradi" onClose={onClose}>
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
            <input className="input" type="number" min={1} value={form.employeeLimit} onChange={set("employeeLimit")} placeholder="Masalan 500" />
          </Field>
          <Field label="Holat">
            <select className="select" value={form.status} onChange={set("status")}>
              <option value="TRIAL">Sinov</option>
              <option value="ACTIVE">Faol</option>
            </select>
          </Field>
        </div>
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

/** Kompaniya uchun maksimal faol xodim soni va chegaradan oshganda aloqa. */
function LimitEditor({ company, onSaved }: { company: Company & { employees: number }; onSaved: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(company.employeeLimit ? String(company.employeeLimit) : "");
  const [contact, setContact] = useState(company.limitContact || "@mamatov_ads");
  const [busy, setBusy] = useState(false);
  const used = company.employees;
  const max = company.employeeLimit;
  const percent = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return (
    <>
      <button className="limit-chip" onClick={() => setOpen(true)} title="Chegarani o‘zgartirish">
        <span>
          <b>{used}</b> / {max || "∞"}
        </span>
        {max ? (
          <span className="limit-bar">
            <i style={{ width: `${percent}%` }} className={percent >= 100 ? "full" : percent >= 90 ? "warn" : ""} />
          </span>
        ) : (
          <small>cheklovsiz</small>
        )}
      </button>
      {open && (
        <Modal title="Xodim chegarasi" subtitle={company.name} onClose={() => setOpen(false)} size="narrow">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await patch(`/admin/companies/${company.id}`, { employeeLimit: limit ? Number(limit) : null, limitContact: contact });
                toast("Chegara saqlandi");
                setOpen(false);
                onSaved();
              } catch (reason) {
                toast(errorText(reason), "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Maksimal faol xodim" hint={`Hozir ${used} ta faol xodim. Bo‘sh qoldirilsa — cheklovsiz.`}>
              <input className="input" type="number" min={1} value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="Masalan 500" />
            </Field>
            <Field label="Chegaradan oshganda aloqa" hint="Kompaniya ko‘proq xodim qo‘shmoqchi bo‘lsa shu manzilga yozadi">
              <input className="input" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="@mamatov_ads" />
            </Field>
            <div className="toolbar" style={{ marginBottom: 12 }}>
              {[50, 100, 200, 500, 1000].map((n) => (
                <button type="button" key={n} className={`btn btn-sm ${limit === String(n) ? "btn-primary" : ""}`} onClick={() => setLimit(String(n))}>
                  {n}
                </button>
              ))}
              <button type="button" className={`btn btn-sm ${!limit ? "btn-primary" : ""}`} onClick={() => setLimit("")}>
                ∞
              </button>
            </div>
            {limit && Number(limit) < used && (
              <p className="late-text" style={{ fontSize: 12.5, marginBottom: 10 }}>
                Chegara hozirgi xodimlar sonidan kam — mavjudlar o‘chmaydi, faqat yangi qo‘shish to‘xtaydi.
              </p>
            )}
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setOpen(false)}>
                Bekor qilish
              </button>
              <button className="btn btn-primary" disabled={busy}>
                Saqlash
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
