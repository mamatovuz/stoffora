import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, Clock3, Flame, Medal, Trophy } from "lucide-react";
import { api, errorText } from "../../api";
import { dateLongUz, dateParts, duration, monthShortUz, tashkentIsoDate } from "@/lib/format";
import type { Attendance } from "@/lib/types";
import { leaveTypeLabel, weekdayShort, weekOrder } from "../../types";
import { SkeletonList } from "./shared";
import { getCached, setCached } from "../miniCache";
import { Seg, type HomeData } from "./shared";
import { haptic } from "./tg";

type View = "calendar" | "schedule" | "stats";
const MONTHS = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun", "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr"];
/** «Oktabr 2026» */
const monthTitle = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

export function MiniHistory({ home, initialView }: { home: HomeData; initialView?: View }) {
  const [view, setView] = useState<View>(initialView || "calendar");
  return (
    <div className="mini-body">
      <div className="mini-title">
        <h1>{view === "calendar" ? "Davomat tarixi" : view === "schedule" ? "Ish grafigim" : "Statistika"}</h1>
        <p>{view === "stats" ? "Oxirgi 6 oy" : monthTitle(tashkentIsoDate())}</p>
      </div>
      <Seg
        className="three"
        value={view}
        onChange={(next) => {
          haptic.select();
          setView(next);
        }}
        options={[
          ["calendar", "Tarix"],
          ["schedule", "Grafigim"],
          ["stats", "Statistika"],
        ]}
      />
      {view === "calendar" && <CalendarView home={home} />}
      {view === "schedule" && <ScheduleView />}
      {view === "stats" && <StatsView />}
    </div>
  );
}

/* ---------------------------------------------------------- kalendar --- */
function CalendarView({ home }: { home: HomeData }) {
  const [rows, setRows] = useState<Attendance[] | null>(() => getCached<Attendance[]>("history"));
  const [error, setError] = useState("");
  useEffect(() => {
    void api<Attendance[]>("/mini/attendance")
      .then((value) => {
        setCached("history", value);
        setRows(value);
      })
      .catch((e) => setError(errorText(e)));
  }, []);
  const today = tashkentIsoDate();
  const month = today.slice(0, 7);
  const [year, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const offset = (new Date(Date.UTC(year, m - 1, 1)).getUTCDay() + 6) % 7;
  const byDate = useMemo(() => new Map((rows || []).map((r) => [r.date, r])), [rows]);
  return (
    <>
      <section className="mini-card">
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
            const weekday = dateParts(date).weekday;
            const workday = home.schedule?.days.find((d) => d.day === weekday)?.enabled ?? true;
            const tone = row?.checkIn
              ? row.lateMinutes
                ? "late"
                : "present"
              : date < today && workday && date >= home.employee.startDate
                ? "absent"
                : !workday
                  ? "off"
                  : "";
            return (
              <span key={date} className={`mini-cal-day ${tone} ${date === today ? "today" : ""}`}>
                {i + 1}
              </span>
            );
          })}
        </div>
        <div className="mini-legend">
          <span>
            <i style={{ background: "var(--m-success)" }} /> Vaqtida
          </span>
          <span>
            <i style={{ background: "var(--m-warn)" }} /> Kechikkan
          </span>
          <span>
            <i style={{ background: "var(--m-danger)" }} /> Kelmagan
          </span>
        </div>
      </section>
      {error && (
        <div className="mini-alert">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}
      <section className="mini-card">
        {rows === null ? (
          <SkeletonList rows={4} />
        ) : rows.length === 0 ? (
          <div className="mini-empty">
            <Clock3 size={28} />
            Hali davomat qaydlari yo‘q
          </div>
        ) : (
          <div className="mini-rows">
            {rows.map((item) => (
              <div className="mini-row" key={item.id}>
                <span className="mini-date">
                  <b>{dateParts(item.date).day}</b>
                  <small>{monthShortUz(item.date)}</small>
                </span>
                <span>
                  <b>
                    {item.checkIn || "—"} → {item.checkOut || "…"}
                  </b>
                  <small>
                    {item.workedMinutes ? duration(item.workedMinutes) : "Ish davom etmoqda"}
                    {item.lateMinutes ? ` · ${item.lateMinutes} daq kech` : ""}
                    {item.overtimeMinutes ? ` · +${item.overtimeMinutes} daq` : ""}
                    {item.breaks?.length ? ` · ☕ ${item.breaks.length}` : ""}
                  </small>
                </span>
                <span className={`mini-chip ${item.lateMinutes ? "warn" : item.checkOut ? "ok" : "info"}`}>
                  {item.lateMinutes ? "Kechikdi" : item.checkOut ? "Vaqtida" : "Ishda"}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

/* ---------------------------------------------------------- grafigim --- */
type ScheduleDay = {
  date: string;
  working: boolean;
  start: string;
  end: string;
  overridden: boolean;
  reason?: string;
  leave?: string;
  checkIn?: string;
  checkOut?: string;
  lateMinutes: number;
  workedMinutes: number;
};
type ScheduleMonth = { month: string; label: string; days: ScheduleDay[]; totals: { workdays: number; plannedMinutes: number; leaveDays: number } };

function shiftMonth(month: string, delta: number) {
  const d = new Date(`${month}-15T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 7);
}

function ScheduleView() {
  const today = tashkentIsoDate();
  const current = today.slice(0, 7);
  const [month, setMonth] = useState(current);
  const [data, setData] = useState<ScheduleMonth | null>(() => getCached<ScheduleMonth>(`schedule:${current}`));
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string>(today);
  useEffect(() => {
    const cached = getCached<ScheduleMonth>(`schedule:${month}`);
    setData(cached);
    setError("");
    void api<ScheduleMonth>(`/mini/schedule?month=${month}`)
      .then((value) => {
        setCached(`schedule:${month}`, value);
        setData(value);
      })
      .catch((e) => setError(errorText(e)));
  }, [month]);
  const [year, m] = month.split("-").map(Number);
  const offset = (new Date(Date.UTC(year, m - 1, 1)).getUTCDay() + 6) % 7;
  const pick = data?.days.find((d) => d.date === selected);
  const upcoming = (data?.days || []).filter((d) => d.date >= today && (d.working || d.leave || d.overridden)).slice(0, 7);
  return (
    <>
      <div className="msc-nav">
        <button aria-label="Oldingi oy" onClick={() => setMonth(shiftMonth(month, -1))} disabled={month <= shiftMonth(current, -3)}>
          <ChevronLeft size={18} />
        </button>
        <b>{data?.label || month}</b>
        <button aria-label="Keyingi oy" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= shiftMonth(current, 2)}>
          <ChevronRight size={18} />
        </button>
      </div>
      {error && (
        <div className="mini-alert">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}
      <section className="mini-card">
        {!data ? (
          <SkeletonList rows={3} />
        ) : (
          <>
            <div className="mini-cal msc-cal">
              {weekOrder.map((d) => (
                <span key={d}>{weekdayShort[d]}</span>
              ))}
              {Array.from({ length: offset }, (_, i) => (
                <i key={`b${i}`} />
              ))}
              {data.days.map((d) => {
                const tone = d.leave ? "leave" : d.overridden ? (d.working ? "swap-on" : "swap-off") : d.working ? "work" : "off";
                return (
                  <button
                    key={d.date}
                    className={`mini-cal-day msc-day ${tone} ${d.date === today ? "today" : ""} ${d.date === selected ? "picked" : ""}`}
                    onClick={() => {
                      haptic.select();
                      setSelected(d.date);
                    }}
                  >
                    {Number(d.date.slice(8))}
                    {d.working && <small>{d.start.replace(/:00$/, "")}</small>}
                  </button>
                );
              })}
            </div>
            <div className="mini-legend">
              <span>
                <i className="lg-work" /> Ish kuni
              </span>
              <span>
                <i className="lg-swap" /> Almashgan
              </span>
              <span>
                <i className="lg-leave" /> Ta’til
              </span>
            </div>
          </>
        )}
      </section>
      {pick && (
        <section className="mini-card msc-detail">
          <b>{dateLongUz(pick.date)}</b>
          <span>
            {pick.leave
              ? `🏖 ${leaveTypeLabel[pick.leave] || "Ta’til"}`
              : pick.working
                ? `🕘 ${pick.start} – ${pick.end}${pick.overridden ? ` · ${pick.reason || "o‘zgartirilgan"}` : ""}`
                : `🌿 Dam olish${pick.overridden ? ` · ${pick.reason || "o‘zgartirilgan"}` : ""}`}
          </span>
          {pick.checkIn && (
            <small>
              Keldi {pick.checkIn}
              {pick.checkOut ? ` · ketdi ${pick.checkOut} · ${duration(pick.workedMinutes)}` : ""}
              {pick.lateMinutes ? ` · ${pick.lateMinutes} daq kech` : ""}
            </small>
          )}
        </section>
      )}
      {data && (
        <section className="mh-stats">
          <div>
            <b>{data.totals.workdays}</b>
            <small>ish kuni</small>
          </div>
          <div>
            <b>{Math.round(data.totals.plannedMinutes / 60)}</b>
            <small>reja soat</small>
          </div>
          <div>
            <b>{data.totals.leaveDays}</b>
            <small>ta’til kuni</small>
          </div>
        </section>
      )}
      {month === current && upcoming.length > 0 && (
        <>
          <div className="mp-group-title">Yaqin kunlar</div>
          <section className="mp-group">
            {upcoming.map((d) => (
              <div className="mp-row" key={d.date}>
                <span>
                  {d.date === today ? "Bugun" : weekdayShort[dateParts(d.date).weekday]}, {Number(d.date.slice(8))}-{monthShortUz(d.date)}
                </span>
                <b className={d.leave ? "" : d.overridden ? "warn" : ""}>{d.leave ? "Ta’til" : d.working ? `${d.start}–${d.end}` : "Dam"}</b>
              </div>
            ))}
          </section>
        </>
      )}
    </>
  );
}

/* -------------------------------------------------------- statistika --- */
type StatsData = {
  streak: { current: number; best: number; badge: { emoji: string; label: string } | null };
  months: { month: string; label: string; present: number; late: number; lateMinutes: number; workedHours: number; overtimeHours: number; onTimeRate: number | null }[];
  leaderboard: { rank: number; total: number; top: { name: string; rate: number; me: boolean }[] } | null;
};

function StatsView() {
  const [data, setData] = useState<StatsData | null>(() => getCached<StatsData>("stats"));
  const [error, setError] = useState("");
  useEffect(() => {
    void api<StatsData>("/mini/stats")
      .then((value) => {
        setCached("stats", value);
        setCached("stats-mini", value);
        setData(value);
      })
      .catch((e) => setError(errorText(e)));
  }, []);
  if (error)
    return (
      <div className="mini-alert">
        <AlertCircle size={18} />
        <span>{error}</span>
      </div>
    );
  if (!data) return <SkeletonList rows={4} />;
  const maxHours = Math.max(1, ...data.months.map((m) => m.workedHours));
  const next = [5, 10, 20, 30, 60].find((n) => n > data.streak.current);
  return (
    <>
      <section className="mst-streak">
        <span className="mst-flame">
          {data.streak.badge?.emoji || <Flame size={26} />}
        </span>
        <span>
          <small>Ketma-ket vaqtida</small>
          <b>{data.streak.current} kun</b>
          <em>
            {data.streak.badge ? `${data.streak.badge.label} · ` : ""}eng yaxshi natija: {data.streak.best} kun
          </em>
        </span>
      </section>
      {next && (
        <div className="mst-goal">
          <div>
            <i style={{ width: `${Math.round((data.streak.current / next) * 100)}%` }} />
          </div>
          <small>
            Keyingi nishongacha {next - data.streak.current} kun vaqtida keling
          </small>
        </div>
      )}

      <div className="mp-group-title">Ishlangan soatlar</div>
      <section className="mini-card mst-chart" aria-label="Oylar bo‘yicha ishlangan soatlar">
        {data.months.map((m) => (
          <div key={m.month} className="mst-bar">
            <small>{m.workedHours}</small>
            <div>
              <i style={{ height: `${Math.round((m.workedHours / maxHours) * 100)}%` }} />
            </div>
            <span>{m.label.split(" ")[0].slice(0, 3)}</span>
          </div>
        ))}
      </section>

      <div className="mp-group-title">Oylar bo‘yicha</div>
      <section className="mp-group">
        {[...data.months].reverse().map((m) => (
          <div className="mp-row mst-row" key={m.month}>
            <span>{m.label}</span>
            <b>
              {m.present} kun · {m.onTimeRate === null ? "—" : `${m.onTimeRate}% vaqtida`}
              {m.overtimeHours ? ` · +${m.overtimeHours} s` : ""}
            </b>
          </div>
        ))}
      </section>

      {data.leaderboard && (
        <>
          <div className="mp-group-title">Filialda vaqtida kelish (shu oy)</div>
          <section className="mini-card mst-board">
            <div className="mst-rank">
              <Trophy size={20} />
              <span>
                Siz <b>{data.leaderboard.rank > 0 ? `${data.leaderboard.rank}-o‘rin` : "—"}</b> / {data.leaderboard.total}
              </span>
            </div>
            {data.leaderboard.top.map((row, i) => (
              <div key={row.name + i} className={`mst-top ${row.me ? "me" : ""}`}>
                <Medal size={16} className={`m${i + 1}`} />
                <span>{row.me ? `${row.name} (siz)` : row.name}</span>
                <b>{row.rate}%</b>
              </div>
            ))}
          </section>
        </>
      )}
    </>
  );
}
