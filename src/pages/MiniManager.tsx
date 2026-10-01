import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeftRight, Check, ChevronDown, HandCoins, LoaderCircle, Plane, RefreshCw, ShieldAlert, Users, X } from "lucide-react";
import { ApiError } from "../api";
import { can } from "@/lib/permissions";
import { dateUz, tashkentIsoDate } from "@/lib/format";
import type { Attendance, Employee, LeaveRequest, Role } from "@/lib/types";
import { leaveTypeLabel } from "../types";

/*
 * Rahbar rejimi: panelga kirmasdan Telegram’dan bugungi holat va so‘rovlarni
 * bir tugmada hal qilish. Panelning o‘z API’lari ishlatiladi (huquq va filial
 * chegarasi serverda tekshiriladi), token alohida — xodim sessiyasiga aralashmaydi.
 */

export type ManagerAuth = {
  token: string;
  user: { id: string; name: string; role: Role; branchIds: string[]; photoDataUrl?: string };
  company: { id: string; name: string };
};
type Toast = (text: string, tone?: "ok" | "error") => void;

/** Rahbar sessiyasini so‘raydi. Rahbar bo‘lmasa null (jim). */
export async function requestManagerAuth(initData: string): Promise<ManagerAuth | null> {
  try {
    const response = await fetch("/api/telegram/manager-auth", {
      method: "POST",
      credentials: "omit",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData }),
    });
    if (response.status !== 200) return null;
    return (await response.json()) as ManagerAuth;
  } catch {
    return null;
  }
}

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

const som = (value: number) => `${Math.round(value).toLocaleString("ru-RU").replace(/\s/g, " ")} so‘m`;
type Filter = "ALL" | "IN" | "LATE" | "ABSENT" | "NOT_YET" | "ON_LEAVE" | "FLAGGED";

export function ManagerHome({ auth, onToast, onExpired }: { auth: ManagerAuth; onToast: Toast; onExpired: () => void }) {
  const call = useMemo(() => client(auth.token), [auth.token]);
  const role = auth.user.role;
  const [view, setView] = useState<"today" | "requests">("today");
  const [day, setDay] = useState<Day | null>(null);
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [swaps, setSwaps] = useState<SwapRow[]>([]);
  const [advances, setAdvances] = useState<AdvanceRow[]>([]);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [branch, setBranch] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const canAttendance = can(role, "attendance.view");
  const canLeave = can(role, "leave.approve");
  const canSwaps = can(role, "leave.approve") || can(role, "attendance.edit");
  const canAdvances = can(role, "payroll.edit");

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
      const [d, l, s, a] = await Promise.all([
        canAttendance ? call<Day>(`/attendance/day?date=${tashkentIsoDate()}`) : Promise.resolve(null),
        canLeave ? call<LeaveRow[]>("/leave") : Promise.resolve([] as LeaveRow[]),
        canSwaps ? call<SwapRow[]>("/shift-swaps") : Promise.resolve([] as SwapRow[]),
        canAdvances ? call<AdvanceRow[]>("/payroll/advances?status=PENDING") : Promise.resolve([] as AdvanceRow[]),
      ]);
      setDay(d);
      setLeaves(l.filter((x) => x.status === "PENDING"));
      setSwaps(s.filter((x) => x.status === "PENDING_MANAGER"));
      setAdvances(a);
    } catch (reason) {
      handle(reason);
    } finally {
      setLoading(false);
    }
  }, [call, canAttendance, canLeave, canSwaps, canAdvances, handle]);

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
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");
      await load();
    } catch (reason) {
      handle(reason);
    } finally {
      setBusy(null);
    }
  };

  const rows = day?.rows || [];
  const branches = [...new Set(rows.map((r) => r.branch).filter(Boolean))] as string[];
  const scoped = rows.filter((r) => !branch || r.branch === branch);
  const flagged = (r: RosterRow) => Boolean(r.record?.flags?.length && !r.record.flagsReviewedBy);
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
  const pendingCount = leaves.length + swaps.length + advances.length;
  const rate = stats.expected ? Math.round((stats.in / stats.expected) * 100) : 0;

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
      <div className="mini-seg" role="tablist">
        <button role="tab" aria-selected={view === "today"} className={view === "today" ? "on" : ""} onClick={() => setView("today")}>
          Bugun
        </button>
        <button role="tab" aria-selected={view === "requests"} className={view === "requests" ? "on" : ""} onClick={() => setView("requests")}>
          So‘rovlar{pendingCount ? <span className="mini-badge inline">{pendingCount}</span> : null}
        </button>
      </div>

      {view === "today" ? (
        !canAttendance ? (
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
            {stats.flagged > 0 && (
              <button className={`mg-alert ${filter === "FLAGGED" ? "on" : ""}`} onClick={() => setFilter(filter === "FLAGGED" ? "ALL" : "FLAGGED")}>
                <ShieldAlert size={17} />
                <span>{stats.flagged} ta shubhali belgi (GPS / internetsiz) — panelda ko‘rib chiqing</span>
              </button>
            )}
            {branches.length > 1 && (
              <label className="mg-branch">
                <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Filial">
                  <option value="">Barcha filiallar</option>
                  {branches.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
                <ChevronDown size={16} />
              </label>
            )}
            <section className="mini-card">
              {!list.length ? (
                <div className="mini-empty">
                  <Users size={26} />
                  Bu ro‘yxatda hech kim yo‘q
                </div>
              ) : (
                <div className="mini-rows">
                  {list.map((r) => (
                    <div className="mini-row mg-row" key={r.employee.id}>
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
                        </small>
                      </span>
                      <span className={`mini-chip ${chipTone(r)}`}>
                        {flagged(r) && <AlertTriangle size={11} />} {stateLabel(r)}
                      </span>
                      {r.employee.phone && (r.state === "ABSENT" || r.state === "NOT_YET") && (
                        <a className="mg-call" href={`tel:${r.employee.phone}`} aria-label="Qo‘ng‘iroq">
                          📞
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )
      ) : (
        <>
          {!pendingCount && !loading && (
            <div className="mini-empty mg-empty">
              <Check size={28} />
              Hamma so‘rovlar ko‘rib chiqilgan
            </div>
          )}
          {leaves.length > 0 && <div className="mp-group-title">Ta’til so‘rovlari</div>}
          {leaves.map((l) => (
            <article className="mg-req" key={l.id}>
              <div className="mg-req-head">
                <span className="mini-ico">
                  <Plane size={17} />
                </span>
                <span>
                  <b>
                    {l.employee?.firstName} {l.employee?.lastName}
                  </b>
                  <small>
                    {leaveTypeLabel[l.type] || l.type} · {dateUz(l.startDate)} – {dateUz(l.endDate)}
                  </small>
                </span>
              </div>
              {l.reason && <p>«{l.reason}»</p>}
              <Actions
                busy={busy === l.id}
                onApprove={() => act(l.id, () => call(`/leave/${l.id}`, { status: "APPROVED" }, "PATCH"), "Ta’til tasdiqlandi")}
                onReject={() => act(l.id, () => call(`/leave/${l.id}`, { status: "REJECTED" }, "PATCH"), "Ta’til rad etildi")}
              />
            </article>
          ))}
          {swaps.length > 0 && <div className="mp-group-title">Smena almashish</div>}
          {swaps.map((s) => (
            <article className="mg-req" key={s.id}>
              <div className="mg-req-head">
                <span className="mini-ico">
                  <ArrowLeftRight size={17} />
                </span>
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
              <Actions
                busy={busy === s.id}
                onApprove={() => act(s.id, () => call(`/shift-swaps/${s.id}/decide`, { approve: true }), "Almashish tasdiqlandi")}
                onReject={() => act(s.id, () => call(`/shift-swaps/${s.id}/decide`, { approve: false }), "Almashish rad etildi")}
              />
            </article>
          ))}
          {advances.length > 0 && <div className="mp-group-title">Avans so‘rovlari</div>}
          {advances.map((a) => (
            <article className="mg-req" key={a.id}>
              <div className="mg-req-head">
                <span className="mini-ico">
                  <HandCoins size={17} />
                </span>
                <span>
                  <b>{a.employeeName}</b>
                  <small>
                    {som(a.amount)}
                    {a.limit ? ` · shu oy olgan: ${som(a.limit.taken)}` : ""}
                  </small>
                </span>
              </div>
              {a.reason && <p>«{a.reason}»</p>}
              <Actions
                busy={busy === a.id}
                onApprove={() => act(a.id, () => call(`/payroll/advances/${a.id}/decide`, { approve: true }), "Avans tasdiqlandi")}
                onReject={() => act(a.id, () => call(`/payroll/advances/${a.id}/decide`, { approve: false }), "Avans rad etildi")}
              />
            </article>
          ))}
        </>
      )}
    </div>
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
    <button className={`mg-tile ${tone || ""} ${active ? "on" : ""}`} onClick={onClick}>
      <b>{value}</b>
      <small>{label}</small>
    </button>
  );
}

export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <section className="mini-card" aria-busy="true">
      <div className="mini-rows">
        {Array.from({ length: rows }, (_, i) => (
          <div className="mini-row sk-row" key={i}>
            <span className="sk sk-circle" />
            <span>
              <i className="sk sk-line" style={{ width: `${55 + ((i * 13) % 30)}%` }} />
              <i className="sk sk-line short" />
            </span>
          </div>
        ))}
      </div>
    </section>
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
