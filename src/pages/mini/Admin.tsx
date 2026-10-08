import { TimeInput } from "../../components/TimeInput";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  Banknote,
  Clock3,
  Building2,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Download,
  FileSpreadsheet,
  Megaphone,
  MessagesSquare,
  Network,
  Plane,
  Plus,
  ScrollText,
  Search,
  UserCog,
  Users,
} from "lucide-react";
import { canOpenPage, can } from "@/lib/permissions";
import { duration, tashkentIsoDate } from "@/lib/format";
import { forwardMinutes, isOvernight, shiftMinutes } from "@/lib/shift-time";
import type {
  Announcement,
  AuditLog,
  Branch,
  Department,
  Employee,
  LeaveRequest,
  Position,
  Role,
  Schedule,
  ScheduleDay,
  User,
} from "@/lib/types";
import {
  leaveTypeLabel,
  weekdayNames,
  weekOrder,
  type Meta,
} from "../../types";
import { roleLabels } from "../../auth";
import { STAFF_ROLE_LABELS } from "@/lib/staff-roles";
import { PhotoAvatar, Seg, Sheet, SkeletonList, som } from "./shared";
import { confirmNative, haptic, openExternal, openTelegram, supports, tg } from "./tg";

/*
 * «Boshqaruv» — saytdagi panel ishlarining Mini App’dagi to‘liq nusxasi: xodimlar,
 * ish haqi jarayoni, ta’tillar, arizalar, grafiklar, filiallar, e’lonlar, murojaatlar,
 * hisobotlar, panel foydalanuvchilari, audit. Har bir bo‘lim saytdagi sahifa bilan bir
 * xil ruxsat bilan ko‘rinadi (canOpenPage) va saytning o‘z API’larini chaqiradi —
 * huquq, filial chegarasi va audit serverda.
 */

export type Call = <T>(
  url: string,
  body?: unknown,
  method?: string,
) => Promise<T>;
type Toast = (text: string, tone?: "ok" | "error") => void;
export type AdminKey =
  | "employees"
  | "attendance"
  | "payroll"
  | "leave"
  | "registrations"
  | "schedules"
  | "branches"
  | "org"
  | "announcements"
  | "helpdesk"
  | "reports"
  | "users"
  | "audit";

export const ADMIN_ITEMS: {
  key: AdminKey;
  label: string;
  hint: string;
  path: string;
  icon: ReactNode;
  /** Sahifadan tashqari kerakli ruxsat (masalan, ko‘rish emas — tahrirlash). */
  need?: string;
}[] = [
  {
    key: "employees",
    label: "Xodimlar",
    hint: "qo‘shish, tahrirlash, bo‘shatish",
    path: "/employees",
    icon: <Users size={18} />,
  },
  {
    key: "attendance",
    label: "Davomatni tuzatish",
    hint: "istalgan kun: kelish/ketish vaqtini kiritish",
    path: "/attendance",
    need: "attendance.edit",
    icon: <Clock3 size={18} />,
  },
  // HR — tabel (timesheet) bosqichi, moliya va direktor — pul hisobi; jarayon bitta.
  {
    key: "payroll",
    label: "Ish haqi va tabel",
    hint: "oy yakuni va tasdiqlash bosqichlari",
    path: "/timesheet",
    icon: <Banknote size={18} />,
  },
  {
    key: "leave",
    label: "Ta’tillar",
    hint: "ta’til va yo‘qlik qo‘shish",
    path: "/leave",
    icon: <Plane size={18} />,
  },
  {
    key: "registrations",
    label: "Arizalar",
    hint: "botdagi nomzodlar",
    path: "/registrations",
    icon: <ClipboardCheck size={18} />,
  },
  {
    key: "schedules",
    label: "Ish grafiklari",
    hint: "ish vaqti va dam kunlari",
    path: "/schedules",
    icon: <ClipboardList size={18} />,
  },
  {
    key: "branches",
    label: "Filiallar",
    hint: "manzil, GPS hudud, rejim",
    path: "/branches",
    icon: <Building2 size={18} />,
  },
  {
    key: "org",
    label: "Bo‘lim va lavozimlar",
    hint: "tuzilma, lavozimga panel huquqi",
    path: "/departments",
    icon: <Network size={18} />,
  },
  {
    key: "announcements",
    label: "E’lonlar",
    hint: "yuborilganlar va yangi e’lon",
    path: "/announcements",
    icon: <Megaphone size={18} />,
  },
  {
    key: "helpdesk",
    label: "Murojaatlar",
    hint: "xodimlar savollariga javob",
    path: "/helpdesk",
    icon: <MessagesSquare size={18} />,
  },
  {
    key: "reports",
    label: "Hisobotlar",
    hint: "Excel fayllar",
    path: "/reports",
    icon: <FileSpreadsheet size={18} />,
  },
  {
    key: "users",
    label: "Panel foydalanuvchilari",
    hint: "HR, moliya, filial rahbari",
    path: "/users",
    icon: <UserCog size={18} />,
  },
  {
    key: "audit",
    label: "Audit jurnali",
    hint: "kim nima qildi",
    path: "/audit",
    icon: <ScrollText size={18} />,
  },
];

/** Shu rolga ruxsat etilgan bo‘limlar (saytdagi menyu bilan bir xil qoida). */
export const adminItemsFor = (role: Role) =>
  ADMIN_ITEMS.filter((item) => canOpenPage(role, item.path) && (!item.need || can(role, item.need)));

const fail = (onToast: Toast) => (reason: unknown) =>
  onToast(reason instanceof Error ? reason.message : "Xatolik", "error");
const dmy = (iso?: string) =>
  iso ? iso.slice(0, 10).split("-").reverse().join(".") : "—";
const when = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
const fullName = (e: Pick<Employee, "firstName" | "lastName">) =>
  `${e.firstName} ${e.lastName}`.trim();

/** Bo‘lim ro‘yxati (Boshqaruv bosh sahifasi). `extra` — rahbar rejimining mavjud ko‘rinishlari (Moliya, Qurilmalar…). */
export function AdminMenu({
  role,
  extra,
  onOpen,
}: {
  role: Role;
  extra: { key: string; label: string; hint: string; icon: ReactNode }[];
  onOpen: (key: string) => void;
}) {
  const items = [...adminItemsFor(role), ...extra];
  if (!items.length)
    return <div className="mini-empty">Bu bo‘limda siz uchun ish yo‘q</div>;
  // Bo‘limlar mavzu bo‘yicha guruhlanadi — 15 ta qatorli bitta ro‘yxatdan topish oson.
  const groups = ADMIN_GROUPS.map((g) => ({ ...g, items: items.filter((i) => g.keys.includes(i.key)) }));
  const rest = items.filter((i) => !ADMIN_GROUPS.some((g) => g.keys.includes(i.key)));
  if (rest.length) groups.push({ title: "Boshqa", keys: [], items: rest });
  return (
    <>
      {groups
        .filter((g) => g.items.length)
        .map((g) => (
          <div key={g.title} className="adm-group">
            <div className="mp-group-title">{g.title}</div>
            <section className="mini-card">
              <div className="mini-rows">
                {g.items.map((item) => (
                  <button
                    key={item.key}
                    className="mini-row adm-item"
                    onClick={() => {
                      haptic.select();
                      onOpen(item.key);
                    }}
                  >
                    <span className="mini-ico">{item.icon}</span>
                    <span>
                      <b>{item.label}</b>
                      <small>{item.hint}</small>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                ))}
              </div>
            </section>
          </div>
        ))}
    </>
  );
}

const ADMIN_GROUPS: { title: string; keys: string[] }[] = [
  { title: "Xodimlar", keys: ["employees", "attendance", "leave", "registrations"] },
  { title: "Ish vaqti va tuzilma", keys: ["schedules", "branches", "org"] },
  { title: "Pul", keys: ["payroll", "money"] },
  { title: "Aloqa", keys: ["announcements", "helpdesk"] },
  { title: "Hisobot va sozlamalar", keys: ["reports", "week", "users", "devices", "audit"] },
];

export function AdminScreen({
  screen,
  call,
  role,
  onToast,
}: {
  screen: AdminKey;
  call: Call;
  role: Role;
  onToast: Toast;
}) {
  switch (screen) {
    case "employees":
      return <EmployeesScreen call={call} role={role} onToast={onToast} />;
    case "payroll":
      return <PayrollScreen call={call} role={role} onToast={onToast} />;
    case "leave":
      return <LeaveScreen call={call} role={role} onToast={onToast} />;
    case "registrations":
      return <RegistrationsScreen call={call} role={role} onToast={onToast} />;
    case "schedules":
      return <SchedulesScreen call={call} role={role} onToast={onToast} />;
    case "branches":
      return <BranchesScreen call={call} role={role} onToast={onToast} />;
    case "org":
      return <OrgScreen call={call} role={role} onToast={onToast} />;
    case "announcements":
      return <AnnouncementsScreen call={call} role={role} onToast={onToast} />;
    case "helpdesk":
      return <HelpdeskScreen call={call} onToast={onToast} />;
    case "reports":
      return <ReportsScreen call={call} role={role} onToast={onToast} />;
    case "users":
      return <UsersScreen call={call} role={role} onToast={onToast} />;
    case "audit":
      return <AuditScreen call={call} onToast={onToast} />;
    case "attendance":
      return <AttendanceFixScreen call={call} onToast={onToast} />;
  }
}

function useMeta(call: Call) {
  const [meta, setMeta] = useState<Meta | null>(null);
  useEffect(() => {
    call<Meta>("/meta")
      .then(setMeta)
      .catch(() =>
        setMeta({
          branches: [],
          departments: [],
          positions: [],
          schedules: [],
        } as unknown as Meta),
      );
  }, [call]);
  return meta;
}

/** Sabab/izoh so‘rash oynasi (Telegram ichida window.prompt ishonchsiz). */
function useAsk() {
  const [request, setRequest] = useState<{
    title: string;
    placeholder: string;
    min: number;
    resolve: (value: string | null) => void;
  } | null>(null);
  const [text, setText] = useState("");
  const ask = useCallback(
    (title: string, placeholder = "", min = 0) =>
      new Promise<string | null>((resolve) => {
        setText("");
        setRequest({ title, placeholder, min, resolve });
      }),
    [],
  );
  const close = (value: string | null) => {
    request?.resolve(value);
    setRequest(null);
  };
  const element = request ? (
    <Sheet
      title={request.title}
      onClose={() => close(null)}
      primary={{
        text: "Davom etish",
        onClick: () => close(text.trim()),
        disabled: text.trim().length < request.min,
      }}
    >
      <textarea
        className="adm-reply"
        rows={3}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={request.placeholder}
      />
    </Sheet>
  ) : null;
  return [element, ask] as const;
}

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="md-search">
      <Search size={16} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function AddButton({ text, onClick }: { text: string; onClick: () => void }) {
  return (
    <button className="mini-btn soft adm-add" onClick={onClick}>
      <Plus size={16} /> {text}
    </button>
  );
}

/* ================================================================ Xodimlar === */
type EmployeeRow = Employee & {
  todayAttendance?: { checkIn?: string; checkOut?: string };
};

function EmployeesScreen({
  call,
  role,
  onToast,
}: {
  call: Call;
  role: Role;
  onToast: Toast;
}) {
  const meta = useMeta(call);
  const [q, setQ] = useState("");
  const [branch, setBranch] = useState("");
  const [status, setStatus] = useState<"ACTIVE" | "DISMISSED">("ACTIVE");
  const [rows, setRows] = useState<EmployeeRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState<EmployeeRow | "new" | null>(null);
  const load = useCallback(() => {
    const params = new URLSearchParams({
      limit: "200",
      status: status === "ACTIVE" ? "" : "DISMISSED",
    });
    if (!params.get("status")) params.delete("status");
    if (q.trim()) params.set("q", q.trim());
    if (branch) params.set("branch", branch);
    call<{ items: EmployeeRow[]; total: number }>(`/employees?${params}`)
      .then((r) => (setRows(r.items), setTotal(r.total)))
      .catch((e) => (setRows([]), fail(onToast)(e)));
  }, [call, q, branch, status, onToast]);
  useEffect(() => {
    const timer = window.setTimeout(load, q ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [load, q]);
  const branchName = (id: string) =>
    meta?.branches.find((b) => b.id === id)?.name || "";
  const positionName = (id: string) =>
    meta?.positions.find((p) => p.id === id)?.name || "";
  return (
    <>
      <Seg
        value={status}
        options={[
          ["ACTIVE", "Ishlayotganlar"],
          ["DISMISSED", "Bo‘shaganlar"],
        ]}
        onChange={setStatus}
      />
      <SearchBox value={q} onChange={setQ} placeholder="Ism, telefon yoki ID" />
      {(meta?.branches.length || 0) > 1 && (
        <select
          className="adm-select"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
        >
          <option value="">Barcha filiallar</option>
          {meta!.branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      )}
      {can(role, "employees.create") && status === "ACTIVE" && (
        <AddButton text="Yangi xodim" onClick={() => setOpen("new")} />
      )}
      <div className="mp-group-title">
        {rows ? `${total} ta xodim` : "Yuklanmoqda…"}
      </div>
      {rows === null ? (
        <SkeletonList rows={6} />
      ) : !rows.length ? (
        <div className="mini-empty">Xodim topilmadi</div>
      ) : (
        <section className="mini-card">
          <div className="mini-rows">
            {rows.map((e) => (
              <button
                className="mini-row"
                key={e.id}
                onClick={() => setOpen(e)}
              >
                <PhotoAvatar employee={e} />
                <span>
                  <b>{fullName(e)}</b>
                  <small>
                    {[
                      positionName(e.positionId),
                      branchName(e.branchId),
                      e.phone,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    {status === "DISMISSED" && e.dismissedAt
                      ? ` · bo‘shagan ${dmy(e.dismissedAt)}`
                      : ""}
                  </small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
        </section>
      )}
      {open && meta && (
        <EmployeeSheet
          call={call}
          role={role}
          meta={meta}
          employee={open === "new" ? undefined : open}
          onClose={() => setOpen(null)}
          onToast={onToast}
          onSaved={() => {
            setOpen(null);
            load();
          }}
        />
      )}
    </>
  );
}

const EMPLOYMENT: [Employee["employmentType"], string][] = [
  ["FULL_TIME", "To‘liq stavka"],
  ["PART_TIME", "Yarim stavka"],
  ["CONTRACT", "Shartnoma"],
];

function EmployeeSheet({
  call,
  role,
  meta,
  employee,
  onClose,
  onSaved,
  onToast,
}: {
  call: Call;
  role: Role;
  meta: Meta;
  employee?: EmployeeRow;
  onClose: () => void;
  onSaved: () => void;
  onToast: Toast;
}) {
  const editable = employee
    ? can(role, "employees.edit")
    : can(role, "employees.create");
  const dismissed =
    employee?.status === "DISMISSED" || employee?.status === "ARCHIVED";
  const salaryVisible = !employee || employee.baseSalary !== undefined;
  const [form, setForm] = useState({
    firstName: employee?.firstName || "",
    lastName: employee?.lastName || "",
    middleName: employee?.middleName || "",
    phone: employee?.phone || "+998",
    branchId: employee?.branchId || meta.branches[0]?.id || "",
    departmentId: employee?.departmentId || meta.departments[0]?.id || "",
    positionId: employee?.positionId || "",
    scheduleId:
      employee?.scheduleId ||
      meta.branches.find(
        (b) => b.id === (employee?.branchId || meta.branches[0]?.id),
      )?.scheduleId ||
      meta.schedules[0]?.id ||
      "",
    baseSalary: String(employee?.baseSalary ?? ""),
    startDate: employee?.startDate || tashkentIsoDate(),
    employmentType:
      employee?.employmentType || ("FULL_TIME" as Employee["employmentType"]),
  });
  const [busy, setBusy] = useState(false);
  const [askElement, ask] = useAsk();
  const set = (patch: Partial<typeof form>) =>
    setForm((f) => ({ ...f, ...patch }));
  const positions = meta.positions.filter(
    (p) =>
      !form.departmentId ||
      !p.departmentId ||
      p.departmentId === form.departmentId,
  );
  async function save() {
    if (form.firstName.trim().length < 2 || form.lastName.trim().length < 2)
      return onToast("Ism va familiyani yozing", "error");
    if (!form.positionId) return onToast("Lavozimni tanlang", "error");
    setBusy(true);
    try {
      const body = {
        ...form,
        middleName: form.middleName.trim() || undefined,
        ...(salaryVisible
          ? { baseSalary: Number(form.baseSalary.replace(/\D/g, "")) || 0 }
          : { baseSalary: undefined }),
      };
      if (employee) await call(`/employees/${employee.id}`, body, "PUT");
      else await call("/employees", { ...body, email: "", currency: "UZS" });
      haptic.success();
      onToast(
        employee
          ? "Saqlandi"
          : "Xodim qo‘shildi — endi Telegram orqali ulanadi",
      );
      onSaved();
    } catch (e) {
      fail(onToast)(e);
    } finally {
      setBusy(false);
    }
  }
  async function dismiss() {
    if (!employee) return;
    const reason = await ask(
      "Ishdan bo‘shatish sababi",
      "Ixtiyoriy: masalan, o‘z xohishi bilan",
    );
    if (reason === null) return;
    if (
      !(await confirmNative(
        `${fullName(employee)} bugungi sana bilan ishdan bo‘shatilsinmi? Telefonlari va sessiyalari yopiladi.`,
        { ok: "Bo‘shatish", destructive: true },
      ))
    )
      return;
    setBusy(true);
    try {
      await call(`/employees/${employee.id}/dismiss`, {
        date: tashkentIsoDate(),
        reason: reason.trim() || undefined,
      });
      onToast("Ishdan bo‘shatildi");
      onSaved();
    } catch (e) {
      fail(onToast)(e);
    } finally {
      setBusy(false);
    }
  }
  async function rehire() {
    if (
      !employee ||
      !(await confirmNative(`${fullName(employee)} qayta ishga olinsinmi?`, {
        ok: "Qayta olish",
      }))
    )
      return;
    setBusy(true);
    try {
      await call(`/employees/${employee.id}/rehire`, {
        startDate: tashkentIsoDate(),
      });
      onToast("Qayta ishga olindi");
      onSaved();
    } catch (e) {
      fail(onToast)(e);
    } finally {
      setBusy(false);
    }
  }
  async function invite() {
    if (!employee) return;
    setBusy(true);
    try {
      const result = await call<{
        link?: string;
        url?: string;
        sent?: boolean;
      }>(`/employees/${employee.id}/telegram-invite`, {});
      const link = result.link || result.url;
      if (!link) return onToast("Taklif yuborildi");
      // Telegram ichida — «Ulashish» oynasi (xodimga darhol yuboriladi); bo‘lmasa nusxalash.
      const copied = await navigator.clipboard?.writeText(link).then(() => true, () => false);
      if (tg()) openTelegram(`https://t.me/share/url?url=${encodeURIComponent(link)}`);
      else onToast(copied ? "Taklif havolasi nusxalandi — xodimga yuboring" : link);
    } catch (e) {
      fail(onToast)(e);
    } finally {
      setBusy(false);
    }
  }
  const lock = !editable || dismissed;
  return (
    <Sheet
      title={employee ? fullName(employee) : "Yangi xodim"}
      subtitle={
        employee
          ? `ID ${employee.employeeNo}${employee.telegramConnected ? " · Telegram ulangan" : " · Telegram ulanmagan"}`
          : "Saqlangach xodim Telegram orqali ulanadi"
      }
      onClose={onClose}
      className="md-sheet"
      primary={
        lock
          ? null
          : {
              text: employee ? "Saqlash" : "Qo‘shish",
              onClick: () => void save(),
              busy,
            }
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!lock) void save();
        }}
      >
        <fieldset disabled={lock} className="adm-fieldset">
          <div className="grid-2">
            <label>
              Ism
              <input
                value={form.firstName}
                onChange={(e) => set({ firstName: e.target.value })}
                required
              />
            </label>
            <label>
              Familiya
              <input
                value={form.lastName}
                onChange={(e) => set({ lastName: e.target.value })}
                required
              />
            </label>
          </div>
          <label>
            Otasining ismi
            <input
              value={form.middleName}
              onChange={(e) => set({ middleName: e.target.value })}
            />
          </label>
          <label>
            Telefon
            <input
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={(e) => set({ phone: e.target.value })}
              required
            />
          </label>
          <label>
            Filial
            <select
              value={form.branchId}
              onChange={(e) => {
                const scheduleId = meta.branches.find(
                  (b) => b.id === e.target.value,
                )?.scheduleId;
                set({
                  branchId: e.target.value,
                  ...(scheduleId && !employee ? { scheduleId } : {}),
                });
              }}
            >
              {meta.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid-2">
            <label>
              Bo‘lim
              <select
                value={form.departmentId}
                onChange={(e) =>
                  set({ departmentId: e.target.value, positionId: "" })
                }
              >
                {meta.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Lavozim
              <select
                value={form.positionId}
                onChange={(e) => set({ positionId: e.target.value })}
              >
                <option value="">— tanlang —</option>
                {positions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Ish grafigi
            <select
              value={form.scheduleId}
              onChange={(e) => set({ scheduleId: e.target.value })}
            >
              {meta.schedules.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid-2">
            {salaryVisible && (
              <label>
                Oylik (so‘m)
                <input
                  inputMode="numeric"
                  value={form.baseSalary}
                  onChange={(e) => set({ baseSalary: e.target.value })}
                  placeholder="4 000 000"
                />
              </label>
            )}
            <label>
              Ishga kirgan sana
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => set({ startDate: e.target.value })}
              />
            </label>
          </div>
          {!employee && (
            <label>
              Bandlik turi
              <select
                value={form.employmentType}
                onChange={(e) =>
                  set({
                    employmentType: e.target
                      .value as Employee["employmentType"],
                  })
                }
              >
                {EMPLOYMENT.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </fieldset>
      </form>
      {employee && can(role, "employees.edit") && (
        <div className="adm-actions">
          {!dismissed && !employee.telegramConnected && (
            <button
              className="mini-btn soft sm"
              disabled={busy}
              onClick={() => void invite()}
            >
              Telegram taklif havolasi
            </button>
          )}
          {dismissed ? (
            <button
              className="mini-btn soft sm"
              disabled={busy}
              onClick={() => void rehire()}
            >
              Qayta ishga olish
            </button>
          ) : (
            <button
              className="mini-btn ghost sm"
              disabled={busy}
              onClick={() => void dismiss()}
            >
              Ishdan bo‘shatish
            </button>
          )}
        </div>
      )}
      {askElement}
    </Sheet>
  );
}

/* ================================================================ Ish haqi === */
type Workflow = {
  stage: string;
  label: string;
  stages: { key: string; label: string }[];
  history: { stage: string; by: string; at: string; note?: string }[];
  can: {
    hrCheck: boolean;
    financeCheck: boolean;
    approve: boolean;
    markPaid: boolean;
    reopen: boolean;
    back: boolean;
  };
};
type PayrollLine = {
  id: string;
  name: string;
  sub: string;
  net: number;
  days: number;
  expectedDays: number;
  deductions: number;
  plus: number;
  advance: number;
  explanation: string;
};
type PayrollData = {
  rows: {
    employee: Employee;
    days: number;
    expectedDays: number;
    net: number;
    deduction: number;
    absenceDeduction: number;
    fine: number;
    advance: number;
    overtimeAmount: number;
    bonus: number;
    explanation: string;
  }[];
  closed: null | {
    total: number;
    lines: {
      employeeId: string;
      employeeNo: string;
      name: string;
      position?: string;
      net: number;
      days: number;
      expectedDays: number;
      lateDeduction: number;
      absenceDeduction: number;
      fine: number;
      advance: number;
      overtimeAmount: number;
      bonus: number;
      explanation: string;
    }[];
  };
};

type TimesheetRow = {
  employeeId: string;
  name: string;
  employeeNo: string;
  branch: string;
  plannedMinutes: number;
  workedMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
  days: number;
  leaveDays: number;
  absentDays: number;
};
const hm = (m: number) => (m ? duration(m) : "—");

function PayrollScreen({
  call,
  role,
  onToast,
}: {
  call: Call;
  role: Role;
  onToast: Toast;
}) {
  // Pul summalari — faqat moliya va direktor; HR esa tabelni (soatlar) ko‘radi va tasdiqlaydi.
  const money = can(role, "payroll.view");
  const [month, setMonth] = useState(tashkentIsoDate().slice(0, 7));
  const [flow, setFlow] = useState<Workflow | null>(null);
  const [data, setData] = useState<PayrollData | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [line, setLine] = useState<PayrollLine | null>(null);
  const [sheet, setSheet] = useState<TimesheetRow[] | null>(null);
  const [askElement, ask] = useAsk();
  const load = useCallback(() => {
    setData(null);
    setSheet(null);
    call<Workflow>(`/payroll/${month}/workflow`)
      .then(setFlow)
      .catch(() => setFlow(null));
    if (money)
      call<PayrollData>(`/payroll?month=${month}`)
        .then(setData)
        .catch((e) => (setData({ rows: [], closed: null }), fail(onToast)(e)));
    else
      call<{ rows: TimesheetRow[] }>(`/payroll/${month}/timesheet`)
        .then((r) => setSheet(r.rows))
        .catch((e) => (setSheet([]), fail(onToast)(e)));
  }, [call, month, money, onToast]);
  useEffect(load, [load]);
  const lines: PayrollLine[] = useMemo(() => {
    if (!data) return [];
    if (data.closed)
      return data.closed.lines.map((l) => ({
        id: l.employeeId,
        name: l.name,
        sub: [l.employeeNo, l.position].filter(Boolean).join(" · "),
        net: l.net,
        days: l.days,
        expectedDays: l.expectedDays,
        deductions: l.lateDeduction + l.absenceDeduction + l.fine,
        plus: l.overtimeAmount + l.bonus,
        advance: l.advance,
        explanation: l.explanation,
      }));
    return data.rows.map((r) => ({
      id: r.employee.id,
      name: fullName(r.employee),
      sub: r.employee.employeeNo,
      net: r.net,
      days: r.days,
      expectedDays: r.expectedDays,
      deductions: r.deduction + r.absenceDeduction + r.fine,
      plus: r.overtimeAmount + r.bonus,
      advance: r.advance,
      explanation: r.explanation,
    }));
  }, [data]);
  const visible = lines.filter((l) =>
    `${l.name} ${l.sub}`.toLowerCase().includes(q.trim().toLowerCase()),
  );
  const total = lines.reduce((s, l) => s + l.net, 0);
  async function act(action: string, text: string) {
    let note: string | undefined;
    if (action === "reopen") {
      const answer = await ask(
        "Oyni qayta ochish sababi",
        "Auditga yoziladi (kamida 3 belgi)",
        3,
      );
      if (!answer) return;
      note = answer;
    } else if (!(await confirmNative(`${text}?`, { ok: "Ha" }))) return;
    setBusy(true);
    try {
      await call(`/payroll/${month}/workflow`, { action, note });
      haptic.success();
      onToast(`${text} ✓`);
      load();
    } catch (e) {
      fail(onToast)(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <label className="adm-month">
        Oy
        <input
          type="month"
          value={month}
          max={tashkentIsoDate().slice(0, 7)}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
        />
      </label>
      {flow && (
        <section className="mini-card adm-flow">
          <small className="adm-muted">Holat: {flow.label}</small>
          <div className="adm-actions">
            {flow.can.hrCheck && (
              <button
                className="mini-btn sm"
                disabled={busy}
                onClick={() =>
                  void act("hr_check", "Timesheet tasdiqlansin (HR)")
                }
              >
                Timesheet’ni tasdiqlash
              </button>
            )}
            {flow.can.financeCheck && (
              <button
                className="mini-btn sm"
                disabled={busy}
                onClick={() =>
                  void act("finance_check", "Hisob tasdiqlansin (Moliya)")
                }
              >
                Hisobni tasdiqlash
              </button>
            )}
            {flow.can.approve && (
              <button
                className="mini-btn sm"
                disabled={busy}
                onClick={() =>
                  void act("approve", "Tasdiqlab oy yopilsin (Direktor)")
                }
              >
                Tasdiqlash va yopish
              </button>
            )}
            {flow.can.markPaid && (
              <button
                className="mini-btn sm"
                disabled={busy}
                onClick={() =>
                  void act("mark_paid", "To‘landi deb belgilansin")
                }
              >
                To‘landi
              </button>
            )}
            {flow.can.back && (
              <button
                className="mini-btn ghost-neutral sm"
                disabled={busy}
                onClick={() =>
                  void act("back", "Qayta tekshirishga qaytarilsin")
                }
              >
                Qaytarish
              </button>
            )}
            {flow.can.reopen && (
              <button
                className="mini-btn ghost-neutral sm"
                disabled={busy}
                onClick={() => void act("reopen", "Oy qayta ochilsin")}
              >
                Qayta ochish
              </button>
            )}
          </div>
        </section>
      )}
      {!money && (
        <>
          <SearchBox
            value={q}
            onChange={setQ}
            placeholder="Xodim yoki filial"
          />
          {sheet === null ? (
            <SkeletonList rows={6} />
          ) : (
            <section className="mini-card">
              <div className="mini-rows">
                {sheet
                  .filter((r) =>
                    `${r.name} ${r.employeeNo} ${r.branch}`
                      .toLowerCase()
                      .includes(q.trim().toLowerCase()),
                  )
                  .map((r) => (
                    <div className="mini-row" key={r.employeeId}>
                      <span>
                        <b>{r.name}</b>
                        <small>
                          {r.branch} · {r.days} kun · reja{" "}
                          {hm(r.plannedMinutes)} · ishlagan{" "}
                          {hm(r.workedMinutes)}
                          {r.lateMinutes
                            ? ` · kechikish ${hm(r.lateMinutes)}`
                            : ""}
                          {r.overtimeMinutes
                            ? ` · overtime ${hm(r.overtimeMinutes)}`
                            : ""}
                          {r.absentDays ? ` · kelmagan ${r.absentDays}` : ""}
                          {r.leaveDays ? ` · ta’til ${r.leaveDays}` : ""}
                        </small>
                      </span>
                    </div>
                  ))}
              </div>
            </section>
          )}
        </>
      )}
      {money && (
        <>
          <section className="mf-stats">
            <div>
              <small>Jami qo‘lga</small>
              <b>{data ? som(data.closed?.total ?? total) : "…"}</b>
            </div>
            <div>
              <small>Xodimlar</small>
              <b>{data ? lines.length : "…"}</b>
            </div>
          </section>
          <SearchBox value={q} onChange={setQ} placeholder="Xodim" />
          {data === null ? (
            <SkeletonList rows={6} />
          ) : !visible.length ? (
            <div className="mini-empty">Ma’lumot yo‘q</div>
          ) : (
            <section className="mini-card">
              <div className="mini-rows">
                {visible.map((l) => (
                  <button
                    className="mini-row"
                    key={l.id}
                    onClick={() => setLine(l)}
                  >
                    <span>
                      <b>{l.name}</b>
                      <small>
                        {l.days}/{l.expectedDays} kun
                        {l.deductions ? ` · −${som(l.deductions)}` : ""}
                        {l.plus ? ` · +${som(l.plus)}` : ""}
                      </small>
                    </span>
                    <b className="adm-amount">{som(l.net)}</b>
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}
      {line && (
        <Sheet
          title={line.name}
          subtitle={`${month} · ${line.days}/${line.expectedDays} kun`}
          onClose={() => setLine(null)}
        >
          <section className="mf-stats">
            <div>
              <small>Qo‘lga</small>
              <b>{som(line.net)}</b>
            </div>
            <div>
              <small>Ushlanma</small>
              <b>{som(line.deductions)}</b>
            </div>
            <div>
              <small>Qo‘shimcha / bonus</small>
              <b>{som(line.plus)}</b>
            </div>
            <div>
              <small>Avans</small>
              <b>{som(line.advance)}</b>
            </div>
          </section>
          {line.explanation && (
            <p className="adm-explain">{line.explanation}</p>
          )}
        </Sheet>
      )}
      {askElement}
    </>
  );
}

/* ================================================================ Ta’tillar === */
type LeaveRow = LeaveRequest & { employee?: Employee };
const LEAVE_STATUS: Record<string, string> = {
  PENDING: "kutilmoqda",
  APPROVED: "tasdiqlangan",
  REJECTED: "rad etilgan",
  CANCELLED: "bekor qilingan",
};

function LeaveScreen({
  call,
  role,
  onToast,
}: {
  call: Call;
  role: Role;
  onToast: Toast;
}) {
  const [rows, setRows] = useState<LeaveRow[] | null>(null);
  const [tab, setTab] = useState<"NOW" | "PENDING" | "ALL">("NOW");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const today = tashkentIsoDate();
  const load = useCallback(() => {
    call<LeaveRow[]>("/leave")
      .then(setRows)
      .catch((e) => (setRows([]), fail(onToast)(e)));
  }, [call, onToast]);
  useEffect(load, [load]);
  const list = (rows || [])
    .filter((r) =>
      tab === "PENDING"
        ? r.status === "PENDING"
        : tab === "NOW"
          ? r.status === "APPROVED" && r.endDate >= today
          : true,
    )
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
  async function decide(r: LeaveRow, approve: boolean) {
    setBusy(r.id);
    try {
      await call(
        `/leave/${r.id}`,
        { status: approve ? "APPROVED" : "REJECTED" },
        "PATCH",
      );
      haptic.success();
      load();
    } catch (e) {
      fail(onToast)(e);
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <Seg
        value={tab}
        className="three"
        options={[
          ["NOW", "Hozir va keyin"],
          ["PENDING", "Kutilmoqda"],
          ["ALL", "Hammasi"],
        ]}
        onChange={setTab}
      />
      <AddButton
        text="Ta’til / yo‘qlik qo‘shish"
        onClick={() => setAdding(true)}
      />
      {rows === null ? (
        <SkeletonList rows={5} />
      ) : !list.length ? (
        <div className="mini-empty">Ro‘yxat bo‘sh</div>
      ) : (
        list.map((r) => (
          <article className="mg-req" key={r.id}>
            <div className="mg-req-head">
              <span className="mini-ico">
                <Plane size={17} />
              </span>
              <span>
                <b>{r.employee ? fullName(r.employee) : "Xodim"}</b>
                <small>
                  {leaveTypeLabel[r.type] || r.type} · {dmy(r.startDate)} –{" "}
                  {dmy(r.endDate)} · {LEAVE_STATUS[r.status] || r.status}
                </small>
                {r.reason && <small>«{r.reason}»</small>}
              </span>
            </div>
            {r.status === "PENDING" && can(role, "leave.approve") && (
              <div className="mg-actions">
                <button
                  className="mini-btn sm"
                  disabled={busy === r.id}
                  onClick={() => void decide(r, true)}
                >
                  Tasdiqlash
                </button>
                <button
                  className="mini-btn sm ghost"
                  disabled={busy === r.id}
                  onClick={() => void decide(r, false)}
                >
                  Rad etish
                </button>
              </div>
            )}
          </article>
        ))
      )}
      {adding && (
        <LeaveAddSheet
          call={call}
          canApprove={can(role, "leave.approve")}
          onClose={() => setAdding(false)}
          onToast={onToast}
          onSaved={() => {
            setAdding(false);
            load();
          }}
        />
      )}
    </>
  );
}

function EmployeePicker({
  call,
  value,
  onPick,
}: {
  call: Call;
  value: Pick<Employee, "id" | "firstName" | "lastName"> | null;
  onPick: (e: Employee | null) => void;
}) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Employee[]>([]);
  useEffect(() => {
    if (value || q.trim().length < 2) return setRows([]);
    const timer = window.setTimeout(() => {
      call<{ items: Employee[] }>(
        `/employees?limit=8&q=${encodeURIComponent(q.trim())}`,
      )
        .then((r) => setRows(r.items))
        .catch(() => setRows([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [call, q, value]);
  if (value)
    return (
      <div className="adm-picked">
        <b>{fullName(value)}</b>
        <button type="button" className="link" onClick={() => onPick(null)}>
          o‘zgartirish
        </button>
      </div>
    );
  return (
    <div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Xodim ismini yozing"
      />
      {rows.length > 0 && (
        <div className="adm-options">
          {rows.map((e) => (
            <button type="button" key={e.id} onClick={() => onPick(e)}>
              {fullName(e)} <small>{e.employeeNo}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LeaveAddSheet({
  call,
  canApprove,
  onClose,
  onSaved,
  onToast,
}: {
  call: Call;
  canApprove: boolean;
  onClose: () => void;
  onSaved: () => void;
  onToast: Toast;
}) {
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [type, setType] = useState("VACATION");
  const [startDate, setStart] = useState(tashkentIsoDate());
  const [endDate, setEnd] = useState(tashkentIsoDate());
  const [reason, setReason] = useState("");
  const [approve, setApprove] = useState(canApprove);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!employee) return onToast("Xodimni tanlang", "error");
    if (reason.trim().length < 3) return onToast("Sababni yozing", "error");
    setBusy(true);
    try {
      await call("/leave", {
        employeeId: employee.id,
        type,
        startDate,
        endDate,
        reason: reason.trim(),
        approve,
      });
      haptic.success();
      onToast("Saqlandi");
      onSaved();
    } catch (e) {
      fail(onToast)(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      title="Ta’til / yo‘qlik"
      onClose={onClose}
      className="md-sheet"
      primary={{
        text: "Saqlash",
        onClick: () => void save(),
        busy,
        disabled: !employee,
      }}
    >
      <form onSubmit={(e) => (e.preventDefault(), void save())}>
        <label>
          Xodim
          <EmployeePicker call={call} value={employee} onPick={setEmployee} />
        </label>
        <label>
          Turi
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {Object.entries(leaveTypeLabel).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="grid-2">
          <label>
            Boshlanish
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            Tugash
            <input
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>
        <label>
          Sabab
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Masalan: yillik ta’til"
          />
        </label>
        {canApprove && (
          <label className="adm-check">
            <input
              type="checkbox"
              checked={approve}
              onChange={(e) => setApprove(e.target.checked)}
            />{" "}
            Darhol tasdiqlash
          </label>
        )}
      </form>
    </Sheet>
  );
}

/* ================================================================ Arizalar === */
type Registration = {
  id: string;
  status: string;
  createdAt: string;
  positionName?: string;
  branchName?: string;
  answers: { id: string; label: string; value: string }[];
};

function RegistrationsScreen({
  call,
  role,
  onToast,
}: {
  call: Call;
  role: Role;
  onToast: Toast;
}) {
  const [rows, setRows] = useState<Registration[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [askElement, ask] = useAsk();
  const load = useCallback(() => {
    call<{ items: Registration[] }>("/registrations?status=PENDING")
      .then((r) => setRows(r.items))
      .catch((e) => (setRows([]), fail(onToast)(e)));
  }, [call, onToast]);
  useEffect(load, [load]);
  const canDecide = can(role, "registrations.approve");
  async function decide(r: Registration, approve: boolean) {
    let reason: string | undefined;
    if (!approve) {
      const answer = await ask(
        "Rad etish sababi",
        "Nomzodga yuboriladi (ixtiyoriy)",
      );
      if (answer === null) return;
      reason = answer || undefined;
    } else if (
      !(await confirmNative("Nomzod xodim sifatida qabul qilinsinmi?", {
        ok: "Qabul qilish",
      }))
    )
      return;
    setBusy(r.id);
    try {
      await call(
        `/registrations/${r.id}/${approve ? "approve" : "reject"}`,
        approve ? {} : { reason },
      );
      haptic.success();
      onToast(approve ? "Qabul qilindi — xodim yaratildi" : "Rad etildi");
      load();
    } catch (e) {
      fail(onToast)(e);
    } finally {
      setBusy(null);
    }
  }
  if (rows === null) return <SkeletonList rows={4} />;
  if (!rows.length) return <div className="mini-empty">Yangi ariza yo‘q</div>;
  return (
    <>
      {rows.map((r) => (
        <article className="mg-req" key={r.id}>
          <div className="mg-req-head">
            <span className="mini-ico">
              <ClipboardCheck size={17} />
            </span>
            <span>
              <b>
                {r.answers.find((a) => /ism|f\.i\.sh|name/i.test(a.label))
                  ?.value || "Nomzod"}
              </b>
              <small>
                {[r.positionName, r.branchName, dmy(r.createdAt)]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
            </span>
          </div>
          <dl className="adm-answers">
            {r.answers.map((a) => (
              <div key={a.id}>
                <dt>{a.label}</dt>
                <dd>{a.value || "—"}</dd>
              </div>
            ))}
          </dl>
          {canDecide && (
            <div className="mg-actions">
              <button
                className="mini-btn sm"
                disabled={busy === r.id}
                onClick={() => void decide(r, true)}
              >
                Qabul qilish
              </button>
              <button
                className="mini-btn sm ghost"
                disabled={busy === r.id}
                onClick={() => void decide(r, false)}
              >
                Rad etish
              </button>
            </div>
          )}
        </article>
      ))}
      {askElement}
    </>
  );
}

/* ================================================================ Grafiklar === */
const blankDays = (): ScheduleDay[] =>
  [0, 1, 2, 3, 4, 5, 6].map((day) => ({
    day,
    enabled: day !== 0,
    start: "09:00",
    end: "18:00",
    breakMinutes: 60,
  }));

function SchedulesScreen({
  call,
  role,
  onToast,
}: {
  call: Call;
  role: Role;
  onToast: Toast;
}) {
  const [rows, setRows] = useState<
    (Schedule & { employees?: number })[] | null
  >(null);
  const [open, setOpen] = useState<Schedule | "new" | null>(null);
  const load = useCallback(() => {
    call<(Schedule & { employees?: number })[]>("/schedules")
      .then(setRows)
      .catch((e) => (setRows([]), fail(onToast)(e)));
  }, [call, onToast]);
  useEffect(load, [load]);
  const editable = can(role, "employees.edit");
  return (
    <>
      {editable && (
        <AddButton text="Yangi grafik" onClick={() => setOpen("new")} />
      )}
      {rows === null ? (
        <SkeletonList rows={4} />
      ) : !rows.length ? (
        <div className="mini-empty">Grafik yo‘q</div>
      ) : (
        <section className="mini-card">
          <div className="mini-rows">
            {rows.map((s) => {
              const first = s.days.find((d) => d.enabled);
              return (
                <button
                  className="mini-row"
                  key={s.id}
                  onClick={() => editable && setOpen(s)}
                >
                  <span className="mini-ico">
                    <ClipboardList size={17} />
                  </span>
                  <span>
                    <b>{s.name}</b>
                    <small>
                      {first
                        ? `${first.start}–${first.end}${isOvernight(first.start, first.end) ? " (ertasi kuni)" : ""}`
                        : "—"}{" "}
                      · haftada {s.days.filter((d) => d.enabled).length} kun ·{" "}
                      {s.employees ?? 0} xodim
                    </small>
                  </span>
                  {editable && <ChevronRight size={16} />}
                </button>
              );
            })}
          </div>
        </section>
      )}
      {open && (
        <ScheduleSheet
          call={call}
          schedule={open === "new" ? undefined : open}
          onClose={() => setOpen(null)}
          onToast={onToast}
          onSaved={() => {
            setOpen(null);
            load();
          }}
        />
      )}
    </>
  );
}

function ScheduleSheet({
  call,
  schedule,
  onClose,
  onSaved,
  onToast,
}: {
  call: Call;
  schedule?: Schedule;
  onClose: () => void;
  onSaved: () => void;
  onToast: Toast;
}) {
  const [name, setName] = useState(schedule?.name || "");
  const [grace, setGrace] = useState(String(schedule?.graceMinutes ?? 10));
  const [days, setDays] = useState<ScheduleDay[]>(() =>
    blankDays().map((d) => schedule?.days.find((x) => x.day === d.day) || d),
  );
  const [busy, setBusy] = useState(false);
  const update = (day: number, patch: Partial<ScheduleDay>) =>
    setDays((list) =>
      list.map((d) => (d.day === day ? { ...d, ...patch } : d)),
    );
  const copyFirst = () => {
    const first = days.find((d) => d.enabled);
    if (first)
      setDays((list) =>
        list.map((d) =>
          d.enabled
            ? {
                ...d,
                start: first.start,
                end: first.end,
                breakMinutes: first.breakMinutes,
              }
            : d,
        ),
      );
  };
  async function save() {
    if (name.trim().length < 2) return onToast("Grafik nomini yozing", "error");
    if (!days.some((d) => d.enabled))
      return onToast("Kamida bitta ish kunini yoqing", "error");
    const same = days.find((d) => d.enabled && d.start === d.end);
    if (same)
      return onToast(
        `${weekdayNames[same.day]}: boshlanish va tugash bir xil bo‘lmasin`,
        "error",
      );
    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        type: schedule?.type || "FIXED",
        graceMinutes: Number(grace) || 0,
        overtimeEnabled: schedule?.overtimeEnabled ?? true,
        days,
      };
      if (schedule) await call(`/schedules/${schedule.id}`, body, "PUT");
      else await call("/schedules", body);
      haptic.success();
      onToast("Grafik saqlandi");
      onSaved();
    } catch (e) {
      fail(onToast)(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      title={schedule ? "Grafikni tahrirlash" : "Yangi grafik"}
      onClose={onClose}
      className="md-sheet"
      primary={{ text: "Saqlash", onClick: () => void save(), busy }}
    >
      <form onSubmit={(e) => (e.preventDefault(), void save())}>
        <div className="grid-2">
          <label>
            Nomi
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="5/2 kunduzgi"
            />
          </label>
          <label>
            Kechikish imtiyozi (daq)
            <input
              inputMode="numeric"
              value={grace}
              onChange={(e) => setGrace(e.target.value.replace(/\D/g, ""))}
            />
          </label>
        </div>
        <button type="button" className="link adm-link" onClick={copyFirst}>
          Birinchi ish kuni vaqtini hammasiga qo‘llash
        </button>
        {weekOrder.map((day) => {
          const d = days.find((x) => x.day === day)!;
          const overnight =
            d.enabled && d.start !== d.end && isOvernight(d.start, d.end);
          return (
            <div className={`adm-day ${d.enabled ? "" : "off"}`} key={day}>
              <label className="adm-check">
                <input
                  type="checkbox"
                  checked={d.enabled}
                  onChange={(e) => update(day, { enabled: e.target.checked })}
                />
                {weekdayNames[day]}
              </label>
              <TimeInput
                value={d.start}
                disabled={!d.enabled}
                onChange={(v) => update(day, { start: v })}
                aria-label="Boshlanish"
              />
              <TimeInput
                value={d.end}
                disabled={!d.enabled}
                onChange={(v) => update(day, { end: v })}
                aria-label="Tugash"
              />
              {d.enabled && d.start !== d.end && (
                <small className={overnight ? "adm-next" : ""}>
                  {overnight ? "ertasi kuni · " : ""}
                  {duration(shiftMinutes(d.start, d.end))}
                </small>
              )}
            </div>
          );
        })}
      </form>
    </Sheet>
  );
}

/* ================================================================ Filiallar === */
type BranchRow = Branch & { employees?: number; presentToday?: number };

function BranchesScreen({
  call,
  role,
  onToast,
}: {
  call: Call;
  role: Role;
  onToast: Toast;
}) {
  const [rows, setRows] = useState<BranchRow[] | null>(null);
  const [open, setOpen] = useState<BranchRow | "new" | null>(null);
  const load = useCallback(() => {
    call<BranchRow[]>("/branches")
      .then(setRows)
      .catch((e) => (setRows([]), fail(onToast)(e)));
  }, [call, onToast]);
  useEffect(load, [load]);
  const editable = can(role, "branches.edit");
  return (
    <>
      {can(role, "branches.create") && (
        <AddButton text="Yangi filial" onClick={() => setOpen("new")} />
      )}
      {rows === null ? (
        <SkeletonList rows={4} />
      ) : !rows.length ? (
        <div className="mini-empty">Filial yo‘q</div>
      ) : (
        <section className="mini-card">
          <div className="mini-rows">
            {rows.map((b) => (
              <button
                className="mini-row"
                key={b.id}
                onClick={() => editable && setOpen(b)}
              >
                <span className="mini-ico">
                  <Building2 size={17} />
                </span>
                <span>
                  <b>
                    {b.name}
                    {b.status === "INACTIVE" ? " (nofaol)" : ""}
                  </b>
                  <small>
                    {b.address} · {b.employees ?? 0} xodim · bugun{" "}
                    {b.presentToday ?? 0} keldi
                  </small>
                </span>
                {editable && <ChevronRight size={16} />}
              </button>
            ))}
          </div>
        </section>
      )}
      {open && (
        <BranchSheet
          call={call}
          branch={open === "new" ? undefined : open}
          onClose={() => setOpen(null)}
          onToast={onToast}
          onSaved={() => {
            setOpen(null);
            load();
          }}
        />
      )}
    </>
  );
}

function BranchSheet({
  call,
  branch,
  onClose,
  onSaved,
  onToast,
}: {
  call: Call;
  branch?: BranchRow;
  onClose: () => void;
  onSaved: () => void;
  onToast: Toast;
}) {
  const [form, setForm] = useState({
    name: branch?.name || "",
    address: branch?.address || "",
    latitude: String(branch?.latitude ?? ""),
    longitude: String(branch?.longitude ?? ""),
    radiusMeters: String(branch?.radiusMeters ?? 100),
    attendanceMode: branch?.attendanceMode || "QR_GPS_FACE",
    status: branch?.status || "ACTIVE",
  });
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof form>) =>
    setForm((f) => ({ ...f, ...patch }));
  function locate() {
    if (!navigator.geolocation)
      return onToast("Joylashuv aniqlanmadi", "error");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        set({
          latitude: p.coords.latitude.toFixed(6),
          longitude: p.coords.longitude.toFixed(6),
        });
        onToast(`Joylashuv olindi (±${Math.round(p.coords.accuracy)} m)`);
      },
      () => onToast("Joylashuvga ruxsat berilmadi", "error"),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }
  async function save() {
    setBusy(true);
    try {
      const body = {
        name: form.name.trim(),
        address: form.address.trim(),
        latitude: Number(form.latitude),
        longitude: Number(form.longitude),
        radiusMeters: Number(form.radiusMeters),
        attendanceMode: form.attendanceMode,
        status: form.status,
      };
      if (branch) await call(`/branches/${branch.id}`, body, "PUT");
      else await call("/branches", body);
      haptic.success();
      onToast("Filial saqlandi");
      onSaved();
    } catch (e) {
      fail(onToast)(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      title={branch ? branch.name : "Yangi filial"}
      onClose={onClose}
      className="md-sheet"
      primary={{ text: "Saqlash", onClick: () => void save(), busy }}
    >
      <form onSubmit={(e) => (e.preventDefault(), void save())}>
        <label>
          Nomi
          <input
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </label>
        <label>
          Manzil
          <input
            value={form.address}
            onChange={(e) => set({ address: e.target.value })}
          />
        </label>
        <div className="grid-2">
          <label>
            Kenglik
            <input
              inputMode="decimal"
              value={form.latitude}
              onChange={(e) => set({ latitude: e.target.value })}
            />
          </label>
          <label>
            Uzunlik
            <input
              inputMode="decimal"
              value={form.longitude}
              onChange={(e) => set({ longitude: e.target.value })}
            />
          </label>
        </div>
        <button type="button" className="mini-btn soft sm" onClick={locate}>
          📍 Hozir turgan joyimni olish
        </button>
        <label>
          Ruxsat etilgan radius (metr)
          <input
            inputMode="numeric"
            value={form.radiusMeters}
            onChange={(e) =>
              set({ radiusMeters: e.target.value.replace(/\D/g, "") })
            }
          />
        </label>
        <label>
          Davomat usuli
          <select
            value={form.attendanceMode}
            onChange={(e) =>
              set({
                attendanceMode: e.target.value as Branch["attendanceMode"],
              })
            }
          >
            <option value="QR_GPS_FACE">QR + GPS + Face ID</option>
            <option value="GPS_FACE">GPS + Face ID (QR’siz)</option>
          </select>
        </label>
        {branch && (
          <label className="adm-check">
            <input
              type="checkbox"
              checked={form.status === "ACTIVE"}
              onChange={(e) =>
                set({ status: e.target.checked ? "ACTIVE" : "INACTIVE" })
              }
            />{" "}
            Faol
          </label>
        )}
      </form>
    </Sheet>
  );
}

/* ================================================== Bo‘lim va lavozimlar === */
function OrgScreen({ call, role, onToast }: { call: Call; role: Role; onToast: Toast }) {
  const [tab, setTab] = useState<"departments" | "positions">("departments");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [open, setOpen] = useState<Department | Position | "new" | null>(null);
  const load = useCallback(() => {
    call<Meta>("/meta")
      .then(setMeta)
      .catch((e) => fail(onToast)(e));
  }, [call, onToast]);
  useEffect(load, [load]);
  const editable = can(role, "employees.edit");
  const departments = meta?.departments || [];
  const deptName = (id: string) => departments.find((d) => d.id === id)?.name || "—";
  const rows: (Department | Position)[] = tab === "departments" ? departments : meta?.positions || [];
  return (
    <>
      <Seg
        value={tab}
        options={[
          ["departments", `Bo‘limlar ${departments.length}`],
          ["positions", `Lavozimlar ${meta?.positions.length ?? 0}`],
        ]}
        onChange={setTab}
      />
      {editable && (tab === "departments" || departments.length > 0) && (
        <AddButton text={tab === "departments" ? "Yangi bo‘lim" : "Yangi lavozim"} onClick={() => setOpen("new")} />
      )}
      {meta === null ? (
        <SkeletonList rows={4} />
      ) : !rows.length ? (
        <div className="mini-empty">{tab === "departments" ? "Bo‘lim yo‘q" : departments.length ? "Lavozim yo‘q" : "Avval bo‘lim qo‘shing"}</div>
      ) : (
        <section className="mini-card">
          <div className="mini-rows">
            {rows.map((row) => {
              const position = tab === "positions" ? (row as Position) : null;
              return (
                <button className="mini-row" key={row.id} onClick={() => editable && setOpen(row)}>
                  <span className="mini-ico">
                    <Network size={17} />
                  </span>
                  <span>
                    <b>{row.name}</b>
                    <small>
                      {position
                        ? [deptName(position.departmentId), position.panelRole && STAFF_ROLE_LABELS[position.panelRole], position.anyBranch && "istalgan filial"].filter(Boolean).join(" · ")
                        : (row as Department).manager || "Rahbar ko‘rsatilmagan"}
                    </small>
                  </span>
                  {editable && <ChevronRight size={16} />}
                </button>
              );
            })}
          </div>
        </section>
      )}
      {open && meta && (
        <OrgSheet
          call={call}
          type={tab}
          row={open === "new" ? undefined : open}
          departments={departments}
          onClose={() => setOpen(null)}
          onToast={onToast}
          onSaved={() => {
            setOpen(null);
            load();
          }}
        />
      )}
    </>
  );
}

function OrgSheet({
  call,
  type,
  row,
  departments,
  onClose,
  onSaved,
  onToast,
}: {
  call: Call;
  type: "departments" | "positions";
  row?: Department | Position;
  departments: Department[];
  onClose: () => void;
  onSaved: () => void;
  onToast: Toast;
}) {
  const isDept = type === "departments";
  const [name, setName] = useState(row?.name || "");
  const [manager, setManager] = useState((row as Department | undefined)?.manager || "");
  const [departmentId, setDepartmentId] = useState((row as Position | undefined)?.departmentId || departments[0]?.id || "");
  const [panelRole, setPanelRole] = useState<string>((row as Position | undefined)?.panelRole || "");
  const [anyBranch, setAnyBranch] = useState(Boolean((row as Position | undefined)?.anyBranch));
  const [busy, setBusy] = useState(false);
  async function save() {
    if (name.trim().length < 2) return onToast("Nomini kiriting", "error");
    setBusy(true);
    try {
      // Lavozimning filial ro‘yxati saytda sozlanadi — bu yerda o‘zgarmaydi.
      const body = isDept ? { name: name.trim(), manager: manager.trim() } : { name: name.trim(), departmentId, panelRole, anyBranch };
      if (row) await call(`/${type}/${row.id}`, body, "PUT");
      else await call(`/${type}`, body);
      haptic.success();
      onToast("Saqlandi");
      onSaved();
    } catch (e) {
      fail(onToast)(e);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!row || !(await confirmNative(`«${row.name}» o‘chirilsinmi?`, { ok: "O‘chirish", destructive: true }))) return;
    setBusy(true);
    try {
      await call(`/${type}/${row.id}`, undefined, "DELETE");
      onToast("O‘chirildi");
      onSaved();
    } catch (e) {
      fail(onToast)(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      title={row ? row.name : isDept ? "Yangi bo‘lim" : "Yangi lavozim"}
      onClose={onClose}
      className="md-sheet"
      primary={{ text: "Saqlash", onClick: () => void save(), busy }}
    >
      <form onSubmit={(e) => (e.preventDefault(), void save())}>
        <label>
          Nomi
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {isDept ? (
          <label>
            Rahbar
            <input value={manager} onChange={(e) => setManager(e.target.value)} />
          </label>
        ) : (
          <>
            <label>
              Bo‘lim
              <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Panel huquqi
              <select value={panelRole} onChange={(e) => setPanelRole(e.target.value)}>
                <option value="">Yo‘q — oddiy xodim</option>
                {Object.entries(STAFF_ROLE_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="adm-check">
              <input type="checkbox" checked={anyBranch} onChange={(e) => setAnyBranch(e.target.checked)} /> Istalgan filialdan keldi-ketdi qila oladi
            </label>
          </>
        )}
      </form>
      {row && (
        <div className="adm-actions">
          <button className="mini-btn ghost sm" disabled={busy} onClick={() => void remove()}>
            O‘chirish
          </button>
        </div>
      )}
    </Sheet>
  );
}

/* ================================================================ E’lonlar === */

function AnnouncementsScreen({
  call,
  role,
  onToast,
}: {
  call: Call;
  role: Role;
  onToast: Toast;
}) {
  const [rows, setRows] = useState<Announcement[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => {
    call<Announcement[]>("/announcements")
      .then(setRows)
      .catch((e) => (setRows([]), fail(onToast)(e)));
  }, [call, onToast]);
  useEffect(load, [load]);
  async function remind(a: Announcement) {
    setBusy(a.id);
    try {
      await call(`/announcements/${a.id}/remind`, {});
      onToast("O‘qimaganlarga eslatma yuborildi");
    } catch (e) {
      fail(onToast)(e);
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      {can(role, "announcements.create") && (
        <AddButton text="Yangi e’lon" onClick={() => setAdding(true)} />
      )}
      {rows === null ? (
        <SkeletonList rows={4} />
      ) : !rows.length ? (
        <div className="mini-empty">E’lon yo‘q</div>
      ) : (
        rows.slice(0, 50).map((a) => {
          const r = a.report?.staffora;
          return (
            <article className="mg-req" key={a.id}>
              <div className="mg-req-head">
                <span className="mini-ico">
                  <Megaphone size={17} />
                </span>
                <span>
                  <b>{a.title}</b>
                  <small>
                    {dmy(a.scheduledAt)}
                    {a.createdBy ? ` · ${a.createdBy}` : ""}
                    {r ? ` · ${r.delivered}/${r.recipients} yetkazildi` : ""}
                    {r && a.ackRequired
                      ? ` · ${r.acknowledged || 0} tanishdi`
                      : ""}
                  </small>
                </span>
              </div>
              <p className="adm-explain">{a.message}</p>
              {a.options?.length && r?.answers ? (
                <small className="adm-muted">
                  {a.options
                    .map((o) => `${o}: ${r.answers?.[o] || 0}`)
                    .join(" · ")}
                </small>
              ) : null}
              {a.ackRequired &&
                r &&
                (r.acknowledged || 0) < r.recipients &&
                can(role, "announcements.create") && (
                  <div className="mg-actions">
                    <button
                      className="mini-btn soft sm"
                      disabled={busy === a.id}
                      onClick={() => void remind(a)}
                    >
                      O‘qimaganlarga eslatish
                    </button>
                  </div>
                )}
            </article>
          );
        })
      )}
      {adding && (
        <AnnounceSheet
          call={call}
          onClose={() => setAdding(false)}
          onToast={onToast}
          onSent={() => (setAdding(false), load())}
        />
      )}
    </>
  );
}

function AnnounceSheet({
  call,
  onClose,
  onSent,
  onToast,
}: {
  call: Call;
  onClose: () => void;
  onSent: () => void;
  onToast: Toast;
}) {
  const meta = useMeta(call);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  async function send() {
    if (title.trim().length < 3 || message.trim().length < 3)
      return onToast("Sarlavha va matnni yozing", "error");
    setBusy(true);
    try {
      const result = await call<{ recipients: number; delivered: number }>(
        "/quick-announce",
        {
          title: title.trim(),
          message: message.trim(),
          branchIds,
          ackRequired: ack || undefined,
        },
      );
      haptic.success();
      onToast(`Yuborildi: ${result.delivered}/${result.recipients} xodim`);
      onSent();
    } catch (e) {
      fail(onToast)(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      title="Yangi e’lon"
      onClose={onClose}
      className="md-sheet"
      primary={{ text: "Yuborish", onClick: () => void send(), busy }}
    >
      <form onSubmit={(e) => (e.preventDefault(), void send())}>
        <label>
          Sarlavha
          <input
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          Matn
          <textarea
            rows={5}
            value={message}
            maxLength={1500}
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
        {(meta?.branches.length || 0) > 1 && (
          <div className="ms-chips">
            <button
              type="button"
              className={!branchIds.length ? "on" : ""}
              onClick={() => setBranchIds([])}
            >
              Hammaga
            </button>
            {meta!.branches.map((b) => (
              <button
                type="button"
                key={b.id}
                className={branchIds.includes(b.id) ? "on" : ""}
                onClick={() =>
                  setBranchIds((list) =>
                    list.includes(b.id)
                      ? list.filter((x) => x !== b.id)
                      : [...list, b.id],
                  )
                }
              >
                {b.name}
              </button>
            ))}
          </div>
        )}
        <label className="adm-check">
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
          />{" "}
          «Tanishdim» tasdig‘ini so‘rash
        </label>
      </form>
    </Sheet>
  );
}

/* ================================================================ Murojaatlar === */
type TicketMessage = {
  id: string;
  from: "EMPLOYEE" | "HR";
  author?: string;
  text: string;
  at: string;
};
type Ticket = {
  id: string;
  kind: "QUESTION" | "FEEDBACK";
  anonymous: boolean;
  category: string;
  subject: string;
  status: "OPEN" | "ANSWERED" | "CLOSED";
  messages: TicketMessage[];
  unreadHr: boolean;
  employeeName: string;
  branch?: string;
  updatedAt: string;
};
const TICKET_STATUS: Record<Ticket["status"], string> = {
  OPEN: "javob kutmoqda",
  ANSWERED: "javob berilgan",
  CLOSED: "yopilgan",
};

function HelpdeskScreen({ call, onToast }: { call: Call; onToast: Toast }) {
  const [data, setData] = useState<{
    categories: Record<string, string>;
    items: Ticket[];
  } | null>(null);
  const [tab, setTab] = useState<"OPEN" | "ALL">("OPEN");
  const [open, setOpen] = useState<Ticket | null>(null);
  const load = useCallback(() => {
    call<{ categories: Record<string, string>; items: Ticket[] }>("/tickets")
      .then(setData)
      .catch((e) => (setData({ categories: {}, items: [] }), fail(onToast)(e)));
  }, [call, onToast]);
  useEffect(load, [load]);
  const list = (data?.items || []).filter(
    (t) => tab === "ALL" || t.status === "OPEN",
  );
  return (
    <>
      <Seg
        value={tab}
        options={[
          [
            "OPEN",
            `Javob kutmoqda (${data?.items.filter((t) => t.status === "OPEN").length ?? 0})`,
          ],
          ["ALL", "Hammasi"],
        ]}
        onChange={setTab}
      />
      {data === null ? (
        <SkeletonList rows={4} />
      ) : !list.length ? (
        <div className="mini-empty">Murojaat yo‘q</div>
      ) : (
        <section className="mini-card">
          <div className="mini-rows">
            {list.map((t) => (
              <button
                className="mini-row"
                key={t.id}
                onClick={() => setOpen(t)}
              >
                <span className="mini-ico">
                  <MessagesSquare size={17} />
                </span>
                <span>
                  <b>
                    {t.unreadHr ? "● " : ""}
                    {t.subject}
                  </b>
                  <small>
                    {t.anonymous ? "Anonim" : t.employeeName}
                    {t.branch ? ` · ${t.branch}` : ""} ·{" "}
                    {data.categories[t.category] || t.category} ·{" "}
                    {TICKET_STATUS[t.status]}
                  </small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
        </section>
      )}
      {open && (
        <TicketSheet
          call={call}
          ticket={open}
          onClose={() => setOpen(null)}
          onToast={onToast}
          onChanged={() => (setOpen(null), load())}
        />
      )}
    </>
  );
}

function TicketSheet({
  call,
  ticket,
  onClose,
  onChanged,
  onToast,
}: {
  call: Call;
  ticket: Ticket;
  onClose: () => void;
  onChanged: () => void;
  onToast: Toast;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (ticket.unreadHr)
      void call(`/tickets/${ticket.id}`, { read: true }, "PATCH").catch(
        () => undefined,
      );
  }, [call, ticket]);
  async function reply(close: boolean) {
    if (!text.trim() && !close) return;
    setBusy(true);
    try {
      if (text.trim())
        await call(`/tickets/${ticket.id}/messages`, {
          text: text.trim(),
          close,
        });
      else await call(`/tickets/${ticket.id}`, { status: "CLOSED" }, "PATCH");
      haptic.success();
      onToast(close ? "Murojaat yopildi" : "Javob yuborildi");
      onChanged();
    } catch (e) {
      fail(onToast)(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      title={ticket.subject}
      subtitle={`${ticket.anonymous ? "Anonim" : ticket.employeeName} · ${TICKET_STATUS[ticket.status]}`}
      onClose={onClose}
      className="md-sheet"
      primary={
        ticket.status === "CLOSED"
          ? null
          : {
              text: "Javob yuborish",
              onClick: () => void reply(false),
              busy,
              disabled: !text.trim(),
            }
      }
      secondary={
        ticket.status === "CLOSED"
          ? null
          : { text: "Yopish", onClick: () => void reply(true) }
      }
    >
      <div className="adm-chat">
        {ticket.messages.map((m) => (
          <div key={m.id} className={m.from === "HR" ? "hr" : ""}>
            <small>
              {m.from === "HR"
                ? m.author || "HR"
                : ticket.anonymous
                  ? "Anonim"
                  : ticket.employeeName}{" "}
              · {when(m.at)}
            </small>
            <p>{m.text}</p>
          </div>
        ))}
      </div>
      {ticket.status !== "CLOSED" && (
        <textarea
          className="adm-reply"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Javobingiz…"
        />
      )}
    </Sheet>
  );
}

/* ================================================================ Hisobotlar === */

/** Panel faylini (Excel/CSV) Telegram «Yuklab olish» oynasi orqali yuklash — 5 daqiqalik imzolangan havola. */
export async function downloadPanelFile(
  call: Call,
  path: string,
  fileName: string,
) {
  const { path: link } = await call<{ path: string }>("/file-link", { path });
  const url = new URL(link, window.location.origin).toString();
  const webApp = tg();
  if (webApp?.downloadFile && supports("8.0")) {
    try {
      webApp.downloadFile({ url, file_name: fileName });
      return;
    } catch {
      /* eski Telegram — brauzerda ochamiz */
    }
  }
  openExternal(url);
}

function ReportsScreen({
  call,
  role,
  onToast,
}: {
  call: Call;
  role: Role;
  onToast: Toast;
}) {
  const month = tashkentIsoDate().slice(0, 7);
  const [period, setPeriod] = useState(month);
  const [busy, setBusy] = useState<string | null>(null);
  const from = `${period}-01`;
  const last = new Date(
    Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0),
  ).getUTCDate();
  const to =
    period === month
      ? tashkentIsoDate()
      : `${period}-${String(last).padStart(2, "0")}`;
  const reports = [
    {
      key: "att",
      name: "Davomat",
      desc: "Har kun: kelish, ketish, kechikish, ishlangan soat",
      path: `/reports/attendance.xlsx?from=${from}&to=${to}`,
      file: `Davomat-${period}.xlsx`,
      need: ["reports.view", "attendance.view"],
    },
    {
      key: "late",
      name: "Kechikishlar",
      desc: "Faqat kechikkan kunlar",
      path: `/reports/attendance.xlsx?from=${from}&to=${to}&type=late`,
      file: `Kechikishlar-${period}.xlsx`,
      need: ["reports.view", "attendance.view"],
    },
    {
      key: "pay",
      name: "Ish haqi vedomosti",
      desc: "Ish kuni, ushlanma, qo‘lga, imzo ustuni",
      path: `/reports/payroll.xlsx?month=${period}`,
      file: `Ish-haqi-${period}.xlsx`,
      need: ["payroll.view", "reports.view"],
    },
    {
      key: "t13",
      name: "T-13 tabel",
      desc: "Buxgalteriya uchun standart tabel",
      path: `/reports/t13.xlsx?month=${period}`,
      file: `T13-${period}.xlsx`,
      need: ["payroll.view", "reports.view", "employees.edit"],
    },
    {
      key: "bank",
      name: "Bank uchun ro‘yxat",
      desc: "F.I.Sh, karta, summa (CSV)",
      path: `/payroll/${period}/bank.csv`,
      file: `Bank-${period}.csv`,
      need: ["payroll.edit"],
    },
    {
      key: "emp",
      name: "Xodimlar ro‘yxati",
      desc: "Filial, lavozim, grafik, Telegram holati",
      path: "/reports/employees.xlsx",
      file: "Xodimlar.xlsx",
      need: ["reports.view", "employees.view"],
    },
  ].filter((r) => r.need.some((p) => can(role, p)));
  async function download(r: (typeof reports)[number]) {
    setBusy(r.key);
    try {
      await downloadPanelFile(call, r.path, r.file);
    } catch (e) {
      fail(onToast)(e);
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <label className="adm-month">
        Oy
        <input
          type="month"
          value={period}
          max={month}
          onChange={(e) => e.target.value && setPeriod(e.target.value)}
        />
      </label>
      <section className="mini-card">
        <div className="mini-rows">
          {reports.map((r) => (
            <button
              className="mini-row"
              key={r.key}
              disabled={busy === r.key}
              onClick={() => void download(r)}
            >
              <span className="mini-ico">
                <FileSpreadsheet size={17} />
              </span>
              <span>
                <b>{r.name}</b>
                <small>{r.desc}</small>
              </span>
              <Download size={16} />
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

/* ======================================================= Panel foydalanuvchilari === */
type SafeUser = Omit<User, "passwordHash">;
const ASSIGNABLE: Role[] = [
  "HR_ADMIN",
  "FINANCE",
  "IT_ADMIN",
  "BRANCH_MANAGER",
];

function UsersScreen({
  call,
  role,
  onToast,
}: {
  call: Call;
  role: Role;
  onToast: Toast;
}) {
  const [rows, setRows] = useState<SafeUser[] | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [open, setOpen] = useState<SafeUser | "new" | null>(null);
  const load = useCallback(() => {
    call<SafeUser[]>("/users")
      .then(setRows)
      .catch((e) => (setRows([]), fail(onToast)(e)));
    call<Branch[]>("/branches")
      .then(setBranches)
      .catch(() => setBranches([]));
  }, [call, onToast]);
  useEffect(load, [load]);
  const manage =
    role === "COMPANY_OWNER" || role === "HR_ADMIN" || role === "HR_MANAGER";
  return (
    <>
      {manage && (
        <AddButton
          text="Foydalanuvchi qo‘shish"
          onClick={() => setOpen("new")}
        />
      )}
      {rows === null ? (
        <SkeletonList rows={4} />
      ) : (
        <section className="mini-card">
          <div className="mini-rows">
            {rows.map((u) => (
              <button
                className="mini-row"
                key={u.id}
                onClick={() =>
                  manage && u.role !== "COMPANY_OWNER" && setOpen(u)
                }
              >
                <span className="mini-ico">
                  <UserCog size={17} />
                </span>
                <span>
                  <b>{u.name}</b>
                  <small>
                    {roleLabels[u.role]} · {u.email}
                    {u.role === "BRANCH_MANAGER" && u.branchIds?.length
                      ? ` · ${u.branchIds
                          .map((id) => branches.find((b) => b.id === id)?.name)
                          .filter(Boolean)
                          .join(", ")}`
                      : ""}
                    {u.telegramId ? " · Telegram ✓" : ""}
                  </small>
                </span>
                {manage && u.role !== "COMPANY_OWNER" && (
                  <ChevronRight size={16} />
                )}
              </button>
            ))}
          </div>
        </section>
      )}
      {open && (
        <UserSheet
          call={call}
          user={open === "new" ? undefined : open}
          branches={branches}
          onClose={() => setOpen(null)}
          onToast={onToast}
          onSaved={() => {
            setOpen(null);
            load();
          }}
        />
      )}
    </>
  );
}

function UserSheet({
  call,
  user,
  branches,
  onClose,
  onSaved,
  onToast,
}: {
  call: Call;
  user?: SafeUser;
  branches: Branch[];
  onClose: () => void;
  onSaved: () => void;
  onToast: Toast;
}) {
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>(
    user?.role === "HR_MANAGER" ? "HR_ADMIN" : user?.role || "HR_ADMIN",
  );
  const [branchIds, setBranchIds] = useState<string[]>(user?.branchIds || []);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      if (user)
        await call(
          `/users/${user.id}`,
          { name: name.trim(), role, branchIds },
          "PUT",
        );
      else
        await call("/users", {
          name: name.trim(),
          email: email.trim(),
          password,
          role,
          branchIds,
        });
      haptic.success();
      onToast("Saqlandi");
      onSaved();
    } catch (e) {
      fail(onToast)(e);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (
      !user ||
      !(await confirmNative(
        `${user.name} panelga kirish huquqidan mahrum qilinsinmi?`,
        { ok: "O‘chirish", destructive: true },
      ))
    )
      return;
    setBusy(true);
    try {
      await call(`/users/${user.id}`, undefined, "DELETE");
      onToast("O‘chirildi");
      onSaved();
    } catch (e) {
      fail(onToast)(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      title={user ? user.name : "Yangi foydalanuvchi"}
      onClose={onClose}
      className="md-sheet"
      primary={{ text: "Saqlash", onClick: () => void save(), busy }}
    >
      <form onSubmit={(e) => (e.preventDefault(), void save())}>
        <label>
          Ism familiya
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {!user && (
          <>
            <label>
              Email (login)
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Parol (kamida 10 belgi)
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          </>
        )}
        <label>
          Rol
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            {ASSIGNABLE.map((r) => (
              <option key={r} value={r}>
                {roleLabels[r]}
              </option>
            ))}
          </select>
        </label>
        {role === "BRANCH_MANAGER" && (
          <div className="ms-chips">
            {branches.map((b) => (
              <button
                type="button"
                key={b.id}
                className={branchIds.includes(b.id) ? "on" : ""}
                onClick={() =>
                  setBranchIds((list) =>
                    list.includes(b.id)
                      ? list.filter((x) => x !== b.id)
                      : [...list, b.id],
                  )
                }
              >
                {b.name}
              </button>
            ))}
          </div>
        )}
      </form>
      {user && (
        <div className="adm-actions">
          <button
            className="mini-btn ghost sm"
            disabled={busy}
            onClick={() => void remove()}
          >
            Panel huquqini olib tashlash
          </button>
        </div>
      )}
    </Sheet>
  );
}

/* ================================================================ Audit === */
function AuditScreen({ call, onToast }: { call: Call; onToast: Toast }) {
  const [rows, setRows] = useState<AuditLog[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    call<AuditLog[]>("/audit")
      .then(setRows)
      .catch((e) => (setRows([]), fail(onToast)(e)));
  }, [call, onToast]);
  const list = (rows || [])
    .filter((r) =>
      `${r.actor} ${r.action}`.toLowerCase().includes(q.trim().toLowerCase()),
    )
    .slice(0, 150);
  return (
    <>
      <SearchBox value={q} onChange={setQ} placeholder="Kim yoki nima" />
      {rows === null ? (
        <SkeletonList rows={6} />
      ) : !list.length ? (
        <div className="mini-empty">Yozuv yo‘q</div>
      ) : (
        <section className="mini-card">
          <div className="mini-rows">
            {list.map((r) => (
              <div className="mini-row" key={r.id}>
                <span>
                  <b>{r.action}</b>
                  <small>
                    {r.actor} · {when(r.createdAt)}
                  </small>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

/* ======================================================== Davomatni tuzatish === */
type DayRow = {
  employee: Pick<Employee, "id" | "firstName" | "lastName" | "photoDataUrl">;
  record: { id: string; checkIn?: string; checkOut?: string; scheduledStart?: string; scheduledEnd?: string; lateMinutes: number } | null;
  state: string;
  branch?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
};
const STATE: Record<string, string> = { IN: "ishda", LEFT: "ketgan", ABSENT: "kelmagan", NOT_YET: "hali kelmagan", ON_LEAVE: "ta’tilda", DAY_OFF: "dam olish", UPCOMING: "boshlanmagan", PRACTICE: "mashq davri" };

/** Saytdagi «Keldi-ketdi → qo‘lda kiritish/tahrirlash» — istalgan o‘tgan kun uchun (sabab auditga yoziladi). */
function AttendanceFixScreen({ call, onToast }: { call: Call; onToast: Toast }) {
  const today = tashkentIsoDate();
  const [date, setDate] = useState(today);
  const [rows, setRows] = useState<DayRow[] | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<DayRow | null>(null);
  const load = useCallback(() => {
    setRows(null);
    call<{ rows: DayRow[] }>(`/attendance/day?date=${date}`)
      .then((r) => setRows(r.rows))
      .catch((e) => (setRows([]), fail(onToast)(e)));
  }, [call, date, onToast]);
  useEffect(load, [load]);
  const list = (rows || []).filter((r) => r.state !== "UPCOMING" && fullName(r.employee).toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <label className="adm-month">
        Sana
        <input type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} />
      </label>
      <SearchBox value={q} onChange={setQ} placeholder="Xodim" />
      {rows === null ? (
        <SkeletonList rows={6} />
      ) : !list.length ? (
        <div className="mini-empty">Bu kunda xodim yo‘q</div>
      ) : (
        <section className="mini-card">
          <div className="mini-rows">
            {list.map((r) => (
              <button className="mini-row" key={r.employee.id} onClick={() => setOpen(r)}>
                <PhotoAvatar employee={r.employee} />
                <span>
                  <b>{fullName(r.employee)}</b>
                  <small>
                    {r.record?.checkIn ? `${r.record.checkIn} → ${r.record.checkOut || "…"}` : STATE[r.state] || r.state}
                    {r.record?.lateMinutes ? ` · ${duration(r.record.lateMinutes)} kech` : ""}
                    {r.branch ? ` · ${r.branch}` : ""}
                  </small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
        </section>
      )}
      {open && (
        <AttendanceFixSheet
          call={call}
          date={date}
          row={open}
          onClose={() => setOpen(null)}
          onToast={onToast}
          onSaved={() => {
            setOpen(null);
            load();
          }}
        />
      )}
    </>
  );
}

function AttendanceFixSheet({ call, date, row, onClose, onSaved, onToast }: { call: Call; date: string; row: DayRow; onClose: () => void; onSaved: () => void; onToast: Toast }) {
  const [checkIn, setCheckIn] = useState(row.record?.checkIn || row.scheduledStart || "09:00");
  const [checkOut, setCheckOut] = useState(row.record?.checkOut || "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const nextDay = Boolean(checkOut && checkIn && checkOut < checkIn);
  async function save() {
    if (note.trim().length < 3) return onToast("Sababni yozing — auditga tushadi", "error");
    setBusy(true);
    try {
      const body = { checkIn, checkOut: checkOut || "", note: `Qo‘lda (Mini App): ${note.trim()}` };
      if (row.record?.id) await call(`/attendance/${row.record.id}`, body, "PUT");
      else await call("/attendance", { ...body, employeeId: row.employee.id, date });
      haptic.success();
      onToast("Davomat saqlandi");
      onSaved();
    } catch (e) {
      fail(onToast)(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet title={fullName(row.employee)} subtitle={`${dmy(date)}${row.scheduledStart ? ` · grafik ${row.scheduledStart}–${row.scheduledEnd}${row.scheduledEnd && isOvernight(row.scheduledStart, row.scheduledEnd) ? " (ertasi kuni)" : ""}` : ""}`} onClose={onClose} primary={{ text: "Saqlash", onClick: () => void save(), busy, disabled: note.trim().length < 3 }}>
      <form onSubmit={(e) => (e.preventDefault(), void save())}>
        <div className="grid-2">
          <label>
            Keldi
            <TimeInput value={checkIn} onChange={(v) => setCheckIn(v)} required />
          </label>
          <label>
            Ketdi (ixtiyoriy)
            <TimeInput value={checkOut} onChange={(v) => setCheckOut(v)} />
          </label>
        </div>
        {nextDay && <small className="adm-muted">Ketish ertasi kuni · {duration(forwardMinutes(checkIn, checkOut))} ishlagan</small>}
        <label>
          Sabab
          <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Masalan: telefoni buzilgan edi" />
        </label>
      </form>
    </Sheet>
  );
}
