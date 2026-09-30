import { useState } from "react";
import { ClipboardList, Copy, Pencil, Plus, Trash2, Users } from "lucide-react";
import { del, errorText, post, put } from "../api";
import { useApi } from "../hooks";
import {
  Confirm,
  Empty,
  ErrorBox,
  Field,
  Loading,
  Modal,
  PageHeader,
  useToast,
} from "../components/ui";
import type { Schedule, ScheduleDay } from "@/lib/types";
import { weekdayNames, weekdayShort, weekOrder } from "../types";

type Row = Schedule & { employees: number };
const typeLabel = { FIXED: "Qat’iy", FLEXIBLE: "Moslashuvchan", SHIFT: "Smenali" };

export function SchedulesPage() {
  const { data, loading, error, reload } = useApi<Row[]>("/schedules");
  const [editing, setEditing] = useState<Schedule | "new" | null>(null);
  const [removing, setRemoving] = useState<Row | null>(null);
  const toast = useToast();
  return (
    <div className="page">
      <PageHeader
        title="Ish grafiklari"
        subtitle="Ish vaqti, tanaffus va kechikish imtiyozi"
        actions={
          <button className="btn btn-primary" onClick={() => setEditing("new")}>
            <Plus size={16} /> Grafik yaratish
          </button>
        }
      />
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} />
      ) : !data?.length ? (
        <section className="card">
          <Empty
            icon={ClipboardList}
            title="Grafik yo‘q"
            text="Kechikish va ish vaqtini hisoblash uchun kamida bitta grafik kerak."
            action={
              <button className="btn btn-primary" onClick={() => setEditing("new")}>
                <Plus size={16} /> Grafik yaratish
              </button>
            }
          />
        </section>
      ) : (
        <div className="grid-cards">
          {data.map((s) => {
            const workdays = s.days.filter((d) => d.enabled);
            return (
              <article className="card" key={s.id}>
                <div className="card-head">
                  <div>
                    <h3>{s.name}</h3>
                    <p>
                      {typeLabel[s.type]} · {s.graceMinutes} daq imtiyoz · haftada{" "}
                      {workdays.length} kun
                    </p>
                  </div>
                </div>
                <div className="card-body">
                  <div className="week-strip">
                    {weekOrder.map((day) => {
                      const d = s.days.find((x) => x.day === day);
                      return (
                        <div key={day} className={d?.enabled ? "" : "off"}>
                          <b>{weekdayShort[day]}</b>
                          <small>{d?.enabled ? d.start : "—"}</small>
                          <small>{d?.enabled ? d.end : ""}</small>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="card-foot">
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    <Users size={13} style={{ display: "inline", verticalAlign: -2 }} />{" "}
                    {s.employees} xodim
                  </span>
                  <div className="toolbar">
                    <button
                      className="icon-btn"
                      title="Nusxa olish"
                      aria-label="Nusxa olish"
                      onClick={() => setEditing({ ...s, id: "", name: `${s.name} (nusxa)` })}
                    >
                      <Copy size={15} />
                    </button>
                    <button className="icon-btn" aria-label="Tahrirlash" onClick={() => setEditing(s)}>
                      <Pencil size={15} />
                    </button>
                    <button className="icon-btn danger" aria-label="O‘chirish" onClick={() => setRemoving(s)}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {editing && (
        <ScheduleForm
          schedule={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            toast("Grafik saqlandi");
            setEditing(null);
            void reload(true);
          }}
        />
      )}
      {removing && (
        <Confirm
          title="Grafikni o‘chirish"
          text={
            removing.employees
              ? `Bu grafikdan ${removing.employees} xodim foydalanmoqda. Avval ularni boshqa grafikka o‘tkazing.`
              : `«${removing.name}» o‘chiriladi.`
          }
          confirmLabel="O‘chirish"
          danger
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await del(`/schedules/${removing.id}`);
            toast("Grafik o‘chirildi");
            void reload(true);
          }}
        />
      )}
    </div>
  );
}

const defaultDays = (): ScheduleDay[] =>
  [0, 1, 2, 3, 4, 5, 6].map((day) => ({
    day,
    enabled: day >= 1 && day <= 5,
    start: "09:00",
    end: "18:00",
    breakMinutes: 60,
  }));

function ScheduleForm({
  schedule,
  onClose,
  onSaved,
}: {
  schedule?: Schedule;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(schedule?.name || "");
  const [type, setType] = useState<Schedule["type"]>(schedule?.type || "FIXED");
  const [grace, setGrace] = useState(schedule?.graceMinutes ?? 10);
  const [overtime, setOvertime] = useState(schedule?.overtimeEnabled ?? true);
  const [days, setDays] = useState<ScheduleDay[]>(() => {
    const base = defaultDays();
    return base.map((d) => schedule?.days.find((x) => x.day === d.day) || d);
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const update = (day: number, patch: Partial<ScheduleDay>) =>
    setDays((list) => list.map((d) => (d.day === day ? { ...d, ...patch } : d)));
  const applyToAll = () => {
    const first = days.find((d) => d.enabled);
    if (!first) return;
    setDays((list) =>
      list.map((d) =>
        d.enabled ? { ...d, start: first.start, end: first.end, breakMinutes: first.breakMinutes } : d,
      ),
    );
  };
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!days.some((d) => d.enabled)) {
      setError("Kamida bitta ish kunini yoqing.");
      return;
    }
    setSaving(true);
    try {
      const body = { name, type, graceMinutes: grace, overtimeEnabled: overtime, days };
      if (schedule?.id) await put(`/schedules/${schedule.id}`, body);
      else await post("/schedules", body);
      onSaved();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title={schedule?.id ? "Grafikni tahrirlash" : "Yangi ish grafigi"} onClose={onClose} size="wide">
      <form onSubmit={save}>
        <div className="form-grid cols-3">
          <Field label="Grafik nomi *">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} placeholder="Standart 5/2" />
          </Field>
          <Field label="Turi">
            <select className="select" value={type} onChange={(e) => setType(e.target.value as Schedule["type"])}>
              <option value="FIXED">Qat’iy</option>
              <option value="FLEXIBLE">Moslashuvchan</option>
              <option value="SHIFT">Smenali</option>
            </select>
          </Field>
          <Field label="Kechikish imtiyozi (daq)" hint="Shu daqiqagacha kechikish hisoblanmaydi">
            <input className="input" type="number" min={0} max={120} value={grace} onChange={(e) => setGrace(Number(e.target.value))} />
          </Field>
        </div>
        <div className="form-section-title">
          Hafta kunlari
          <button type="button" className="link" style={{ marginLeft: "auto", order: 2 }} onClick={applyToAll}>
            Birinchi kun vaqtini hammasiga qo‘llash
          </button>
        </div>
        <div className="day-editor">
          {weekOrder.map((day) => {
            const d = days.find((x) => x.day === day)!;
            return (
              <div key={day} className={`day-editor-row ${d.enabled ? "" : "off"}`}>
                <label>
                  <span className="switch">
                    <input type="checkbox" checked={d.enabled} onChange={(e) => update(day, { enabled: e.target.checked })} />
                    <span />
                  </span>
                  {weekdayNames[day]}
                </label>
                <input className="input" type="time" value={d.start} disabled={!d.enabled} onChange={(e) => update(day, { start: e.target.value })} aria-label="Boshlanish" />
                <input className="input" type="time" value={d.end} disabled={!d.enabled} onChange={(e) => update(day, { end: e.target.value })} aria-label="Tugash" />
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={480}
                  value={d.breakMinutes}
                  disabled={!d.enabled}
                  onChange={(e) => update(day, { breakMinutes: Number(e.target.value) })}
                  aria-label="Tanaffus (daq)"
                  title="Tanaffus (daqiqa)"
                />
              </div>
            );
          })}
        </div>
        <label className="checkbox-row" style={{ margin: "14px 0" }}>
          <input type="checkbox" checked={overtime} onChange={(e) => setOvertime(e.target.checked)} />
          Qo‘shimcha ish vaqtini hisoblash (ish haqiga qo‘shiladi)
        </label>
        <ErrorBox message={error} />
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Bekor qilish
          </button>
          <button className="btn btn-primary" disabled={saving}>
            {saving ? "Saqlanmoqda…" : "Saqlash"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
