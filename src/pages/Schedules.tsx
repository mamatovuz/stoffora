import { useState } from "react";
import { Clock3, Plus, Users } from "lucide-react";
import { post } from "../api";
import { useApi } from "../hooks";
import { Empty, ErrorBox, Loading, Modal, PageHeader } from "../components/ui";
import type { Schedule } from "@/lib/types";
type Row = Schedule & { employees: number };
const days = ["Yak", "Du", "Se", "Chor", "Pay", "Jum", "Shan"];
export function SchedulesPage() {
  const { data, loading, error, reload } = useApi<Row[]>("/schedules");
  const [open, setOpen] = useState(false);
  return (
    <div className="page">
      <PageHeader
        title="Ish grafiklari"
        subtitle="Ish vaqti, tanaffus va kechikish qoidalari"
        actions={
          <button className="btn btn-primary" onClick={() => setOpen(true)}>
            <Plus size={16} /> Grafik yaratish
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
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(360px,1fr))",
            gap: 14,
          }}
        >
          {data.map((s) => (
            <article className="card" key={s.id}>
              <div className="section-head">
                <div>
                  <h2>{s.name}</h2>
                  <small className="subtle">
                    {s.type} · {s.graceMinutes} daqiqa imtiyoz
                  </small>
                </div>
                <span className="badge badge-green">Faol</span>
              </div>
              <div className="section-body">
                {s.days.map((d) => (
                  <div
                    key={d.day}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "55px 1fr auto",
                      padding: "8px 0",
                      borderBottom: "1px solid #edf0ef",
                      fontSize: 12,
                    }}
                  >
                    <b>{days[d.day]}</b>
                    <span className="subtle">
                      {d.enabled ? `${d.start} — ${d.end}` : "Dam olish"}
                    </span>
                    <small className="subtle">
                      {d.enabled ? `${d.breakMinutes} daq tanaffus` : ""}
                    </small>
                  </div>
                ))}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginTop: 15,
                  }}
                >
                  <span className="subtle">
                    <Users size={14} style={{ display: "inline" }} />{" "}
                    {s.employees} xodim
                  </span>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {open && (
        <ScheduleForm
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
function ScheduleForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
      name: "",
      type: "FIXED",
      start: "08:00",
      end: "17:00",
      graceMinutes: 5,
      breakMinutes: 60,
      overtimeEnabled: true,
    }),
    [error, setError] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const days = [1, 2, 3, 4, 5, 6, 0].map((day) => ({
      day,
      enabled: day > 0 && day < 6,
      start: form.start,
      end: form.end,
      breakMinutes: form.breakMinutes,
    }));
    try {
      await post("/schedules", {
        name: form.name,
        type: form.type,
        graceMinutes: form.graceMinutes,
        overtimeEnabled: form.overtimeEnabled,
        days,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xatolik");
    }
  }
  return (
    <Modal title="Yangi ish grafigi" onClose={onClose}>
      <form onSubmit={save}>
        <div className="field">
          <label className="label">Grafik nomi</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </div>
        <div className="form-grid">
          <div className="field">
            <label className="label">Boshlanish</label>
            <input
              className="input"
              type="time"
              value={form.start}
              onChange={(e) => setForm({ ...form, start: e.target.value })}
            />
          </div>
          <div className="field">
            <label className="label">Tugash</label>
            <input
              className="input"
              type="time"
              value={form.end}
              onChange={(e) => setForm({ ...form, end: e.target.value })}
            />
          </div>
          <div className="field">
            <label className="label">Imtiyoz (daq)</label>
            <input
              className="input"
              type="number"
              value={form.graceMinutes}
              onChange={(e) =>
                setForm({ ...form, graceMinutes: Number(e.target.value) })
              }
            />
          </div>
          <div className="field">
            <label className="label">Tanaffus (daq)</label>
            <input
              className="input"
              type="number"
              value={form.breakMinutes}
              onChange={(e) =>
                setForm({ ...form, breakMinutes: Number(e.target.value) })
              }
            />
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
