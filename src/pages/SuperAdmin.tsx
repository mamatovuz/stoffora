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
  const toast = useToast();
  async function logout() {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    location.href = "/login";
  }
  return (
    <div>
      <header className="topbar scrolled" style={{ background: "var(--surface)" }}>
        <Logo />
        <span className="badge dark plain" style={{ background: "var(--ink)", color: "#fff" }}>
          SUPER ADMIN
        </span>
        <button className="btn" style={{ marginLeft: "auto" }} onClick={logout}>
          <LogOut size={15} /> Chiqish
        </button>
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
                  value={data.telegram.state === "running" ? "Ishlayapti" : data.telegram.state}
                  note={data.telegram.username ? `@${data.telegram.username} · ${data.telegram.mode || ""}` : data.telegram.error}
                  icon={Send}
                  tone={data.telegram.state === "running" ? "green" : "red"}
                />
              </div>
              <section className="card">
                <div className="table-wrap">
                  <table className="table table-cards">
                    <thead>
                      <tr>
                        <th>Kompaniya</th>
                        <th>Egasi</th>
                        <th>Xodim / filial</th>
                        <th>Tarif</th>
                        <th>Holat</th>
                        <th>Yaratilgan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.companies.map((c) => (
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
      await post("/admin/companies", form);
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
