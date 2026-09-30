import { useEffect, useMemo, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  AlertTriangle,
  Camera,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Link2,
  Pencil,
  Plus,
  ScanFace,
  Search,
  Send,
  Smartphone,
  Unlink,
  UserRoundPlus,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import { del, errorText, post, put } from "../api";
import { useApi, useDebounced } from "../hooks";
import {
  Avatar,
  Confirm,
  Empty,
  ErrorBox,
  Field,
  Loading,
  Modal,
  PageHeader,
  Person,
  Status,
  useToast,
} from "../components/ui";
import {
  dateLongUz,
  dateUz,
  duration,
  money,
  tashkentIsoDate,
} from "@/lib/format";
import type { Attendance, AuditLog, Employee, LeaveRequest } from "@/lib/types";
import { leaveTypeLabel, verificationLabel, weekdayShort, weekOrder, type Meta } from "../types";

type EmployeeListRow = Employee & { todayAttendance?: Attendance };
type List = { items: EmployeeListRow[]; total: number; page: number; pages: number };

export function EmployeesPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") || "");
  const debounced = useDebounced(q, 300);
  const page = Number(params.get("page") || 1);
  const query = new URLSearchParams({
    q: debounced,
    page: String(page),
    branch: params.get("branch") || "",
    department: params.get("department") || "",
    status: params.get("status") || "",
  });
  const { data, loading, error, reload } = useApi<List>(`/employees?${query}`);
  const { data: meta } = useApi<Meta>("/meta");
  const navigate = useNavigate();
  const toast = useToast();
  const [archiveTarget, setArchiveTarget] = useState<Employee | null>(null);
  const urlQuery = params.get("q") || "";
  useEffect(() => setQ(urlQuery), [urlQuery]);
  function set(name: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    if (name !== "page") next.delete("page");
    setParams(next, { replace: true });
  }
  const lookup = (rows: { id: string; name: string }[] | undefined, id: string) =>
    rows?.find((x) => x.id === id)?.name || "—";

  return (
    <div className="page">
      <PageHeader
        title="Xodimlar"
        subtitle={`${data?.total ?? 0} ta xodim`}
        actions={
          <>
            <a className="btn" href="/api/reports/employees.xlsx" download>
              <Download size={16} /> Excel
            </a>
            <Link className="btn btn-primary" to="/employees/new">
              <Plus size={16} /> Xodim qo‘shish
            </Link>
          </>
        }
      />
      <section className="card">
        <div className="filters">
          <span className="input-icon">
            <Search size={16} />
            <input
              className="input"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                if (page !== 1) set("page", "");
              }}
              placeholder="Ism, ID, telefon…"
            />
          </span>
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
            value={params.get("status") || ""}
            onChange={(e) => set("status", e.target.value)}
          >
            <option value="">Faol va nofaol</option>
            <option value="ACTIVE">Faol</option>
            <option value="INACTIVE">Nofaol</option>
          </select>
        </div>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <div className="card-body">
            <ErrorBox message={error} />
          </div>
        ) : !data?.items.length ? (
          <Empty
            icon={Users}
            title={debounced || params.toString() ? "Xodim topilmadi" : "Hali xodim yo‘q"}
            text={
              debounced || params.toString()
                ? "Qidiruv yoki filtrlarni o‘zgartiring."
                : "Birinchi xodimni qo‘shing. U Telegram botda telefon raqamini yuborib ulanadi."
            }
            action={
              <Link to="/employees/new" className="btn btn-primary">
                <UserRoundPlus size={16} /> Xodim qo‘shish
              </Link>
            }
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table table-cards">
                <thead>
                  <tr>
                    <th>Xodim</th>
                    <th>Lavozim</th>
                    <th>Filial</th>
                    <th>Ulanish</th>
                    <th>Bugun</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((e) => (
                    <tr
                      key={e.id}
                      className="clickable"
                      onClick={() => navigate(`/employees/${e.id}`)}
                    >
                      <td>
                        <Person
                          first={e.firstName}
                          last={e.lastName}
                          photo={e.photoDataUrl}
                          sub={`${e.employeeNo} · ${e.phone}`}
                        />
                      </td>
                      <td data-label="Lavozim">
                        <span className="stack">
                          <span>{lookup(meta?.positions, e.positionId)}</span>
                          <small>{lookup(meta?.departments, e.departmentId)}</small>
                        </span>
                      </td>
                      <td data-label="Filial">{lookup(meta?.branches, e.branchId)}</td>
                      <td data-label="Ulanish">
                        <span className="tags">
                          <span
                            className={`tag`}
                            style={
                              e.telegramConnected
                                ? { background: "var(--blue-bg)", color: "var(--blue)" }
                                : undefined
                            }
                            title={e.telegramConnected ? "Telegram ulangan" : "Telegram ulanmagan"}
                          >
                            <Send size={10} />
                            {e.telegramConnected ? "Ulangan" : "Yo‘q"}
                          </span>
                          <span
                            className="tag"
                            style={
                              e.faceEnrolledAt
                                ? { background: "var(--green-bg)", color: "var(--green)" }
                                : undefined
                            }
                            title={e.faceEnrolledAt ? "Face ID faol" : "Face ID sozlanmagan"}
                          >
                            <ScanFace size={10} />
                            {e.faceEnrolledAt ? "Face ID" : "—"}
                          </span>
                        </span>
                      </td>
                      <td data-label="Bugun">
                        {e.status !== "ACTIVE" ? (
                          <Status value={e.status} />
                        ) : e.todayAttendance?.checkIn ? (
                          <span className="state-cell">
                            <Status
                              value={e.todayAttendance.checkOut ? "LEFT" : "IN"}
                              live={!e.todayAttendance.checkOut}
                            />
                            <small className="num">
                              {e.todayAttendance.checkIn}
                              {e.todayAttendance.checkOut
                                ? ` → ${e.todayAttendance.checkOut}`
                                : ""}
                            </small>
                          </span>
                        ) : (
                          <span className="faint">Qayd yo‘q</span>
                        )}
                      </td>
                      <td className="actions">
                        {e.status !== "ARCHIVED" && e.status !== "DISMISSED" && (
                          <button
                            className="icon-btn danger"
                            title="Ishdan bo‘shatish"
                            aria-label="Ishdan bo‘shatish"
                            onClick={(event) => {
                              event.stopPropagation();
                              setArchiveTarget(e);
                            }}
                          >
                            <UserMinus size={16} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <span>
                Jami {data.total} · {data.page}/{data.pages} sahifa
              </span>
              <div>
                <button
                  className="btn btn-sm"
                  disabled={page <= 1}
                  onClick={() => set("page", String(page - 1))}
                  aria-label="Oldingi sahifa"
                >
                  <ChevronLeft size={15} />
                </button>
                <button
                  className="btn btn-sm"
                  disabled={page >= data.pages}
                  onClick={() => set("page", String(page + 1))}
                  aria-label="Keyingi sahifa"
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          </>
        )}
      </section>
      {archiveTarget && (
        <DismissModal
          employee={archiveTarget}
          onClose={() => setArchiveTarget(null)}
          onDone={() => {
            setArchiveTarget(null);
            toast("Xodim ishdan bo‘shatildi");
            void reload(true);
          }}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- form --- */
type FormState = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  employeeNo: string;
  departmentId: string;
  positionId: string;
  branchId: string;
  scheduleId: string;
  startDate: string;
  employmentType: string;
  baseSalary: number;
  currency: string;
  address: string;
  manager: string;
  photoDataUrl: string;
  status?: string;
};

function EmployeeFields({
  form,
  setForm,
  meta,
  editing,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  meta: Meta;
  editing?: boolean;
}) {
  const set = (name: keyof FormState, value: string | number) =>
    setForm((f) => ({ ...f, [name]: value }));
  const positions = meta.positions.filter((x) => x.departmentId === form.departmentId);
  return (
    <>
      <PhotoPicker
        first={form.firstName || "Yangi"}
        last={form.lastName}
        value={form.photoDataUrl}
        onChange={(photoDataUrl) => set("photoDataUrl", photoDataUrl)}
      />
      <div className="form-section-title">Shaxsiy ma’lumotlar</div>
      <div className="form-grid">
        <Field label="Ism *">
          <input className="input" value={form.firstName} onChange={(e) => set("firstName", e.target.value)} required minLength={2} />
        </Field>
        <Field label="Familiya *">
          <input className="input" value={form.lastName} onChange={(e) => set("lastName", e.target.value)} required minLength={2} />
        </Field>
        <Field label="Telefon *" hint="Xodim botda shu raqamni yuborib ulanadi">
          <input
            className="input"
            type="tel"
            value={form.phone}
            placeholder="+998 90 123 45 67"
            onChange={(e) => set("phone", e.target.value)}
            required
          />
        </Field>
        <Field label="Email">
          <input className="input" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label="Manzil" className="span-2">
          <input className="input" value={form.address} onChange={(e) => set("address", e.target.value)} />
        </Field>
      </div>
      <div className="form-section-title">Ish ma’lumotlari</div>
      <div className="form-grid">
        <Field label="Filial *">
          <select className="select" value={form.branchId} onChange={(e) => set("branchId", e.target.value)} required>
            <option value="" disabled>Tanlang</option>
            {meta.branches.map((x) => (
              <option key={x.id} value={x.id}>{x.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Ish grafigi *">
          <select className="select" value={form.scheduleId} onChange={(e) => set("scheduleId", e.target.value)} required>
            <option value="" disabled>Tanlang</option>
            {meta.schedules.map((x) => (
              <option key={x.id} value={x.id}>{x.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Bo‘lim *">
          <select
            className="select"
            value={form.departmentId}
            onChange={(e) => {
              const departmentId = e.target.value;
              setForm((f) => ({
                ...f,
                departmentId,
                positionId:
                  meta.positions.find((p) => p.departmentId === departmentId)?.id || "",
              }));
            }}
            required
          >
            <option value="" disabled>Tanlang</option>
            {meta.departments.map((x) => (
              <option key={x.id} value={x.id}>{x.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Lavozim *" hint={form.departmentId && !positions.length ? "Bu bo‘limda lavozim yo‘q" : undefined}>
          <select className="select" value={form.positionId} onChange={(e) => set("positionId", e.target.value)} required>
            <option value="" disabled>Tanlang</option>
            {positions.map((x) => (
              <option key={x.id} value={x.id}>{x.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Xodim ID" hint={editing ? undefined : "Bo‘sh qolsa avtomatik (EMP-0001)"}>
          <input className="input" value={form.employeeNo} onChange={(e) => set("employeeNo", e.target.value)} />
        </Field>
        <Field label="Ish boshlagan sana *">
          <input className="input" type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} required />
        </Field>
        <Field label="Bandlik turi">
          <select className="select" value={form.employmentType} onChange={(e) => set("employmentType", e.target.value)}>
            <option value="FULL_TIME">To‘liq stavka</option>
            <option value="PART_TIME">Yarim stavka</option>
            <option value="CONTRACT">Shartnoma</option>
          </select>
        </Field>
        <Field label="Rahbari">
          <input className="input" value={form.manager} onChange={(e) => set("manager", e.target.value)} />
        </Field>
        {editing && (form.status === "ACTIVE" || form.status === "INACTIVE") && (
          <Field label="Holat">
            <select className="select" value={form.status} onChange={(e) => set("status", e.target.value)}>
              <option value="ACTIVE">Faol</option>
              <option value="INACTIVE">Nofaol (vaqtincha)</option>
            </select>
          </Field>
        )}
      </div>
      <div className="form-section-title">Ish haqi</div>
      <div className="form-grid">
        <Field label="Oylik maosh">
          <input className="input" type="number" min={0} step={10000} value={form.baseSalary} onChange={(e) => set("baseSalary", Number(e.target.value))} />
        </Field>
        <Field label="Valyuta">
          <select className="select" value={form.currency} onChange={(e) => set("currency", e.target.value)}>
            <option>UZS</option>
            <option>USD</option>
          </select>
        </Field>
      </div>
    </>
  );
}

function SetupGuard({ meta }: { meta: Meta }) {
  const missing = [
    !meta.branches.length && ["Filial", "/branches"],
    !meta.schedules.length && ["Ish grafigi", "/schedules"],
    !meta.departments.length && ["Bo‘lim", "/departments"],
    !meta.positions.length && ["Lavozim", "/positions"],
  ].filter(Boolean) as [string, string][];
  if (!missing.length) return null;
  return (
    <div className="alert warn" style={{ marginBottom: 16 }}>
      <AlertTriangle size={18} />
      <div>
        <b>Avval quyidagilarni yarating</b>
        <p>
          Xodim qo‘shish uchun kerak:{" "}
          {missing.map(([label, to], index) => (
            <span key={to}>
              <Link className="link" to={to}>
                {label}
              </Link>
              {index < missing.length - 1 ? ", " : ""}
            </span>
          ))}
        </p>
      </div>
    </div>
  );
}

export function EmployeeFormPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { data: meta, loading, error: metaError } = useApi<Meta>("/meta");
  const [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>({
    firstName: "",
    lastName: "",
    phone: "+998 ",
    email: "",
    employeeNo: "",
    departmentId: "",
    positionId: "",
    branchId: "",
    scheduleId: "",
    startDate: tashkentIsoDate(),
    employmentType: "FULL_TIME",
    baseSalary: 0,
    currency: "UZS",
    address: "",
    manager: "",
    photoDataUrl: "",
  });
  useEffect(() => {
    if (!meta) return;
    setForm((f) => {
      const departmentId = f.departmentId || meta.departments[0]?.id || "";
      return {
        ...f,
        departmentId,
        positionId:
          f.positionId ||
          meta.positions.find((p) => p.departmentId === departmentId)?.id ||
          "",
        branchId: f.branchId || meta.branches[0]?.id || "",
        scheduleId:
          f.scheduleId || meta.branches[0]?.scheduleId || meta.schedules[0]?.id || "",
      };
    });
  }, [meta]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const row = await post<Employee>("/employees", form);
      toast("Xodim yaratildi");
      navigate(`/employees/${row.id}?welcome=1`);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  }
  if (loading)
    return (
      <div className="page narrow">
        <Loading />
      </div>
    );
  if (!meta)
    return (
      <div className="page narrow">
        <ErrorBox message={metaError} />
      </div>
    );
  const blocked =
    !meta.branches.length ||
    !meta.schedules.length ||
    !meta.departments.length ||
    !meta.positions.length;
  return (
    <div className="page narrow">
      <Link to="/employees" className="back-link">
        <ChevronLeft size={16} /> Xodimlar
      </Link>
      <PageHeader title="Yangi xodim" subtitle="Ma’lumotlarni kiriting — keyin xodim Telegram orqali ulanadi" />
      <SetupGuard meta={meta} />
      <form className="card card-body" onSubmit={submit}>
        <EmployeeFields form={form} setForm={setForm} meta={meta} />
        <ErrorBox message={error} />
        <div className="form-actions">
          <Link className="btn" to="/employees">
            Bekor qilish
          </Link>
          <button className="btn btn-primary" disabled={saving || blocked}>
            <UserRoundPlus size={16} />
            {saving ? "Saqlanmoqda…" : "Xodimni yaratish"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------- profile --- */
type Profile = {
  employee: Employee;
  attendance: Attendance[];
  leave: LeaveRequest[];
  activity: AuditLog[];
  faceSamples: number;
};
type Invite = {
  link?: string;
  appLink?: string;
  botUsername?: string;
  startParam: string;
  expiresAt: string;
};

export function EmployeeProfilePage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const toast = useToast();
  const { data, loading, error, reload } = useApi<Profile>(`/employees/${id}`);
  const { data: meta } = useApi<Meta>("/meta");
  const [tab, setTab] = useState(params.get("welcome") ? "connect" : "overview");
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<"face" | "telegram" | "archive" | "rehire" | null>(null);

  if (loading && !data)
    return (
      <div className="page">
        <Loading />
      </div>
    );
  if (error || !data)
    return (
      <div className="page">
        <ErrorBox message={error || "Xodim topilmadi"} />
      </div>
    );
  const e = data.employee;
  const lookup = (rows: { id: string; name: string }[] | undefined, key: string) =>
    rows?.find((x) => x.id === key)?.name;
  const department = lookup(meta?.departments, e.departmentId);
  const position = lookup(meta?.positions, e.positionId);
  const branch = lookup(meta?.branches, e.branchId);
  const schedule = meta?.schedules.find((x) => x.id === e.scheduleId);
  const today = data.attendance.find((a) => a.date === tashkentIsoDate());
  const dismissed = e.status === "DISMISSED" || e.status === "ARCHIVED";
  const month = tashkentIsoDate().slice(0, 7);
  const monthRows = data.attendance.filter((a) => a.date.startsWith(month));
  const tabs = [
    ["overview", "Umumiy"],
    ["attendance", `Davomat (${data.attendance.length})`],
    ["leave", `Ta’til (${data.leave.length})`],
    ["connect", "Telegram va Face ID"],
    ["activity", "Faoliyat"],
  ];

  return (
    <div className="page">
      <Link to={dismissed ? "/dismissed" : "/employees"} className="back-link">
        <ChevronLeft size={16} /> {dismissed ? "Ishdan bo‘shaganlar" : "Xodimlar"}
      </Link>
      {dismissed && (
        <div className="alert warn" style={{ marginBottom: 14 }}>
          <UserMinus size={18} />
          <div>
            <b>
              Ishdan bo‘shagan{e.dismissedAt ? ` · ${dateLongUz(e.dismissedAt)}` : ""}
            </b>
            <p>
              {e.dismissReason ? `Sabab: ${e.dismissReason}. ` : ""}Davomat belgilay olmaydi va ish haqi
              hisobiga kirmaydi. Tarixiy ma’lumotlar saqlangan.
            </p>
          </div>
        </div>
      )}
      <section className="card profile-hero">
        <Avatar first={e.firstName} last={e.lastName} photo={e.photoDataUrl} size="xl" />
        <div>
          <h1>
            {e.firstName} {e.lastName}
          </h1>
          <p>
            {position || "Lavozim belgilanmagan"} · {department || "—"} · {e.employeeNo}
          </p>
          <div className="tags">
            <Status value={e.status} />
            <span className="badge blue plain">
              <Send size={12} /> {e.telegramConnected ? `Telegram ulangan${e.telegramUsername ? ` · @${e.telegramUsername}` : ""}` : "Telegram ulanmagan"}
            </span>
            <span className={`badge plain ${e.faceEnrolledAt ? "green" : "gray"}`}>
              <ScanFace size={12} /> {e.faceEnrolledAt ? "Face ID faol" : "Face ID yo‘q"}
            </span>
          </div>
        </div>
        <div className="toolbar">
          {dismissed ? (
            <button className="btn btn-primary" onClick={() => setConfirm("rehire")}>
              <UserPlus size={16} /> Qayta ishga olish
            </button>
          ) : (
            <button className="btn btn-danger" onClick={() => setConfirm("archive")}>
              <UserMinus size={16} /> Ishdan bo‘shatish
            </button>
          )}
          <button className="btn btn-primary" onClick={() => setEditing(true)} disabled={!meta}>
            <Pencil size={16} /> Tahrirlash
          </button>
        </div>
      </section>

      <div className="profile-grid">
        <aside className="card">
          <div className="card-head">
            <h3>Bugun</h3>
            <Status
              value={today?.checkIn ? (today.checkOut ? "LEFT" : "IN") : "NOT_YET"}
              label={today?.checkIn ? undefined : "Qayd yo‘q"}
              live={Boolean(today?.checkIn && !today.checkOut)}
            />
          </div>
          <div className="card-body today-card">
            <div className="timeline-2">
              <div>
                <small>Keldi</small>
                <b>{today?.checkIn || "—"}</b>
              </div>
              <span className="line" />
              <div>
                <small>Ketdi</small>
                <b>{today?.checkOut || "—"}</b>
              </div>
            </div>
            <div className="kv">
              <div>
                <span>Grafik</span>
                <b>{schedule?.name || "—"}</b>
              </div>
              <div>
                <span>Filial</span>
                <b>{branch || "—"}</b>
              </div>
              <div>
                <span>Bu oy kelgan</span>
                <b>{monthRows.filter((a) => a.checkIn).length} kun</b>
              </div>
              <div>
                <span>Bu oy kechikish</span>
                <b>
                  {monthRows.filter((a) => a.lateMinutes > 0).length} marta ·{" "}
                  {monthRows.reduce((s, a) => s + a.lateMinutes, 0)} daq
                </b>
              </div>
              <div>
                <span>Bu oy ishlagan</span>
                <b>{duration(monthRows.reduce((s, a) => s + a.workedMinutes, 0))}</b>
              </div>
            </div>
            <MonthGrid rows={monthRows} month={month} scheduleDays={schedule?.days} />
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
          <div className="card-body">
            {tab === "overview" && (
              <div className="info-grid">
                <Info label="Telefon" value={e.phone} />
                <Info label="Email" value={e.email} />
                <Info label="Manzil" value={e.address} />
                <Info label="Bo‘lim" value={department} />
                <Info label="Lavozim" value={position} />
                <Info label="Filial" value={branch} />
                <Info label="Rahbari" value={e.manager} />
                <Info label="Ish boshlagan" value={dateLongUz(e.startDate)} />
                <Info
                  label="Bandlik"
                  value={
                    { FULL_TIME: "To‘liq stavka", PART_TIME: "Yarim stavka", CONTRACT: "Shartnoma" }[
                      e.employmentType
                    ]
                  }
                />
                <Info label="Oylik maosh" value={money(e.baseSalary, e.currency)} />
                <Info
                  label="Ish grafigi"
                  value={
                    schedule
                      ? `${schedule.name} · ${schedule.graceMinutes} daq imtiyoz`
                      : undefined
                  }
                />
                <Info label="Xodim ID" value={e.employeeNo} />
              </div>
            )}
            {tab === "attendance" && <AttendanceTable rows={data.attendance} />}
            {tab === "leave" &&
              (data.leave.length ? (
                <div className="table-wrap">
                  <table className="table">
                    <tbody>
                      {data.leave.map((l) => (
                        <tr key={l.id}>
                          <td>
                            <span className="stack">
                              <b>{leaveTypeLabel[l.type] || l.type}</b>
                              <small>{l.reason}</small>
                            </span>
                          </td>
                          <td className="num">
                            {dateUz(l.startDate)} — {dateUz(l.endDate)}
                          </td>
                          <td className="actions">
                            <Status value={l.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title="Ta’til so‘rovlari yo‘q" text="Xodim Mini App orqali so‘rov yuborishi mumkin." />
              ))}
            {tab === "connect" && (
              <ConnectPanel
                employee={e}
                faceSamples={data.faceSamples}
                onResetFace={() => setConfirm("face")}
                onUnlinkTelegram={() => setConfirm("telegram")}
              />
            )}
            {tab === "activity" &&
              (data.activity.length ? (
                <div className="activity-list">
                  {data.activity.map((a) => (
                    <div key={a.id}>
                      <b>{a.action}</b>
                      <small>
                        {a.actor} · {dateUz(a.createdAt)}{" "}
                        {new Date(a.createdAt).toLocaleTimeString("en-GB", {
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone: "Asia/Tashkent",
                        })}
                      </small>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty />
              ))}
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
            toast("Ma’lumotlar saqlandi");
            void reload(true);
          }}
        />
      )}
      {confirm === "face" && (
        <Confirm
          title="Face ID’ni qayta sozlash"
          text="Mavjud biometrik namuna o‘chiriladi. Xodim keyingi davomatda yuzini qayta ro‘yxatdan o‘tkazadi."
          confirmLabel="Qayta sozlash"
          danger
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await del(`/employees/${e.id}/face-profile`);
            toast("Face ID tozalandi");
            void reload(true);
          }}
        />
      )}
      {confirm === "telegram" && (
        <Confirm
          title="Telegram’ni uzish"
          text="Xodimning Telegram hisobi profildan uziladi. U qayta ulanish uchun botga telefon raqamini yuborishi kerak bo‘ladi."
          confirmLabel="Uzish"
          danger
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await del(`/employees/${e.id}/telegram`);
            toast("Telegram uzildi");
            void reload(true);
          }}
        />
      )}
      {confirm === "archive" && (
        <DismissModal
          employee={e}
          onClose={() => setConfirm(null)}
          onDone={() => {
            setConfirm(null);
            toast("Xodim ishdan bo‘shatildi");
            void reload(true);
          }}
        />
      )}
      {confirm === "rehire" && (
        <RehireModal
          employee={e}
          onClose={() => setConfirm(null)}
          onDone={() => {
            setConfirm(null);
            toast("Xodim qayta ishga olindi");
            void reload(true);
          }}
        />
      )}
    </div>
  );
}

function ConnectPanel({
  employee: e,
  faceSamples,
  onResetFace,
  onUnlinkTelegram,
}: {
  employee: Employee;
  faceSamples: number;
  onResetFace: () => void;
  onUnlinkTelegram: () => void;
}) {
  const toast = useToast();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [busy, setBusy] = useState(false);
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast("Nusxalandi");
    } catch {
      toast("Nusxalab bo‘lmadi — qo‘lda belgilang", "error");
    }
  };
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="connect-card">
        <div className="connect-card-head">
          <span>
            <Send size={19} />
          </span>
          <div>
            <b>Telegram</b>
            <small>
              {e.telegramConnected
                ? `Ulangan${e.telegramUsername ? ` · @${e.telegramUsername}` : ""}`
                : "Hali ulanmagan"}
            </small>
          </div>
          {e.telegramConnected ? (
            <button className="btn btn-sm btn-danger" onClick={onUnlinkTelegram}>
              <Unlink size={14} /> Uzish
            </button>
          ) : (
            <Status value="PENDING" label="Kutilmoqda" />
          )}
        </div>
        {!e.telegramConnected && (
          <>
            <div className="alert info">
              <Smartphone size={18} />
              <div>
                <b>Eng oson usul — telefon raqam</b>
                <p>
                  Xodim botni ochib <b>/start</b> bosadi va «Telefon raqamni
                  yuborish» tugmasini bosadi. Raqam <b>{e.phone}</b> bilan mos
                  kelsa, hisob avtomatik ulanadi.
                </p>
              </div>
            </div>
            {invite ? (
              <div style={{ display: "grid", gap: 8 }}>
                <span className="label">Bir martalik havola (72 soat amal qiladi)</span>
                {invite.appLink && (
                  <div className="code-box">
                    <code>{invite.appLink}</code>
                    <button className="btn btn-sm" onClick={() => void copy(invite.appLink!)}>
                      <Copy size={13} /> Mini App
                    </button>
                  </div>
                )}
                {invite.link ? (
                  <div className="code-box">
                    <code>{invite.link}</code>
                    <button className="btn btn-sm" onClick={() => void copy(invite.link!)}>
                      <Copy size={13} /> Bot
                    </button>
                  </div>
                ) : (
                  <div className="alert warn">
                    <AlertTriangle size={18} />
                    <div>
                      <b>Bot username aniqlanmadi</b>
                      <p>
                        Xodim botga <code>/start {invite.startParam}</code> yozib yuborsin.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <button
                className="btn"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    setInvite(await post<Invite>(`/employees/${e.id}/telegram-invite`));
                  } catch (reason) {
                    toast(errorText(reason), "error");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Link2 size={15} /> Ulanish havolasini yaratish
              </button>
            )}
          </>
        )}
      </div>
      <div className="connect-card">
        <div className="connect-card-head">
          <span className="green">
            <ScanFace size={19} />
          </span>
          <div>
            <b>Face ID</b>
            <small>
              {e.faceEnrolledAt
                ? `Faol · ${dateLongUz(e.faceEnrolledAt)}${faceSamples ? ` · ${faceSamples} namuna` : ""}`
                : "Birinchi davomatda Mini App’da avtomatik sozlanadi"}
            </small>
          </div>
          {e.faceEnrolledAt && (
            <button className="btn btn-sm btn-danger" onClick={onResetFace}>
              Qayta sozlash
            </button>
          )}
        </div>
        {e.faceEnrolledAt && faceSamples === 0 && (
          <div className="alert warn">
            <AlertTriangle size={18} />
            <div>
              <b>Eski Face ID (1 namuna)</b>
              <p>
                Aniqlikni oshirish uchun Face ID’ni qayta sozlash tavsiya etiladi —
                yangi usulda jonlilik tekshiruvi va bir nechta namuna olinadi.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MonthGrid({
  rows,
  month,
  scheduleDays,
}: {
  rows: Attendance[];
  month: string;
  scheduleDays?: { day: number; enabled: boolean }[];
}) {
  const [year, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const offset = (new Date(Date.UTC(year, m - 1, 1)).getUTCDay() + 6) % 7;
  const today = tashkentIsoDate();
  const byDate = new Map(rows.map((r) => [r.date, r]));
  return (
    <div className="mini-cal">
      {weekOrder.map((d) => (
        <span key={d}>{weekdayShort[d]}</span>
      ))}
      {Array.from({ length: offset }, (_, i) => (
        <i key={`b${i}`} />
      ))}
      {Array.from({ length: days }, (_, i) => {
        const date = `${month}-${String(i + 1).padStart(2, "0")}`;
        const row = byDate.get(date);
        const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
        const workday = scheduleDays?.find((d) => d.day === weekday)?.enabled ?? true;
        const tone = row?.checkIn
          ? row.lateMinutes
            ? "late"
            : "present"
          : date < today && workday
            ? "absent"
            : !workday
              ? "off"
              : "";
        return (
          <span
            key={date}
            className={`mini-cal-day ${tone} ${date === today ? "today" : ""}`}
            title={row ? `${row.checkIn || "—"} → ${row.checkOut || "—"}` : undefined}
          >
            {i + 1}
          </span>
        );
      })}
    </div>
  );
}

function AttendanceTable({ rows }: { rows: Attendance[] }) {
  if (!rows.length)
    return <Empty title="Davomat qaydlari yo‘q" text="Xodim hali davomat belgilamagan." />;
  return (
    <div className="table-wrap">
      <table className="table table-cards">
        <thead>
          <tr>
            <th>Sana</th>
            <th>Keldi → Ketdi</th>
            <th>Ishladi</th>
            <th>Kechikish</th>
            <th>Tasdiq</th>
            <th>Holat</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 60).map((a) => (
            <tr key={a.id}>
              <td>
                <b>{dateUz(a.date)}</b>
              </td>
              <td data-label="Vaqt">
                <span className="times">
                  <b>{a.checkIn || "—"}</b>
                  <span className="arrow">→</span>
                  <b>{a.checkOut || "—"}</b>
                </span>
              </td>
              <td data-label="Ishladi" className="num">
                {a.workedMinutes ? duration(a.workedMinutes) : "—"}
              </td>
              <td data-label="Kechikish">
                {a.lateMinutes ? <span className="late-text">{a.lateMinutes} daq</span> : "—"}
              </td>
              <td data-label="Tasdiq">
                <span className="tags">
                  {a.verification.map((v) => (
                    <span className="tag" key={v}>
                      {verificationLabel[v] || v}
                    </span>
                  ))}
                </span>
              </td>
              <td data-label="Holat">
                <Status value={a.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
  const [form, setForm] = useState<FormState>({
    firstName: employee.firstName,
    lastName: employee.lastName,
    phone: employee.phone,
    email: employee.email || "",
    employeeNo: employee.employeeNo,
    departmentId: employee.departmentId,
    positionId: employee.positionId,
    branchId: employee.branchId,
    scheduleId: employee.scheduleId,
    startDate: employee.startDate,
    employmentType: employee.employmentType,
    baseSalary: employee.baseSalary,
    currency: employee.currency,
    address: employee.address || "",
    manager: employee.manager || "",
    photoDataUrl: employee.photoDataUrl || "",
    status: employee.status,
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const { status, ...rest } = form;
      // Ishdan bo‘shatish/qayta olish alohida amal orqali — bu yerda faqat faol/nofaol.
      await put(
        `/employees/${employee.id}`,
        status === "ACTIVE" || status === "INACTIVE" ? form : rest,
      );
      onSaved();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title="Xodimni tahrirlash" onClose={onClose} size="wide">
      <form onSubmit={save}>
        <EmployeeFields form={form} setForm={setForm} meta={meta} editing />
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

function Info({ label, value }: { label: string; value?: string }) {
  return (
    <div className="info-item">
      <small>{label}</small>
      <b>{value || "—"}</b>
    </div>
  );
}

export function PhotoPicker({
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
  const id = useMemo(() => `photo-${Math.random().toString(36).slice(2)}`, []);
  return (
    <div className="photo-picker">
      <Avatar first={first} last={last} photo={value} size="lg" />
      <div>
        <b>Profil rasmi</b>
        <small>JPG, PNG yoki WEBP · avtomatik 512px gacha siqiladi</small>
        <div className="toolbar">
          <label className="btn btn-sm" htmlFor={id}>
            <Camera size={14} /> {value ? "Almashtirish" : "Yuklash"}
          </label>
          <input
            id={id}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setError("");
              try {
                onChange(await resizePhoto(file));
              } catch (reason) {
                setError(errorText(reason, "Rasm yuklanmadi."));
              }
              event.target.value = "";
            }}
          />
          {value && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange("")}>
              Olib tashlash
            </button>
          )}
        </div>
        {error && <span className="field-error">{error}</span>}
      </div>
    </div>
  );
}

export async function resizePhoto(file: File, square = true) {
  if (!file.type.startsWith("image/")) throw new Error("Faqat rasm faylini tanlang.");
  if (file.size > 10 * 1024 * 1024) throw new Error("Rasm hajmi 10 MB’dan oshmasin.");
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Rasmni o‘qib bo‘lmadi."));
      element.src = url;
    });
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    const size = Math.min(512, side);
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Rasmni tayyorlab bo‘lmadi.");
    if (square)
      context.drawImage(
        image,
        (image.naturalWidth - side) / 2,
        (image.naturalHeight - side) / 2,
        side,
        side,
        0,
        0,
        size,
        size,
      );
    return canvas.toDataURL("image/jpeg", 0.84);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function DismissModal({
  employee,
  onClose,
  onDone,
}: {
  employee: Employee;
  onClose: () => void;
  onDone: () => void;
}) {
  const [date, setDate] = useState(tashkentIsoDate());
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="Ishdan bo‘shatish"
      subtitle={`${employee.firstName} ${employee.lastName} · ${employee.employeeNo}`}
      onClose={onClose}
      size="narrow"
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            await post(`/employees/${employee.id}/dismiss`, { date, reason: reason || undefined });
            onDone();
          } catch (reason) {
            setError(errorText(reason));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="muted" style={{ marginBottom: 14, fontSize: 13.5 }}>
          Xodim «Ishdan bo‘shaganlar» ro‘yxatiga o‘tadi, davomat belgilay olmaydi va ish haqi hisobiga
          kirmaydi. Keyin qayta ishga olish mumkin.
        </p>
        <Field label="Bo‘shagan sana">
          <input className="input" type="date" value={date} max={tashkentIsoDate()} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="Sabab (ixtiyoriy)">
          <input className="input" value={reason} maxLength={300} placeholder="Masalan: o‘z xohishi bilan" onChange={(e) => setReason(e.target.value)} />
        </Field>
        <ErrorBox message={error} />
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Bekor qilish
          </button>
          <button className="btn btn-danger-solid" disabled={busy}>
            <UserMinus size={15} /> {busy ? "Saqlanmoqda…" : "Ishdan bo‘shatish"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function RehireModal({
  employee,
  onClose,
  onDone,
}: {
  employee: Employee;
  onClose: () => void;
  onDone: () => void;
}) {
  const { data: meta } = useApi<Meta>("/meta");
  const [startDate, setStartDate] = useState(tashkentIsoDate());
  const [refs, setRefs] = useState({
    branchId: employee.branchId,
    departmentId: employee.departmentId,
    positionId: employee.positionId,
    scheduleId: employee.scheduleId,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Oldingi bo‘lim/lavozim o‘chirilgan bo‘lsa, yangisini tanlash so‘raladi.
  const missing = meta
    ? {
        branchId: !meta.branches.some((b) => b.id === refs.branchId),
        departmentId: !meta.departments.some((d) => d.id === refs.departmentId),
        positionId: !meta.positions.some((p) => p.id === refs.positionId),
        scheduleId: !meta.schedules.some((x) => x.id === refs.scheduleId),
      }
    : { branchId: false, departmentId: false, positionId: false, scheduleId: false };
  const anyMissing = Object.values(missing).some(Boolean);
  const pick = (key: keyof typeof refs, label: string, rows: { id: string; name: string }[]) => (
    <Field label={label} hint={missing[key] ? "Oldingisi o‘chirilgan — yangisini tanlang" : undefined}>
      <select
        className={`select ${missing[key] ? "field-error" : ""}`}
        value={missing[key] ? "" : refs[key]}
        onChange={(e) => setRefs((r) => ({ ...r, [key]: e.target.value }))}
        required
      >
        <option value="">Tanlang…</option>
        {rows.map((row) => (
          <option key={row.id} value={row.id}>
            {row.name}
          </option>
        ))}
      </select>
    </Field>
  );
  return (
    <Modal
      title="Qayta ishga olish"
      subtitle={`${employee.firstName} ${employee.lastName} · ${employee.employeeNo}`}
      onClose={onClose}
      size="narrow"
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            await post(`/employees/${employee.id}/rehire`, { startDate, ...refs });
            onDone();
          } catch (reason) {
            setError(errorText(reason));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="muted" style={{ marginBottom: 14, fontSize: 13.5 }}>
          Xodim yana faol bo‘ladi: Telegram orqali davomat belgilaydi va ish haqi hisobiga kiradi.
        </p>
        <Field label="Yangi ish boshlash sanasi">
          <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </Field>
        {meta && (
          <div className="form-grid">
            {pick("branchId", "Filial", meta.branches)}
            {pick("departmentId", "Bo‘lim", meta.departments)}
            {pick("positionId", "Lavozim", meta.positions)}
            {pick("scheduleId", "Ish grafigi", meta.schedules)}
          </div>
        )}
        {anyMissing && (
          <p className="late-text" style={{ fontSize: 12.5, marginBottom: 10 }}>
            Ba’zi bog‘lanishlar o‘chirilgan — qizil maydonlarni to‘ldiring.
          </p>
        )}
        <ErrorBox message={error} />
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Bekor qilish
          </button>
          <button className="btn btn-primary" disabled={busy || !meta || anyMissing}>
            <UserPlus size={15} /> {busy ? "Saqlanmoqda…" : "Qayta ishga olish"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function DismissedPage() {
  const [q, setQ] = useState("");
  const debounced = useDebounced(q, 300);
  const { data, loading, error } = useApi<List>(
    `/employees?status=DISMISSED&limit=200&q=${encodeURIComponent(debounced)}`,
  );
  const { data: meta } = useApi<Meta>("/meta");
  const navigate = useNavigate();
  const rows = (data?.items || [])
    .slice()
    .sort((a, b) => (b.dismissedAt || b.updatedAt).localeCompare(a.dismissedAt || a.updatedAt));
  return (
    <div className="page">
      <PageHeader title="Ishdan bo‘shaganlar" subtitle={`${data?.total ?? 0} ta xodim · ish haqi hisobiga kirmaydi`} />
      <section className="card">
        <div className="filters">
          <span className="input-icon">
            <Search size={16} />
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ism, ID, telefon…" />
          </span>
        </div>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <div className="card-body">
            <ErrorBox message={error} />
          </div>
        ) : !rows.length ? (
          <Empty
            icon={UserMinus}
            title="Ishdan bo‘shaganlar yo‘q"
            text="Xodim profilida «Ishdan bo‘shatish» bosilganda u shu ro‘yxatga tushadi."
          />
        ) : (
          <div className="table-wrap">
            <table className="table table-cards">
              <thead>
                <tr>
                  <th>Xodim</th>
                  <th>Lavozim</th>
                  <th>Ishlagan davr</th>
                  <th>Sabab</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} className="clickable" onClick={() => navigate(`/employees/${e.id}`)}>
                    <td>
                      <Person first={e.firstName} last={e.lastName} photo={e.photoDataUrl} sub={`${e.employeeNo} · ${e.phone}`} />
                    </td>
                    <td data-label="Lavozim">{meta?.positions.find((p) => p.id === e.positionId)?.name || "—"}</td>
                    <td data-label="Davr" className="num">
                      {dateUz(e.startDate)} — {e.dismissedAt ? dateUz(e.dismissedAt) : "—"}
                    </td>
                    <td data-label="Sabab" className="muted">
                      {e.dismissReason || "—"}
                    </td>
                    <td className="actions">
                      <span className="link">
                        Ochish <ChevronRight size={14} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
