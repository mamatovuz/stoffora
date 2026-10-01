import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  CheckSquare,
  ChevronDown,
  HandCoins,
  Hourglass,
  LoaderCircle,
  MapPin,
  Plane,
  RefreshCw,
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
import { dateUz, tashkentIsoDate } from "@/lib/format";
import type { Attendance, Branch, Employee, LeaveRequest } from "@/lib/types";
import { leaveTypeLabel } from "../types";
import { SkeletonList } from "./mini/shared";
import type { ManagerAuth, ManagerView } from "./mini/managerAuth";
import { callPhone, choiceNative, confirmNative, haptic, useMainButton, useSecondaryButton, writeInTelegram } from "./mini/tg";

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

type RosterRow = {
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
type AdvanceRow = { id: string; employeeName: string; amount: number; reason?: string; status: string; month: string; limit?: { max: number; taken: number } };
type OvertimeRow = { id: string; date: string; name: string; checkIn?: string; checkOut?: string; scheduledEnd: string; overtimeMinutes: number; approved?: boolean; note?: string };
type LateNotice = { id: string; employeeId: string; employeeName: string; minutes: number; reason: string; createdAt: string };
type Analytics = {
  month: string;
  current: { attendanceRate: number; punctuality: number; lateMinutes: number; absent: number; score: number | null };
  previous: { attendanceRate: number; punctuality: number; lateMinutes: number; absent: number; score: number | null };
  punctual: { id: string; name: string; present: number }[];
  latecomers: { id: string; name: string; lateMinutes: number; late: number }[];
  daily: { date: string; rate: number; late: number; absent: number }[];
};
type Pending = { kind: "leave" | "swap" | "advance" | "overtime"; id: string };

const som = (value: number) => `${Math.round(value).toLocaleString("ru-RU").replace(/\s/g, " ")} so‘m`;
type Filter = "ALL" | "IN" | "LATE" | "ABSENT" | "NOT_YET" | "ON_LEAVE" | "FLAGGED";

export function ManagerHome({ auth, onToast, onExpired, initialView }: { auth: ManagerAuth; onToast: Toast; onExpired: () => void; initialView?: ManagerView }) {
  const call = useMemo(() => client(auth.token), [auth.token]);
  const role = auth.user.role;
  const [view, setView] = useState<ManagerView>(initialView || "today");
  const [day, setDay] = useState<Day | null>(null);
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [swaps, setSwaps] = useState<SwapRow[]>([]);
  const [advances, setAdvances] = useState<AdvanceRow[]>([]);
  const [overtime, setOvertime] = useState<OvertimeRow[]>([]);
  const [notices, setNotices] = useState<LateNotice[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [branch, setBranch] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Pending[]>([]);
  const canAttendance = can(role, "attendance.view");
  const canLeave = can(role, "leave.approve");
  const canSwaps = can(role, "leave.approve") || can(role, "attendance.edit");
  const canAdvances = can(role, "payroll.edit");
  const canOvertime = can(role, "attendance.edit") || can(role, "payroll.edit");
  const canAnalytics = can(role, "dashboard.view");

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
      const [d, l, s, a, o, n, b] = await Promise.all([
        canAttendance ? call<Day>(`/attendance/day?date=${tashkentIsoDate()}`) : Promise.resolve(null),
        canLeave ? call<LeaveRow[]>("/leave") : Promise.resolve([] as LeaveRow[]),
        canSwaps ? call<SwapRow[]>("/shift-swaps") : Promise.resolve([] as SwapRow[]),
        canAdvances ? call<AdvanceRow[]>("/payroll/advances?status=PENDING") : Promise.resolve([] as AdvanceRow[]),
        canOvertime ? call<{ rows: OvertimeRow[] }>(`/overtime?month=${month}`).catch(() => ({ rows: [] as OvertimeRow[] })) : Promise.resolve({ rows: [] as OvertimeRow[] }),
        canAttendance ? call<LateNotice[]>("/late-notices").catch(() => [] as LateNotice[]) : Promise.resolve([] as LateNotice[]),
        canAttendance ? call<Branch[]>("/branches").catch(() => [] as Branch[]) : Promise.resolve([] as Branch[]),
      ]);
      setDay(d);
      setLeaves(l.filter((x) => x.status === "PENDING"));
      setSwaps(s.filter((x) => x.status === "PENDING_MANAGER"));
      setAdvances(a);
      setOvertime(o.rows.filter((r) => r.approved === undefined));
      setNotices(n);
      setBranches(b);
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
  const list = scoped
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
  const pendingCount = leaves.length + swaps.length + advances.length + overtime.length;
  const rate = stats.expected ? Math.round((stats.in / stats.expected) * 100) : 0;

  // Pastki Telegram tugmalari: ommaviy tasdiqlash rejimida.
  useMainButton(view === "requests" && selecting ? { text: selected.length ? `Tasdiqlash (${selected.length})` : "So‘rovlarni belgilang", onClick: () => void bulkApprove(), disabled: !selected.length, progress: busy === "bulk" } : null);
  useSecondaryButton(view === "requests" && selecting ? { text: "Bekor qilish", onClick: () => (setSelecting(false), setSelected([])) } : null);

  async function contact(r: RosterRow) {
    const e = r.employee;
    const options = [...(e.telegramUsername || e.phone ? [{ id: "write", text: "Telegram’da yozish" }] : []), ...(e.phone ? [{ id: "call", text: "Qo‘ng‘iroq" }] : [])];
    if (!options.length) return onToast("Xodimning telefoni va Telegram’i yo‘q", "error");
    const notice = noticeOf(e.id);
    const choice = await choiceNative(
      `${e.firstName} ${e.lastName} · ${stateLabel(r)}${notice ? `\n⏳ ~${notice.minutes} daq kechikadi: «${notice.reason}»` : ""}`,
      options,
    );
    if (choice === "write") writeInTelegram({ username: e.telegramUsername, phone: e.phone });
    if (choice === "call" && e.phone) callPhone(e.phone);
  }

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
        <button className="mg-refresh" onClick={() => void load()} aria-label="Yangilash" disabled={loading}>
          <RefreshCw size={18} className={loading ? "spin" : ""} />
        </button>
      </div>
      <div className="mini-seg four" role="tablist">
        {(
          [
            ["today", "Bugun", 0],
            ["requests", "So‘rovlar", pendingCount],
            ...(canAttendance ? ([["map", "Xarita", 0]] as const) : []),
            ...(canAnalytics ? ([["week", "Xulosa", 0]] as const) : []),
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
            {branchNames.length > 1 && <BranchSelect value={branch} options={branchNames} onChange={setBranch} />}
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
                      <button className="mini-row mg-row" key={r.employee.id} onClick={() => void contact(r)}>
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
            <p className="mp-note">Xodimga bosing — Telegram’da yozish yoki qo‘ng‘iroq qilish.</p>
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
                  </span>
                </div>
                {a.reason && <p>«{a.reason}»</p>}
                {!selecting && (
                  <Actions busy={busy === a.id} onApprove={() => act(a.id, () => decide(item, true), "Avans tasdiqlandi")} onReject={() => void reject(item, `${a.employeeName} avansi`)} />
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
        <BranchMap rows={rows} branches={branches} branch={branch} onBranch={setBranch} branchNames={branchNames} onPick={(r) => void contact(r)} loading={!day} />
      )}
      {view === "week" && <WeekSummary call={call} onError={handle} />}
    </div>
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
/**
 * Tashqi xarita xizmatisiz: filial markazda, ruxsat etilgan radius doira,
 * xodimlar belgilangan nuqtalar (metrda, shimol tepada).
 */
function BranchMap({
  rows,
  branches,
  branch,
  branchNames,
  onBranch,
  onPick,
  loading,
}: {
  rows: RosterRow[];
  branches: Branch[];
  branch: string;
  branchNames: string[];
  onBranch: (value: string) => void;
  onPick: (row: RosterRow) => void;
  loading: boolean;
}) {
  const name = branch || branchNames[0] || branches[0]?.name || "";
  const target = branches.find((b) => b.name === name);
  if (loading) return <SkeletonList rows={3} />;
  if (!target)
    return (
      <div className="mini-empty">
        <MapPin size={26} />
        Filial ma’lumoti topilmadi
      </div>
    );
  const points = rows
    .filter((r) => r.branch === target.name && typeof r.record?.latitude === "number" && typeof r.record?.longitude === "number")
    .map((r) => {
      const dy = (r.record!.latitude! - target.latitude) * 111_320;
      const dx = (r.record!.longitude! - target.longitude) * 111_320 * Math.cos((target.latitude * Math.PI) / 180);
      return { row: r, dx, dy, distance: Math.round(Math.hypot(dx, dy)) };
    });
  const extent = Math.max(target.radiusMeters * 1.4, ...points.map((p) => p.distance * 1.15), 50);
  const size = 300;
  const scale = size / 2 / extent;
  const radius = target.radiusMeters * scale;
  const outside = points.filter((p) => p.distance > target.radiusMeters);
  return (
    <>
      {branchNames.length > 1 && <BranchSelect value={name} options={branchNames} onChange={onBranch} />}
      <section className="mini-card mg-map">
        <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${target.name} — belgilar xaritasi`}>
          <defs>
            <radialGradient id="mg-zone">
              <stop offset="0%" stopColor="var(--m-accent)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="var(--m-accent)" stopOpacity="0.05" />
            </radialGradient>
          </defs>
          {[0.5, 1, 1.5].map((k) => (
            <circle key={k} cx={size / 2} cy={size / 2} r={radius * k} className="mg-map-ring" />
          ))}
          <circle cx={size / 2} cy={size / 2} r={radius} fill="url(#mg-zone)" className="mg-map-zone" />
          <text x={size / 2} y={14} className="mg-map-n">
            N
          </text>
          <g transform={`translate(${size / 2} ${size / 2})`}>
            <rect x={-7} y={-7} width={14} height={14} rx={3} className="mg-map-branch" />
          </g>
          {points.map((p) => (
            <g key={p.row.employee.id} transform={`translate(${size / 2 + p.dx * scale} ${size / 2 - p.dy * scale})`} onClick={() => onPick(p.row)} className="mg-map-dot">
              <circle r={7} className={flaggedTone(p.row)} />
              <text y={-11}>{p.row.employee.firstName}</text>
            </g>
          ))}
        </svg>
        <div className="mini-legend">
          <span>
            <i style={{ background: "var(--m-success)" }} /> Vaqtida
          </span>
          <span>
            <i style={{ background: "var(--m-warn)" }} /> Kechikkan
          </span>
          <span>
            <i style={{ background: "var(--m-danger)" }} /> Shubhali
          </span>
        </div>
        <small className="mg-map-scale">Doira — ruxsat etilgan {target.radiusMeters} m · {points.length} ta belgi</small>
      </section>
      {outside.length > 0 && (
        <div className="mg-alert">
          <ShieldAlert size={17} />
          <span>{outside.length} kishi radius chetida belgilangan (GPS aniqligi hisobiga) — tekshirib ko‘ring.</span>
        </div>
      )}
      <section className="mp-group">
        {points
          .sort((a, b) => b.distance - a.distance)
          .map((p) => (
            <button className="mp-row link" key={p.row.employee.id} onClick={() => onPick(p.row)}>
              <span>
                {p.row.employee.firstName} {p.row.employee.lastName}
              </span>
              <b className={p.distance > target.radiusMeters ? "warn" : ""}>
                {p.distance} m{p.row.record?.flags?.length ? " ⚠️" : ""}
              </b>
            </button>
          ))}
      </section>
    </>
  );
}
const flaggedTone = (r: RosterRow) => (r.record?.flags?.length && !r.record.flagsReviewedBy ? "bad" : r.late ? "warn" : "ok");

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
