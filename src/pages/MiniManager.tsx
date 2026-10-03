import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  CheckSquare,
  CalendarSync,
  ChevronDown,
  HandCoins,
  Hourglass,
  LoaderCircle,
  MapPin,
  Megaphone,
  Plane,
  RefreshCw,
  Search,
  LogIn,
  Gavel,
  FileWarning,
  LogOut,
  ShieldAlert,
  Square,
  Timer,
  TrendingDown,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { ApiError } from "../api";
import { can } from "@/lib/permissions";
import { dateLongUz, dateUz, tashkentIsoDate } from "@/lib/format";
import { FineSheet, MoneyView } from "./mini/MoneyTools";
import { DevicesView } from "./mini/DevicesView";
import { OpsView } from "./mini/OpsView";
import { MiniDesk } from "./mini/Desk";
import type { Attendance, Branch, Employee, LeaveRequest } from "@/lib/types";
import { leaveTypeLabel } from "../types";
import { SkeletonList } from "./mini/shared";
import { TileMap, type MapPoint } from "./mini/TileMap";
import { haversineDistance } from "@/lib/attendance";
import { FLAG_LABELS } from "@/lib/gps";
import { Briefing, EmployeeCardSheet, QuickAnnounceSheet, TrendsList, type TrendRow } from "./mini/ManagerTools";
import type { ManagerAuth, ManagerView } from "./mini/managerAuth";
import { confirmNative, haptic, useMainButton, useSecondaryButton } from "./mini/tg";

/*
 * Rahbar rejimi: panelga kirmasdan Telegram’dan bugungi holat, so‘rovlar,
 * filial xaritasi va haftalik xulosa. Panelning o‘z API’lari ishlatiladi (huquq va
 * filial chegarasi serverda tekshiriladi), token alohida — xodim sessiyasiga aralashmaydi.
 */

type Toast = (text: string, tone?: "ok" | "error") => void;

function client(token: string) {
  return async function call<T>(url: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`/api${url}`, {
        method,
        credentials: "omit",
        headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError("Server bilan aloqa yo‘q.", 0);
    }
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { message?: string };
      throw new ApiError(data.message || `So‘rov bajarilmadi (${response.status}).`, response.status);
    }
    return response.json() as Promise<T>;
  };
}

export type RosterRow = {
  employee: Employee;
  record?: Attendance;
  state: "PRACTICE" | "IN" | "LEFT" | "ABSENT" | "ON_LEAVE" | "DAY_OFF" | "NOT_YET" | "UPCOMING";
  late: boolean;
  scheduledStart?: string;
  branch?: string;
};
type Day = { date: string; stats: { total: number; present: number; inNow: number; late: number; absent: number; leave: number; dayOff: number; notYet: number }; rows: RosterRow[] };
type LeaveRow = LeaveRequest & { employee?: Employee };
type SwapRow = { id: string; requesterName: string; colleagueName: string; giveDate: string; takeDate?: string; giveShift?: string; reason?: string; status: string };
type AdvanceRow = {
  id: string;
  employeeName: string;
  amount: number;
  reason?: string;
  status: string;
  month: string;
  hrDecidedBy?: string;
  limit?: { max: number; taken: number };
  payout?: { method: "CARD" | "CASH"; cardMask?: string; holder?: string };
};
type OvertimeRow = { id: string; date: string; name: string; checkIn?: string; checkOut?: string; scheduledEnd: string; overtimeMinutes: number; approved?: boolean; note?: string };
type LateNotice = { id: string; employeeId: string; employeeName: string; minutes: number; reason: string; createdAt: string };
type Analytics = {
  month: string;
  current: { attendanceRate: number; punctuality: number; lateMinutes: number; absent: number; score: number | null };
  previous: { attendanceRate: number; punctuality: number; lateMinutes: number; absent: number; score: number | null };
  punctual: { id: string; name: string; present: number }[];
  latecomers: { id: string; name: string; lateMinutes: number; late: number }[];
  daily: { date: string; rate: number; late: number; absent: number }[];
  branches: { id: string; name: string; employees: number; attendanceRate: number; punctuality: number; lateMinutes: number; absent: number; score: number | null }[];
};
type Pending = { kind: "leave" | "swap" | "advance" | "overtime" | "dayoff" | "mark" | "fine"; id: string };
type FineRow = { id: string; employeeName: string; branchName: string; amount: number; reason: string; proposedBy?: string; createdAt: string };
type MarkRow = { id: string; employeeName: string; position?: string; date: string; time: string; kind: "IN" | "OUT"; branchName: string; comment: string };
type DayOffRow = { id: string; employeeName: string; fromDate: string; toDate: string; fromWeekday: string; toWeekday: string; reason?: string };

const som = (value: number) => `${Math.round(value).toLocaleString("ru-RU").replace(/\s/g, " ")} so‘m`;
type Filter = "ALL" | "IN" | "LATE" | "ABSENT" | "NOT_YET" | "ON_LEAVE" | "FLAGGED";

export function ManagerHome({ auth, onToast, onExpired, initialView }: { auth: ManagerAuth; onToast: Toast; onExpired: () => void; initialView?: ManagerView }) {
  const call = useMemo(() => client(auth.token), [auth.token]);
  const role = auth.user.role;
  const [view, setView] = useState<ManagerView>(initialView || "desk");
  const [day, setDay] = useState<Day | null>(null);
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [swaps, setSwaps] = useState<SwapRow[]>([]);
  const [dayoffs, setDayoffs] = useState<DayOffRow[]>([]);
  const [marks, setMarks] = useState<MarkRow[]>([]);
  const [fines, setFines] = useState<FineRow[]>([]);
  const [fining, setFining] = useState(false);
  const [expiring, setExpiring] = useState<{ id: string; title: string; expiresAt: string; status: string; employeeId: string; employeeName: string; branchName: string }[]>([]);
  const [advances, setAdvances] = useState<AdvanceRow[]>([]);
  const [overtime, setOvertime] = useState<OvertimeRow[]>([]);
  const [notices, setNotices] = useState<LateNotice[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [trends, setTrends] = useState<TrendRow[] | null>(null);
  const [cardFor, setCardFor] = useState<string | null>(null);
  const [announcing, setAnnouncing] = useState(false);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [query, setQuery] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string>("");
  /** Oldingi yangilanishda kelmaganlar — yangi kelganlar qisqa vaqt ajratib ko‘rsatiladi. */
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [branch, setBranch] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Pending[]>([]);
  const canAttendance = can(role, "attendance.view");
  const canLeave = can(role, "leave.approve");
  const canSwaps = can(role, "leave.approve") || can(role, "attendance.edit");
  // Avans: HR 1-bosqich (PENDING), moliya 2-bosqich (HR_APPROVED). Egasi ikkalasini ham ko‘radi.
  const advanceHr = can(role, "leave.approve") || can(role, "employees.edit");
  const advanceFinance = can(role, "payroll.edit");
  const canAdvances = advanceHr || advanceFinance;
  const canOvertime = can(role, "attendance.edit") || can(role, "payroll.edit");
  const canAnalytics = can(role, "dashboard.view");
  const canEditAttendance = can(role, "attendance.edit");
  const canAnnounce = can(role, "announcements.create") || role === "BRANCH_MANAGER";
  // Jarima: HR / direktor / moliya — darhol; filial rahbari — taklif (HR tasdiqlaydi).
  const fineDirect = can(role, "employees.edit") || can(role, "payroll.edit");
  const canFine = fineDirect || role === "BRANCH_MANAGER";
  // «Moliya» ko‘rinishi — faqat moliya va direktor (HR moliyani ko‘rmaydi).
  const canMoney = can(role, "payroll.view") || can(role, "payroll.edit");
  // Qurilmalar — IT va HR; «So‘rovlar» — davomat/ta’til/moliya bilan ishlaydiganlar (IT — yo‘q).
  const canDevices = can(role, "devices.manage") || can(role, "employees.edit");
  const canRequests = canAttendance || canLeave || canAdvances || fineDirect;
  // Operatsiya: vazifalar, checklistlar, hodisalar (IT — faqat IT/jihoz hodisalari).
  const canOps = can(role, "ops.manage") || can(role, "incidents.it");
  useEffect(() => {
    if (!canAttendance && (view === "today" || view === "map")) setView(canMoney ? "money" : canDevices && !canRequests ? "devices" : "requests");
  }, [canAttendance, canMoney, canDevices, canRequests, view]);

  const handle = useCallback(
    (reason: unknown) => {
      if (reason instanceof ApiError && reason.status === 401) return onExpired();
      onToast(reason instanceof Error ? reason.message : "Xatolik", "error");
    },
    [onExpired, onToast],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const month = tashkentIsoDate().slice(0, 7);
      const [d, l, s, a, o, n, b, t] = await Promise.all([
        canAttendance ? call<Day>(`/attendance/day?date=${tashkentIsoDate()}`) : Promise.resolve(null),
        canLeave ? call<LeaveRow[]>("/leave") : Promise.resolve([] as LeaveRow[]),
        canSwaps ? call<SwapRow[]>("/shift-swaps") : Promise.resolve([] as SwapRow[]),
        canAdvances
          ? Promise.all([
              call<AdvanceRow[]>("/payroll/advances?status=PENDING,HR_APPROVED"),
              call<{ payroll?: { advanceHrApproval?: boolean } }>("/company").catch(() => ({ payroll: undefined })),
            ]).then(([list, company]) => {
              const twoStep = company.payroll?.advanceHrApproval !== false;
              return list.filter((a) =>
                a.status === "PENDING" ? (twoStep ? advanceHr : advanceFinance) : a.status === "HR_APPROVED" && advanceFinance,
              );
            })
          : Promise.resolve([] as AdvanceRow[]),
        canOvertime ? call<{ rows: OvertimeRow[] }>(`/overtime?month=${month}`).catch(() => ({ rows: [] as OvertimeRow[] })) : Promise.resolve({ rows: [] as OvertimeRow[] }),
        canAttendance ? call<LateNotice[]>("/late-notices").catch(() => [] as LateNotice[]) : Promise.resolve([] as LateNotice[]),
        canAttendance ? call<Branch[]>("/branches").catch(() => [] as Branch[]) : Promise.resolve([] as Branch[]),
        canAttendance ? call<TrendRow[]>("/trends").catch(() => [] as TrendRow[]) : Promise.resolve([] as TrendRow[]),
      ]);
      setDay(d);
      if (d) {
        const arrived = new Set(d.rows.filter((r) => r.record?.checkIn).map((r) => r.employee.id));
        if (seen.current) {
          const newcomers = new Set([...arrived].filter((id) => !seen.current!.has(id)));
          if (newcomers.size) {
            setFresh(newcomers);
            haptic.tap("light");
            window.setTimeout(() => setFresh(new Set()), 20_000);
          }
        }
        seen.current = arrived;
      }
      setUpdatedAt(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tashkent" }));
      setLeaves(l.filter((x) => x.status === "PENDING"));
      setSwaps(s.filter((x) => x.status === "PENDING_MANAGER"));
      if (canSwaps) void call<DayOffRow[]>("/dayoff-moves?status=PENDING").then(setDayoffs).catch(() => setDayoffs([]));
      if (canSwaps) void call<MarkRow[]>("/attendance-corrections?status=PENDING").then(setMarks).catch(() => setMarks([]));
      if (fineDirect) void call<FineRow[]>("/fines?status=PENDING").then(setFines).catch(() => setFines([]));
      if (can(role, "employees.view")) void call<typeof expiring>("/documents/expiring").then(setExpiring).catch(() => setExpiring([]));
      setAdvances(a);
      setOvertime(o.rows.filter((r) => r.approved === undefined));
      setNotices(n);
      setBranches(b);
      setTrends(t);
    } catch (reason) {
      handle(reason);
    } finally {
      setLoading(false);
    }
  }, [call, canAttendance, canLeave, canSwaps, canAdvances, canOvertime, handle]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => document.visibilityState === "visible" && void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const act = async (key: string, run: () => Promise<unknown>, message: string) => {
    setBusy(key);
    try {
      await run();
      onToast(message);
      haptic.success();
      await load();
    } catch (reason) {
      handle(reason);
    } finally {
      setBusy(null);
    }
  };

  const decide = (item: Pending, approve: boolean) => {
    if (item.kind === "leave") return call(`/leave/${item.id}`, { status: approve ? "APPROVED" : "REJECTED" }, "PATCH");
    if (item.kind === "swap") return call(`/shift-swaps/${item.id}/decide`, { approve });
    if (item.kind === "dayoff") return call(`/dayoff-moves/${item.id}/decide`, { approve });
    if (item.kind === "mark") return call(`/attendance-corrections/${item.id}/decide`, { approve });
    if (item.kind === "fine") return call(`/fines/${item.id}/decide`, { approve });
    if (item.kind === "advance") return call(`/payroll/advances/${item.id}/decide`, { approve });
    return call(`/attendance/${item.id}/overtime`, { approved: approve });
  };
  const reject = async (item: Pending, label: string) => {
    if (!(await confirmNative(`${label} — rad etilsinmi?`, { ok: "Rad etish", destructive: true }))) return;
    await act(item.id, () => decide(item, false), "Rad etildi");
  };
  const isSelected = (item: Pending) => selected.some((s) => s.id === item.id);
  const toggle = (item: Pending) => {
    haptic.select();
    setSelected((list) => (isSelected(item) ? list.filter((s) => s.id !== item.id) : [...list, item]));
  };
  const bulkApprove = async () => {
    if (!selected.length) return;
    if (!(await confirmNative(`${selected.length} ta so‘rov tasdiqlansinmi?`, { ok: "Tasdiqlash" }))) return;
    setBusy("bulk");
    let ok = 0;
    for (const item of selected)
      try {
        await decide(item, true);
        ok += 1;
      } catch (reason) {
        if (reason instanceof ApiError && reason.status === 401) {
          onExpired();
          break;
        }
      }
    setBusy(null);
    setSelected([]);
    setSelecting(false);
    onToast(ok === selected.length ? `${ok} ta so‘rov tasdiqlandi` : `${ok} / ${selected.length} ta tasdiqlandi`, ok ? "ok" : "error");
    if (ok) haptic.success();
    await load();
  };

  const rows = day?.rows || [];
  const branchNames = [...new Set(rows.map((r) => r.branch).filter(Boolean))] as string[];
  const scoped = rows.filter((r) => !branch || r.branch === branch);
  const flagged = (r: RosterRow) => Boolean(r.record?.flags?.length && !r.record.flagsReviewedBy);
  const noticeOf = (employeeId: string) => notices.find((n) => n.employeeId === employeeId);
  const stats = {
    in: scoped.filter((r) => r.state === "IN" || r.state === "LEFT").length,
    late: scoped.filter((r) => r.late).length,
    absent: scoped.filter((r) => r.state === "ABSENT").length,
    notYet: scoped.filter((r) => r.state === "NOT_YET").length,
    leave: scoped.filter((r) => r.state === "ON_LEAVE").length,
    flagged: scoped.filter(flagged).length,
    expected: scoped.filter((r) => !["DAY_OFF", "ON_LEAVE", "UPCOMING"].includes(r.state)).length,
  };
  const q = query.trim().toLowerCase();
  const list = scoped
    .filter((r) => !q || `${r.employee.firstName} ${r.employee.lastName} ${r.employee.employeeNo}`.toLowerCase().includes(q))
    .filter((r) =>
      filter === "ALL"
        ? r.state !== "DAY_OFF"
        : filter === "IN"
          ? r.state === "IN" || r.state === "LEFT"
          : filter === "LATE"
            ? r.late
            : filter === "FLAGGED"
              ? flagged(r)
              : r.state === filter,
    )
    .sort((a, b) => order(a) - order(b) || `${a.employee.firstName}`.localeCompare(`${b.employee.firstName}`));
  const pendingCount = fines.length + marks.length + leaves.length + swaps.length + dayoffs.length + advances.length + overtime.length;
  const markDays = [...new Set(marks.map((m) => m.date))].sort((a, b) => b.localeCompare(a));
  const rate = stats.expected ? Math.round((stats.in / stats.expected) * 100) : 0;

  // Pastki Telegram tugmalari: ommaviy tasdiqlash rejimida.
  useMainButton(view === "requests" && selecting ? { text: selected.length ? `Tasdiqlash (${selected.length})` : "So‘rovlarni belgilang", onClick: () => void bulkApprove(), disabled: !selected.length, progress: busy === "bulk" } : null);
  useSecondaryButton(view === "requests" && selecting ? { text: "Bekor qilish", onClick: () => (setSelecting(false), setSelected([])) } : null);


  const selectableToggle = pendingCount > 1 && (
    <button
      className={`mg-select ${selecting ? "on" : ""}`}
      onClick={() => {
        haptic.select();
        setSelecting(!selecting);
        setSelected([]);
      }}
    >
      {selecting ? <X size={15} /> : <CheckSquare size={15} />} {selecting ? "Bekor" : "Tanlash"}
    </button>
  );
  const pick = (item: Pending) =>
    selecting ? (
      <button className="mg-check" aria-label="Tanlash" onClick={() => toggle(item)}>
        {isSelected(item) ? <CheckSquare size={20} /> : <Square size={20} />}
      </button>
    ) : null;

  return (
    <div className="mini-body mg">
      <div className="mg-head">
        <div>
          <small>Rahbar paneli · {auth.company.name}</small>
          <h1>{auth.user.name}</h1>
        </div>
        <span className="mg-head-actions">
          {canFine && (
            <button className="mg-refresh" onClick={() => setFining(true)} aria-label={fineDirect ? "Jarima yozish" : "Jarima taklif qilish"}>
              <Gavel size={18} />
            </button>
          )}
          {canAnnounce && (
            <button className="mg-refresh" onClick={() => setAnnouncing(true)} aria-label="Tezkor e’lon">
              <Megaphone size={18} />
            </button>
          )}
          <button className="mg-refresh" onClick={() => void load()} aria-label="Yangilash" disabled={loading}>
            <RefreshCw size={18} className={loading ? "spin" : ""} />
          </button>
        </span>
      </div>
      <div className={`mini-seg ${["", "one", "", "three", "four", "five", "six"][[true, canAttendance, canRequests, canAttendance, canAnalytics, canMoney, canDevices, canOps].filter(Boolean).length] || "seven"}`} role="tablist">
        {(
          [
            ["desk", "Ish stoli", 0] as const,
            ...(canAttendance ? ([["today", "Bugun", 0]] as const) : []),
            ...(canRequests ? ([["requests", "So‘rovlar", pendingCount]] as const) : []),
            ...(canAttendance ? ([["map", "Xarita", 0]] as const) : []),
            ...(canAnalytics ? ([["week", "Xulosa", 0]] as const) : []),
            ...(canMoney ? ([["money", "Moliya", 0]] as const) : []),
            ...(canDevices ? ([["devices", "Qurilma", 0]] as const) : []),
            ...(canOps ? ([["ops", "Operatsiya", 0]] as const) : []),
          ] as const
        ).map(([key, label, badge]) => (
          <button
            key={key}
            role="tab"
            aria-selected={view === key}
            className={view === key ? "on" : ""}
            onClick={() => {
              haptic.select();
              setView(key);
            }}
          >
            {label}
            {badge ? <span className="mini-badge inline">{badge}</span> : null}
          </button>
        ))}
      </div>

      {view === "today" &&
        (!canAttendance ? (
          <div className="mini-empty">Davomatni ko‘rish huquqingiz yo‘q.</div>
        ) : !day ? (
          <SkeletonList />
        ) : (
          <>
            <Briefing
              name={auth.user.name}
              stats={stats}
              notices={notices.filter((n) => !rows.find((r) => r.employee.id === n.employeeId)?.record?.checkIn).length}
              pending={pendingCount}
              trends={trends?.length || 0}
              onOpen={(target) => {
                if (target === "requests") setView("requests");
                else if (target === "trends") setView("week");
                else setFilter(target);
              }}
            />
            <section className="mg-hero">
              <div className="mg-ring" style={{ ["--p" as string]: `${rate}` }}>
                <b>{rate}%</b>
                <small>keldi</small>
              </div>
              <div className="mg-tiles">
                <Tile label="Ishda" value={stats.in} tone="ok" active={filter === "IN"} onClick={() => setFilter(filter === "IN" ? "ALL" : "IN")} />
                <Tile label="Kechikdi" value={stats.late} tone="warn" active={filter === "LATE"} onClick={() => setFilter(filter === "LATE" ? "ALL" : "LATE")} />
                <Tile label="Kelmadi" value={stats.absent} tone="bad" active={filter === "ABSENT"} onClick={() => setFilter(filter === "ABSENT" ? "ALL" : "ABSENT")} />
                <Tile label="Hali yo‘q" value={stats.notYet} active={filter === "NOT_YET"} onClick={() => setFilter(filter === "NOT_YET" ? "ALL" : "NOT_YET")} />
              </div>
            </section>
            {notices.length > 0 && (
              <div className="mg-alert info">
                <Hourglass size={17} />
                <span>
                  {notices.length} kishi kechikishini oldindan aytdi: {notices.slice(0, 3).map((n) => `${n.employeeName.split(" ")[0]} (~${n.minutes} daq)`).join(", ")}
                  {notices.length > 3 ? "…" : ""}
                </span>
              </div>
            )}
            {stats.flagged > 0 && (
              <button className={`mg-alert ${filter === "FLAGGED" ? "on" : ""}`} onClick={() => setFilter(filter === "FLAGGED" ? "ALL" : "FLAGGED")}>
                <ShieldAlert size={17} />
                <span>{stats.flagged} ta shubhali belgi (GPS / qurilma / internetsiz) — panelda ko‘rib chiqing</span>
              </button>
            )}
            <LiveFeed rows={scoped} onOpen={setCardFor} />
            <div className="mg-tools">
              <label className="md-search">
                <Search size={16} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Xodimni qidirish" />
              </label>
              {branchNames.length > 1 && <BranchSelect value={branch} options={branchNames} onChange={setBranch} />}
            </div>
            {updatedAt && (
              <p className="mg-updated">
                <i /> Jonli · {updatedAt} da yangilandi
                {filter !== "ALL" && (
                  <button className="mini-link" onClick={() => setFilter("ALL")}>
                    Filtrni olib tashlash
                  </button>
                )}
              </p>
            )}
            <section className="mini-card">
              {!list.length ? (
                <div className="mini-empty">
                  <Users size={26} />
                  Bu ro‘yxatda hech kim yo‘q
                </div>
              ) : (
                <div className="mini-rows">
                  {list.map((r) => {
                    const notice = noticeOf(r.employee.id);
                    return (
                      <button className={`mini-row mg-row ${fresh.has(r.employee.id) ? "fresh" : ""}`} key={r.employee.id} onClick={() => setCardFor(r.employee.id)}>
                        <span className={`mg-avatar ${stateTone(r)}`}>
                          {r.employee.photoDataUrl ? <img src={r.employee.photoDataUrl} alt="" /> : `${r.employee.firstName[0] || ""}${r.employee.lastName[0] || ""}`}
                        </span>
                        <span>
                          <b>
                            {r.employee.firstName} {r.employee.lastName}
                          </b>
                          <small>
                            {r.branch}
                            {r.record?.checkIn ? ` · ${r.record.checkIn}${r.record.checkOut ? ` → ${r.record.checkOut}` : ""}` : r.scheduledStart ? ` · grafik ${r.scheduledStart}` : ""}
                            {r.record?.breaks?.some((b) => !b.end) ? " · ☕ tanaffusda" : ""}
                          </small>
                          {notice && !r.record?.checkIn && (
                            <small className="mg-notice">
                              ⏳ ~{notice.minutes} daq · {notice.reason}
                            </small>
                          )}
                        </span>
                        <span className={`mini-chip ${chipTone(r)}`}>
                          {flagged(r) && <AlertTriangle size={11} />} {stateLabel(r)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
            <p className="mp-note">Xodimga bosing — karta: oylik tarix, trendlar, hujjatlar, yozish va qo‘lda belgilash.</p>
          </>
        ))}

      {view === "requests" && (
        <>
          <div className="mg-req-bar">
            <span>{pendingCount ? `${pendingCount} ta so‘rov kutmoqda` : ""}</span>
            {selectableToggle}
          </div>
          {!pendingCount && !loading && (
            <div className="mini-empty mg-empty">
              <Check size={28} />
              Hamma so‘rovlar ko‘rib chiqilgan
            </div>
          )}
          {expiring.length > 0 && (
            <>
              <div className="mp-group-title">Hujjat muddatlari · {expiring.length}</div>
              <section className="mini-card">
                <div className="mini-rows">
                  {expiring.slice(0, 6).map((d) => (
                    <button className="mini-row" key={d.id} onClick={() => setCardFor(d.employeeId)}>
                      <span className={`mini-ico ${d.status === "EXPIRED" ? "bad" : ""}`}>
                        <FileWarning size={17} />
                      </span>
                      <span>
                        <b>{d.employeeName}</b>
                        <small>
                          {d.title} · {d.branchName}
                        </small>
                      </span>
                      <span className={`mini-chip ${d.status === "EXPIRED" ? "bad" : "warn"}`}>{d.status === "EXPIRED" ? "O‘tgan" : `${dateUz(d.expiresAt)} gacha`}</span>
                    </button>
                  ))}
                </div>
              </section>
            </>
          )}
          {fines.length > 0 && <div className="mp-group-title">Jarima takliflari (filial rahbarlaridan)</div>}
          {fines.map((f) => {
            const item = { kind: "fine" as const, id: f.id };
            return (
              <article className={`mg-req ${isSelected(item) ? "picked" : ""}`} key={f.id}>
                <div className="mg-req-head">
                  {pick(item) || (
                    <span className="mini-ico bad">
                      <Gavel size={17} />
                    </span>
                  )}
                  <span>
                    <b>
                      {f.employeeName} · −{f.amount.toLocaleString("ru-RU")} so‘m
                    </b>
                    <small>
                      {f.branchName} · taklif: {f.proposedBy}
                    </small>
                  </span>
                </div>
                <p>«{f.reason}»</p>
                {!selecting && (
                  <Actions busy={busy === f.id} onApprove={() => act(f.id, () => decide(item, true), "Jarima qo‘llandi — xodimga xabar yuborildi")} onReject={() => void reject(item, `${f.employeeName} jarimasi`)} />
                )}
              </article>
            );
          })}
          {marks.length > 0 && <div className="mp-group-title">Belgilash so‘rovlari (unutilgan kirish/chiqish)</div>}
          {markDays.map((date) => (
            <div key={date} className="mg-day">
              <div className="mg-day-title">{dateLongUz(date, true)}</div>
              {marks
                .filter((m) => m.date === date)
                .map((m) => {
                  const item = { kind: "mark" as const, id: m.id };
                  return (
                    <article className={`mg-req ${isSelected(item) ? "picked" : ""}`} key={m.id}>
                      <div className="mg-req-head">
                        {pick(item) || <span className={`mini-ico ${m.kind === "IN" ? "ok" : "bad"}`}>{m.kind === "IN" ? <LogIn size={17} /> : <LogOut size={17} />}</span>}
                        <span>
                          <b>{m.employeeName}</b>
                          <small>
                            {m.kind === "IN" ? "Kirish" : "Chiqish"} · {m.time} · {m.branchName}
                          </small>
                        </span>
                      </div>
                      <p>«{m.comment}»</p>
                      {!selecting && (
                        <Actions
                          busy={busy === m.id}
                          onApprove={() => act(m.id, () => decide(item, true), `${m.kind === "IN" ? "Kirish" : "Chiqish"} ${m.time} davomatga yozildi`)}
                          onReject={() => void reject(item, `${m.employeeName} — ${m.kind === "IN" ? "kirish" : "chiqish"} ${m.time}`)}
                        />
                      )}
                    </article>
                  );
                })}
            </div>
          ))}
          {leaves.length > 0 && <div className="mp-group-title">Ta’til so‘rovlari</div>}
          {leaves.map((l) => {
            const item = { kind: "leave" as const, id: l.id };
            return (
              <article className={`mg-req ${isSelected(item) ? "picked" : ""}`} key={l.id}>
                <div className="mg-req-head">
                  {pick(item) || (
                    <span className="mini-ico">
                      <Plane size={17} />
                    </span>
                  )}
                  <span>
                    <b>
                      {l.employee?.firstName} {l.employee?.lastName}
                      {l.documentId ? " 📎" : ""}
                    </b>
                    <small>
                      {leaveTypeLabel[l.type] || l.type} · {dateUz(l.startDate)} – {dateUz(l.endDate)}
                    </small>
                  </span>
                </div>
                {l.reason && <p>«{l.reason}»</p>}
                {!selecting && (
                  <Actions
                    busy={busy === l.id}
                    onApprove={() => act(l.id, () => decide(item, true), "Ta’til tasdiqlandi")}
                    onReject={() => void reject(item, `${l.employee?.firstName || "Xodim"} ta’tili`)}
                  />
                )}
              </article>
            );
          })}
          {swaps.length > 0 && <div className="mp-group-title">Smena almashish</div>}
          {swaps.map((s) => {
            const item = { kind: "swap" as const, id: s.id };
            return (
              <article className={`mg-req ${isSelected(item) ? "picked" : ""}`} key={s.id}>
                <div className="mg-req-head">
                  {pick(item) || (
                    <span className="mini-ico">
                      <ArrowLeftRight size={17} />
                    </span>
                  )}
                  <span>
                    <b>
                      {s.requesterName} → {s.colleagueName}
                    </b>
                    <small>
                      {dateUz(s.giveDate)}
                      {s.giveShift ? ` (${s.giveShift})` : ""}
                      {s.takeDate ? ` · evaziga ${dateUz(s.takeDate)}` : ""}
                    </small>
                  </span>
                </div>
                {s.reason && <p>«{s.reason}»</p>}
                {!selecting && (
                  <Actions busy={busy === s.id} onApprove={() => act(s.id, () => decide(item, true), "Almashish tasdiqlandi")} onReject={() => void reject(item, "Smena almashish")} />
                )}
              </article>
            );
          })}
          {dayoffs.length > 0 && <div className="mp-group-title">Dam olish kunini ko‘chirish</div>}
          {dayoffs.map((m) => {
            const item = { kind: "dayoff" as const, id: m.id };
            return (
              <article className={`mg-req ${isSelected(item) ? "picked" : ""}`} key={m.id}>
                <div className="mg-req-head">
                  {pick(item) || (
                    <span className="mini-ico">
                      <CalendarSync size={17} />
                    </span>
                  )}
                  <span>
                    <b>{m.employeeName}</b>
                    <small>
                      {dateUz(m.fromDate)} ({m.fromWeekday}) ishlaydi → {dateUz(m.toDate)} ({m.toWeekday}) dam oladi
                    </small>
                  </span>
                </div>
                {m.reason && <p>«{m.reason}»</p>}
                {!selecting && (
                  <Actions busy={busy === m.id} onApprove={() => act(m.id, () => decide(item, true), "Dam kuni ko‘chirildi")} onReject={() => void reject(item, `${m.employeeName} dam kuni`)} />
                )}
              </article>
            );
          })}
          {overtime.length > 0 && <div className="mp-group-title">Qo‘shimcha ish</div>}
          {overtime.map((o) => {
            const item = { kind: "overtime" as const, id: o.id };
            return (
              <article className={`mg-req ${isSelected(item) ? "picked" : ""}`} key={o.id}>
                <div className="mg-req-head">
                  {pick(item) || (
                    <span className="mini-ico">
                      <Timer size={17} />
                    </span>
                  )}
                  <span>
                    <b>{o.name}</b>
                    <small>
                      {dateUz(o.date)} · +{o.overtimeMinutes} daq · {o.checkIn} → {o.checkOut}
                    </small>
                  </span>
                </div>
                {o.note && <p>«{o.note}»</p>}
                {!selecting && (
                  <Actions busy={busy === o.id} onApprove={() => act(o.id, () => decide(item, true), "Qo‘shimcha ish tasdiqlandi")} onReject={() => void reject(item, `${o.name} qo‘shimcha ishi`)} />
                )}
              </article>
            );
          })}
          {advances.length > 0 && <div className="mp-group-title">Avans so‘rovlari</div>}
          {advances.map((a) => {
            const item = { kind: "advance" as const, id: a.id };
            return (
              <article className={`mg-req ${isSelected(item) ? "picked" : ""}`} key={a.id}>
                <div className="mg-req-head">
                  {pick(item) || (
                    <span className="mini-ico">
                      <HandCoins size={17} />
                    </span>
                  )}
                  <span>
                    <b>{a.employeeName}</b>
                    <small>
                      {som(a.amount)}
                      {a.limit ? ` · shu oy olgan: ${som(a.limit.taken)}` : ""}
                    </small>
                    <small>
                      {a.status === "HR_APPROVED" ? `✓ HR: ${a.hrDecidedBy || "tasdiqlagan"} · moliya tasdig‘i` : "HR tasdig‘i"}
                      {a.payout?.method === "CARD" ? ` · 💳 ${a.payout.cardMask} (${a.payout.holder})` : a.payout?.method === "CASH" ? " · 💵 naqd" : ""}
                    </small>
                  </span>
                </div>
                {a.reason && <p>«{a.reason}»</p>}
                {!selecting && (
                  <Actions busy={busy === a.id} onApprove={() => act(a.id, () => decide(item, true), a.status === "PENDING" && advanceHr && !advanceFinance ? "Moliyaga yuborildi" : a.status === "PENDING" ? "HR bosqichi tasdiqlandi" : "Avans tasdiqlandi")} onReject={() => void reject(item, `${a.employeeName} avansi`)} />
                )}
              </article>
            );
          })}
          {selecting && !window.Telegram?.WebApp?.MainButton && (
            <button className="mini-btn" disabled={!selected.length || busy === "bulk"} onClick={() => void bulkApprove()}>
              Tasdiqlash ({selected.length})
            </button>
          )}
        </>
      )}

      {view === "map" && (
        <BranchMap rows={rows} branches={branches} onOpen={setCardFor} loading={!day} />
      )}
      {view === "week" && (
        <>
          {canAttendance && (
            <>
              <div className="mp-group-title">Diqqat talab (oxirgi 4 hafta)</div>
              <TrendsList rows={trends} onOpen={setCardFor} />
            </>
          )}
          <WeekSummary call={call} onError={handle} />
        </>
      )}
      {cardFor && (
        <EmployeeCardSheet
          employeeId={cardFor}
          call={call}
          canEdit={canEditAttendance}
          onClose={() => setCardFor(null)}
          onToast={onToast}
          onChanged={() => void load()}
        />
      )}
      {view === "desk" && <MiniDesk call={call} role={role} canAttendance={canAttendance} onOpen={(v) => setView(v as ManagerView)} onEmployee={setCardFor} />}
      {view === "devices" && canDevices && <DevicesView call={call} onToast={onToast} />}
      {view === "ops" && canOps && <OpsView call={call} onToast={onToast} />}
      {view === "money" && canMoney && <MoneyView call={call} canAdvances={canMoney} canFines={canMoney} onError={onToast} />}
      {fining && (
        <FineSheet
          call={call}
          direct={fineDirect}
          onClose={() => setFining(false)}
          onError={onToast}
          onDone={(text) => {
            setFining(false);
            onToast(text);
            void load();
          }}
        />
      )}
      {announcing && <QuickAnnounceSheet call={call} branches={branches} onClose={() => setAnnouncing(false)} onToast={onToast} />}
    </div>
  );
}

/** So‘nggi belgilar lentasi: bugun kim qachon keldi/ketdi (eng yangisi tepada). */
function LiveFeed({ rows, onOpen }: { rows: RosterRow[]; onOpen: (employeeId: string) => void }) {
  const events = rows
    .flatMap((r) => [
      ...(r.record?.checkIn ? [{ r, time: r.record.checkIn, kind: "in" as const }] : []),
      ...(r.record?.checkOut ? [{ r, time: r.record.checkOut, kind: "out" as const }] : []),
    ])
    .sort((a, b) => b.time.localeCompare(a.time))
    .slice(0, 6);
  if (!events.length) return null;
  return (
    <section className="mg-feed" aria-label="So‘nggi belgilar">
      <div className="mg-feed-head">So‘nggi belgilar</div>
      <div className="mg-feed-list">
        {events.map(({ r, time, kind }) => (
          <button key={`${r.employee.id}:${kind}`} className={`mg-feed-item ${kind} ${kind === "in" && r.late ? "late" : ""}`} onClick={() => onOpen(r.employee.id)}>
            <span className="mg-avatar sm">
              {r.employee.photoDataUrl ? <img src={r.employee.photoDataUrl} alt="" /> : `${r.employee.firstName[0] || ""}${r.employee.lastName[0] || ""}`}
            </span>
            <b>{r.employee.firstName}</b>
            <small>
              {kind === "in" ? <LogIn size={11} /> : <LogOut size={11} />} {time}
            </small>
          </button>
        ))}
      </div>
    </section>
  );
}

function BranchSelect({ value, options, onChange }: { value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="mg-branch">
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Filial">
        <option value="">Barcha filiallar</option>
        {options.map((b) => (
          <option key={b} value={b}>
            {b}
          </option>
        ))}
      </select>
      <ChevronDown size={16} />
    </label>
  );
}

/* --------------------------------------------------------- filial xaritasi --- */
type MapFilter = "ALL" | "OK" | "LATE" | "FLAG" | "EDGE";
const personTone = (r: RosterRow): MapPoint["tone"] => (r.record?.flags?.length && !r.record.flagsReviewedBy ? "bad" : r.late ? "warn" : r.state === "LEFT" ? "muted" : "ok");

/**
 * Haqiqiy xarita: «Barcha filiallar» — har filial pinida kelganlar soni; filial tanlansa —
 * ruxsat etilgan radius va xodimlar belgilagan joylar (avatar-pin). Pin bosilsa — ma’lumot kartasi.
 */
/** Rahbar Mini App’i va panel (sayt) uchun umumiy filial xaritasi. `height` — panelda kattaroq. */
export function BranchMap({
  rows,
  branches,
  onOpen,
  loading,
  height = 380,
}: {
  rows: RosterRow[];
  branches: Branch[];
  onOpen: (employeeId: string) => void;
  loading: boolean;
  height?: number;
}) {
  const active = useMemo(() => branches.filter((b) => b.status !== "INACTIVE" && Number.isFinite(b.latitude) && (b.latitude || b.longitude)), [branches]);
  const [focus, setFocus] = useState<string>(() => (active.length === 1 ? active[0].id : "ALL"));
  const [filter, setFilter] = useState<MapFilter>("ALL");
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (focus !== "ALL" && !active.some((b) => b.id === focus)) setFocus(active.length === 1 ? active[0].id : "ALL");
    else if (focus === "ALL" && active.length === 1) setFocus(active[0].id);
  }, [active, focus]);
  if (loading) return <SkeletonList rows={3} />;
  if (!active.length)
    return (
      <div className="mini-empty">
        <MapPin size={26} />
        Filiallar koordinatasi kiritilmagan
      </div>
    );

  const byBranch = (id: string) => rows.filter((r) => r.employee.branchId === id);
  const stat = (list: RosterRow[]) => ({
    in: list.filter((r) => r.state === "IN" || r.state === "LEFT").length,
    expected: list.filter((r) => !["DAY_OFF", "ON_LEAVE", "UPCOMING"].includes(r.state)).length,
    late: list.filter((r) => r.late).length,
    flagged: list.filter((r) => r.record?.flags?.length && !r.record.flagsReviewedBy).length,
  });
  const branch = active.find((b) => b.id === focus);

  // «Barcha filiallar» rejimi
  if (!branch) {
    const points: MapPoint[] = active.map((b) => {
      const s = stat(byBranch(b.id));
      const rate = s.expected ? s.in / s.expected : 1;
      return {
        id: b.id,
        lat: b.latitude,
        lng: b.longitude,
        kind: "branch",
        label: b.name,
        badge: `${s.in}/${s.expected}`,
        tone: s.flagged ? "bad" : rate >= 0.9 ? "ok" : rate >= 0.7 ? "warn" : "bad",
      };
    });
    return (
      <>
        <BranchChips branches={active} focus={focus} onFocus={setFocus} />
        <TileMap points={points} circles={active.map((b) => ({ id: b.id, lat: b.latitude, lng: b.longitude, radius: b.radiusMeters }))} fitKey="ALL" height={height} onPick={(p) => p && setFocus(p.id)} />
        <section className="mini-card mg-branch-list">
          {active
            .map((b) => ({ b, s: stat(byBranch(b.id)) }))
            .sort((x, y) => (x.s.expected ? x.s.in / x.s.expected : 1) - (y.s.expected ? y.s.in / y.s.expected : 1))
            .map(({ b, s }) => {
              const rate = s.expected ? Math.round((s.in / s.expected) * 100) : 100;
              return (
                <button key={b.id} className="mg-branch-row" onClick={() => setFocus(b.id)}>
                  <span>
                    <b>{b.name}</b>
                    <small>
                      {s.in}/{s.expected} keldi{s.late ? ` · ${s.late} kechikdi` : ""}
                      {s.flagged ? ` · ⚠️ ${s.flagged}` : ""}
                    </small>
                  </span>
                  <span className="mg-meter">
                    <i style={{ width: `${rate}%` }} className={rate >= 90 ? "ok" : rate >= 70 ? "warn" : "bad"} />
                  </span>
                  <em>{rate}%</em>
                </button>
              );
            })}
        </section>
      </>
    );
  }

  // Bitta filial
  const list = byBranch(branch.id);
  const located = list
    .filter((r) => typeof r.record?.latitude === "number" && typeof r.record?.longitude === "number")
    .map((r) => ({ r, distance: Math.round(haversineDistance(branch.latitude, branch.longitude, r.record!.latitude!, r.record!.longitude!)) }));
  const counts = {
    ok: located.filter((p) => !p.r.late && !(p.r.record?.flags?.length && !p.r.record.flagsReviewedBy)).length,
    late: located.filter((p) => p.r.late).length,
    flag: located.filter((p) => p.r.record?.flags?.length && !p.r.record.flagsReviewedBy).length,
    edge: located.filter((p) => p.distance > branch.radiusMeters).length,
  };
  const visible = located.filter(({ r, distance }) =>
    filter === "ALL"
      ? true
      : filter === "OK"
        ? !r.late && !(r.record?.flags?.length && !r.record.flagsReviewedBy)
        : filter === "LATE"
          ? r.late
          : filter === "FLAG"
            ? Boolean(r.record?.flags?.length && !r.record.flagsReviewedBy)
            : distance > branch.radiusMeters,
  );
  const points: MapPoint[] = [
    { id: `branch:${branch.id}`, lat: branch.latitude, lng: branch.longitude, kind: "branch", label: branch.name, tone: "info" },
    ...visible.map(({ r }) => ({
      id: r.employee.id,
      lat: r.record!.latitude!,
      lng: r.record!.longitude!,
      kind: "person" as const,
      label: r.employee.firstName,
      initials: `${r.employee.firstName[0] || ""}${r.employee.lastName[0] || ""}`,
      photo: r.employee.photoDataUrl,
      tone: personTone(r),
    })),
  ];
  const pick = located.find((p) => p.r.employee.id === selected);
  const notMarked = list.filter((r) => r.state === "NOT_YET" || r.state === "ABSENT").length;
  return (
    <>
      <BranchChips branches={active} focus={focus} onFocus={(id) => (setFocus(id), setSelected(null))} />
      <div className="mg-map-filters" role="radiogroup">
        {(
          [
            ["ALL", `Hammasi ${located.length}`, ""],
            ["OK", `Vaqtida ${counts.ok}`, "ok"],
            ["LATE", `Kechikkan ${counts.late}`, "warn"],
            ["FLAG", `Shubhali ${counts.flag}`, "bad"],
            ["EDGE", `Chegarada ${counts.edge}`, "warn"],
          ] as const
        ).map(([key, label, tone]) => (
          <button
            key={key}
            role="radio"
            aria-checked={filter === key}
            className={`${tone} ${filter === key ? "on" : ""}`}
            onClick={() => {
              haptic.select();
              setFilter(key);
              setSelected(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <TileMap
        points={points}
        circles={[{ id: branch.id, lat: branch.latitude, lng: branch.longitude, radius: branch.radiusMeters }]}
        selectedId={selected}
        fitKey={`${branch.id}:${filter}`}
        onPick={(p) => setSelected(p && p.kind === "person" ? p.id : null)}
        height={height}
      >
        {pick && (
          <div className="tm-card" onPointerDown={(event) => event.stopPropagation()}>
            <span className={`mg-avatar ${personTone(pick.r)}`}>
              {pick.r.employee.photoDataUrl ? <img src={pick.r.employee.photoDataUrl} alt="" /> : `${pick.r.employee.firstName[0] || ""}${pick.r.employee.lastName[0] || ""}`}
            </span>
            <span>
              <b>
                {pick.r.employee.firstName} {pick.r.employee.lastName}
              </b>
              <small>
                {pick.r.record?.checkIn ? `Keldi ${pick.r.record.checkIn}` : ""}
                {pick.r.record?.checkOut ? ` · ketdi ${pick.r.record.checkOut}` : ""} · {pick.distance} m
                {pick.distance > branch.radiusMeters ? " (chegarada)" : ""}
              </small>
              {pick.r.record?.flags?.length && !pick.r.record.flagsReviewedBy ? (
                <small className="bad">⚠️ {pick.r.record.flags.map((f) => FLAG_LABELS[f as keyof typeof FLAG_LABELS] || f).join(", ")}</small>
              ) : null}
            </span>
            <button className="mini-btn sm" onClick={() => onOpen(pick.r.employee.id)}>
              Karta
            </button>
          </div>
        )}
      </TileMap>
      <section className="mg-map-stats">
        <div>
          <b>{stat(list).in}</b>
          <small>keldi</small>
        </div>
        <div>
          <b>{notMarked}</b>
          <small>belgilamagan</small>
        </div>
        <div>
          <b>{branch.radiusMeters} m</b>
          <small>radius</small>
        </div>
      </section>
      {visible.length > 0 && (
        <section className="mp-group">
          {[...visible]
            .sort((a, b) => b.distance - a.distance)
            .map(({ r, distance }) => (
              <button className="mp-row link" key={r.employee.id} onClick={() => setSelected(r.employee.id)}>
                <span>
                  <i className={`mg-dot ${personTone(r)}`} /> {r.employee.firstName} {r.employee.lastName}
                </span>
                <b className={distance > branch.radiusMeters ? "warn" : ""}>
                  {distance} m{r.record?.flags?.length && !r.record.flagsReviewedBy ? " ⚠️" : ""}
                </b>
              </button>
            ))}
        </section>
      )}
    </>
  );
}

function BranchChips({ branches, focus, onFocus }: { branches: Branch[]; focus: string; onFocus: (id: string) => void }) {
  if (branches.length < 2) return null;
  return (
    <div className="mg-map-branches">
      <button className={focus === "ALL" ? "on" : ""} onClick={() => onFocus("ALL")}>
        Barcha filiallar
      </button>
      {branches.map((b) => (
        <button key={b.id} className={focus === b.id ? "on" : ""} onClick={() => onFocus(b.id)}>
          {b.name}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------- haftalik xulosa --- */
function WeekSummary({ call, onError }: { call: <T>(url: string) => Promise<T>; onError: (reason: unknown) => void }) {
  const [data, setData] = useState<Analytics | null>(null);
  useEffect(() => {
    void call<Analytics>(`/analytics?month=${tashkentIsoDate().slice(0, 7)}`)
      .then(setData)
      .catch(onError);
  }, [call, onError]);
  if (!data) return <SkeletonList rows={4} />;
  const today = tashkentIsoDate();
  const week = data.daily.filter((d) => d.date <= today).slice(-7);
  const delta = (now: number, before: number) => now - before;
  const Trend = ({ value, inverse }: { value: number; inverse?: boolean }) =>
    value === 0 ? null : (
      <em className={(value > 0) !== Boolean(inverse) ? "up" : "down"}>
        {value > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />} {Math.abs(value)}
      </em>
    );
  return (
    <>
      <section className="mg-kpis">
        <div>
          <small>Davomat</small>
          <b>{data.current.attendanceRate}%</b>
          <Trend value={delta(data.current.attendanceRate, data.previous.attendanceRate)} />
        </div>
        <div>
          <small>Vaqtida kelish</small>
          <b>{data.current.punctuality}%</b>
          <Trend value={delta(data.current.punctuality, data.previous.punctuality)} />
        </div>
        <div>
          <small>Kechikish</small>
          <b>{Math.round(data.current.lateMinutes / 60)} s</b>
          <Trend value={Math.round(delta(data.current.lateMinutes, data.previous.lateMinutes) / 60)} inverse />
        </div>
        <div>
          <small>Kelmagan</small>
          <b>{data.current.absent}</b>
          <Trend value={delta(data.current.absent, data.previous.absent)} inverse />
        </div>
      </section>
      <div className="mp-group-title">Oxirgi 7 kun</div>
      <section className="mini-card mst-chart">
        {week.map((d) => (
          <div key={d.date} className="mst-bar">
            <small>{d.rate}%</small>
            <div>
              <i style={{ height: `${Math.max(3, d.rate)}%` }} className={d.rate < 70 ? "low" : ""} />
            </div>
            <span>{Number(d.date.slice(8))}</span>
          </div>
        ))}
      </section>
      {data.branches.length > 1 && (
        <>
          <div className="mp-group-title">Filiallar reytingi (shu oy)</div>
          <section className="mini-card mg-branch-list">
            {data.branches.map((b, i) => (
              <div className="mg-branch-row" key={b.id}>
                <span>
                  <b>
                    {["🥇", "🥈", "🥉"][i] || `${i + 1}.`} {b.name}
                  </b>
                  <small>
                    {b.employees} xodim · vaqtida {b.punctuality}% · kelmagan {b.absent}
                  </small>
                </span>
                <span className="mg-meter">
                  <i style={{ width: `${b.attendanceRate}%` }} className={b.attendanceRate >= 90 ? "ok" : b.attendanceRate >= 75 ? "warn" : "bad"} />
                </span>
                <em>{b.attendanceRate}%</em>
              </div>
            ))}
          </section>
        </>
      )}
      {data.latecomers.length > 0 && (
        <>
          <div className="mp-group-title">Ko‘p kechikkanlar (shu oy)</div>
          <section className="mp-group">
            {data.latecomers.slice(0, 5).map((p) => (
              <div className="mp-row" key={p.id}>
                <span>{p.name}</span>
                <b className="warn">
                  {p.late} marta · {p.lateMinutes} daq
                </b>
              </div>
            ))}
          </section>
        </>
      )}
      {data.punctual.length > 0 && (
        <>
          <div className="mp-group-title">Eng intizomlilar</div>
          <section className="mp-group">
            {data.punctual.slice(0, 5).map((p, i) => (
              <div className="mp-row" key={p.id}>
                <span>
                  {["🥇", "🥈", "🥉"][i] || "⭐"} {p.name}
                </span>
                <b className="ok">{p.present} kun vaqtida</b>
              </div>
            ))}
          </section>
        </>
      )}
    </>
  );
}

function Actions({ busy, onApprove, onReject }: { busy: boolean; onApprove: () => void; onReject: () => void }) {
  return (
    <div className="mg-actions">
      <button className="mini-btn sm" disabled={busy} onClick={onApprove}>
        {busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />} Tasdiqlash
      </button>
      <button className="mini-btn sm ghost" disabled={busy} onClick={onReject}>
        <X size={16} /> Rad etish
      </button>
    </div>
  );
}

function Tile({ label, value, tone, active, onClick }: { label: string; value: number; tone?: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      className={`mg-tile ${tone || ""} ${active ? "on" : ""}`}
      onClick={() => {
        haptic.select();
        onClick();
      }}
    >
      <b>{value}</b>
      <small>{label}</small>
    </button>
  );
}

const order = (r: RosterRow) => (r.state === "ABSENT" ? 0 : r.state === "NOT_YET" ? 1 : r.late ? 2 : r.state === "IN" ? 3 : r.state === "LEFT" ? 4 : 5);
const stateTone = (r: RosterRow) => (r.state === "ABSENT" ? "bad" : r.late ? "warn" : r.state === "IN" || r.state === "LEFT" ? "ok" : "");
const chipTone = (r: RosterRow) => (r.record?.flags?.length && !r.record.flagsReviewedBy ? "bad" : stateTone(r));
function stateLabel(r: RosterRow) {
  if (r.state === "IN") return r.late ? `${r.record?.lateMinutes} daq kech` : "Ishda";
  if (r.state === "LEFT") return "Ketdi";
  if (r.state === "ABSENT") return "Kelmadi";
  if (r.state === "NOT_YET") return "Hali yo‘q";
  if (r.state === "ON_LEAVE") return "Ta’tilda";
  if (r.state === "DAY_OFF") return "Dam";
  if (r.state === "PRACTICE") return "Mashq";
  return "Kutilmoqda";
}
