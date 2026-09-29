import { useState } from "react";
import { Link } from "react-router-dom";
import { Building2, MapPin, Plus, QrCode, Users } from "lucide-react";
import { post } from "../api";
import { useApi } from "../hooks";
import {
  Empty,
  ErrorBox,
  Loading,
  Modal,
  PageHeader,
  Status,
} from "../components/ui";
import type { Branch, Schedule } from "@/lib/types";
type BranchRow = Branch & { employees: number };
export function BranchesPage() {
  const { data, loading, error, reload } = useApi<BranchRow[]>("/branches"),
    { data: schedules } = useApi<Schedule[]>("/schedules");
  const [open, setOpen] = useState(false);
  return (
    <div className="page">
      <PageHeader
        title="Filiallar"
        subtitle="Ish joylari va davomat zonalari"
        actions={
          <button className="btn btn-primary" onClick={() => setOpen(true)}>
            <Plus size={16} /> Filial qo‘shish
          </button>
        }
      />
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} />
      ) : !data?.length ? (
        <Empty />
      ) : (
        <div
          className="branches-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
            gap: 14,
          }}
        >
          {data.map((b) => (
            <article className="card branch-card" key={b.id}>
              <div className="section-body">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "start",
                  }}
                >
                  <span
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 8,
                      display: "grid",
                      placeItems: "center",
                      background: "var(--brand-soft)",
                      color: "var(--brand)",
                    }}
                  >
                    <Building2 size={21} />
                  </span>
                  <Status value={b.status} />
                </div>
                <h2 style={{ fontSize: 17, margin: "16px 0 7px" }}>{b.name}</h2>
                <p className="subtle" style={{ fontSize: 12, minHeight: 38 }}>
                  <MapPin size={14} style={{ display: "inline" }} /> {b.address}
                </p>
                <div className="info-grid" style={{ marginTop: 18 }}>
                  <div className="info-item">
                    <small>Xodimlar</small>
                    <b>
                      <Users size={14} style={{ display: "inline" }} />{" "}
                      {b.employees}
                    </b>
                  </div>
                  <div className="info-item">
                    <small>GPS radius</small>
                    <b>{b.radiusMeters} metr</b>
                  </div>
                  <div className="info-item">
                    <small>Menejer</small>
                    <b>{b.manager}</b>
                  </div>
                  <div className="info-item">
                    <small>Koordinata</small>
                    <b>
                      {b.latitude.toFixed(3)}, {b.longitude.toFixed(3)}
                    </b>
                  </div>
                  <div className="info-item branch-device">
                    <small>Davomat qurilmasi</small>
                    <b><QrCode size={14} /> Dinamik QR</b>
                    <span className="device-online"><i /> Onlayn</span>
                  </div>
                </div>
              </div>
              <div
                style={{
                  borderTop: "1px solid var(--line)",
                  padding: 12,
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span className="subtle" style={{ fontSize: 11 }}>
                  Radius: {b.radiusMeters} m
                </span>
                <Link
                  className="btn btn-sm"
                  to={`/attendance-screen/${b.id}`}
                  target="_blank"
                >
                  <QrCode size={15} /> QR ekran
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
      {open && (
        <BranchForm
          schedules={schedules || []}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            void reload();
          }}
        />
      )}
    </div>
  );
}
function BranchForm({
  schedules,
  onClose,
  onSaved,
}: {
  schedules: Schedule[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: "",
    address: "",
    latitude: 40.7821,
    longitude: 72.3442,
    radiusMeters: 100,
    manager: "",
    scheduleId: schedules[0]?.id || "",
    status: "ACTIVE",
  });
  const [error, setError] = useState("");
  const set = (k: string, v: string | number) =>
    setForm((f) => ({ ...f, [k]: v }));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await post("/branches", form);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xatolik");
    }
  }
  return (
    <Modal title="Yangi filial" onClose={onClose}>
      <form onSubmit={save}>
        <div className="form-grid">
          <Field label="Filial nomi">
            <input
              className="input"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              required
            />
          </Field>
          <Field label="Menejer">
            <input
              className="input"
              value={form.manager}
              onChange={(e) => set("manager", e.target.value)}
              required
            />
          </Field>
          <div style={{ gridColumn: "1/-1" }}>
            <Field label="Manzil">
              <input
                className="input"
                value={form.address}
                onChange={(e) => set("address", e.target.value)}
                required
              />
            </Field>
          </div>
          <Field label="Latitude">
            <input
              className="input"
              type="number"
              step="any"
              value={form.latitude}
              onChange={(e) => set("latitude", Number(e.target.value))}
            />
          </Field>
          <Field label="Longitude">
            <input
              className="input"
              type="number"
              step="any"
              value={form.longitude}
              onChange={(e) => set("longitude", Number(e.target.value))}
            />
          </Field>
          <Field label="Davomat radiusi (metr)">
            <input
              className="input"
              type="number"
              value={form.radiusMeters}
              onChange={(e) => set("radiusMeters", Number(e.target.value))}
            />
          </Field>
          <Field label="Ish grafigi">
            <select
              className="select"
              value={form.scheduleId}
              onChange={(e) => set("scheduleId", e.target.value)}
            >
              {schedules.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {error && <p className="field-error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Bekor qilish
          </button>
          <button className="btn btn-primary">Filialni yaratish</button>
        </div>
      </form>
    </Modal>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="field">
      <label className="label">{label}</label>
      {children}
    </div>
  );
}
