import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlarmClock,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock3,
  Download,
  Filter,
  LogIn,
  LogOut,
  Plane,
  Search,
  UserCheck,
  UserPlus,
  Users,
  UserX,
  X,
  type LucideIcon,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from "recharts";
import { api, errorText } from "../api";
import { useApi, usePolling } from "../hooks";
import { useAuth } from "../auth";
import { Avatar, Empty, ErrorBox, Segmented, useToast } from "../components/ui";
import type { Notification } from "@/lib/types";
import { canOpenPage } from "@/lib/permissions";
import { dateLongUz, dateUz, duration, tashkentIsoDate, weekdayShortUz } from "@/lib/format";
import { addDays, leaveTypeLabel, type RosterRow, type RosterStats } from "../types";
import { SetupChecklist, type SetupData } from "../components/SetupChecklist";

type Dashboard = {
  date?: string;
  stats: RosterStats;
  roster: RosterRow[];
  weekly: { date: string; present: number; late: number; absent: number; rate: number | null }[];
  setup: SetupData["setup"];
  bot: SetupData["bot"];
  notifications: Notification[];
  leave: number;
};
type InboxItem = {
  kind: string;
  id: string;
  label: string;
  title: string;
  sub: string;
  detail?: string;
  urgent: boolean;
  employeeId?: string;
  photoDataUrl?: string;
  createdAt: string;
  decide: { method: "POST" | "PATCH"; path: string; rejectPath?: string; approve: Record<string, unknown>; reject: Record<string, unknown> };
};
type LeaveRow = {
  id: string;
  employeeId: string;
  type: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  createdAt: string;
  decidedBy?: string;
  employee?: { firstName: string; lastName: string; photoDataUrl?: string };
};
type Days = "7" | "14" | "30";
type Tone = "red" | "amber" | "green" | "blue" | "violet" | "gray";

/*
 * Holatlar bir-birini takrorlamaydi (TimePay24 tartibi): har bir faol xodim bugun bitta guruhda —
 * «Ishda» (vaqtida kelgan), «Kech» (kechikib kelgan) yoki «Ishda emas» (kelmagan, ta’til, dam olish,
 * smenasi hali boshlanmagan). Uchalasining yig‘indisi «Barchasi»ga teng.
 * Davomat % = kelganlar / (kelganlar + kelmaganlar): smenasi boshlanmaganlar hisobga kirmaydi.
 */
const rateOf = (came: number, absent: number) => (came + absent ? (came / (came + absent)) * 100 : null);
const num = (n: number) => n.toLocaleString("ru-RU").replace(/[  ]/g, " ");
const pct = (n: number, digits = 0) => `${n.toFixed(digits).replace(".", ",")}%`;
const rateTone = (rate: number | null): Tone => (rate === null ? "gray" : rate >= 90 ? "green" : rate >= 70 ? "amber" : "red");
const hm = (minutes?: number) => {
  const total = Math.max(0, Math.round(minutes || 0));
  return total ? `${Math.floor(total / 60)} soat ${String(total % 60).padStart(2, "0")} daq` : "—";
};

export function DashboardPage() {
  const { user } = useAuth();
  const today = useMemo(() => tashkentIsoDate(), []);
  const [date, setDate] = useState(today);
  const [days, setDays] = useState<Days>("7");
  const [branch, setBranch] = useState("ALL");
  const isToday = date === today;
  const { data, loading, error, reload } = useApi<Dashboard>(`/dashboard?days=${days}${isToday ? "" : `&date=${date}`}`);
  const allowed = (path: string) => (user ? canOpenPage(user.role, path, user.modules) : false);
  const inbox = useApi<InboxItem[]>("/workspace/inbox");
  const leaves = useApi<LeaveRow[]>(allowed("/leave") ? "/leave" : null);
  usePolling(() => {
    if (isToday) void reload(true);
    void inbox.reload(true);
  }, 30_000);

  const branches = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of data?.roster || []) map.set(row.branchId || "none", row.branch || "Filialsiz");
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], "uz"));
  }, [data]);
  const roster = useMemo(() => (data?.roster || []).filter((row) => branch === "ALL" || (row.branchId || "none") === branch), [data, branch]);

  if (!data) return <div className="page tp-page">{error ? <ErrorBox message={error} /> : <DashSkeleton />}</div>;

  const s = branch === "ALL" ? data.stats : statsOf(roster);
  const onTime = Math.max(0, s.present - s.late);
  const away = Math.max(0, s.total - s.present);
  const rate = rateOf(s.present, s.absent);
  const monthStart = `${date.slice(0, 7)}-01`;

  return (
    <div className={`page tp-page ${loading ? "is-refreshing" : ""}`}>
      <header className="tp-head">
        <div>
          <h1>Boshqaruv paneli</h1>
          <p>{isToday ? `Bugun, ${dateLongUz(date, true)}` : `${dateLongUz(date, true)} holatiga ko‘ra`}</p>
        </div>
        <div className="tp-head-actions">
          <DatePick value={date} max={today} onChange={setDate} />
          <BranchFilter value={branch} options={branches} onChange={setBranch} />
          {allowed("/reports") && (
            <a className="btn" href={`/api/reports/attendance.xlsx?from=${monthStart}&to=${date}`} download>
              <Download size={15} /> Hisobot
            </a>
          )}
          {allowed("/employees/new") && (
            <Link className="btn btn-primary" to="/employees/new">
              <UserPlus size={15} /> Xodim qo‘shish
            </Link>
          )}
        </div>
      </header>
      {error && <ErrorBox message={error} />}

      <section className="tp-stats" aria-label="Bugungi holat">
        <StatTile
          tone="blue"
          icon={Users}
          label="Barchasi"
          value={s.total}
          note={`${num(s.total - s.dayOff - s.leave)} nafari bugun rejada`}
          to={allowed("/employees") ? "/employees" : undefined}
          share={s.total ? (s.total - s.dayOff - s.leave) / s.total : 0}
        />
        <StatTile
          tone="green"
          icon={UserCheck}
          label="Ishda"
          value={onTime}
          note={rate === null ? "Davomat hali yo‘q" : `Davomat ${pct(rate)} · hozir ${num(s.inNow)} kishi`}
          to={isToday ? "/attendance?state=IN" : undefined}
          share={s.total ? onTime / s.total : 0}
        />
        <StatTile
          tone="amber"
          icon={AlarmClock}
          label="Kech"
          value={s.late}
          note={s.present ? `Kelganlarning ${pct((s.late / s.present) * 100)}` : "Kechikish yo‘q"}
          to={isToday ? "/attendance?state=LATE" : undefined}
          share={s.present ? s.late / s.present : 0}
        />
        <StatTile
          tone="red"
          icon={UserX}
          label="Ishda emas"
          share={s.total ? away / s.total : 0}
          value={away}
          note={[s.absent && `kelmagan ${s.absent}`, s.leave && `ta’til ${s.leave}`, s.dayOff && `dam ${s.dayOff}`, s.notYet && `kutilmoqda ${s.notYet}`].filter(Boolean).join(" · ") || "Hamma joyida"}
          to={isToday ? "/attendance?state=ABSENT" : undefined}
        />
      </section>

      <SetupChecklist data={data} />

      <RequestsCard items={inbox.data} leaves={leaves.data} loading={inbox.loading} more={allowed("/inbox")} onChanged={() => void Promise.all([inbox.reload(true), leaves.reload(true), reload(true)])} />

      <AttendanceTable roster={roster} isToday={isToday} />

      <div className="tp-grid-2">
        <BranchStats roster={data.roster} more={allowed("/branches") ? "/branches" : null} />
        <ActivityFeed roster={data.roster} date={data.date || date} notifications={data.notifications} more={allowed("/notifications")} />
      </div>

      <WorkTimeStats weekly={data.weekly} days={days} onDays={setDays} roster={roster} />
    </div>
  );
}

function statsOf(rows: RosterRow[]): RosterStats {
  const s: RosterStats = { total: rows.length, present: 0, inNow: 0, left: 0, late: 0, absent: 0, leave: 0, dayOff: 0, notYet: 0 };
  for (const row of rows) {
    if (row.state === "IN") {
      s.present += 1;
      s.inNow += 1;
    } else if (row.state === "LEFT") {
      s.present += 1;
      s.left += 1;
    } else if (row.state === "ABSENT") s.absent += 1;
    else if (row.state === "ON_LEAVE") s.leave += 1;
    else if (row.state === "DAY_OFF") s.dayOff += 1;
    else s.notYet += 1;
    if (row.late && (row.state === "IN" || row.state === "LEFT")) s.late += 1;
  }
  return s;
}

/* ---------------------------------------------------------- sana tanlash --- */
function DatePick({ value, max, onChange }: { value: string; max: string; onChange: (date: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const min = addDays(max, -366);
  const open = () => {
    const el = input.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
    }
  };
  return (
    <div className="db-date tp-date" role="group" aria-label="Sana">
      <button type="button" className="db-date-step" aria-label="Oldingi kun" disabled={value <= min} onClick={() => onChange(addDays(value, -1))}>
        <ChevronLeft size={15} />
      </button>
      <button type="button" className="db-date-btn" onClick={open} aria-label={`Sana: ${dateLongUz(value)}. O‘zgartirish`}>
        <CalendarDays size={14} />
        <span>{dateUz(value)}</span>
        {value === max && <em>Bugun</em>}
      </button>
      <input
        ref={input}
        type="date"
        className="db-date-input"
        value={value}
        min={min}
        max={max}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => e.target.value && onChange(e.target.value > max ? max : e.target.value)}
      />
      <button type="button" className="db-date-step" aria-label="Keyingi kun" disabled={value >= max} onClick={() => onChange(addDays(value, 1))}>
        <ChevronRight size={15} />
      </button>
    </div>
  );
}

function BranchFilter({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (value: string) => void }) {
  if (options.length < 2) return null;
  return (
    <label className={`tp-filter-btn ${value !== "ALL" ? "on" : ""}`}>
      <Filter size={14} aria-hidden />
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Filial bo‘yicha filtr">
        <option value="ALL">Barcha filiallar</option>
        {options.map(([key, name]) => (
          <option key={key} value={key}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ------------------------------------------------------------ statistika --- */
function StatTile({ tone, icon: Icon, label, value, note, to, share }: { tone: Tone; icon: LucideIcon; label: string; value: number; note: string; to?: string; share?: number }) {
  const width = share === undefined || !Number.isFinite(share) ? null : Math.max(0, Math.min(1, share)) * 100;
  const body = (
    <>
      <span className="tp-stat-icon" aria-hidden>
        <Icon size={18} strokeWidth={1.9} />
      </span>
      <span className="tp-stat-text">
        <small>{label}</small>
        <strong>{num(value)}</strong>
        <em>{note}</em>
      </span>
      {/* Umumiy xodimlar ichidagi ulush — bir qarashda solishtirish uchun. */}
      {width !== null && (
        <span className="tp-stat-bar" aria-hidden>
          <i style={{ width: `${width}%` }} />
        </span>
      )}
    </>
  );
  return to ? (
    <Link to={to} className={`tp-stat ${tone}`}>
      {body}
    </Link>
  ) : (
    <div className={`tp-stat ${tone}`}>{body}</div>
  );
}

/* --------------------------------------------------------------- arizalar --- */
type RequestFilter = "ALL" | "PENDING" | "DONE";
const REQUEST_STATUS: Record<string, [string, Tone]> = {
  PENDING: ["Tasdiqlanmagan", "amber"],
  APPROVED: ["Tasdiqlangan", "green"],
  REJECTED: ["Rad etilgan", "red"],
  CANCELLED: ["Bekor qilingan", "gray"],
};

function RequestsCard({ items, leaves, loading, more, onChanged }: { items: InboxItem[] | null; leaves: LeaveRow[] | null; loading: boolean; more: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [filter, setFilter] = useState<RequestFilter>("ALL");
  const [busy, setBusy] = useState("");
  // Kutilayotganlar (amal tugmalari bilan) + so‘nggi 14 kunda ko‘rib chiqilgan ta’til arizalari.
  const rows = useMemo(() => {
    const pending = (items || []).map((item) => ({
      id: `${item.kind}:${item.id}`,
      name: item.title,
      photo: item.photoDataUrl,
      type: item.label,
      date: item.createdAt,
      reason: [item.sub, item.detail].filter(Boolean).join(" · "),
      status: "PENDING" as string,
      urgent: item.urgent,
      item: item as InboxItem | undefined,
    }));
    const since = addDays(tashkentIsoDate(), -14);
    const done = (leaves || [])
      .filter((l) => l.status !== "PENDING" && l.createdAt.slice(0, 10) >= since)
      .slice(0, 8)
      .map((l) => ({
        id: `leave-done:${l.id}`,
        name: l.employee ? `${l.employee.firstName} ${l.employee.lastName}` : "Xodim",
        photo: l.employee?.photoDataUrl,
        type: leaveTypeLabel[l.type] || "Ta’til",
        date: l.createdAt,
        reason: `${dateUz(l.startDate)} – ${dateUz(l.endDate)}${l.reason ? ` · ${l.reason}` : ""}`,
        status: l.status as string,
        urgent: false,
        item: undefined as InboxItem | undefined,
      }));
    return [...pending, ...done];
  }, [items, leaves]);
  const shown = rows.filter((r) => filter === "ALL" || (filter === "PENDING" ? r.status === "PENDING" : r.status !== "PENDING")).slice(0, 6);
  const pendingCount = rows.filter((r) => r.status === "PENDING").length;

  async function decide(item: InboxItem, approve: boolean) {
    setBusy(item.id);
    try {
      const body = approve ? item.decide.approve : item.decide.reject;
      await api(!approve && item.decide.rejectPath ? item.decide.rejectPath : item.decide.path, { method: item.decide.method, body: JSON.stringify(body) });
      toast(approve ? "Ariza tasdiqlandi" : "Ariza rad etildi");
      window.dispatchEvent(new Event("staffora:leave"));
      onChanged();
    } catch (reason) {
      toast(errorText(reason), "error");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="tp-card">
      <div className="tp-card-head">
        <div className="tp-title">
          <h2>Arizalar</h2>
          {pendingCount > 0 && <span className="tp-pill amber">{pendingCount} ta kutilmoqda</span>}
        </div>
        <div className="tp-card-tools">
          <Segmented<RequestFilter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: "ALL", label: "Barchasi" },
              { value: "PENDING", label: "Kutilmoqda", count: pendingCount },
              { value: "DONE", label: "Ko‘rib chiqilgan" },
            ]}
          />
          {more && (
            <Link to="/inbox" className="tp-link">
              Barchasi <ChevronRight size={14} />
            </Link>
          )}
        </div>
      </div>
      {loading && !items ? (
        <div className="tp-sk-rows">
          {[0, 1, 2].map((i) => (
            <span key={i} className="db-sk db-sk-row" />
          ))}
        </div>
      ) : !shown.length ? (
        <div className="tp-clear">
          <CheckCircle2 size={18} aria-hidden />
          <span>
            <b>{filter === "DONE" ? "Ko‘rib chiqilgan ariza yo‘q" : "Kutilayotgan ariza yo‘q"}</b>
            <small>Ta’til, belgilash, smena va avans so‘rovlari shu yerda paydo bo‘ladi.</small>
          </span>
        </div>
      ) : (
        <div className="table-wrap tp-table-wrap">
          <table className="tp-table tp-cards tp-req">
            <thead>
              <tr>
                <th>Kim tomonidan</th>
                <th>Ariza turi</th>
                <th>Sana</th>
                <th>Sababi</th>
                <th>Status</th>
                <th className="right">Amallar</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const [label, tone] = REQUEST_STATUS[r.status] || ["—", "gray"];
                const [first, ...rest] = r.name.split(" ");
                const item = r.item;
                return (
                  <tr key={r.id}>
                    <td className="c-person">
                      <span className="tp-person">
                        <Avatar first={first} last={rest.join(" ")} photo={r.photo} size="sm" />
                        <b>{r.name}</b>
                      </span>
                    </td>
                    <td className="c-type">
                      <span className="tp-type">
                        <ClipboardList size={13} aria-hidden /> {r.type}
                      </span>
                    </td>
                    <td className="c-date tp-muted nowrap">{dateUz(r.date)}</td>
                    <td className="c-reason tp-reason" title={r.reason}>
                      {r.reason || "—"}
                    </td>
                    <td className="c-status">
                      <span className={`tp-badge ${tone}`}>
                        {label}
                        {r.urgent ? " · shoshilinch" : ""}
                      </span>
                    </td>
                    <td className="c-actions right">
                      {item ? (
                        <span className="tp-row-actions">
                          <button type="button" className="tp-act ok" disabled={busy === item.id} title="Tasdiqlash" aria-label={`${r.name}: tasdiqlash`} onClick={() => void decide(item, true)}>
                            <Check size={15} />
                          </button>
                          <button type="button" className="tp-act no" disabled={busy === item.id} title="Rad etish" aria-label={`${r.name}: rad etish`} onClick={() => void decide(item, false)}>
                            <X size={15} />
                          </button>
                        </span>
                      ) : (
                        <span className="tp-muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* --------------------------------------------------------- davomat jadvali --- */
type StateFilter = "ALL" | "IN" | "LATE" | "LEFT" | "ABSENT" | "ON_LEAVE" | "DAY_OFF" | "WAIT";
type SortKey = "name" | "in" | "out" | "worked";
const VERIFY_LABEL: Record<string, string> = { FACE: "Face ID", GPS: "GPS", QR: "QR kod", TELEGRAM: "Telegram", DEVICE: "Qurilma", MANUAL: "Qo‘lda" };
const PAGE = 10;

function stateBadge(row: RosterRow): [string, Tone, boolean?] {
  const state = row.state as string;
  if (state === "IN") return row.late ? ["Kechikkan", "amber", true] : ["Ishda", "green", true];
  if (state === "LEFT") return row.late ? ["Ketdi · kech", "blue"] : ["Ketdi", "blue"];
  if (state === "ABSENT") return ["Kelmagan", "red"];
  if (state === "ON_LEAVE") return [row.leaveType ? leaveTypeLabel[row.leaveType] || "Ta’tilda" : "Ta’tilda", "violet"];
  if (state === "DAY_OFF") return ["Dam olishda", "gray"];
  if (state === "PRACTICE") return ["Mashq davri", "amber"];
  return ["Kutilmoqda", "gray"];
}
const minutesOf = (time?: string) => (time ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) : -1);

function AttendanceTable({ roster, isToday }: { roster: RosterRow[]; isToday: boolean }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [state, setState] = useState<StateFilter>("ALL");
  const [department, setDepartment] = useState("ALL");
  const [schedule, setSchedule] = useState("ALL");
  const [device, setDevice] = useState("ALL");
  const [lateOnly, setLateOnly] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "in", dir: 1 });
  const [page, setPage] = useState(0);
  const options = useMemo(() => {
    const uniq = (values: (string | undefined)[]) => [...new Set(values.filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "uz"));
    return {
      departments: uniq(roster.map((r) => r.department)),
      schedules: uniq(roster.map((r) => r.schedule)),
      devices: uniq(roster.flatMap((r) => r.record?.verification || [])),
    };
  }, [roster]);
  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("uz");
    const list = roster.filter((r) => {
      if (q && !`${r.employee.firstName} ${r.employee.lastName} ${r.employee.employeeNo} ${r.position || ""}`.toLocaleLowerCase("uz").includes(q)) return false;
      if (department !== "ALL" && r.department !== department) return false;
      if (schedule !== "ALL" && r.schedule !== schedule) return false;
      if (device !== "ALL" && !(r.record?.verification || []).some((v) => v === device)) return false;
      if (lateOnly && !r.late) return false;
      if (state === "ALL") return true;
      if (state === "LATE") return r.late && (r.state === "IN" || r.state === "LEFT");
      if (state === "WAIT") return r.state !== "IN" && r.state !== "LEFT" && r.state !== "ABSENT" && r.state !== "ON_LEAVE" && r.state !== "DAY_OFF";
      return r.state === state;
    });
    const value = (r: RosterRow) => (sort.key === "in" ? minutesOf(r.record?.checkIn) : sort.key === "out" ? minutesOf(r.record?.checkOut) : sort.key === "worked" ? r.record?.workedMinutes || 0 : 0);
    return list.sort((a, b) => {
      if (sort.key === "name") return `${a.employee.firstName} ${a.employee.lastName}`.localeCompare(`${b.employee.firstName} ${b.employee.lastName}`, "uz") * sort.dir;
      const av = value(a);
      const bv = value(b);
      // Belgisi yo‘q xodimlar har doim oxirida.
      if (av < 0 && bv >= 0) return 1;
      if (bv < 0 && av >= 0) return -1;
      return (av - bv) * sort.dir;
    });
  }, [roster, query, state, department, schedule, device, lateOnly, sort]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pages - 1);
  const shown = rows.slice(current * PAGE, current * PAGE + PAGE);
  const reset = () => setPage(0);
  const toggleSort = (key: SortKey) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "worked" ? -1 : 1 }));
    reset();
  };
  const head = (key: SortKey, label: string) => {
    const active = sort.key === key;
    const Icon = !active ? ArrowUpDown : sort.dir === 1 ? ArrowUp : ArrowDown;
    return (
      <th aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
        <button type="button" className={`tp-sort ${active ? "on" : ""}`} onClick={() => toggleSort(key)}>
          {label}
          <Icon size={12} aria-hidden />
        </button>
      </th>
    );
  };
  const filtered = Boolean(query) || state !== "ALL" || department !== "ALL" || schedule !== "ALL" || device !== "ALL" || lateOnly;
  const clear = () => {
    setQuery("");
    setState("ALL");
    setDepartment("ALL");
    setSchedule("ALL");
    setDevice("ALL");
    setLateOnly(false);
    reset();
  };

  return (
    <section className="tp-card tp-attendance">
      <div className="tp-card-head">
        <div className="tp-title">
          <h2>Davomat</h2>
          <span className="tp-muted">
            {isToday ? "bugungi kirish-chiqishlar" : "tanlangan kun"} · {num(rows.length)} xodim
          </span>
        </div>
        <Link to="/attendance" className="tp-link">
          To‘liq davomat <ChevronRight size={14} />
        </Link>
      </div>
      <div className="tp-filters" role="search">
        <label className="tp-search">
          <Search size={14} aria-hidden />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              reset();
            }}
            placeholder="Barcha xodimlar — ism yoki ID"
            aria-label="Xodim qidirish"
          />
        </label>
        <Select
          label="Holat"
          value={state}
          onChange={(v) => {
            setState(v as StateFilter);
            reset();
          }}
        >
          <option value="ALL">Barcha holatlar</option>
          <option value="IN">Ishda</option>
          <option value="LATE">Kechikkan</option>
          <option value="LEFT">Ketgan</option>
          <option value="ABSENT">Kelmagan</option>
          <option value="ON_LEAVE">Ta’tilda</option>
          <option value="DAY_OFF">Dam olishda</option>
          <option value="WAIT">Kutilmoqda</option>
        </Select>
        {options.departments.length > 0 && (
          <Select
            label="Bo‘lim"
            value={department}
            onChange={(v) => {
              setDepartment(v);
              reset();
            }}
          >
            <option value="ALL">Barcha bo‘limlar</option>
            {options.departments.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </Select>
        )}
        {options.schedules.length > 0 && (
          <Select
            label="Smena turi"
            value={schedule}
            onChange={(v) => {
              setSchedule(v);
              reset();
            }}
          >
            <option value="ALL">Barcha smenalar</option>
            {options.schedules.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </Select>
        )}
        {options.devices.length > 0 && (
          <Select
            label="Qurilma turi"
            value={device}
            onChange={(v) => {
              setDevice(v);
              reset();
            }}
          >
            <option value="ALL">Barcha qurilmalar</option>
            {options.devices.map((d) => (
              <option key={d} value={d}>
                {VERIFY_LABEL[d] || d}
              </option>
            ))}
          </Select>
        )}
        <button
          type="button"
          className={`tp-chip ${lateOnly ? "on" : ""}`}
          aria-pressed={lateOnly}
          onClick={() => {
            setLateOnly(!lateOnly);
            reset();
          }}
        >
          <AlarmClock size={13} aria-hidden /> Kechikish
        </button>
        {filtered && (
          <button type="button" className="tp-chip ghost" onClick={clear}>
            <X size={13} aria-hidden /> Tozalash
          </button>
        )}
      </div>
      {!roster.length ? (
        <Empty
          icon={Users}
          title="Xodimlar hali qo‘shilmagan"
          text="Birinchi xodimni qo‘shing — u Telegram bot yoki ilova orqali kirish-chiqishni belgilaydi."
          action={
            <Link to="/employees/new" className="btn btn-primary">
              <UserPlus size={16} /> Xodim qo‘shish
            </Link>
          }
        />
      ) : !rows.length ? (
        <Empty icon={Search} title="Mos xodim topilmadi" text="Qidiruv yoki filtrlarni o‘zgartirib ko‘ring." />
      ) : (
        <>
          <div className="table-wrap tp-table-wrap">
            <table className="tp-table tp-att tp-cards">
              <thead>
                <tr>
                  {head("name", "Xodim")}
                  {head("in", "Kirish")}
                  {head("out", "Chiqish")}
                  <th>Qo‘shimcha vaqt</th>
                  {head("worked", "Jami")}
                  <th>Filial</th>
                  <th>Holat</th>
                  <th aria-label="Batafsil" />
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => {
                  const [label, tone, live] = stateBadge(row);
                  const rec = row.record;
                  const open = `/employees/${row.employee.id}`;
                  return (
                    <tr key={row.employee.id} className="clickable" onClick={() => navigate(open)}>
                      <td className="c-person">
                        <span className="tp-person">
                          <Avatar first={row.employee.firstName} last={row.employee.lastName} photo={row.employee.photoDataUrl} size="sm" />
                          <span>
                            <Link to={open} onClick={(e) => e.stopPropagation()}>
                              {row.employee.firstName} {row.employee.lastName}
                            </Link>
                            <small>{row.position || row.department || row.employee.employeeNo}</small>
                          </span>
                        </span>
                      </td>
                      <td className="c-in" data-label="Kirish">
                        <span className="tp-time">
                          <b className={rec?.checkIn ? (row.late ? "t-amber" : "t-green") : "t-none"}>{rec?.checkIn || "—"}</b>
                          {row.late && rec?.lateMinutes ? (
                            <small className="tp-tag amber">+{duration(rec.lateMinutes)}</small>
                          ) : row.scheduledStart && !rec?.checkIn ? (
                            <small className="tp-muted">reja {row.scheduledStart}</small>
                          ) : null}
                        </span>
                      </td>
                      <td className="c-out" data-label="Chiqish">
                        <span className="tp-time">
                          <b className={rec?.checkOut ? "" : "t-none"}>{rec?.checkOut || "—"}</b>
                          {rec?.earlyLeaveMinutes ? <small className="tp-tag red">−{duration(rec.earlyLeaveMinutes)}</small> : null}
                        </span>
                      </td>
                      <td className="c-over" data-label="Qo‘shimcha">
                        {rec?.overtimeMinutes ? <span className="tp-tag green">+{duration(rec.overtimeMinutes)}</span> : <span className="tp-muted">—</span>}
                      </td>
                      <td className="c-worked nowrap" data-label="Jami">
                        {rec?.workedMinutes ? <b>{hm(rec.workedMinutes)}</b> : <span className="tp-muted">—</span>}
                      </td>
                      <td className="c-branch tp-muted">{row.branch || "—"}</td>
                      <td className="c-state">
                        <span className={`tp-badge ${tone} ${live ? "live" : ""}`}>{label}</span>
                      </td>
                      <td className="c-chev tp-chev">
                        <ChevronRight size={16} aria-hidden />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="tp-pager">
              <span className="tp-muted">
                {num(current * PAGE + 1)}–{num(Math.min(rows.length, current * PAGE + PAGE))} / {num(rows.length)}
              </span>
              <div>
                <button type="button" className="tp-page-btn" disabled={current === 0} onClick={() => setPage(current - 1)} aria-label="Oldingi sahifa">
                  <ChevronLeft size={15} />
                </button>
                {Array.from({ length: pages }, (_, i) => i)
                  .filter((i) => i === 0 || i === pages - 1 || Math.abs(i - current) <= 1)
                  .map((i, index, list) => (
                    <span key={i} className="tp-page-group">
                      {index > 0 && i - list[index - 1] > 1 && <span className="tp-muted">…</span>}
                      <button type="button" className={`tp-page-btn ${i === current ? "on" : ""}`} onClick={() => setPage(i)} aria-current={i === current ? "page" : undefined}>
                        {i + 1}
                      </button>
                    </span>
                  ))}
                <button type="button" className="tp-page-btn" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} aria-label="Keyingi sahifa">
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return (
    <label className={`tp-select ${value !== "ALL" ? "on" : ""}`}>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {children}
      </select>
    </label>
  );
}

/* --------------------------------------------------- filiallar statistikasi --- */
type BranchRow = { key: string; name: string; total: number; working: number; came: number; late: number; absent: number; rate: number | null };

function BranchStats({ roster, more }: { roster: RosterRow[]; more: string | null }) {
  const rows = useMemo(() => {
    const map = new Map<string, BranchRow>();
    for (const row of roster) {
      const key = row.branchId || row.branch || "none";
      const b = map.get(key) || { key, name: row.branch || "Filialsiz", total: 0, working: 0, came: 0, late: 0, absent: 0, rate: null };
      b.total += 1;
      if (row.state === "IN") b.working += 1;
      if (row.state === "IN" || row.state === "LEFT") b.came += 1;
      if (row.late && (row.state === "IN" || row.state === "LEFT")) b.late += 1;
      if (row.state === "ABSENT") b.absent += 1;
      map.set(key, b);
    }
    return [...map.values()].map((b) => ({ ...b, rate: rateOf(b.came, b.absent) })).sort((a, b) => b.total - a.total);
  }, [roster]);
  return (
    <section className="tp-card">
      <div className="tp-card-head">
        <div className="tp-title">
          <h2>Filiallar statistikasi</h2>
          <span className="tp-muted">{rows.length} filial</span>
        </div>
        {more && (
          <Link to={more} className="tp-link">
            Filiallar <ChevronRight size={14} />
          </Link>
        )}
      </div>
      {!rows.length ? (
        <Empty icon={Building2} title="Filial ma’lumoti yo‘q" text="Xodimlar filialga biriktirilgach, har bir filialning davomati shu yerda ko‘rinadi." />
      ) : (
        <div className="table-wrap tp-table-wrap">
          <table className="tp-table tp-cards tp-branches">
            <thead>
              <tr>
                <th>Filial</th>
                <th className="num">Xodimlar</th>
                <th className="num">Hozir ishda</th>
                <th className="num">Kechikkan</th>
                <th>Davomat</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 7).map((b) => {
                const tone = rateTone(b.rate);
                return (
                  <tr key={b.key}>
                    <td className="c-name">
                      <span className="tp-branch">
                        <span className="tp-branch-icon">
                          <Building2 size={13} aria-hidden />
                        </span>
                        <b>{b.name}</b>
                      </span>
                    </td>
                    <td className="c-total num" data-label="Xodimlar">
                      {num(b.total)}
                    </td>
                    <td className="c-working num" data-label="Hozir ishda">
                      {num(b.working)}
                    </td>
                    <td className={`c-late num ${b.late ? "t-amber" : "tp-muted"}`} data-label="Kechikkan">
                      {num(b.late)}
                    </td>
                    <td className="c-rate">
                      <span className="tp-rate">
                        <span className="tp-meter">
                          <i className={tone} style={{ width: `${b.rate ?? 0}%` }} />
                        </span>
                        <b>{b.rate === null ? "—" : pct(b.rate)}</b>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ----------------------------------------------------- oxirgi faoliyatlar --- */
type Activity = { key: string; at: string; icon: LucideIcon; tone: Tone; title: string; text?: string; time: string };

function eventLook(type: string): [LucideIcon, Tone] {
  if (type === "LEAVE") return [Plane, "violet"];
  if (type === "ATTENDANCE_REQUEST") return [ClipboardList, "blue"];
  if (type === "REGISTRATION" || type === "EMPLOYEES") return [UserPlus, "green"];
  if (/APPROV|DECID/.test(type)) return [CheckCircle2, "green"];
  return [Clock3, "gray"];
}
const clockOf = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tashkent" });

function ActivityFeed({ roster, date, notifications, more }: { roster: RosterRow[]; date: string; notifications: Notification[]; more: boolean }) {
  const items = useMemo(() => {
    const list: Activity[] = [];
    for (const row of roster) {
      const rec = row.record;
      if (!rec) continue;
      const name = `${row.employee.firstName} ${row.employee.lastName}`;
      const where = row.branch ? ` · ${row.branch}` : "";
      if (rec.checkIn) list.push({ key: `${rec.id}:in`, at: `${date}T${rec.checkIn}`, icon: LogIn, tone: row.late ? "amber" : "green", title: name, text: `${row.late ? "kechikib keldi" : "ishga keldi"}${where}`, time: rec.checkIn });
      if (rec.checkOut) list.push({ key: `${rec.id}:out`, at: `${date}T${rec.checkOut}`, icon: LogOut, tone: "blue", title: name, text: `ishdan ketdi · ${hm(rec.workedMinutes)}`, time: rec.checkOut });
    }
    for (const n of notifications) {
      const [icon, tone] = eventLook(n.type);
      const local = new Date(n.createdAt).toLocaleString("sv-SE", { timeZone: "Asia/Tashkent" }).replace(" ", "T").slice(0, 16);
      list.push({ key: n.id, at: local, icon, tone, title: n.title, text: n.body, time: local.slice(0, 10) === date ? clockOf(n.createdAt) : dateUz(n.createdAt).slice(0, 5) });
    }
    return list.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 7);
  }, [roster, date, notifications]);
  return (
    <section className="tp-card">
      <div className="tp-card-head">
        <div className="tp-title">
          <h2>Oxirgi faoliyatlar</h2>
        </div>
        {more && (
          <Link to="/notifications" className="tp-link">
            Barchasi <ChevronRight size={14} />
          </Link>
        )}
      </div>
      {items.length ? (
        <ol className="tp-feed">
          {items.map((item) => (
            <li key={item.key}>
              <span className={`tp-feed-icon ${item.tone}`}>
                <item.icon size={13} strokeWidth={2} aria-hidden />
              </span>
              <span className="tp-feed-text">
                <b>{item.title}</b>
                {item.text && <small>{item.text}</small>}
              </span>
              <time>{item.time}</time>
            </li>
          ))}
        </ol>
      ) : (
        <Empty icon={Clock3} title="Hozircha faoliyat yo‘q" text="Kirish-chiqishlar, arizalar va tasdiqlar shu yerda ko‘rinadi." />
      )}
    </section>
  );
}

/* --------------------------------------------------- ish vaqti statistikasi --- */
function WorkTimeStats({ weekly, days, onDays, roster }: { weekly: Dashboard["weekly"]; days: Days; onDays: (d: Days) => void; roster: RosterRow[] }) {
  const realToday = tashkentIsoDate();
  const lastIso = weekly[weekly.length - 1]?.date;
  const firstData = weekly.findIndex((d) => d.present + d.late + d.absent > 0);
  const series = firstData > 0 ? weekly.slice(firstData) : weekly;
  const chart = series.map((item) => ({
    ...item,
    day: item.date === lastIso && lastIso === realToday ? "Bugun" : days === "7" ? weekdayShortUz(item.date) : String(Number(item.date.slice(8))),
  }));
  const came = series.reduce((sum, d) => sum + d.present + d.late, 0);
  const late = series.reduce((sum, d) => sum + d.late, 0);
  const absent = series.reduce((sum, d) => sum + d.absent, 0);
  const avg = rateOf(came, absent);
  const worked = roster.filter((r) => r.record?.workedMinutes);
  const avgWorked = worked.length ? worked.reduce((s, r) => s + (r.record?.workedMinutes || 0), 0) / worked.length : 0;
  const overtime = roster.reduce((s, r) => s + (r.record?.overtimeMinutes || 0), 0);
  return (
    <section className="tp-card tp-worktime">
      <div className="tp-card-head">
        <div className="tp-title">
          <h2>Ish vaqti statistikasi</h2>
          <span className="tp-muted">so‘nggi {days} kun</span>
        </div>
        <Segmented<Days>
          value={days}
          onChange={onDays}
          options={[
            { value: "7", label: "Hafta" },
            { value: "14", label: "14 kun" },
            { value: "30", label: "Oy" },
          ]}
        />
      </div>
      <div className="tp-worktime-body">
        <div className="tp-mini-stats">
          <div>
            <small>O‘rtacha davomat</small>
            <strong className={`t-${rateTone(avg)}`}>{avg === null ? "—" : pct(avg, 1)}</strong>
          </div>
          <div>
            <small>Kechikishlar</small>
            <strong className="t-amber">{num(late)}</strong>
          </div>
          <div>
            <small>Kelmaganlar</small>
            <strong className="t-red">{num(absent)}</strong>
          </div>
          <div>
            <small>Bugun o‘rtacha ish vaqti</small>
            <strong>{avgWorked ? hm(avgWorked) : "—"}</strong>
          </div>
          <div>
            <small>Bugungi qo‘shimcha vaqt</small>
            <strong className="t-green">{overtime ? duration(overtime) : "—"}</strong>
          </div>
        </div>
        <div className="tp-chart">
          {firstData < 0 ? (
            <Empty icon={Clock3} title="Hali davomat yo‘q" text="Xodimlar kirish-chiqishni belgilay boshlagach, kunlik grafik shu yerda ko‘rinadi." />
          ) : (
            <>
              <div className="tp-legend" aria-hidden>
                <span>
                  <i style={{ background: "var(--chart-ok)" }} /> Vaqtida
                </span>
                <span>
                  <i style={{ background: "var(--chart-late)" }} /> Kechikkan
                </span>
                <span>
                  <i style={{ background: "var(--chart-bad)" }} /> Kelmagan
                </span>
              </div>
              <div className="tp-chart-box">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart} margin={{ left: -8, right: 4, top: 4 }} barCategoryGap={chart.length > 14 ? "22%" : "38%"}>
                    <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                    <XAxis dataKey="day" axisLine={false} tickLine={false} minTickGap={6} interval={chart.length > 14 ? "preserveStartEnd" : 0} tick={{ fill: "var(--chart-axis)", fontSize: 11 }} />
                    <YAxis allowDecimals={false} axisLine={false} tickLine={false} width={40} tick={{ fill: "var(--chart-axis)", fontSize: 11 }} />
                    <Tooltip cursor={{ fill: "var(--hover-tint)" }} content={<ChartTooltip />} isAnimationActive={false} />
                    <Bar dataKey="present" name="Vaqtida" stackId="d" fill="var(--chart-ok)" maxBarSize={26} isAnimationActive={false} />
                    <Bar dataKey="late" name="Kechikkan" stackId="d" fill="var(--chart-late)" maxBarSize={26} isAnimationActive={false} />
                    <Bar dataKey="absent" name="Kelmagan" stackId="d" fill="var(--chart-bad)" maxBarSize={26} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
                <table className="sr-only">
                  <caption>Kunlik davomat</caption>
                  <thead>
                    <tr>
                      <th>Sana</th>
                      <th>Vaqtida</th>
                      <th>Kechikkan</th>
                      <th>Kelmagan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {series.map((d) => (
                      <tr key={d.date}>
                        <td>{dateUz(d.date)}</td>
                        <td>{d.present}</td>
                        <td>{d.late}</td>
                        <td>{d.absent}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function ChartTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as Dashboard["weekly"][number];
  return (
    <div className="chart-tooltip">
      <b>{dateLongUz(row.date, true)}</b>
      <span>
        <i style={{ background: "var(--chart-ok)" }} /> Vaqtida <em>{num(row.present)}</em>
      </span>
      <span>
        <i style={{ background: "var(--chart-late)" }} /> Kechikkan <em>{num(row.late)}</em>
      </span>
      <span>
        <i style={{ background: "var(--chart-bad)" }} /> Kelmagan <em>{num(row.absent)}</em>
      </span>
      <span className="rate">
        Davomat <em>{row.rate === null ? "—" : `${row.rate}%`}</em>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------- skeleton --- */
function DashSkeleton() {
  return (
    <div aria-busy="true" aria-label="Yuklanmoqda">
      <div className="db-sk-head">
        <span className="db-sk" style={{ width: 200, height: 24 }} />
        <span className="db-sk" style={{ width: 260, height: 13 }} />
      </div>
      <div className="tp-stats">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="tp-stat gray">
            <span className="db-sk" style={{ width: 40, height: 40, borderRadius: 10 }} />
            <span className="tp-stat-text">
              <span className="db-sk" style={{ width: 70, height: 11 }} />
              <span className="db-sk" style={{ width: 60, height: 24, margin: "6px 0" }} />
            </span>
          </span>
        ))}
      </div>
      <span className="tp-card db-sk-card" style={{ display: "block", height: 240 }} />
      <span className="tp-card db-sk-card" style={{ display: "block", height: 420, marginTop: 16 }} />
    </div>
  );
}
