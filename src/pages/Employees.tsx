import { useEffect, useMemo, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  Archive,
  Camera,
  ChevronLeft,
  ChevronRight,
  Download,
  MoreHorizontal,
  Plus,
  Search,
  ScanFace,
  UserRoundPlus,
} from "lucide-react";
import { api, post, put } from "../api";
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
import { dateUz, money, duration } from "@/lib/format";
import type {
  Attendance,
  AuditLog,
  Branch,
  Department,
  Employee,
  LeaveRequest,
  Position,
  Schedule,
} from "@/lib/types";
type Meta = {
  branches: Branch[];
  departments: Department[];
  positions: Position[];
  schedules: Schedule[];
};
type EmployeeListRow = Employee & { todayAttendance?: Attendance };
type List = {
  items: EmployeeListRow[];
  total: number;
  page: number;
  pages: number;
};
export function EmployeesPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") || "",
    page = Number(params.get("page") || 1);
  const url = `/employees?q=${encodeURIComponent(q)}&page=${page}&branch=${params.get("branch") || ""}&department=${params.get("department") || ""}&position=${params.get("position") || ""}&schedule=${params.get("schedule") || ""}&status=${params.get("status") || ""}`;
  const { data, loading, error, reload } = useApi<List>(url),
    { data: meta } = useApi<Meta>("/meta");
  const navigate = useNavigate();
  const [archiveTarget, setArchiveTarget] = useState<Employee | null>(null);
  function set(name: string, value: string) {
    const next = new URLSearchParams(params);
    value ? next.set(name, value) : next.delete(name);
    if (name !== "page") next.delete("page");
    setParams(next);
  }
  async function archive() {
    if (!archiveTarget) return;
    await api(`/employees/${archiveTarget.id}`, { method: "DELETE" });
    setArchiveTarget(null);
    void reload();
  }
  return (
    <div className="page">
      <PageHeader
        title="Xodimlar"
        subtitle={`${data?.total || 0} ta xodim ro‘yxati`}
        actions={
          <>
            <a className="btn" href="/api/reports/employees.csv" download>
              <Download size={16} /> Eksport
            </a>
            <Link className="btn btn-primary" to="/employees/new">
              <Plus size={16} /> Xodim qo‘shish
            </Link>
          </>
        }
      />
      <section className="card">
        <div className="filters">
          <div className="search-field">
            <Search size={17} />
            <input
              className="input"
              value={q}
              onChange={(e) => set("q", e.target.value)}
              placeholder="Ism, ID, telefon..."
            />
          </div>
          <select
            className="select"
            value={params.get("department") || ""}
            onChange={(e) => set("department", e.target.value)}
          >
            <option value="">Barcha bo‘limlar</option>
            {meta?.departments.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <select
            className="select"
            value={params.get("position") || ""}
            onChange={(e) => set("position", e.target.value)}
          >
            <option value="">Barcha lavozimlar</option>
            {meta?.positions.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <select
            className="select"
            value={params.get("branch") || ""}
            onChange={(e) => set("branch", e.target.value)}
          >
            <option value="">Barcha filiallar</option>
            {meta?.branches.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <select
            className="select"
            value={params.get("schedule") || ""}
            onChange={(e) => set("schedule", e.target.value)}
          >
            <option value="">Barcha grafiklar</option>
            {meta?.schedules.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <select
            className="select"
            value={params.get("status") || ""}
            onChange={(e) => set("status", e.target.value)}
          >
            <option value="">Barcha holatlar</option>
            <option value="ACTIVE">Faol</option>
            <option value="INACTIVE">Nofaol</option>
            <option value="ARCHIVED">Arxiv</option>
          </select>
        </div>
        {loading ? (
          <Loading />
        ) : error ? (
          <div className="section-body">
            <ErrorBox message={error} />
          </div>
        ) : !data?.items.length ? (
          <Empty
            title="Xodim topilmadi"
            text="Filtrlarni o‘zgartiring yoki yangi xodim qo‘shing."
          />
        ) : (
          <>
            <div className="table-wrap mobile-cards">
              <table className="table">
                <thead>
                  <tr>
                    <th>Xodim</th>
                    <th>ID</th>
                    <th>Lavozim</th>
                    <th>Bo‘lim</th>
                    <th>Filial</th>
                    <th>Ish grafigi</th>
                    <th>Bugungi holat</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((e) => (
                    <tr
                      key={e.id}
                      className="clickable-row"
                      onClick={() => navigate(`/employees/${e.id}`)}
                    >
                      <td>
                        <Link to={`/employees/${e.id}`} className="cell-person">
                          <Avatar
                            first={e.firstName}
                            last={e.lastName}
                            photo={e.photoDataUrl}
                          />
                          <span>
                            <b>
                              {e.firstName} {e.lastName}
                            </b>
                            <small>
                              {e.employeeNo} · {e.email}
                            </small>
                          </span>
                        </Link>
                      </td>
                      <td>{e.employeeNo}</td>
                      <td>
                        {meta?.positions.find((x) => x.id === e.positionId)
                          ?.name || "—"}
                      </td>
                      <td>
                        {meta?.departments.find((x) => x.id === e.departmentId)
                          ?.name || "—"}
                      </td>
                      <td>
                        {meta?.branches.find((x) => x.id === e.branchId)
                          ?.name || "—"}
                      </td>
                      <td>
                        {meta?.schedules.find((x) => x.id === e.scheduleId)
                          ?.name || "—"}
                      </td>
                      <td>
                        <Status
                          value={
                            e.todayAttendance?.status ||
                            (e.status === "ACTIVE" ? "ABSENT" : e.status)
                          }
                        />
                        {e.todayAttendance?.checkIn && (
                          <small className="attendance-time">
                            {e.todayAttendance.checkIn}
                          </small>
                        )}
                      </td>
                      <td>
                        <button
                          className="icon-btn"
                          title="Arxivlash"
                          onClick={(event) => {
                            event.stopPropagation();
                            setArchiveTarget(e);
                          }}
                        >
                          <Archive size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <span>
                {data.total} tadan {(page - 1) * 10 + 1}–
                {Math.min(page * 10, data.total)}
              </span>
              <div className="toolbar">
                <button
                  className="btn btn-sm"
                  disabled={page <= 1}
                  onClick={() => set("page", String(page - 1))}
                >
                  <ChevronLeft size={15} />
                </button>
                <span>
                  {page} / {data.pages || 1}
                </span>
                <button
                  className="btn btn-sm"
                  disabled={page >= data.pages}
                  onClick={() => set("page", String(page + 1))}
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          </>
        )}
      </section>
      {archiveTarget && (
        <Modal title="Xodimni arxivlash" onClose={() => setArchiveTarget(null)}>
          <div className="confirm-content">
            <p>
              <b>
                {archiveTarget.firstName} {archiveTarget.lastName}
              </b>{" "}
              arxivga o‘tkaziladi. Tarixiy davomat ma’lumotlari saqlanib qoladi.
            </p>
            <div className="form-actions">
              <button className="btn" onClick={() => setArchiveTarget(null)}>
                Bekor qilish
              </button>
              <button className="btn btn-danger" onClick={() => void archive()}>
                <Archive size={16} /> Arxivlash
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function EmployeeFormPage() {
  const navigate = useNavigate(),
    { data: meta, loading } = useApi<Meta>("/meta");
  const [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    phone: "+998 ",
    email: "",
    employeeNo: "GF-",
    departmentId: "",
    positionId: "",
    branchId: "",
    scheduleId: "",
    startDate: new Date().toISOString().slice(0, 10),
    employmentType: "FULL_TIME",
    baseSalary: 3500000,
    currency: "UZS",
    address: "",
    manager: "",
    telegramUsername: "",
    photoDataUrl: "",
  });
  useEffect(() => {
    if (meta)
      setForm((f) => ({
        ...f,
        departmentId: f.departmentId || meta.departments[0]?.id || "",
        positionId: f.positionId || meta.positions[0]?.id || "",
        branchId: f.branchId || meta.branches[0]?.id || "",
        scheduleId: f.scheduleId || meta.schedules[0]?.id || "",
      }));
  }, [meta]);
  const set = (name: string, value: string | number) =>
    setForm((f) => ({ ...f, [name]: value }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const row = await post<Employee>("/employees", form);
      navigate(`/employees/${row.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xatolik yuz berdi");
    } finally {
      setSaving(false);
    }
  }
  if (loading)
    return (
      <div className="page">
        <Loading />
      </div>
    );
  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <PageHeader
        title="Yangi xodim"
        subtitle="Shaxsiy va ish ma’lumotlarini kiriting"
        actions={
          <Link className="btn" to="/employees">
            Bekor qilish
          </Link>
        }
      />
      <form className="card" onSubmit={submit}>
        <div className="section-head">
          <h2>Shaxsiy ma’lumotlar</h2>
          <span className="subtle">1 / 3</span>
        </div>
        <div className="section-body">
          <PhotoPicker
            first={form.firstName || "Yangi"}
            last={form.lastName}
            value={form.photoDataUrl}
            onChange={(photoDataUrl) => set("photoDataUrl", photoDataUrl)}
          />
          <div className="form-grid">
            <Field label="Ism *">
              <input
                className="input"
                value={form.firstName}
                onChange={(e) => set("firstName", e.target.value)}
                required
              />
            </Field>
            <Field label="Familiya *">
              <input
                className="input"
                value={form.lastName}
                onChange={(e) => set("lastName", e.target.value)}
                required
              />
            </Field>
            <Field label="Telefon *">
              <input
                className="input"
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                required
              />
            </Field>
            <Field label="Email *">
              <input
                className="input"
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                required
              />
            </Field>
            <Field label="Manzil">
              <input
                className="input"
                value={form.address}
                onChange={(e) => set("address", e.target.value)}
              />
            </Field>
            <Field label="Telegram username">
              <input
                className="input"
                placeholder="@username"
                value={form.telegramUsername}
                onChange={(e) => set("telegramUsername", e.target.value)}
              />
            </Field>
          </div>
        </div>
        <div className="section-head">
          <h2>Ish ma’lumotlari</h2>
          <span className="subtle">2 / 3</span>
        </div>
        <div className="section-body">
          <div className="form-grid">
            <Field label="Xodim ID *">
              <input
                className="input"
                value={form.employeeNo}
                onChange={(e) => set("employeeNo", e.target.value)}
                required
              />
            </Field>
            <Field label="Ish boshlash sanasi *">
              <input
                className="input"
                type="date"
                value={form.startDate}
                onChange={(e) => set("startDate", e.target.value)}
                required
              />
            </Field>
            <Field label="Bo‘lim">
              <select
                className="select"
                value={form.departmentId}
                onChange={(e) => set("departmentId", e.target.value)}
              >
                {meta?.departments.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Lavozim">
              <select
                className="select"
                value={form.positionId}
                onChange={(e) => set("positionId", e.target.value)}
              >
                {meta?.positions
                  .filter((x) => x.departmentId === form.departmentId)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Filial">
              <select
                className="select"
                value={form.branchId}
                onChange={(e) => set("branchId", e.target.value)}
              >
                {meta?.branches.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Ish grafigi">
              <select
                className="select"
                value={form.scheduleId}
                onChange={(e) => set("scheduleId", e.target.value)}
              >
                {meta?.schedules.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Menejer">
              <input
                className="input"
                value={form.manager}
                onChange={(e) => set("manager", e.target.value)}
              />
            </Field>
            <Field label="Bandlik turi">
              <select
                className="select"
                value={form.employmentType}
                onChange={(e) => set("employmentType", e.target.value)}
              >
                <option value="FULL_TIME">To‘liq stavka</option>
                <option value="PART_TIME">Yarim stavka</option>
                <option value="CONTRACT">Shartnoma</option>
              </select>
            </Field>
          </div>
        </div>
        <div className="section-head">
          <h2>Ish haqi</h2>
          <span className="subtle">3 / 3</span>
        </div>
        <div className="section-body">
          <div className="form-grid">
            <Field label="Bazaviy ish haqi">
              <input
                className="input"
                type="number"
                value={form.baseSalary}
                onChange={(e) => set("baseSalary", Number(e.target.value))}
              />
            </Field>
            <Field label="Valyuta">
              <select
                className="select"
                value={form.currency}
                onChange={(e) => set("currency", e.target.value)}
              >
                <option>UZS</option>
                <option>USD</option>
              </select>
            </Field>
          </div>
          {error && <ErrorBox message={error} />}
          <div className="form-actions">
            <Link className="btn" to="/employees">
              Bekor qilish
            </Link>
            <button className="btn btn-primary" disabled={saving}>
              <UserRoundPlus size={16} />
              {saving ? "Saqlanmoqda..." : "Xodimni yaratish"}
            </button>
          </div>
        </div>
      </form>
    </div>
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

type Profile = {
  employee: Employee;
  attendance: Attendance[];
  leave: LeaveRequest[];
  activity: AuditLog[];
};
export function EmployeeProfilePage() {
  const { id } = useParams(),
    { data, loading, error, reload } = useApi<Profile>(`/employees/${id}`),
    { data: meta } = useApi<Meta>("/meta");
  const [tab, setTab] = useState("overview");
  const [editing, setEditing] = useState(false);
  const [faceResetOpen, setFaceResetOpen] = useState(false);
  const [invite, setInvite] = useState<{
    link?: string;
    startParam: string;
    expiresAt: string;
  } | null>(null);
  const [inviteError, setInviteError] = useState("");
  async function createTelegramInvite() {
    setInviteError("");
    try {
      setInvite(await post(`/employees/${id}/telegram-invite`, {}));
    } catch (reason) {
      setInviteError(
        reason instanceof Error ? reason.message : "Taklif yaratilmadi.",
      );
    }
  }
  if (loading)
    return (
      <div className="page">
        <Loading />
      </div>
    );
  if (error || !data)
    return (
      <div className="page">
        <ErrorBox message={error} />
      </div>
    );
  const e = data.employee,
    department = meta?.departments.find((x) => x.id === e.departmentId)?.name,
    position = meta?.positions.find((x) => x.id === e.positionId)?.name,
    branch = meta?.branches.find((x) => x.id === e.branchId)?.name,
    schedule = meta?.schedules.find((x) => x.id === e.scheduleId)?.name;
  const tabs = [
    ["overview", "Umumiy"],
    ["calendar", "Kalendar"],
    ["attendance", "Davomat"],
    ["work", "Ish ma’lumotlari"],
    ["leave", "Ta’til"],
    ["payroll", "Ish haqi"],
    ["devices", "Qurilmalar"],
    ["activity", "Faoliyat"],
  ];
  const latestAttendance = data.attendance[0];
  return (
    <div className="page employee-profile-page">
      <PageHeader
        title={`${e.firstName} ${e.lastName}`}
        subtitle={`${e.employeeNo} · ${position || "Lavozim belgilanmagan"}`}
        actions={
          <>
            <Link className="btn" to="/employees">
              Orqaga
            </Link>
            <button
              className="btn btn-primary"
              onClick={() => setEditing(true)}
            >
              Tahrirlash
            </button>
          </>
        }
      />
      <section className="profile-hero">
        <div className="profile-identity">
          <Avatar
            first={e.firstName}
            last={e.lastName}
            photo={e.photoDataUrl}
          />
          <div>
            <span className="profile-eyebrow">{e.employeeNo}</span>
            <h1>
              {e.firstName} {e.lastName}
            </h1>
            <p>
              {position || "Lavozim belgilanmagan"} ·{" "}
              {department || "Bo‘lim belgilanmagan"}
            </p>
          </div>
          <Status value={e.status} />
        </div>
        <div className="profile-hero-meta">
          <div>
            <small>Filial</small>
            <b>{branch || "—"}</b>
          </div>
          <div>
            <small>Ish grafigi</small>
            <b>{schedule || "—"}</b>
          </div>
          <div>
            <small>Bugungi kirish</small>
            <b>{latestAttendance?.checkIn || "—"}</b>
          </div>
          <div>
            <small>Bugungi holat</small>
            <Status value={latestAttendance?.status || "ABSENT"} />
          </div>
          <div>
            <small>Ishlangan vaqt</small>
            <b>{duration(latestAttendance?.workedMinutes || 0)}</b>
          </div>
          <div>
            <small>Kechikish</small>
            <b>{latestAttendance?.lateMinutes || 0} daqiqa</b>
          </div>
        </div>
        <div className="profile-hero-actions">
          <Link className="btn" to="/employees">
            Orqaga
          </Link>
          <button className="btn btn-primary" onClick={() => setEditing(true)}>
            Tahrirlash
          </button>
        </div>
      </section>
      <div className="profile-layout profile-content">
        <aside className="card profile-side">
          <Avatar
            first={e.firstName}
            last={e.lastName}
            photo={e.photoDataUrl}
          />
          <h2>
            {e.firstName} {e.lastName}
          </h2>
          <p>{position}</p>
          <div style={{ marginTop: 12 }}>
            <Status value={e.status} />
          </div>
          <div className="profile-list">
            <div>
              <span>Bo‘lim</span>
              <b>{department}</b>
            </div>
            <div>
              <span>Filial</span>
              <b>{branch}</b>
            </div>
            <div>
              <span>Menejer</span>
              <b>{e.manager || "—"}</b>
            </div>
            <div>
              <span>Telefon</span>
              <b>{e.phone}</b>
            </div>
            <div>
              <span>Ish grafigi</span>
              <b>{schedule}</b>
            </div>
            <div>
              <span>Ish boshlagan</span>
              <b>{dateUz(e.startDate)}</b>
            </div>
          </div>
        </aside>
        <section className="card">
          <div className="tabs">
            {tabs.map(([key, label]) => (
              <button
                className={`tab ${tab === key ? "active" : ""}`}
                key={key}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="section-body">
            {tab === "overview" && (
              <div className="profile-overview">
                <section className="profile-info-panel">
                  <h3>Shaxsiy ma’lumotlar</h3>
                  <Info
                    label="To‘liq ism"
                    value={`${e.firstName} ${e.lastName}`}
                  />
                  <Info label="Telefon" value={e.phone} />
                  <Info label="Email" value={e.email} />
                  <Info label="Manzil" value={e.address} />
                  <Info
                    label="Telegram"
                    value={e.telegramConnected ? "Ulangan" : "Ulanmagan"}
                  />
                </section>
                <section className="profile-info-panel">
                  <h3>Ish ma’lumotlari</h3>
                  <Info label="Bo‘lim" value={department} />
                  <Info label="Lavozim" value={position} />
                  <Info label="Filial" value={branch} />
                  <Info label="Menejer" value={e.manager} />
                  <Info label="Ish grafigi" value={schedule} />
                  <Info label="Ish boshlagan" value={dateUz(e.startDate)} />
                </section>
                <section className="today-attendance-panel">
                  <div className="profile-panel-head">
                    <div>
                      <h3>Bugungi davomat</h3>
                      <small>
                        Reja: {latestAttendance?.scheduledStart || "—"} →{" "}
                        {latestAttendance?.scheduledEnd || "—"}
                      </small>
                    </div>
                    <Status value={latestAttendance?.status || "ABSENT"} />
                  </div>
                  <div className="attendance-timeline">
                    <div
                      className={latestAttendance?.checkIn ? "complete" : ""}
                    >
                      <i />
                      <span>
                        <b>{latestAttendance?.checkIn || "—"}</b>
                        <small>Kirish</small>
                      </span>
                    </div>
                    <div
                      className={latestAttendance?.checkOut ? "complete" : ""}
                    >
                      <i />
                      <span>
                        <b>{latestAttendance?.checkOut || "Kutilmoqda"}</b>
                        <small>Chiqish</small>
                      </span>
                    </div>
                  </div>
                  <div className="attendance-facts">
                    <span>
                      <small>Amalda</small>
                      <b>
                        {latestAttendance?.checkIn || "—"} →{" "}
                        {latestAttendance?.checkOut || "..."}
                      </b>
                    </span>
                    <span>
                      <small>Ishlangan</small>
                      <b>{duration(latestAttendance?.workedMinutes || 0)}</b>
                    </span>
                    <span>
                      <small>Kechikish</small>
                      <b>{latestAttendance?.lateMinutes || 0} daqiqa</b>
                    </span>
                  </div>
                  <div className="attendance-verification">
                    {latestAttendance?.verification.map((method) => (
                      <span key={method}>
                        <Status value="CONNECTED" />{" "}
                        {method === "QR" ? "Dynamic QR" : method}
                      </span>
                    )) || <small>Tasdiqlash ma’lumoti yo‘q</small>}
                  </div>
                </section>
              </div>
            )}
            {tab === "attendance" && <AttendanceMini rows={data.attendance} />}{" "}
            {tab === "calendar" && <CalendarMini rows={data.attendance} />}{" "}
            {tab === "work" && (
              <div className="info-grid">
                <Info label="Bo‘lim" value={department} />
                <Info label="Lavozim" value={position} />
                <Info label="Filial" value={branch} />
                <Info label="Grafik" value={schedule} />
                <Info label="Menejer" value={e.manager} />
                <Info label="Xodim ID" value={e.employeeNo} />
              </div>
            )}
            {tab === "leave" && (
              <div>
                {data.leave.length ? (
                  data.leave.map((l) => (
                    <div
                      key={l.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "12px 0",
                        borderBottom: "1px solid var(--line)",
                      }}
                    >
                      <span>
                        {l.type}
                        <small className="subtle" style={{ display: "block" }}>
                          {dateUz(l.startDate)} — {dateUz(l.endDate)}
                        </small>
                      </span>
                      <Status value={l.status} />
                    </div>
                  ))
                ) : (
                  <Empty />
                )}
              </div>
            )}
            {tab === "payroll" && (
              <div className="info-grid">
                <Info
                  label="Bazaviy ish haqi"
                  value={money(e.baseSalary, e.currency)}
                />
                <Info label="To‘lov turi" value="Oylik" />
                <Info label="Valyuta" value={e.currency} />
                <Info label="Holat" value="Faol" />
              </div>
            )}
            {tab === "devices" && (
              <div>
                <div className="info-grid">
                  <Info label="Qurilma holati" value={e.deviceStatus} />
                  <Info
                    label="Telegram"
                    value={
                      e.telegramUsername
                        ? `@${e.telegramUsername}`
                        : "Ulanmagan"
                    }
                  />
                  <Info
                    label="Face ID"
                    value={
                      e.faceEnrolledAt
                        ? `Ulangan · ${dateUz(e.faceEnrolledAt)}`
                        : "Ro‘yxatdan o‘tmagan"
                    }
                  />
                </div>
                {e.faceEnrolledAt && (
                  <div className="face-admin-row">
                    <span>
                      <ScanFace size={19} />
                      <span>
                        <b>Biometrik profil faol</b>
                        <small>
                          Xodim kirish va chiqishda yuzini tasdiqlaydi.
                        </small>
                      </span>
                    </span>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => setFaceResetOpen(true)}
                    >
                      Face ID’ni qayta sozlash
                    </button>
                  </div>
                )}
                {!e.telegramConnected && (
                  <div
                    style={{
                      marginTop: 22,
                      paddingTop: 18,
                      borderTop: "1px solid var(--line)",
                    }}
                  >
                    <h3 style={{ fontSize: 14 }}>Telegram’ni ulash</h3>
                    <p className="subtle" style={{ fontSize: 12 }}>
                      Bir martalik havola 24 soat amal qiladi. Uni faqat shu
                      xodimga yuboring.
                    </p>
                    {invite ? (
                      <div className="card" style={{ padding: 14 }}>
                        <code style={{ wordBreak: "break-all", fontSize: 11 }}>
                          {invite.link || `/start ${invite.startParam}`}
                        </code>
                        <button
                          className="btn btn-sm"
                          style={{ marginTop: 12 }}
                          onClick={() =>
                            void navigator.clipboard.writeText(
                              invite.link || invite.startParam,
                            )
                          }
                        >
                          Nusxalash
                        </button>
                      </div>
                    ) : (
                      <button
                        className="btn btn-primary"
                        onClick={() => void createTelegramInvite()}
                      >
                        Ulanish havolasini yaratish
                      </button>
                    )}
                    {inviteError && (
                      <p className="field-error">{inviteError}</p>
                    )}
                  </div>
                )}
              </div>
            )}
            {tab === "activity" && (
              <div className="timeline">
                {data.activity.map((a) => (
                  <div className="timeline-item" key={a.id}>
                    <b>{a.action}</b>
                    <p
                      className="subtle"
                      style={{ margin: "5px 0 0", fontSize: 11 }}
                    >
                      {a.actor} · {dateUz(a.createdAt)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
      {editing && meta && (
        <EditEmployee
          employee={e}
          meta={meta}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void reload();
          }}
        />
      )}
      {faceResetOpen && (
        <Modal
          title="Face ID’ni qayta sozlash"
          onClose={() => setFaceResetOpen(false)}
        >
          <div className="confirm-content">
            <p>
              Xodimning mavjud biometrik shabloni o‘chiriladi. Keyingi davomat
              urinishida u yuzini qayta ro‘yxatdan o‘tkazishi kerak.
            </p>
            <div className="form-actions">
              <button className="btn" onClick={() => setFaceResetOpen(false)}>
                Bekor qilish
              </button>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  await api(`/employees/${e.id}/face-profile`, {
                    method: "DELETE",
                  });
                  setFaceResetOpen(false);
                  void reload();
                }}
              >
                Qayta sozlash
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
function EditEmployee({
  employee,
  meta,
  onClose,
  onSaved,
}: {
  employee: Employee;
  meta: Meta;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    firstName: employee.firstName,
    lastName: employee.lastName,
    phone: employee.phone,
    email: employee.email,
    address: employee.address || "",
    departmentId: employee.departmentId,
    positionId: employee.positionId,
    branchId: employee.branchId,
    scheduleId: employee.scheduleId,
    baseSalary: employee.baseSalary,
    photoDataUrl: employee.photoDataUrl || "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await put(`/employees/${employee.id}`, form);
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Xatolik yuz berdi");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title="Xodimni tahrirlash" onClose={onClose}>
      <form onSubmit={save}>
        <PhotoPicker
          first={form.firstName}
          last={form.lastName}
          value={form.photoDataUrl}
          onChange={(photoDataUrl) => setForm({ ...form, photoDataUrl })}
        />
        <div className="form-grid">
          <Field label="Ism">
            <input
              className="input"
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              required
            />
          </Field>
          <Field label="Familiya">
            <input
              className="input"
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              required
            />
          </Field>
          <Field label="Telefon">
            <input
              className="input"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              required
            />
          </Field>
          <Field label="Email">
            <input
              className="input"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
          </Field>
          <Field label="Filial">
            <select
              className="select"
              value={form.branchId}
              onChange={(e) => setForm({ ...form, branchId: e.target.value })}
            >
              {meta.branches.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Ish grafigi">
            <select
              className="select"
              value={form.scheduleId}
              onChange={(e) => setForm({ ...form, scheduleId: e.target.value })}
            >
              {meta.schedules.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Bo‘lim">
            <select
              className="select"
              value={form.departmentId}
              onChange={(e) =>
                setForm({ ...form, departmentId: e.target.value })
              }
            >
              {meta.departments.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Lavozim">
            <select
              className="select"
              value={form.positionId}
              onChange={(e) => setForm({ ...form, positionId: e.target.value })}
            >
              {meta.positions
                .filter((x) => x.departmentId === form.departmentId)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Bazaviy ish haqi">
            <input
              className="input"
              type="number"
              value={form.baseSalary}
              onChange={(e) =>
                setForm({ ...form, baseSalary: Number(e.target.value) })
              }
            />
          </Field>
          <Field label="Manzil">
            <input
              className="input"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </Field>
        </div>
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
function Info({ label, value }: { label: string; value?: string }) {
  return (
    <div className="info-item">
      <small>{label}</small>
      <b>{value || "—"}</b>
    </div>
  );
}
function AttendanceMini({ rows }: { rows: Attendance[] }) {
  return rows.length ? (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Sana</th>
            <th>Grafik</th>
            <th>Kelish</th>
            <th>Chiqish</th>
            <th>Ishlagan</th>
            <th>Holat</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td>{dateUz(a.date)}</td>
              <td>
                {a.scheduledStart}–{a.scheduledEnd}
              </td>
              <td>{a.checkIn || "—"}</td>
              <td>{a.checkOut || "—"}</td>
              <td>{duration(a.workedMinutes)}</td>
              <td>
                <Status value={a.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty />
  );
}
function CalendarMini({ rows }: { rows: Attendance[] }) {
  const byDate = new Map(rows.map((x) => [new Date(x.date).getDate(), x]));
  return (
    <div className="calendar-grid">
      {Array.from({ length: 28 }, (_, i) => {
        const row = byDate.get(i + 1);
        return (
          <div key={i} className="calendar-day">
            <span>{i + 1}</span>
            {row && (
              <>
                <div style={{ marginTop: 10 }}>
                  <Status value={row.status} />
                </div>
                <small
                  className="subtle"
                  style={{ display: "block", marginTop: 8 }}
                >
                  {row.checkIn || "—"} → {row.checkOut || "—"}
                </small>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PhotoPicker({
  first,
  last,
  value,
  onChange,
}: {
  first: string;
  last?: string;
  value?: string;
  onChange: (value: string) => void;
}) {
  const [error, setError] = useState("");
  return (
    <div className="photo-picker">
      <Avatar first={first} last={last} photo={value} />
      <div>
        <b>Xodim rasmi</b>
        <small>JPG, PNG yoki WEBP. Rasm avtomatik 512px gacha siqiladi.</small>
        <label className="btn btn-sm">
          <Camera size={15} /> {value ? "Rasmni almashtirish" : "Rasm yuklash"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setError("");
              try {
                onChange(await resizeEmployeePhoto(file));
              } catch (reason) {
                setError(
                  reason instanceof Error ? reason.message : "Rasm yuklanmadi.",
                );
              }
              event.target.value = "";
            }}
          />
        </label>
        {value && (
          <button
            type="button"
            className="photo-remove"
            onClick={() => onChange("")}
          >
            Rasmni olib tashlash
          </button>
        )}
        {error && <span className="field-error">{error}</span>}
      </div>
    </div>
  );
}

async function resizeEmployeePhoto(file: File) {
  if (!file.type.startsWith("image/"))
    throw new Error("Faqat rasm faylini tanlang.");
  if (file.size > 8 * 1024 * 1024)
    throw new Error("Rasm hajmi 8 MB’dan oshmasin.");
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Rasmni o‘qib bo‘lmadi."));
      element.src = url;
    });
    const scale = Math.min(
      1,
      512 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas
      .getContext("2d")
      ?.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}
