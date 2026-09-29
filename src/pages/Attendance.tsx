import { useMemo, useState } from "react";
import { Download, MapPin, Pencil, Search, ShieldCheck } from "lucide-react";
import { put } from "../api";
import { useApi } from "../hooks";
import {
  Avatar,
  Empty,
  ErrorBox,
  Loading,
  Modal,
  PageHeader,
  Status,
} from "../components/ui";
import { dateUz, duration } from "@/lib/format";
import type { Attendance, Branch, Department, Employee } from "@/lib/types";

type Row = Attendance & {
  employee?: Employee;
  branch?: string;
  department?: string;
  schedule?: string;
};
type Meta = { branches: Branch[]; departments: Department[] };

export function AttendancePage() {
  const [status, setStatus] = useState("");
  const [branch, setBranch] = useState("");
  const [department, setDepartment] = useState("");
  const [verification, setVerification] = useState("");
  const [date, setDate] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);
  const url = `/attendance?status=${status}&branch=${branch}&department=${department}&verification=${verification}&date=${date}`;
  const { data, loading, error, reload } = useApi<Row[]>(url);
  const { data: meta } = useApi<Meta>("/meta");
  const rows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return data || [];
    return (data || []).filter((row) =>
      `${row.employee?.firstName} ${row.employee?.lastName} ${row.employee?.employeeNo}`
        .toLowerCase()
        .includes(normalized),
    );
  }, [data, query]);
  const stats = {
    total: rows.length,
    working: rows.filter((row) =>
      ["WORKING", "PRESENT", "CHECKED_OUT"].includes(row.status),
    ).length,
    late: rows.filter((row) => row.status === "LATE").length,
    absent: rows.filter((row) => row.status === "ABSENT").length,
  };
  return (
    <div className="page attendance-page">
      <PageHeader
        title="Davomat"
        subtitle={date ? dateUz(date) : "Barcha davomat qaydlari"}
        actions={
          <a className="btn" href="/api/reports/attendance.csv" download>
            <Download size={16} /> CSV eksport
          </a>
        }
      />
      <section className="attendance-summary">
        <div>
          <small>Ko‘rsatilgan qaydlar</small>
          <b>{stats.total}</b>
        </div>
        <div>
          <i className="dot-success" />
          <span>
            <small>Ishda / chiqqan</small>
            <b>{stats.working}</b>
          </span>
        </div>
        <div>
          <i className="dot-warning" />
          <span>
            <small>Kechikkan</small>
            <b>{stats.late}</b>
          </span>
        </div>
        <div>
          <i className="dot-danger" />
          <span>
            <small>Kelmagan</small>
            <b>{stats.absent}</b>
          </span>
        </div>
      </section>
      <section className="card attendance-workspace">
        <div className="filters attendance-filters">
          <div className="search-field">
            <Search size={16} />
            <input
              className="input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Xodim qidirish..."
            />
          </div>
          <input
            className="input date-filter"
            aria-label="Sana"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
          <select
            className="select"
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
          >
            <option value="">Barcha filiallar</option>
            {meta?.branches.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <select
            className="select"
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
          >
            <option value="">Barcha bo‘limlar</option>
            {meta?.departments.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <select
            className="select"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">Barcha holatlar</option>
            <option value="WORKING">Ishlamoqda</option>
            <option value="LATE">Kechikdi</option>
            <option value="ABSENT">Kelmagan</option>
            <option value="CHECKED_OUT">Ishdan chiqdi</option>
            <option value="ON_LEAVE">Ta’tilda</option>
          </select>
          <select
            className="select"
            value={verification}
            onChange={(event) => setVerification(event.target.value)}
          >
            <option value="">Barcha tasdiqlar</option>
            <option value="GPS">GPS</option>
            <option value="QR">Dinamik QR</option>
            <option value="TELEGRAM">Telegram</option>
            <option value="DEVICE">Qurilma</option>
            <option value="MANUAL">Qo‘lda</option>
          </select>
        </div>
        {loading ? (
          <Loading />
        ) : error ? (
          <div className="section-body">
            <ErrorBox message={error} />
          </div>
        ) : !rows.length ? (
          <Empty
            title="Davomat qaydi topilmadi"
            text="Tanlangan filtrlar bo‘yicha ma’lumot mavjud emas."
          />
        ) : (
          <div className="table-wrap mobile-cards">
            <table className="table attendance-table">
              <thead>
                <tr>
                  <th>Xodim</th>
                  <th>Grafik</th>
                  <th>Kelish</th>
                  <th>Chiqish</th>
                  <th>Kechikish</th>
                  <th>Erta chiqish</th>
                  <th>Ishlangan</th>
                  <th>Holat</th>
                  <th>Tasdiq</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="cell-person">
                        <Avatar
                          first={row.employee?.firstName || "?"}
                          last={row.employee?.lastName}
                          photo={row.employee?.photoDataUrl}
                        />
                        <span>
                          <b>
                            {row.employee?.firstName} {row.employee?.lastName}
                          </b>
                          <small>
                            {row.department || row.branch} · {dateUz(row.date)}
                          </small>
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="stacked-cell">
                        <b>{row.schedule || "Ish grafigi"}</b>
                        <small>
                          {row.scheduledStart}–{row.scheduledEnd}
                        </small>
                      </span>
                    </td>
                    <td className="time-cell">{row.checkIn || "—"}</td>
                    <td>{row.checkOut || "—"}</td>
                    <td>
                      {row.lateMinutes ? (
                        <span className="numeric-warning">
                          {row.lateMinutes} daq
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {row.earlyLeaveMinutes
                        ? `${row.earlyLeaveMinutes} daq`
                        : "—"}
                    </td>
                    <td>
                      {row.workedMinutes ? duration(row.workedMinutes) : "—"}
                    </td>
                    <td>
                      <Status value={row.status} />
                    </td>
                    <td>
                      <div className="verification-list">
                        {row.verification.map((item) => (
                          <span key={item}>
                            <ShieldCheck size={12} />{" "}
                            {item === "QR" ? "QR" : item}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <button
                        className="icon-btn"
                        aria-label="Davomatni tahrirlash"
                        onClick={() => setSelected(row)}
                      >
                        <Pencil size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {selected && (
        <EditAttendance
          row={selected}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}

function EditAttendance({
  row,
  onClose,
  onSaved,
}: {
  row: Row;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [checkIn, setCheckIn] = useState(row.checkIn || "08:00");
  const [checkOut, setCheckOut] = useState(row.checkOut || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await put(`/attendance/${row.id}`, {
        checkIn,
        checkOut: checkOut || undefined,
      });
      onSaved();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Davomat saqlanmadi.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title="Davomatni tahrirlash" onClose={onClose}>
      <div className="audit-notice">
        <ShieldCheck size={18} />
        <span>
          <b>Audit nazorati yoqilgan</b>
          <small>
            Qo‘lda kiritilgan har bir o‘zgarish audit jurnaliga yoziladi.
          </small>
        </span>
      </div>
      <form onSubmit={save}>
        <div className="form-grid">
          <div className="field">
            <label className="label">Kelish vaqti</label>
            <input
              className="input"
              type="time"
              value={checkIn}
              onChange={(event) => setCheckIn(event.target.value)}
              required
            />
          </div>
          <div className="field">
            <label className="label">Chiqish vaqti</label>
            <input
              className="input"
              type="time"
              value={checkOut}
              onChange={(event) => setCheckOut(event.target.value)}
            />
          </div>
        </div>
        {row.distanceMeters !== undefined && (
          <p className="subtle">
            <MapPin size={14} style={{ display: "inline" }} /> Filialdan masofa:{" "}
            {row.distanceMeters} metr
          </p>
        )}
        {error && <p className="field-error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Bekor qilish
          </button>
          <button className="btn btn-primary" disabled={saving}>
            {saving ? "Saqlanmoqda..." : "Saqlash"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
