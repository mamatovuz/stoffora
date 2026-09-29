import { useState } from "react";
import { LogOut, Plus } from "lucide-react";
import { api, post } from "../api";
import { useApi } from "../hooks";
import { ErrorBox, Loading, Modal, PageHeader, Status } from "../components/ui";
import { Logo } from "../components/Logo";
import { dateUz } from "@/lib/format";
import type { Company } from "@/lib/types";
type Overview = {
  stats: {
    companies: number;
    active: number;
    trial: number;
    employees: number;
    eventsToday: number;
  };
  companies: (Company & { employees: number; branches: number })[];
};
export function SuperAdminPage() {
  const { data, loading, error, reload } = useApi<Overview>("/admin/overview"),
    [open, setOpen] = useState(false);
  async function logout() {
    await api("/auth/logout", { method: "POST" });
    location.href = "/login";
  }
  return (
    <div>
      <header className="topbar" style={{ position: "sticky" }}>
        <Logo />
        <span
          style={{
            marginLeft: 15,
            paddingLeft: 15,
            borderLeft: "1px solid var(--line)",
            fontSize: 11,
            color: "var(--muted)",
          }}
        >
          SUPER ADMIN
        </span>
        <button className="btn" style={{ marginLeft: "auto" }} onClick={logout}>
          <LogOut size={15} /> Chiqish
        </button>
      </header>
      <div className="page">
        <PageHeader
          title="Platforma boshqaruvi"
          subtitle="Staffora kompaniyalari va tizim faolligi"
        />
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorBox message={error} />
        ) : (
          data && (
            <>
              <div className="grid-stats">
                {[
                  ["Kompaniyalar", data.stats.companies],
                  ["Faol", data.stats.active],
                  ["Sinov muddati", data.stats.trial],
                  ["Xodimlar", data.stats.employees],
                  ["Davomat hodisalari", data.stats.eventsToday],
                ].map(([label, value]) => (
                  <div className="card stat" key={label}>
                    <div className="stat-label">{label}</div>
                    <div className="stat-value">{value}</div>
                  </div>
                ))}
              </div>
              <section className="card" style={{ marginTop: 16 }}>
                <div className="section-head">
                  <h2>Kompaniyalar</h2>
                  <button
                    className="btn btn-primary"
                    onClick={() => setOpen(true)}
                  >
                    <Plus size={15} /> Kompaniya yaratish
                  </button>
                </div>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Kompaniya</th>
                        <th>Egasi</th>
                        <th>Xodimlar</th>
                        <th>Filiallar</th>
                        <th>Reja</th>
                        <th>Holat</th>
                        <th>Yaratilgan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.companies.map((c) => (
                        <tr key={c.id}>
                          <td>
                            <b>{c.name}</b>
                            <small
                              className="subtle"
                              style={{ display: "block" }}
                            >
                              {c.slug}
                            </small>
                          </td>
                          <td>{c.ownerName}</td>
                          <td>{c.employees}</td>
                          <td>{c.branches}</td>
                          <td>{c.plan}</td>
                          <td>
                            <Status value={c.status} />
                          </td>
                          <td>{dateUz(c.createdAt)}</td>
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
              void reload();
            }}
          />
        )}
      </div>
    </div>
  );
}
function CompanyForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
      name: "",
      ownerName: "",
      plan: "Standard",
      status: "TRIAL",
    }),
    [error, setError] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await post("/admin/companies", form);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xatolik");
    }
  }
  return (
    <Modal title="Yangi kompaniya" onClose={onClose}>
      <form onSubmit={save}>
        <div className="field">
          <label className="label">Kompaniya nomi</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </div>
        <div className="field">
          <label className="label">Egasi</label>
          <input
            className="input"
            value={form.ownerName}
            onChange={(e) => setForm({ ...form, ownerName: e.target.value })}
            required
          />
        </div>
        <div className="form-grid">
          <div className="field">
            <label className="label">Reja</label>
            <select
              className="select"
              value={form.plan}
              onChange={(e) => setForm({ ...form, plan: e.target.value })}
            >
              <option>Standard</option>
              <option>Business</option>
              <option>Enterprise</option>
            </select>
          </div>
          <div className="field">
            <label className="label">Holat</label>
            <select
              className="select"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              <option value="TRIAL">Sinov</option>
              <option value="ACTIVE">Faol</option>
            </select>
          </div>
        </div>
        {error && <p className="field-error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Bekor qilish
          </button>
          <button className="btn btn-primary">Yaratish</button>
        </div>
      </form>
    </Modal>
  );
}
