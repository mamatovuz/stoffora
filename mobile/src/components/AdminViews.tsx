import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { errorText } from "@/lib/api";
import { SERVER_ORIGIN } from "@/lib/config";
import { duration, forwardMinutes, som, tashkentIsoDate, toMinutes } from "@/lib/format";
import { currentFix } from "@/lib/location";
import { canOpenPage, canWeb, mcall } from "@/lib/manager";
import { useTheme } from "@/lib/theme";
import { Badge, Button, Card, Empty, Group, GroupTitle, Icon, Loading, Row, Segmented, Sheet, haptic, type IconName } from "./ui";

/*
 * «Boshqaruv» — saytdagi panel ishlarining ilovadagi to‘liq nusxasi (Mini App’dagi bilan bir xil):
 * xodimlar, ish haqi va tabel, ta’tillar, arizalar, grafiklar, filiallar, e’lonlar, murojaatlar,
 * hisobotlar, panel foydalanuvchilari, audit. Bo‘lim saytdagi sahifa bilan bir xil ruxsat bilan
 * ko‘rinadi; saytning o‘z API’lari chaqiriladi — huquq, filial chegarasi va audit serverda.
 */

export type AdminKey = "employees" | "attendance" | "payroll" | "leave" | "registrations" | "schedules" | "branches" | "org" | "announcements" | "helpdesk" | "reports" | "users" | "audit";
type Role = string;

export const ADMIN_ITEMS: { key: AdminKey; label: string; hint: string; path: string; icon: IconName; need?: string }[] = [
  { key: "employees", label: "Xodimlar", hint: "qo‘shish, tahrirlash, bo‘shatish", path: "/employees", icon: "people-outline" },
  { key: "attendance", label: "Davomatni tuzatish", hint: "istalgan kun: kelish/ketish vaqtini kiritish", path: "/attendance", icon: "time-outline", need: "attendance.edit" },
  { key: "payroll", label: "Ish haqi va tabel", hint: "oy yakuni va tasdiqlash bosqichlari", path: "/timesheet", icon: "cash-outline" },
  { key: "leave", label: "Ta’tillar", hint: "ta’til va yo‘qlik qo‘shish", path: "/leave", icon: "airplane-outline" },
  { key: "registrations", label: "Arizalar", hint: "botdagi nomzodlar", path: "/registrations", icon: "clipboard-outline" },
  { key: "schedules", label: "Ish grafiklari", hint: "ish vaqti va dam kunlari", path: "/schedules", icon: "time-outline" },
  { key: "branches", label: "Filiallar", hint: "manzil, GPS hudud, rejim", path: "/branches", icon: "business-outline" },
  { key: "org", label: "Bo‘lim va lavozimlar", hint: "tuzilma, lavozimga panel huquqi", path: "/departments", icon: "git-network-outline" },
  { key: "announcements", label: "E’lonlar", hint: "yuborilganlar va yangi e’lon", path: "/announcements", icon: "megaphone-outline" },
  { key: "helpdesk", label: "Murojaatlar", hint: "xodimlar savollariga javob", path: "/helpdesk", icon: "chatbubbles-outline" },
  { key: "reports", label: "Hisobotlar", hint: "Excel fayllar", path: "/reports", icon: "document-text-outline" },
  { key: "users", label: "Panel foydalanuvchilari", hint: "HR, moliya, filial rahbari", path: "/users", icon: "person-circle-outline" },
  { key: "audit", label: "Audit jurnali", hint: "kim nima qildi", path: "/audit", icon: "reader-outline" },
];
export const adminItemsFor = (role: Role) => ADMIN_ITEMS.filter((i) => canOpenPage(role, i.path) && (!i.need || canWeb(role, i.need)));

const ROLE_LABEL: Record<string, string> = { COMPANY_OWNER: "Kompaniya egasi", HR_ADMIN: "HR", HR_MANAGER: "HR", FINANCE: "Moliya", IT_ADMIN: "IT administrator", BRANCH_MANAGER: "Filial rahbari" };
const LEAVE: Record<string, string> = { VACATION: "Mehnat ta’tili", SICK: "Kasallik", PERMISSION: "Ruxsat (javob)", UNPAID: "Haq to‘lanmaydigan", OTHER: "Boshqa" };
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY = ["Yakshanba", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"];
const dmy = (iso?: string) => (iso ? iso.slice(0, 10).split("-").reverse().join(".") : "—");
const when = (iso: string) => new Date(iso).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const oops = (e: unknown) => Alert.alert("Xatolik", errorText(e));
const fullName = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`.trim();
const isClock = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const confirm = (title: string, text: string, ok: string, destructive = false) =>
  new Promise<boolean>((resolve) =>
    Alert.alert(title, text, [
      { text: "Bekor qilish", style: "cancel", onPress: () => resolve(false) },
      { text: ok, style: destructive ? "destructive" : "default", onPress: () => resolve(true) },
    ]),
  );
const shiftMonth = (ym: string, delta: number) => {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + delta, 15));
  return d.toISOString().slice(0, 7);
};

/* ------------------------------------------------------------ kichik qismlar --- */
function Field({ label, value, onChange, placeholder, keyboard, secure, multiline, editable = true }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; keyboard?: "numeric" | "phone-pad" | "email-address" | "decimal-pad"; secure?: boolean; multiline?: boolean; editable?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: c.muted, fontSize: 13 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={c.muted}
        keyboardType={keyboard}
        secureTextEntry={secure}
        multiline={multiline}
        editable={editable}
        autoCapitalize={keyboard === "email-address" || secure ? "none" : "sentences"}
        style={[st.input, { color: c.ink, borderColor: c.line, backgroundColor: c.card, opacity: editable ? 1 : 0.6 }, multiline && { minHeight: 90, textAlignVertical: "top" }]}
      />
    </View>
  );
}

/** Tanlov (select o‘rniga): bosilsa variantlar shu yerning o‘zida ochiladi (Modal ichida Modal bo‘lmaydi). */
function Choice({ label, value, options, onChange, editable = true }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void; editable?: boolean }) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  const current = options.find(([v]) => v === value)?.[1] || "— tanlang —";
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: c.muted, fontSize: 13 }}>{label}</Text>
      <Pressable disabled={!editable} onPress={() => setOpen(!open)} style={[st.input, st.choice, { borderColor: c.line, backgroundColor: c.card, opacity: editable ? 1 : 0.6 }]}>
        <Text style={{ color: c.ink, fontSize: 15.5, flex: 1 }} numberOfLines={1}>
          {current}
        </Text>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={16} color={c.muted} />
      </Pressable>
      {open ? (
        <View style={[st.options, { borderColor: c.line, backgroundColor: c.card }]}>
          {options.map(([v, text]) => (
            <Pressable
              key={v}
              onPress={() => {
                haptic.select();
                onChange(v);
                setOpen(false);
              }}
              style={[st.option, { borderBottomColor: c.line }]}
            >
              <Text style={{ color: v === value ? c.accent : c.ink, fontWeight: v === value ? "600" : "400" }}>{text}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const { c } = useTheme();
  return (
    <View style={[st.search, { backgroundColor: c.card }]}>
      <Icon name="search" size={17} color={c.muted} />
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={c.muted} style={{ flex: 1, color: c.ink, fontSize: 16 }} />
    </View>
  );
}

function MonthStepper({ value, onChange, max }: { value: string; onChange: (v: string) => void; max: string }) {
  const { c } = useTheme();
  return (
    <View style={[st.month, { backgroundColor: c.card }]}>
      <Pressable hitSlop={10} onPress={() => onChange(shiftMonth(value, -1))}>
        <Icon name="chevron-back" size={20} color={c.accent} />
      </Pressable>
      <Text style={{ color: c.ink, fontWeight: "600", fontSize: 16 }}>{value.split("-").reverse().join(".")}</Text>
      <Pressable hitSlop={10} disabled={value >= max} onPress={() => onChange(shiftMonth(value, 1))}>
        <Icon name="chevron-forward" size={20} color={value >= max ? c.line : c.accent} />
      </Pressable>
    </View>
  );
}

function useMeta() {
  const [meta, setMeta] = useState<Meta | null>(null);
  useEffect(() => {
    mcall<Meta>("/meta")
      .then(setMeta)
      .catch(() => setMeta({ branches: [], departments: [], positions: [], schedules: [] }));
  }, []);
  return meta;
}

type Meta = {
  branches: { id: string; name: string; scheduleId?: string }[];
  departments: { id: string; name: string }[];
  positions: { id: string; name: string; departmentId?: string }[];
  schedules: { id: string; name: string }[];
};

/* ------------------------------------------------------------- menyu --- */
export function AdminMenu({ role, extra, onOpen }: { role: Role; extra: { key: string; label: string; hint: string; icon: IconName }[]; onOpen: (key: string) => void }) {
  const items = [...adminItemsFor(role), ...extra];
  if (!items.length) return <Empty icon="grid-outline" title="Bu bo‘limda siz uchun ish yo‘q" />;
  // Bo‘limlar mavzu bo‘yicha guruhlanadi — uzun bitta ro‘yxatdan topish oson (Mini App bilan bir xil).
  const groups = ADMIN_GROUPS.map((g) => ({ ...g, items: items.filter((i) => g.keys.includes(i.key)) }));
  const rest = items.filter((i) => !ADMIN_GROUPS.some((g) => g.keys.includes(i.key)));
  if (rest.length) groups.push({ title: "Boshqa", keys: [], items: rest });
  return (
    <>
      {groups
        .filter((g) => g.items.length)
        .map((g) => (
          <View key={g.title} style={{ gap: 6 }}>
            <GroupTitle>{g.title}</GroupTitle>
            <Group>
              {g.items.map((i, index) => (
                <Row key={i.key} icon={i.icon} label={i.label} sub={i.hint} onPress={() => onOpen(i.key)} last={index === g.items.length - 1} />
              ))}
            </Group>
          </View>
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

export function AdminScreen({ screen, role }: { screen: AdminKey; role: Role }) {
  switch (screen) {
    case "employees":
      return <EmployeesScreen role={role} />;
    case "payroll":
      return <PayrollScreen role={role} />;
    case "leave":
      return <LeaveScreen role={role} />;
    case "registrations":
      return <RegistrationsScreen role={role} />;
    case "schedules":
      return <SchedulesScreen role={role} />;
    case "branches":
      return <BranchesScreen role={role} />;
    case "org":
      return <OrgScreen role={role} />;
    case "announcements":
      return <AnnouncementsScreen role={role} />;
    case "helpdesk":
      return <HelpdeskScreen />;
    case "reports":
      return <ReportsScreen role={role} />;
    case "users":
      return <UsersScreen role={role} />;
    case "audit":
      return <AuditScreen />;
    case "attendance":
      return <AttendanceFixScreen />;
  }
}

/* ================================================================ Xodimlar === */
type Emp = {
  id: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  phone: string;
  employeeNo: string;
  branchId: string;
  departmentId: string;
  positionId: string;
  scheduleId: string;
  baseSalary?: number;
  startDate: string;
  status: string;
  dismissedAt?: string;
  telegramConnected?: boolean;
};

function EmployeesScreen({ role }: { role: Role }) {
  const meta = useMeta();
  const [q, setQ] = useState("");
  const [branch, setBranch] = useState("");
  const [status, setStatus] = useState<"ACTIVE" | "DISMISSED">("ACTIVE");
  const [rows, setRows] = useState<Emp[] | null>(null);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState<Emp | "new" | null>(null);
  const load = useCallback(() => {
    const params = new URLSearchParams({ limit: "200" });
    if (status === "DISMISSED") params.set("status", "DISMISSED");
    if (q.trim()) params.set("q", q.trim());
    if (branch) params.set("branch", branch);
    mcall<{ items: Emp[]; total: number }>(`/employees?${params}`)
      .then((r) => (setRows(r.items), setTotal(r.total)))
      .catch((e) => (setRows([]), oops(e)));
  }, [q, branch, status]);
  useEffect(() => {
    const timer = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, q]);
  const nameOf = (list: { id: string; name: string }[] | undefined, id: string) => list?.find((x) => x.id === id)?.name || "";
  return (
    <>
      <Segmented<"ACTIVE" | "DISMISSED"> value={status} onChange={setStatus} options={[["ACTIVE", "Ishlayotganlar"], ["DISMISSED", "Bo‘shaganlar"]]} />
      <SearchInput value={q} onChange={setQ} placeholder="Ism, telefon yoki ID" />
      {(meta?.branches.length || 0) > 1 ? <Choice label="Filial" value={branch} options={[["", "Barcha filiallar"], ...meta!.branches.map((b) => [b.id, b.name] as [string, string])]} onChange={setBranch} /> : null}
      {canWeb(role, "employees.create") && status === "ACTIVE" ? <Button title="Yangi xodim" icon="person-add-outline" tone="soft" onPress={() => setOpen("new")} /> : null}
      <GroupTitle>{rows ? `${total} ta xodim` : "Yuklanmoqda"}</GroupTitle>
      {rows === null ? (
        <Loading />
      ) : !rows.length ? (
        <Empty icon="people-outline" title="Xodim topilmadi" />
      ) : (
        <Group>
          {rows.map((e, i) => (
            <Row
              key={e.id}
              label={fullName(e)}
              sub={[nameOf(meta?.positions, e.positionId), nameOf(meta?.branches, e.branchId), e.phone, e.dismissedAt ? `bo‘shagan ${dmy(e.dismissedAt)}` : ""].filter(Boolean).join(" · ")}
              onPress={() => setOpen(e)}
              last={i === rows.length - 1}
            />
          ))}
        </Group>
      )}
      {open && meta ? (
        <EmployeeSheet
          role={role}
          meta={meta}
          employee={open === "new" ? undefined : open}
          onClose={() => setOpen(null)}
          onSaved={() => {
            setOpen(null);
            load();
          }}
        />
      ) : null}
    </>
  );
}

function EmployeeSheet({ role, meta, employee, onClose, onSaved }: { role: Role; meta: Meta; employee?: Emp; onClose: () => void; onSaved: () => void }) {
  const { c } = useTheme();
  const editable = employee ? canWeb(role, "employees.edit") : canWeb(role, "employees.create");
  const dismissed = employee?.status === "DISMISSED" || employee?.status === "ARCHIVED";
  const lock = !editable || dismissed;
  const salaryVisible = !employee || employee.baseSalary !== undefined;
  const firstBranch = meta.branches[0];
  const [form, setForm] = useState({
    firstName: employee?.firstName || "",
    lastName: employee?.lastName || "",
    middleName: employee?.middleName || "",
    phone: employee?.phone || "+998",
    branchId: employee?.branchId || firstBranch?.id || "",
    departmentId: employee?.departmentId || meta.departments[0]?.id || "",
    positionId: employee?.positionId || "",
    scheduleId: employee?.scheduleId || firstBranch?.scheduleId || meta.schedules[0]?.id || "",
    baseSalary: employee?.baseSalary !== undefined ? String(employee.baseSalary) : "",
    startDate: employee?.startDate || tashkentIsoDate(),
  });
  const [busy, setBusy] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState("");
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const positions = meta.positions.filter((p) => !form.departmentId || !p.departmentId || p.departmentId === form.departmentId);
  async function save() {
    if (form.firstName.trim().length < 2 || form.lastName.trim().length < 2) return Alert.alert("Ism va familiyani yozing");
    if (!form.positionId) return Alert.alert("Lavozimni tanlang");
    setBusy(true);
    try {
      const body = { ...form, middleName: form.middleName.trim() || undefined, baseSalary: salaryVisible ? Number(form.baseSalary.replace(/\D/g, "")) || 0 : undefined };
      if (employee) await mcall(`/employees/${employee.id}`, body, "PUT");
      else await mcall("/employees", { ...body, email: "", currency: "UZS", employmentType: "FULL_TIME" });
      haptic.success();
      onSaved();
    } catch (e) {
      oops(e);
    } finally {
      setBusy(false);
    }
  }
  async function act(path: string, body: unknown, done: string) {
    setBusy(true);
    try {
      const result = await mcall<{ link?: string }>(path, body);
      haptic.success();
      if (result?.link) Alert.alert(done, result.link, [{ text: "Ulashish", onPress: () => void Linking.openURL(`https://t.me/share/url?url=${encodeURIComponent(result.link!)}`) }, { text: "OK" }]);
      else Alert.alert(done);
      if (!result?.link) onSaved();
    } catch (e) {
      oops(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet visible title={employee ? fullName(employee) : "Yangi xodim"} subtitle={employee ? `ID ${employee.employeeNo}${employee.telegramConnected ? " · Telegram ulangan" : " · Telegram ulanmagan"}` : "Saqlangach xodim Telegram orqali ulanadi"} onClose={onClose}>
      <Field label="Ism" value={form.firstName} onChange={(v) => set({ firstName: v })} editable={!lock} />
      <Field label="Familiya" value={form.lastName} onChange={(v) => set({ lastName: v })} editable={!lock} />
      <Field label="Otasining ismi" value={form.middleName} onChange={(v) => set({ middleName: v })} editable={!lock} />
      <Field label="Telefon" value={form.phone} onChange={(v) => set({ phone: v })} keyboard="phone-pad" editable={!lock} />
      <Choice
        label="Filial"
        value={form.branchId}
        editable={!lock}
        options={meta.branches.map((b) => [b.id, b.name])}
        onChange={(v) => {
          const scheduleId = meta.branches.find((b) => b.id === v)?.scheduleId;
          set({ branchId: v, ...(scheduleId && !employee ? { scheduleId } : {}) });
        }}
      />
      <Choice label="Bo‘lim" value={form.departmentId} editable={!lock} options={meta.departments.map((d) => [d.id, d.name])} onChange={(v) => set({ departmentId: v, positionId: "" })} />
      <Choice label="Lavozim" value={form.positionId} editable={!lock} options={positions.map((p) => [p.id, p.name])} onChange={(v) => set({ positionId: v })} />
      <Choice label="Ish grafigi" value={form.scheduleId} editable={!lock} options={meta.schedules.map((s) => [s.id, s.name])} onChange={(v) => set({ scheduleId: v })} />
      {salaryVisible ? <Field label="Oylik (so‘m)" value={form.baseSalary} onChange={(v) => set({ baseSalary: v })} keyboard="numeric" editable={!lock} /> : null}
      <Field label="Ishga kirgan sana (YYYY-MM-DD)" value={form.startDate} onChange={(v) => set({ startDate: v })} editable={!lock} />
      {!lock ? <Button title={employee ? "Saqlash" : "Qo‘shish"} onPress={() => void save()} busy={busy} /> : null}
      {employee && canWeb(role, "employees.edit") ? (
        <View style={{ gap: 8 }}>
          {!dismissed && !employee.telegramConnected ? <Button title="Telegram taklif havolasi" tone="soft" icon="paper-plane-outline" disabled={busy} onPress={() => void act(`/employees/${employee.id}/telegram-invite`, {}, "Taklif havolasi")} /> : null}
          {dismissed ? (
            <Button title="Qayta ishga olish" tone="soft" disabled={busy} onPress={() => void act(`/employees/${employee.id}/rehire`, { startDate: tashkentIsoDate() }, "Qayta ishga olindi")} />
          ) : dismissing ? (
            <Card style={{ gap: 10 }}>
              <Field label="Bo‘shatish sababi (ixtiyoriy)" value={reason} onChange={setReason} />
              <Button title="Bugungi sana bilan bo‘shatish" tone="danger" busy={busy} onPress={() => void act(`/employees/${employee.id}/dismiss`, { date: tashkentIsoDate(), reason: reason.trim() || undefined }, "Ishdan bo‘shatildi")} />
            </Card>
          ) : (
            <Button title="Ishdan bo‘shatish" tone="ghost" onPress={() => setDismissing(true)} />
          )}
        </View>
      ) : null}
      <Text style={{ color: c.muted, fontSize: 12 }}>O‘zgarishlar auditga yoziladi.</Text>
    </Sheet>
  );
}

/* ================================================================ Ish haqi === */
type Workflow = { stage: string; label: string; stages: { key: string; label: string }[]; history: { by: string; at: string }[]; can: { hrCheck: boolean; financeCheck: boolean; approve: boolean; markPaid: boolean; reopen: boolean; back: boolean } };
type PayRow = { employee: { id: string; firstName: string; lastName: string; employeeNo: string }; days: number; expectedDays: number; net: number; deduction: number; absenceDeduction: number; fine: number; advance: number; overtimeAmount: number; bonus: number; explanation: string };
type ClosedLine = { employeeId: string; employeeNo: string; name: string; net: number; days: number; expectedDays: number; lateDeduction: number; absenceDeduction: number; fine: number; advance: number; overtimeAmount: number; bonus: number; explanation: string };
type Line = { id: string; name: string; net: number; days: number; expectedDays: number; deductions: number; plus: number; advance: number; explanation: string };
type SheetRow = { employeeId: string; name: string; employeeNo: string; branch: string; plannedMinutes: number; workedMinutes: number; lateMinutes: number; overtimeMinutes: number; days: number; leaveDays: number; absentDays: number };
const hm = (m: number) => (m ? duration(m) : "—");

function PayrollScreen({ role }: { role: Role }) {
  const { c } = useTheme();
  const money = canWeb(role, "payroll.view");
  const thisMonth = tashkentIsoDate().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [flow, setFlow] = useState<Workflow | null>(null);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [closedTotal, setClosedTotal] = useState<number | null>(null);
  const [sheet, setSheet] = useState<SheetRow[] | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [note, setNote] = useState("");
  const [line, setLine] = useState<Line | null>(null);
  const load = useCallback(() => {
    setLines(null);
    setSheet(null);
    mcall<Workflow>(`/payroll/${month}/workflow`).then(setFlow).catch(() => setFlow(null));
    if (money)
      mcall<{ rows: PayRow[]; closed: null | { total: number; lines: ClosedLine[] } }>(`/payroll?month=${month}`)
        .then((d) => {
          setClosedTotal(d.closed?.total ?? null);
          setLines(
            d.closed
              ? d.closed.lines.map((l) => ({ id: l.employeeId, name: l.name, net: l.net, days: l.days, expectedDays: l.expectedDays, deductions: l.lateDeduction + l.absenceDeduction + l.fine, plus: l.overtimeAmount + l.bonus, advance: l.advance, explanation: l.explanation }))
              : d.rows.map((r) => ({ id: r.employee.id, name: fullName(r.employee), net: r.net, days: r.days, expectedDays: r.expectedDays, deductions: r.deduction + r.absenceDeduction + r.fine, plus: r.overtimeAmount + r.bonus, advance: r.advance, explanation: r.explanation })),
          );
        })
        .catch((e) => (setLines([]), oops(e)));
    else
      mcall<{ rows: SheetRow[] }>(`/payroll/${month}/timesheet`)
        .then((r) => setSheet(r.rows))
        .catch((e) => (setSheet([]), oops(e)));
  }, [month, money]);
  useEffect(load, [load]);
  async function act(action: string, text: string, extra?: string) {
    if (action !== "reopen" && !(await confirm(text, "Davom etilsinmi?", "Ha"))) return;
    setBusy(true);
    try {
      await mcall(`/payroll/${month}/workflow`, { action, note: extra });
      haptic.success();
      setReopening(false);
      setNote("");
      load();
    } catch (e) {
      oops(e);
    } finally {
      setBusy(false);
    }
  }
  const filter = (text: string) => text.toLowerCase().includes(q.trim().toLowerCase());
  const total = (lines || []).reduce((s, l) => s + l.net, 0);
  return (
    <>
      <MonthStepper value={month} onChange={setMonth} max={thisMonth} />
      {flow ? (
        <Card style={{ gap: 8 }}>
          <Text style={{ color: c.muted, fontSize: 13 }}>Holat: {flow.label}</Text>
          {flow.can.hrCheck ? <Button title="Timesheet’ni tasdiqlash (HR)" busy={busy} onPress={() => void act("hr_check", "Timesheet tasdiqlansin")} /> : null}
          {flow.can.financeCheck ? <Button title="Hisobni tasdiqlash (Moliya)" busy={busy} onPress={() => void act("finance_check", "Hisob tasdiqlansin")} /> : null}
          {flow.can.approve ? <Button title="Tasdiqlash va yopish (Direktor)" busy={busy} onPress={() => void act("approve", "Tasdiqlab oy yopilsin")} /> : null}
          {flow.can.markPaid ? <Button title="To‘landi" tone="success" busy={busy} onPress={() => void act("mark_paid", "To‘landi deb belgilansin")} /> : null}
          {flow.can.back ? <Button title="Qayta tekshirishga qaytarish" tone="ghost" disabled={busy} onPress={() => void act("back", "Qaytarilsin")} /> : null}
          {flow.can.reopen ? (
            reopening ? (
              <>
                <Field label="Qayta ochish sababi (auditga yoziladi)" value={note} onChange={setNote} />
                <Button title="Oyni qayta ochish" tone="danger" disabled={note.trim().length < 3} busy={busy} onPress={() => void act("reopen", "Qayta ochish", note.trim())} />
              </>
            ) : (
              <Button title="Qayta ochish" tone="ghost" onPress={() => setReopening(true)} />
            )
          ) : null}
        </Card>
      ) : null}
      {money ? (
        <>
          <Card style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <View>
              <Text style={{ color: c.muted, fontSize: 12.5 }}>Jami qo‘lga</Text>
              <Text style={{ color: c.ink, fontSize: 20, fontWeight: "700" }}>{lines ? som(closedTotal ?? total) : "…"}</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={{ color: c.muted, fontSize: 12.5 }}>Xodimlar</Text>
              <Text style={{ color: c.ink, fontSize: 20, fontWeight: "700" }}>{lines?.length ?? "…"}</Text>
            </View>
          </Card>
          <SearchInput value={q} onChange={setQ} placeholder="Xodim" />
          {lines === null ? (
            <Loading />
          ) : (
            <Group>
              {lines
                .filter((l) => filter(l.name))
                .map((l, i, all) => (
                  <Row key={l.id} label={l.name} sub={`${l.days}/${l.expectedDays} kun${l.deductions ? ` · −${som(l.deductions)}` : ""}${l.plus ? ` · +${som(l.plus)}` : ""}`} value={som(l.net)} onPress={() => setLine(l)} last={i === all.length - 1} />
                ))}
            </Group>
          )}
        </>
      ) : (
        <>
          <SearchInput value={q} onChange={setQ} placeholder="Xodim yoki filial" />
          {sheet === null ? (
            <Loading />
          ) : (
            <Group>
              {sheet
                .filter((r) => filter(`${r.name} ${r.employeeNo} ${r.branch}`))
                .map((r, i, all) => (
                  <Row
                    key={r.employeeId}
                    label={r.name}
                    sub={`${r.branch} · ${r.days} kun · reja ${hm(r.plannedMinutes)} · ishlagan ${hm(r.workedMinutes)}${r.lateMinutes ? ` · kechikish ${hm(r.lateMinutes)}` : ""}${r.overtimeMinutes ? ` · overtime ${hm(r.overtimeMinutes)}` : ""}${r.absentDays ? ` · kelmagan ${r.absentDays}` : ""}`}
                    last={i === all.length - 1}
                  />
                ))}
            </Group>
          )}
        </>
      )}
      {line ? (
        <Sheet visible title={line.name} subtitle={`${month} · ${line.days}/${line.expectedDays} kun`} onClose={() => setLine(null)}>
          <Group>
            <Row label="Qo‘lga" value={som(line.net)} />
            <Row label="Ushlanma" value={som(line.deductions)} />
            <Row label="Qo‘shimcha / bonus" value={som(line.plus)} />
            <Row label="Avans" value={som(line.advance)} last />
          </Group>
          {line.explanation ? <Text style={{ color: c.ink, lineHeight: 20 }}>{line.explanation}</Text> : null}
        </Sheet>
      ) : null}
    </>
  );
}

/* ================================================================ Ta’tillar === */
type LeaveRow = { id: string; type: string; startDate: string; endDate: string; reason?: string; status: string; employee?: { firstName: string; lastName: string } };
const LEAVE_STATUS: Record<string, [string, "warn" | "ok" | "bad" | "muted"]> = { PENDING: ["kutilmoqda", "warn"], APPROVED: ["tasdiqlangan", "ok"], REJECTED: ["rad etilgan", "bad"], CANCELLED: ["bekor", "muted"] };

function LeaveScreen({ role }: { role: Role }) {
  const { c } = useTheme();
  const [rows, setRows] = useState<LeaveRow[] | null>(null);
  const [tab, setTab] = useState<"NOW" | "PENDING" | "ALL">("NOW");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const today = tashkentIsoDate();
  const load = useCallback(() => {
    mcall<LeaveRow[]>("/leave")
      .then(setRows)
      .catch((e) => (setRows([]), oops(e)));
  }, []);
  useEffect(load, [load]);
  const list = (rows || []).filter((r) => (tab === "PENDING" ? r.status === "PENDING" : tab === "NOW" ? r.status === "APPROVED" && r.endDate >= today : true)).sort((a, b) => b.startDate.localeCompare(a.startDate));
  async function decide(r: LeaveRow, approve: boolean) {
    setBusy(r.id);
    try {
      await mcall(`/leave/${r.id}`, { status: approve ? "APPROVED" : "REJECTED" }, "PATCH");
      haptic.success();
      load();
    } catch (e) {
      oops(e);
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <Segmented<"NOW" | "PENDING" | "ALL"> value={tab} onChange={setTab} options={[["NOW", "Hozir va keyin"], ["PENDING", "Kutilmoqda"], ["ALL", "Hammasi"]]} />
      <Button title="Ta’til / yo‘qlik qo‘shish" icon="add" tone="soft" onPress={() => setAdding(true)} />
      {rows === null ? (
        <Loading />
      ) : !list.length ? (
        <Empty icon="airplane-outline" title="Ro‘yxat bo‘sh" />
      ) : (
        list.map((r) => (
          <Card key={r.id} style={{ gap: 8 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
              <Text style={{ color: c.ink, fontWeight: "600", fontSize: 16, flex: 1 }}>{r.employee ? fullName(r.employee) : "Xodim"}</Text>
              <Badge text={LEAVE_STATUS[r.status]?.[0] || r.status} tone={LEAVE_STATUS[r.status]?.[1] || "muted"} />
            </View>
            <Text style={{ color: c.muted }}>
              {LEAVE[r.type] || r.type} · {dmy(r.startDate)} – {dmy(r.endDate)}
            </Text>
            {r.reason ? <Text style={{ color: c.ink }}>«{r.reason}»</Text> : null}
            {r.status === "PENDING" && canWeb(role, "leave.approve") ? (
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Button title="Tasdiqlash" style={{ flex: 1 }} busy={busy === r.id} onPress={() => void decide(r, true)} />
                <Button title="Rad etish" tone="ghost" style={{ flex: 1 }} disabled={busy === r.id} onPress={() => void decide(r, false)} />
              </View>
            ) : null}
          </Card>
        ))
      )}
      {adding ? <LeaveAddSheet canApprove={canWeb(role, "leave.approve")} onClose={() => setAdding(false)} onSaved={() => (setAdding(false), load())} /> : null}
    </>
  );
}

function EmployeePicker({ value, onPick }: { value: Emp | null; onPick: (e: Emp | null) => void }) {
  const { c } = useTheme();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Emp[]>([]);
  useEffect(() => {
    if (value || q.trim().length < 2) return setRows([]);
    const timer = setTimeout(() => {
      mcall<{ items: Emp[] }>(`/employees?limit=8&q=${encodeURIComponent(q.trim())}`)
        .then((r) => setRows(r.items))
        .catch(() => setRows([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [q, value]);
  if (value)
    return (
      <Pressable onPress={() => onPick(null)} style={[st.input, st.choice, { borderColor: c.line, backgroundColor: c.card }]}>
        <Text style={{ color: c.ink, flex: 1, fontWeight: "600" }}>{fullName(value)}</Text>
        <Text style={{ color: c.accent }}>o‘zgartirish</Text>
      </Pressable>
    );
  return (
    <View style={{ gap: 6 }}>
      <Field label="Xodim" value={q} onChange={setQ} placeholder="Ismini yozing" />
      {rows.length ? (
        <View style={[st.options, { borderColor: c.line, backgroundColor: c.card }]}>
          {rows.map((e) => (
            <Pressable key={e.id} onPress={() => onPick(e)} style={[st.option, { borderBottomColor: c.line }]}>
              <Text style={{ color: c.ink }}>
                {fullName(e)} <Text style={{ color: c.muted }}>{e.employeeNo}</Text>
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function LeaveAddSheet({ canApprove, onClose, onSaved }: { canApprove: boolean; onClose: () => void; onSaved: () => void }) {
  const { c } = useTheme();
  const [employee, setEmployee] = useState<Emp | null>(null);
  const [type, setType] = useState("VACATION");
  const [startDate, setStart] = useState(tashkentIsoDate());
  const [endDate, setEnd] = useState(tashkentIsoDate());
  const [reason, setReason] = useState("");
  const [approve, setApprove] = useState(canApprove);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!employee) return Alert.alert("Xodimni tanlang");
    if (reason.trim().length < 3) return Alert.alert("Sababni yozing");
    setBusy(true);
    try {
      await mcall("/leave", { employeeId: employee.id, type, startDate, endDate, reason: reason.trim(), approve });
      haptic.success();
      onSaved();
    } catch (e) {
      oops(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet visible title="Ta’til / yo‘qlik" onClose={onClose}>
      <EmployeePicker value={employee} onPick={setEmployee} />
      <Choice label="Turi" value={type} options={Object.entries(LEAVE)} onChange={setType} />
      <Field label="Boshlanish (YYYY-MM-DD)" value={startDate} onChange={setStart} />
      <Field label="Tugash (YYYY-MM-DD)" value={endDate} onChange={setEnd} />
      <Field label="Sabab" value={reason} onChange={setReason} placeholder="Masalan: yillik ta’til" />
      {canApprove ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ color: c.ink }}>Darhol tasdiqlash</Text>
          <Switch value={approve} onValueChange={setApprove} />
        </View>
      ) : null}
      <Button title="Saqlash" onPress={() => void save()} busy={busy} disabled={!employee} />
    </Sheet>
  );
}

/* ================================================================ Arizalar === */
type Registration = { id: string; createdAt: string; positionName?: string; branchName?: string; answers: { id: string; label: string; value: string }[] };

function RegistrationsScreen({ role }: { role: Role }) {
  const { c } = useTheme();
  const [rows, setRows] = useState<Registration[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const load = useCallback(() => {
    mcall<{ items: Registration[] }>("/registrations?status=PENDING")
      .then((r) => setRows(r.items))
      .catch((e) => (setRows([]), oops(e)));
  }, []);
  useEffect(load, [load]);
  async function decide(r: Registration, approve: boolean) {
    if (approve && !(await confirm("Qabul qilish", "Nomzod xodim sifatida qabul qilinsinmi?", "Qabul qilish"))) return;
    setBusy(r.id);
    try {
      await mcall(`/registrations/${r.id}/${approve ? "approve" : "reject"}`, approve ? {} : { reason: reason.trim() || undefined });
      haptic.success();
      setRejecting(null);
      setReason("");
      load();
    } catch (e) {
      oops(e);
    } finally {
      setBusy(null);
    }
  }
  if (rows === null) return <Loading />;
  if (!rows.length) return <Empty icon="clipboard-outline" title="Yangi ariza yo‘q" />;
  const canDecide = canWeb(role, "registrations.approve");
  return (
    <>
      {rows.map((r) => (
        <Card key={r.id} style={{ gap: 8 }}>
          <Text style={{ color: c.ink, fontWeight: "600", fontSize: 16 }}>{r.answers.find((a) => /ism|f\.i\.sh|name/i.test(a.label))?.value || "Nomzod"}</Text>
          <Text style={{ color: c.muted }}>{[r.positionName, r.branchName, dmy(r.createdAt)].filter(Boolean).join(" · ")}</Text>
          {r.answers.map((a) => (
            <View key={a.id} style={{ flexDirection: "row", gap: 8 }}>
              <Text style={{ color: c.muted, flex: 0.9, fontSize: 13 }}>{a.label}</Text>
              <Text style={{ color: c.ink, flex: 1.1, fontSize: 13 }}>{a.value || "—"}</Text>
            </View>
          ))}
          {canDecide ? (
            rejecting === r.id ? (
              <>
                <Field label="Rad etish sababi (nomzodga yuboriladi)" value={reason} onChange={setReason} />
                <Button title="Rad etish" tone="danger" busy={busy === r.id} onPress={() => void decide(r, false)} />
              </>
            ) : (
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Button title="Qabul qilish" style={{ flex: 1 }} busy={busy === r.id} onPress={() => void decide(r, true)} />
                <Button title="Rad etish" tone="ghost" style={{ flex: 1 }} onPress={() => setRejecting(r.id)} />
              </View>
            )
          ) : null}
        </Card>
      ))}
    </>
  );
}

/* ================================================================ Grafiklar === */
type Day = { day: number; enabled: boolean; start: string; end: string; breakMinutes: number };
type Schedule = { id: string; name: string; type: string; graceMinutes: number; overtimeEnabled: boolean; days: Day[]; employees?: number };
const blankDays = (): Day[] => [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, enabled: day !== 0, start: "09:00", end: "18:00", breakMinutes: 60 }));
const overnight = (d: Day) => toMinutes(d.end) < toMinutes(d.start);

function SchedulesScreen({ role }: { role: Role }) {
  const [rows, setRows] = useState<Schedule[] | null>(null);
  const [open, setOpen] = useState<Schedule | "new" | null>(null);
  const load = useCallback(() => {
    mcall<Schedule[]>("/schedules")
      .then(setRows)
      .catch((e) => (setRows([]), oops(e)));
  }, []);
  useEffect(load, [load]);
  const editable = canWeb(role, "employees.edit");
  return (
    <>
      {editable ? <Button title="Yangi grafik" icon="add" tone="soft" onPress={() => setOpen("new")} /> : null}
      {rows === null ? (
        <Loading />
      ) : !rows.length ? (
        <Empty icon="time-outline" title="Grafik yo‘q" />
      ) : (
        <Group>
          {rows.map((s, i) => {
            const first = s.days.find((d) => d.enabled);
            return (
              <Row
                key={s.id}
                icon="time-outline"
                label={s.name}
                sub={`${first ? `${first.start}–${first.end}${overnight(first) ? " (ertasi kuni)" : ""}` : "—"} · haftada ${s.days.filter((d) => d.enabled).length} kun · ${s.employees ?? 0} xodim`}
                onPress={editable ? () => setOpen(s) : undefined}
                last={i === rows.length - 1}
              />
            );
          })}
        </Group>
      )}
      {open ? <ScheduleSheet schedule={open === "new" ? undefined : open} onClose={() => setOpen(null)} onSaved={() => (setOpen(null), load())} /> : null}
    </>
  );
}

function ScheduleSheet({ schedule, onClose, onSaved }: { schedule?: Schedule; onClose: () => void; onSaved: () => void }) {
  const { c } = useTheme();
  const [name, setName] = useState(schedule?.name || "");
  const [grace, setGrace] = useState(String(schedule?.graceMinutes ?? 10));
  const [days, setDays] = useState<Day[]>(() => blankDays().map((d) => schedule?.days.find((x) => x.day === d.day) || d));
  const [busy, setBusy] = useState(false);
  const update = (day: number, patch: Partial<Day>) => setDays((list) => list.map((d) => (d.day === day ? { ...d, ...patch } : d)));
  async function save() {
    if (name.trim().length < 2) return Alert.alert("Grafik nomini yozing");
    if (!days.some((d) => d.enabled)) return Alert.alert("Kamida bitta ish kunini yoqing");
    const bad = days.find((d) => d.enabled && (!isClock(d.start) || !isClock(d.end)));
    if (bad) return Alert.alert(`${WEEKDAY[bad.day]}: vaqtni HH:MM ko‘rinishida yozing`);
    const same = days.find((d) => d.enabled && d.start === d.end);
    if (same) return Alert.alert(`${WEEKDAY[same.day]}: boshlanish va tugash bir xil bo‘lmasin`);
    setBusy(true);
    try {
      const body = { name: name.trim(), type: schedule?.type || "FIXED", graceMinutes: Number(grace) || 0, overtimeEnabled: schedule?.overtimeEnabled ?? true, days };
      if (schedule) await mcall(`/schedules/${schedule.id}`, body, "PUT");
      else await mcall("/schedules", body);
      haptic.success();
      onSaved();
    } catch (e) {
      oops(e);
    } finally {
      setBusy(false);
    }
  }
  const copyFirst = () => {
    const first = days.find((d) => d.enabled);
    if (first) setDays((list) => list.map((d) => (d.enabled ? { ...d, start: first.start, end: first.end, breakMinutes: first.breakMinutes } : d)));
  };
  return (
    <Sheet visible title={schedule ? "Grafikni tahrirlash" : "Yangi grafik"} subtitle="Tugash boshlanishdan kichik bo‘lsa — smena ertasi kuni tugaydi (14:00 → 00:00)" onClose={onClose}>
      <Field label="Nomi" value={name} onChange={setName} placeholder="5/2 kunduzgi" />
      <Field label="Kechikish imtiyozi (daqiqa)" value={grace} onChange={(v) => setGrace(v.replace(/\D/g, ""))} keyboard="numeric" />
      <Pressable onPress={copyFirst}>
        <Text style={{ color: c.accent, fontWeight: "600" }}>Birinchi ish kuni vaqtini hammasiga qo‘llash</Text>
      </Pressable>
      {WEEK.map((day) => {
        const d = days.find((x) => x.day === day)!;
        const valid = isClock(d.start) && isClock(d.end) && d.start !== d.end;
        return (
          <View key={day} style={{ gap: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Switch value={d.enabled} onValueChange={(v) => update(day, { enabled: v })} />
              <Text style={{ color: c.ink, width: 92 }}>{WEEKDAY[day]}</Text>
              <TextInput value={d.start} editable={d.enabled} onChangeText={(v) => update(day, { start: v })} placeholder="09:00" placeholderTextColor={c.muted} maxLength={5} style={[st.input, st.time, { color: c.ink, borderColor: c.line, backgroundColor: c.card, opacity: d.enabled ? 1 : 0.45 }]} />
              <Text style={{ color: c.muted }}>→</Text>
              <TextInput value={d.end} editable={d.enabled} onChangeText={(v) => update(day, { end: v })} placeholder="18:00" placeholderTextColor={c.muted} maxLength={5} style={[st.input, st.time, { color: c.ink, borderColor: c.line, backgroundColor: c.card, opacity: d.enabled ? 1 : 0.45 }]} />
            </View>
            {d.enabled && valid ? (
              <Text style={{ color: overnight(d) ? c.accent : c.muted, fontSize: 12, marginLeft: 60, fontWeight: overnight(d) ? "600" : "400" }}>
                {overnight(d) ? "ertasi kuni · " : ""}
                {duration(forwardMinutes(d.start, d.end))}
              </Text>
            ) : null}
          </View>
        );
      })}
      <Button title="Saqlash" onPress={() => void save()} busy={busy} />
    </Sheet>
  );
}

/* ================================================================ Filiallar === */
type Branch = { id: string; name: string; address: string; latitude: number; longitude: number; radiusMeters: number; attendanceMode?: string; status: string; employees?: number; presentToday?: number };

function BranchesScreen({ role }: { role: Role }) {
  const [rows, setRows] = useState<Branch[] | null>(null);
  const [open, setOpen] = useState<Branch | "new" | null>(null);
  const load = useCallback(() => {
    mcall<Branch[]>("/branches")
      .then(setRows)
      .catch((e) => (setRows([]), oops(e)));
  }, []);
  useEffect(load, [load]);
  const editable = canWeb(role, "branches.edit");
  return (
    <>
      {canWeb(role, "branches.create") ? <Button title="Yangi filial" icon="add" tone="soft" onPress={() => setOpen("new")} /> : null}
      {rows === null ? (
        <Loading />
      ) : !rows.length ? (
        <Empty icon="business-outline" title="Filial yo‘q" />
      ) : (
        <Group>
          {rows.map((b, i) => (
            <Row
              key={b.id}
              icon="business-outline"
              label={`${b.name}${b.status === "INACTIVE" ? " (nofaol)" : ""}`}
              sub={`${b.address} · ${b.employees ?? 0} xodim · bugun ${b.presentToday ?? 0} keldi`}
              onPress={editable ? () => setOpen(b) : undefined}
              last={i === rows.length - 1}
            />
          ))}
        </Group>
      )}
      {open ? <BranchSheet branch={open === "new" ? undefined : open} onClose={() => setOpen(null)} onSaved={() => (setOpen(null), load())} /> : null}
    </>
  );
}

function BranchSheet({ branch, onClose, onSaved }: { branch?: Branch; onClose: () => void; onSaved: () => void }) {
  const { c } = useTheme();
  const [form, setForm] = useState({
    name: branch?.name || "",
    address: branch?.address || "",
    latitude: branch ? String(branch.latitude) : "",
    longitude: branch ? String(branch.longitude) : "",
    radiusMeters: String(branch?.radiusMeters ?? 100),
    attendanceMode: branch?.attendanceMode || "QR_GPS_FACE",
    status: branch?.status || "ACTIVE",
  });
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  async function locate() {
    setLocating(true);
    try {
      const fix = await currentFix();
      set({ latitude: fix.latitude.toFixed(6), longitude: fix.longitude.toFixed(6) });
      Alert.alert("Joylashuv olindi", `Aniqlik ±${Math.round(fix.accuracy)} m`);
    } catch (e) {
      oops(e);
    } finally {
      setLocating(false);
    }
  }
  async function save() {
    setBusy(true);
    try {
      const body = { name: form.name.trim(), address: form.address.trim(), latitude: Number(form.latitude), longitude: Number(form.longitude), radiusMeters: Number(form.radiusMeters), attendanceMode: form.attendanceMode, status: form.status };
      if (branch) await mcall(`/branches/${branch.id}`, body, "PUT");
      else await mcall("/branches", body);
      haptic.success();
      onSaved();
    } catch (e) {
      oops(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet visible title={branch ? branch.name : "Yangi filial"} onClose={onClose}>
      <Field label="Nomi" value={form.name} onChange={(v) => set({ name: v })} />
      <Field label="Manzil" value={form.address} onChange={(v) => set({ address: v })} />
      <Field label="Kenglik" value={form.latitude} onChange={(v) => set({ latitude: v })} keyboard="decimal-pad" />
      <Field label="Uzunlik" value={form.longitude} onChange={(v) => set({ longitude: v })} keyboard="decimal-pad" />
      <Button title="📍 Hozir turgan joyimni olish" tone="soft" busy={locating} onPress={() => void locate()} />
      <Field label="Ruxsat etilgan radius (metr)" value={form.radiusMeters} onChange={(v) => set({ radiusMeters: v.replace(/\D/g, "") })} keyboard="numeric" />
      <Choice
        label="Davomat usuli"
        value={form.attendanceMode}
        options={[
          ["QR_GPS_FACE", "QR + GPS + Face ID"],
          ["GPS_FACE", "GPS + Face ID (QR’siz)"],
        ]}
        onChange={(v) => set({ attendanceMode: v })}
      />
      {branch ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ color: c.ink }}>Faol</Text>
          <Switch value={form.status === "ACTIVE"} onValueChange={(v) => set({ status: v ? "ACTIVE" : "INACTIVE" })} />
        </View>
      ) : null}
      <Button title="Saqlash" onPress={() => void save()} busy={busy} />
    </Sheet>
  );
}

/* =================================================== Bo‘lim va lavozimlar === */
type Dept = { id: string; name: string; manager?: string };
type Pos = { id: string; name: string; departmentId: string; panelRole?: string; anyBranch?: boolean };
const PANEL_ROLE: [string, string][] = [
  ["", "Yo‘q — oddiy xodim"],
  ["HR_ADMIN", "HR"],
  ["FINANCE", "Moliya"],
  ["IT_ADMIN", "IT administrator"],
  ["BRANCH_MANAGER", "Filial rahbari"],
];

function OrgScreen({ role }: { role: Role }) {
  const [tab, setTab] = useState<"departments" | "positions">("departments");
  const [data, setData] = useState<{ departments: Dept[]; positions: Pos[] } | null>(null);
  const [open, setOpen] = useState<Dept | Pos | "new" | null>(null);
  const load = useCallback(() => {
    mcall<{ departments: Dept[]; positions: Pos[] }>("/meta")
      .then(setData)
      .catch((e) => (setData({ departments: [], positions: [] }), oops(e)));
  }, []);
  useEffect(load, [load]);
  const editable = canWeb(role, "employees.edit");
  const departments = data?.departments || [];
  const deptName = (id: string) => departments.find((d) => d.id === id)?.name || "—";
  const rows: (Dept | Pos)[] = tab === "departments" ? departments : data?.positions || [];
  return (
    <>
      <Segmented<"departments" | "positions">
        value={tab}
        onChange={setTab}
        options={[
          ["departments", "Bo‘limlar", departments.length],
          ["positions", "Lavozimlar", data?.positions.length ?? 0],
        ]}
      />
      {editable && (tab === "departments" || departments.length > 0) ? <Button title={tab === "departments" ? "Yangi bo‘lim" : "Yangi lavozim"} icon="add" tone="soft" onPress={() => setOpen("new")} /> : null}
      {data === null ? (
        <Loading />
      ) : !rows.length ? (
        <Empty icon="git-network-outline" title={tab === "departments" ? "Bo‘lim yo‘q" : departments.length ? "Lavozim yo‘q" : "Avval bo‘lim qo‘shing"} />
      ) : (
        <Group>
          {rows.map((row, i) => {
            const p = tab === "positions" ? (row as Pos) : null;
            const sub = p
              ? [deptName(p.departmentId), PANEL_ROLE.find(([k]) => k && k === p.panelRole)?.[1], p.anyBranch ? "istalgan filial" : ""].filter(Boolean).join(" · ")
              : (row as Dept).manager || "Rahbar ko‘rsatilmagan";
            return <Row key={row.id} icon="git-network-outline" label={row.name} sub={sub} onPress={editable ? () => setOpen(row) : undefined} last={i === rows.length - 1} />;
          })}
        </Group>
      )}
      {open && data ? <OrgSheet type={tab} row={open === "new" ? undefined : open} departments={departments} onClose={() => setOpen(null)} onSaved={() => (setOpen(null), load())} /> : null}
    </>
  );
}

function OrgSheet({ type, row, departments, onClose, onSaved }: { type: "departments" | "positions"; row?: Dept | Pos; departments: Dept[]; onClose: () => void; onSaved: () => void }) {
  const { c } = useTheme();
  const isDept = type === "departments";
  const [name, setName] = useState(row?.name || "");
  const [manager, setManager] = useState((row as Dept | undefined)?.manager || "");
  const [departmentId, setDepartmentId] = useState((row as Pos | undefined)?.departmentId || departments[0]?.id || "");
  const [panelRole, setPanelRole] = useState((row as Pos | undefined)?.panelRole === "HR_MANAGER" ? "HR_ADMIN" : (row as Pos | undefined)?.panelRole || "");
  const [anyBranch, setAnyBranch] = useState(Boolean((row as Pos | undefined)?.anyBranch));
  const [busy, setBusy] = useState(false);
  async function save() {
    if (name.trim().length < 2) return Alert.alert("Nomini kiriting");
    setBusy(true);
    try {
      // Lavozimning filial ro‘yxati saytda sozlanadi — bu yerda o‘zgarmaydi.
      const body = isDept ? { name: name.trim(), manager: manager.trim() } : { name: name.trim(), departmentId, panelRole, anyBranch };
      if (row) await mcall(`/${type}/${row.id}`, body, "PUT");
      else await mcall(`/${type}`, body);
      haptic.success();
      onSaved();
    } catch (e) {
      oops(e);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!row || !(await confirm("O‘chirish", `«${row.name}» o‘chiriladi.`, "O‘chirish", true))) return;
    setBusy(true);
    try {
      await mcall(`/${type}/${row.id}`, undefined, "DELETE");
      onSaved();
    } catch (e) {
      oops(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet visible title={row ? row.name : isDept ? "Yangi bo‘lim" : "Yangi lavozim"} onClose={onClose}>
      <Field label="Nomi" value={name} onChange={setName} />
      {isDept ? (
        <Field label="Rahbar" value={manager} onChange={setManager} />
      ) : (
        <>
          <Choice label="Bo‘lim" value={departmentId} options={departments.map((d) => [d.id, d.name])} onChange={setDepartmentId} />
          <Choice label="Panel huquqi" value={panelRole} options={PANEL_ROLE} onChange={setPanelRole} />
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <Text style={{ color: c.ink, flex: 1 }}>Istalgan filialdan keldi-ketdi qila oladi</Text>
            <Switch value={anyBranch} onValueChange={setAnyBranch} />
          </View>
        </>
      )}
      <Button title="Saqlash" onPress={() => void save()} busy={busy} />
      {row ? <Button title="O‘chirish" tone="ghost" disabled={busy} onPress={() => void remove()} /> : null}
    </Sheet>
  );
}

/* ================================================================ E’lonlar === */
type Announcement = { id: string; title: string; message: string; scheduledAt: string; createdBy?: string; ackRequired?: boolean; options?: string[]; report?: { staffora?: { recipients: number; delivered: number; acknowledged?: number; answers?: Record<string, number> } } };

function AnnouncementsScreen({ role }: { role: Role }) {
  const { c } = useTheme();
  const [rows, setRows] = useState<Announcement[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => {
    mcall<Announcement[]>("/announcements")
      .then(setRows)
      .catch((e) => (setRows([]), oops(e)));
  }, []);
  useEffect(load, [load]);
  const canCreate = canWeb(role, "announcements.create");
  async function remind(a: Announcement) {
    setBusy(a.id);
    try {
      await mcall(`/announcements/${a.id}/remind`, {});
      Alert.alert("O‘qimaganlarga eslatma yuborildi");
    } catch (e) {
      oops(e);
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      {canCreate ? <Button title="Yangi e’lon" icon="megaphone-outline" tone="soft" onPress={() => setAdding(true)} /> : null}
      {rows === null ? (
        <Loading />
      ) : !rows.length ? (
        <Empty icon="megaphone-outline" title="E’lon yo‘q" />
      ) : (
        rows.slice(0, 50).map((a) => {
          const r = a.report?.staffora;
          return (
            <Card key={a.id} style={{ gap: 6 }}>
              <Text style={{ color: c.ink, fontWeight: "600", fontSize: 16 }}>{a.title}</Text>
              <Text style={{ color: c.muted, fontSize: 12.5 }}>
                {dmy(a.scheduledAt)}
                {a.createdBy ? ` · ${a.createdBy}` : ""}
                {r ? ` · ${r.delivered}/${r.recipients} yetkazildi` : ""}
                {r && a.ackRequired ? ` · ${r.acknowledged || 0} tanishdi` : ""}
              </Text>
              <Text style={{ color: c.ink }}>{a.message}</Text>
              {a.options?.length && r?.answers ? <Text style={{ color: c.muted, fontSize: 12.5 }}>{a.options.map((o) => `${o}: ${r.answers?.[o] || 0}`).join(" · ")}</Text> : null}
              {a.ackRequired && r && (r.acknowledged || 0) < r.recipients && canCreate ? <Button title="O‘qimaganlarga eslatish" tone="soft" busy={busy === a.id} onPress={() => void remind(a)} /> : null}
            </Card>
          );
        })
      )}
      {adding ? <AnnounceSheet onClose={() => setAdding(false)} onSent={() => (setAdding(false), load())} /> : null}
    </>
  );
}

function AnnounceSheet({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const { c } = useTheme();
  const meta = useMeta();
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  async function send() {
    if (title.trim().length < 3 || message.trim().length < 3) return Alert.alert("Sarlavha va matnni yozing");
    setBusy(true);
    try {
      const result = await mcall<{ recipients: number; delivered: number }>("/quick-announce", { title: title.trim(), message: message.trim(), branchIds, ackRequired: ack || undefined });
      haptic.success();
      Alert.alert("Yuborildi", `${result.delivered}/${result.recipients} xodim`);
      onSent();
    } catch (e) {
      oops(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet visible title="Yangi e’lon" onClose={onClose}>
      <Field label="Sarlavha" value={title} onChange={setTitle} />
      <Field label="Matn" value={message} onChange={setMessage} multiline />
      {(meta?.branches.length || 0) > 1 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {[{ id: "", name: "Hammaga" }, ...meta!.branches].map((b) => {
            const on = b.id ? branchIds.includes(b.id) : !branchIds.length;
            return (
              <Pressable
                key={b.id || "all"}
                onPress={() => setBranchIds((list) => (!b.id ? [] : list.includes(b.id) ? list.filter((x) => x !== b.id) : [...list, b.id]))}
                style={[st.chip, { backgroundColor: on ? c.accent : c.card, borderColor: c.line }]}
              >
                <Text style={{ color: on ? "#fff" : c.ink, fontSize: 13 }}>{b.name}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ color: c.ink }}>«Tanishdim» tasdig‘ini so‘rash</Text>
        <Switch value={ack} onValueChange={setAck} />
      </View>
      <Button title="Yuborish" onPress={() => void send()} busy={busy} />
    </Sheet>
  );
}

/* ================================================================ Murojaatlar === */
type Ticket = { id: string; anonymous: boolean; category: string; subject: string; status: "OPEN" | "ANSWERED" | "CLOSED"; messages: { id: string; from: "EMPLOYEE" | "HR"; author?: string; text: string; at: string }[]; unreadHr: boolean; employeeName: string; branch?: string };
const TICKET_STATUS: Record<Ticket["status"], string> = { OPEN: "javob kutmoqda", ANSWERED: "javob berilgan", CLOSED: "yopilgan" };

function HelpdeskScreen() {
  const [data, setData] = useState<{ categories: Record<string, string>; items: Ticket[] } | null>(null);
  const [tab, setTab] = useState<"OPEN" | "ALL">("OPEN");
  const [open, setOpen] = useState<Ticket | null>(null);
  const load = useCallback(() => {
    mcall<{ categories: Record<string, string>; items: Ticket[] }>("/tickets")
      .then(setData)
      .catch((e) => (setData({ categories: {}, items: [] }), oops(e)));
  }, []);
  useEffect(load, [load]);
  const list = (data?.items || []).filter((t) => tab === "ALL" || t.status === "OPEN");
  return (
    <>
      <Segmented<"OPEN" | "ALL"> value={tab} onChange={setTab} options={[["OPEN", "Javob kutmoqda", data?.items.filter((t) => t.status === "OPEN").length], ["ALL", "Hammasi"]]} />
      {data === null ? (
        <Loading />
      ) : !list.length ? (
        <Empty icon="chatbubbles-outline" title="Murojaat yo‘q" />
      ) : (
        <Group>
          {list.map((t, i) => (
            <Row
              key={t.id}
              icon="chatbubble-ellipses-outline"
              label={`${t.unreadHr ? "● " : ""}${t.subject}`}
              sub={`${t.anonymous ? "Anonim" : t.employeeName}${t.branch ? ` · ${t.branch}` : ""} · ${data.categories[t.category] || t.category} · ${TICKET_STATUS[t.status]}`}
              onPress={() => setOpen(t)}
              last={i === list.length - 1}
            />
          ))}
        </Group>
      )}
      {open ? <TicketSheet ticket={open} onClose={() => setOpen(null)} onChanged={() => (setOpen(null), load())} /> : null}
    </>
  );
}

function TicketSheet({ ticket, onClose, onChanged }: { ticket: Ticket; onClose: () => void; onChanged: () => void }) {
  const { c } = useTheme();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (ticket.unreadHr) void mcall(`/tickets/${ticket.id}`, { read: true }, "PATCH").catch(() => undefined);
  }, [ticket]);
  async function reply(close: boolean) {
    setBusy(true);
    try {
      if (text.trim()) await mcall(`/tickets/${ticket.id}/messages`, { text: text.trim(), close });
      else await mcall(`/tickets/${ticket.id}`, { status: "CLOSED" }, "PATCH");
      haptic.success();
      onChanged();
    } catch (e) {
      oops(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet visible title={ticket.subject} subtitle={`${ticket.anonymous ? "Anonim" : ticket.employeeName} · ${TICKET_STATUS[ticket.status]}`} onClose={onClose}>
      {ticket.messages.map((m) => (
        <View key={m.id} style={[st.bubble, { alignSelf: m.from === "HR" ? "flex-end" : "flex-start", backgroundColor: m.from === "HR" ? `${c.accent}22` : c.tint }]}>
          <Text style={{ color: c.muted, fontSize: 11.5 }}>
            {m.from === "HR" ? m.author || "HR" : ticket.anonymous ? "Anonim" : ticket.employeeName} · {when(m.at)}
          </Text>
          <Text style={{ color: c.ink, fontSize: 15 }}>{m.text}</Text>
        </View>
      ))}
      {ticket.status !== "CLOSED" ? (
        <>
          <Field label="Javob" value={text} onChange={setText} multiline />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button title="Yuborish" style={{ flex: 1 }} disabled={!text.trim()} busy={busy} onPress={() => void reply(false)} />
            <Button title="Yopish" tone="ghost" style={{ flex: 1 }} disabled={busy} onPress={() => void reply(true)} />
          </View>
        </>
      ) : null}
    </Sheet>
  );
}

/* ================================================================ Hisobotlar === */
async function downloadPanelFile(path: string) {
  const { path: link } = await mcall<{ path: string }>("/file-link", { path });
  await Linking.openURL(SERVER_ORIGIN + link);
}

function ReportsScreen({ role }: { role: Role }) {
  const thisMonth = tashkentIsoDate().slice(0, 7);
  const [period, setPeriod] = useState(thisMonth);
  const [busy, setBusy] = useState<string | null>(null);
  const from = `${period}-01`;
  const last = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate();
  const to = period === thisMonth ? tashkentIsoDate() : `${period}-${String(last).padStart(2, "0")}`;
  const reports = useMemo(
    () =>
      [
        { key: "att", name: "Davomat", desc: "Har kun: kelish, ketish, kechikish, soat", path: `/reports/attendance.xlsx?from=${from}&to=${to}`, need: ["reports.view", "attendance.view"] },
        { key: "late", name: "Kechikishlar", desc: "Faqat kechikkan kunlar", path: `/reports/attendance.xlsx?from=${from}&to=${to}&type=late`, need: ["reports.view", "attendance.view"] },
        { key: "pay", name: "Ish haqi vedomosti", desc: "Ish kuni, ushlanma, qo‘lga", path: `/reports/payroll.xlsx?month=${period}`, need: ["payroll.view", "reports.view"] },
        { key: "t13", name: "T-13 tabel", desc: "Buxgalteriya uchun standart tabel", path: `/reports/t13.xlsx?month=${period}`, need: ["payroll.view", "reports.view", "employees.edit"] },
        { key: "bank", name: "Bank uchun ro‘yxat", desc: "F.I.Sh, karta, summa (CSV)", path: `/payroll/${period}/bank.csv`, need: ["payroll.edit"] },
        { key: "emp", name: "Xodimlar ro‘yxati", desc: "Filial, lavozim, grafik, Telegram", path: "/reports/employees.xlsx", need: ["reports.view", "employees.view"] },
      ].filter((r) => r.need.some((p) => canWeb(role, p))),
    [from, to, period, role],
  );
  async function download(key: string, path: string) {
    setBusy(key);
    try {
      await downloadPanelFile(path);
    } catch (e) {
      oops(e);
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <MonthStepper value={period} onChange={setPeriod} max={thisMonth} />
      <Group>
        {reports.map((r, i) => (
          <Row key={r.key} icon="document-text-outline" label={r.name} sub={busy === r.key ? "Tayyorlanmoqda…" : r.desc} onPress={() => void download(r.key, r.path)} last={i === reports.length - 1} />
        ))}
      </Group>
    </>
  );
}

/* ======================================================= Panel foydalanuvchilari === */
type User = { id: string; name: string; email: string; role: string; branchIds?: string[]; telegramId?: string };

function UsersScreen({ role }: { role: Role }) {
  const [rows, setRows] = useState<User[] | null>(null);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [open, setOpen] = useState<User | "new" | null>(null);
  const load = useCallback(() => {
    mcall<User[]>("/users")
      .then(setRows)
      .catch((e) => (setRows([]), oops(e)));
    mcall<{ id: string; name: string }[]>("/branches")
      .then(setBranches)
      .catch(() => setBranches([]));
  }, []);
  useEffect(load, [load]);
  const manage = role === "COMPANY_OWNER" || role === "HR_ADMIN" || role === "HR_MANAGER";
  return (
    <>
      {manage ? <Button title="Foydalanuvchi qo‘shish" icon="person-add-outline" tone="soft" onPress={() => setOpen("new")} /> : null}
      {rows === null ? (
        <Loading />
      ) : (
        <Group>
          {rows.map((u, i) => (
            <Row
              key={u.id}
              icon="person-circle-outline"
              label={u.name}
              sub={`${ROLE_LABEL[u.role] || u.role} · ${u.email}${u.role === "BRANCH_MANAGER" && u.branchIds?.length ? ` · ${u.branchIds.map((id) => branches.find((b) => b.id === id)?.name).filter(Boolean).join(", ")}` : ""}${u.telegramId ? " · Telegram ✓" : ""}`}
              onPress={manage && u.role !== "COMPANY_OWNER" ? () => setOpen(u) : undefined}
              last={i === rows.length - 1}
            />
          ))}
        </Group>
      )}
      {open ? <UserSheet user={open === "new" ? undefined : open} branches={branches} onClose={() => setOpen(null)} onSaved={() => (setOpen(null), load())} /> : null}
    </>
  );
}

function UserSheet({ user, branches, onClose, onSaved }: { user?: User; branches: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const { c } = useTheme();
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState(user?.role === "HR_MANAGER" ? "HR_ADMIN" : user?.role || "HR_ADMIN");
  const [branchIds, setBranchIds] = useState<string[]>(user?.branchIds || []);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      if (user) await mcall(`/users/${user.id}`, { name: name.trim(), role, branchIds }, "PUT");
      else await mcall("/users", { name: name.trim(), email: email.trim(), password, role, branchIds });
      haptic.success();
      onSaved();
    } catch (e) {
      oops(e);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!user || !(await confirm("Panel huquqini olib tashlash", `${user.name} panelga kira olmaydi.`, "O‘chirish", true))) return;
    setBusy(true);
    try {
      await mcall(`/users/${user.id}`, undefined, "DELETE");
      onSaved();
    } catch (e) {
      oops(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet visible title={user ? user.name : "Yangi foydalanuvchi"} onClose={onClose}>
      <Field label="Ism familiya" value={name} onChange={setName} />
      {!user ? (
        <>
          <Field label="Email (login)" value={email} onChange={setEmail} keyboard="email-address" />
          <Field label="Parol (kamida 10 belgi)" value={password} onChange={setPassword} secure />
        </>
      ) : null}
      <Choice label="Rol" value={role} options={["HR_ADMIN", "FINANCE", "IT_ADMIN", "BRANCH_MANAGER"].map((r) => [r, ROLE_LABEL[r]])} onChange={setRole} />
      {role === "BRANCH_MANAGER" ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {branches.map((b) => {
            const on = branchIds.includes(b.id);
            return (
              <Pressable key={b.id} onPress={() => setBranchIds((list) => (on ? list.filter((x) => x !== b.id) : [...list, b.id]))} style={[st.chip, { backgroundColor: on ? c.accent : c.card, borderColor: c.line }]}>
                <Text style={{ color: on ? "#fff" : c.ink, fontSize: 13 }}>{b.name}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <Button title="Saqlash" onPress={() => void save()} busy={busy} />
      {user ? <Button title="Panel huquqini olib tashlash" tone="ghost" disabled={busy} onPress={() => void remove()} /> : null}
    </Sheet>
  );
}

/* ================================================================ Audit === */
type Audit = { id: string; actor: string; action: string; createdAt: string };

function AuditScreen() {
  const [rows, setRows] = useState<Audit[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    mcall<Audit[]>("/audit")
      .then(setRows)
      .catch((e) => (setRows([]), oops(e)));
  }, []);
  const list = (rows || []).filter((r) => `${r.actor} ${r.action}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 150);
  return (
    <>
      <SearchInput value={q} onChange={setQ} placeholder="Kim yoki nima" />
      {rows === null ? (
        <Loading />
      ) : !list.length ? (
        <Empty icon="reader-outline" title="Yozuv yo‘q" />
      ) : (
        <Group>
          {list.map((r, i) => (
            <Row key={r.id} label={r.action} sub={`${r.actor} · ${when(r.createdAt)}`} last={i === list.length - 1} />
          ))}
        </Group>
      )}
    </>
  );
}

/* ======================================================== Davomatni tuzatish === */
type DayRow = { employee: { id: string; firstName: string; lastName: string }; record: { id: string; checkIn?: string; checkOut?: string; lateMinutes: number } | null; state: string; branch?: string; scheduledStart?: string; scheduledEnd?: string };
const STATE: Record<string, string> = { IN: "ishda", LEFT: "ketgan", ABSENT: "kelmagan", NOT_YET: "hali kelmagan", ON_LEAVE: "ta’tilda", DAY_OFF: "dam olish", UPCOMING: "boshlanmagan", PRACTICE: "mashq davri" };
const shiftDay = (iso: string, delta: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);

/** Saytdagi «Keldi-ketdi → qo‘lda kiritish/tahrirlash» — istalgan o‘tgan kun (sabab auditga yoziladi). */
function AttendanceFixScreen() {
  const { c } = useTheme();
  const today = tashkentIsoDate();
  const [date, setDate] = useState(today);
  const [rows, setRows] = useState<DayRow[] | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<DayRow | null>(null);
  const load = useCallback(() => {
    setRows(null);
    mcall<{ rows: DayRow[] }>(`/attendance/day?date=${date}`)
      .then((r) => setRows(r.rows))
      .catch((e) => (setRows([]), oops(e)));
  }, [date]);
  useEffect(load, [load]);
  const list = (rows || []).filter((r) => r.state !== "UPCOMING" && fullName(r.employee).toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <View style={[st.month, { backgroundColor: c.card }]}>
        <Pressable hitSlop={10} onPress={() => setDate(shiftDay(date, -1))}>
          <Icon name="chevron-back" size={20} color={c.accent} />
        </Pressable>
        <Text style={{ color: c.ink, fontWeight: "600", fontSize: 16 }}>{date === today ? "Bugun" : dmy(date)}</Text>
        <Pressable hitSlop={10} disabled={date >= today} onPress={() => setDate(shiftDay(date, 1))}>
          <Icon name="chevron-forward" size={20} color={date >= today ? c.line : c.accent} />
        </Pressable>
      </View>
      <SearchInput value={q} onChange={setQ} placeholder="Xodim" />
      {rows === null ? (
        <Loading />
      ) : !list.length ? (
        <Empty icon="time-outline" title="Bu kunda xodim yo‘q" />
      ) : (
        <Group>
          {list.map((r, i) => (
            <Row
              key={r.employee.id}
              label={fullName(r.employee)}
              sub={`${r.record?.checkIn ? `${r.record.checkIn} → ${r.record.checkOut || "…"}` : STATE[r.state] || r.state}${r.record?.lateMinutes ? ` · ${duration(r.record.lateMinutes)} kech` : ""}${r.branch ? ` · ${r.branch}` : ""}`}
              onPress={() => setOpen(r)}
              last={i === list.length - 1}
            />
          ))}
        </Group>
      )}
      {open ? <AttendanceFixSheet date={date} row={open} onClose={() => setOpen(null)} onSaved={() => (setOpen(null), load())} /> : null}
    </>
  );
}

function AttendanceFixSheet({ date, row, onClose, onSaved }: { date: string; row: DayRow; onClose: () => void; onSaved: () => void }) {
  const { c } = useTheme();
  const [checkIn, setCheckIn] = useState(row.record?.checkIn || row.scheduledStart || "09:00");
  const [checkOut, setCheckOut] = useState(row.record?.checkOut || "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = isClock(checkIn) && (!checkOut || isClock(checkOut));
  const nextDay = valid && Boolean(checkOut) && toMinutes(checkOut) < toMinutes(checkIn);
  async function save() {
    if (!valid) return Alert.alert("Vaqtni HH:MM ko‘rinishida yozing");
    if (note.trim().length < 3) return Alert.alert("Sababni yozing — auditga tushadi");
    setBusy(true);
    try {
      const body = { checkIn, checkOut: checkOut || "", note: `Qo‘lda (ilova): ${note.trim()}` };
      if (row.record?.id) await mcall(`/attendance/${row.record.id}`, body, "PUT");
      else await mcall("/attendance", { ...body, employeeId: row.employee.id, date });
      haptic.success();
      onSaved();
    } catch (e) {
      oops(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet visible title={fullName(row.employee)} subtitle={`${dmy(date)}${row.scheduledStart ? ` · grafik ${row.scheduledStart}–${row.scheduledEnd}` : ""}`} onClose={onClose}>
      <Field label="Keldi (HH:MM)" value={checkIn} onChange={setCheckIn} placeholder="09:00" />
      <Field label="Ketdi (ixtiyoriy, HH:MM)" value={checkOut} onChange={setCheckOut} placeholder="18:00" />
      {nextDay ? <Text style={{ color: c.accent, fontSize: 12.5 }}>Ketish ertasi kuni · {duration(forwardMinutes(checkIn, checkOut))} ishlagan</Text> : null}
      <Field label="Sabab (auditga yoziladi)" value={note} onChange={setNote} placeholder="Masalan: telefoni buzilgan edi" />
      <Button title="Saqlash" onPress={() => void save()} busy={busy} disabled={note.trim().length < 3} />
    </Sheet>
  );
}

/** «‹ Boshqaruv» qatori (ichki bo‘limdan menyuga qaytish). */
export function AdminBack({ title, onBack }: { title: string; onBack: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onBack} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6 }} hitSlop={8}>
      <Icon name="chevron-back" size={20} color={c.accent} />
      <Text style={{ color: c.accent, fontSize: 15 }}>Boshqaruv</Text>
      <Text style={{ color: c.ink, fontSize: 17, fontWeight: "700", marginLeft: 6 }} numberOfLines={1}>
        {title}
      </Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15.5 },
  choice: { flexDirection: "row", alignItems: "center", gap: 8 },
  options: { borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  option: { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  search: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderRadius: 12, minHeight: 44 },
  month: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12 },
  time: { width: 76, paddingHorizontal: 8, paddingVertical: 8, textAlign: "center" },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, borderWidth: StyleSheet.hairlineWidth },
  bubble: { maxWidth: "88%", padding: 10, borderRadius: 14, gap: 2 },
});
