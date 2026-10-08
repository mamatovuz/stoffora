import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Bell,
  CalendarClock,
  Clock3,
  Plane,
  ScanFace,
  UserPlus,
  Users,
  PartyPopper,
} from "lucide-react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { useState } from "react";
import { useApi, usePolling } from "../hooks";
import { useAuth } from "../auth";
import {
  Empty,
  ErrorBox,
  Loading,
  PageHeader,
  Person,
  Segmented,
  Status,
} from "../components/ui";
import type { Notification } from "@/lib/types";
import { dateLongUz, dateUz, weekdayShortUz } from "@/lib/format";
import type { RosterRow, RosterStats } from "../types";
import { SetupChecklist, type SetupData } from "../components/SetupChecklist";

type Dashboard = {
  stats: RosterStats;
  roster: RosterRow[];
  weekly: { date: string; present: number; late: number; absent: number; rate: number | null }[];
  setup: SetupData["setup"];
  celebrations: { employeeId: string; name: string; kind: "BIRTHDAY" | "ANNIVERSARY"; date: string; daysLeft: number; years: number }[];
  bot: SetupData["bot"];
  notifications: Notification[];
  leave: number;
};

function greeting() {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hour12: false,
      timeZone: "Asia/Tashkent",
    }).format(new Date()),
  );
  if (hour < 5) return "Xayrli tun";
  if (hour < 12) return "Xayrli tong";
  if (hour < 18) return "Xayrli kun";
  return "Xayrli kech";
}

export function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [days, setDays] = useState<"7" | "14" | "30">("7");
  const { data, loading, error, reload } = useApi<Dashboard>(`/dashboard?days=${days}`);
  usePolling(() => void reload(true), 30_000);

  if (loading && !data)
    return (
      <div className="page">
        <Loading />
      </div>
    );
  if (error || !data)
    return (
      <div className="page">
        <ErrorBox message={error || "Ma’lumot yuklanmadi"} />
      </div>
    );

  const s = data.stats;
  const setup = data.setup;
  const expected = Math.max(0, s.total - s.dayOff - s.leave);
  const rate = expected ? Math.round((s.present / expected) * 100) : 0;
  const onTime = Math.max(0, s.present - s.late);
  const bar = (value: number) =>
    s.total ? `${(value / s.total) * 100}%` : "0%";
  const todayIso = data.weekly[data.weekly.length - 1]?.date;
  const chart = data.weekly.map((item) => ({
    ...item,
    day: item.date === todayIso ? "Bugun" : days === "7" ? weekdayShortUz(item.date) : String(Number(item.date.slice(8))),
    // Ustunning eng yuqori (nolga teng bo‘lmagan) qismi — faqat u yumaloqlanadi.
    top: item.absent ? "absent" : item.late ? "late" : "present",
  }));
  const rated = data.weekly.filter((d) => d.rate !== null);
  const avgRate = rated.length
    ? Math.round(rated.reduce((sum, d) => sum + (d.rate || 0), 0) / rated.length)
    : 0;
  const totalLate = data.weekly.reduce((sum, d) => sum + d.late, 0);
  const totalAbsent = data.weekly.reduce((sum, d) => sum + d.absent, 0);

  return (
    <div className="page">
      <PageHeader
        title={`${greeting()}, ${user?.name.split(" ")[0] || ""}`}
        subtitle={dateLongUz(new Date(), true)}
        actions={
          <>
            <Link className="btn" to="/leave">
              <CalendarClock size={16} /> So‘rovlar
              {data.leave > 0 && <span className="btn-count">{data.leave}</span>}
            </Link>
            <Link className="btn btn-primary" to="/employees/new">
              <UserPlus size={16} /> Xodim qo‘shish
            </Link>
          </>
        }
      />

      <SetupChecklist data={data} />

      <section className="hero">
        <div>
          <small className="eyebrow">
            <span className="live-dot" />
            Bugungi davomat · jonli
          </small>
          <h2>
            {s.present}
            <span> / {expected} keldi</span>
          </h2>
          <p className="hero-lead">
            Davomat darajasi <b>{rate}%</b> · hozir
            ishda <b>{s.inNow}</b> nafar
          </p>
          <div className="hero-bar">
            <i style={{ width: bar(onTime), background: "#22a05a" }} />
            <i style={{ width: bar(s.late), background: "#e5962b" }} />
            <i style={{ width: bar(s.absent), background: "#e5484d" }} />
            <i style={{ width: bar(s.leave), background: "#8b5cf6" }} />
            <i style={{ width: bar(s.notYet), background: "#cbd5e1" }} />
          </div>
          <div className="hero-legend">
            <span>
              <i style={{ background: "#22a05a" }} /> Vaqtida {onTime}
            </span>
            <span>
              <i style={{ background: "#e5962b" }} /> Kechikkan {s.late}
            </span>
            <span>
              <i style={{ background: "#e5484d" }} /> Kelmagan {s.absent}
            </span>
            <span>
              <i style={{ background: "#8b5cf6" }} /> Ta’tilda {s.leave}
            </span>
            <span>
              <i style={{ background: "#cbd5e1" }} /> Kutilmoqda {s.notYet}
            </span>
          </div>
        </div>
        <div className="hero-metrics">
          {(
            [
              ["Ishda", s.inNow, "#22a05a", "IN"],
              ["Kechikkan", s.late, "#e5962b", "LATE"],
              ["Kelmagan", s.absent, "#e5484d", "ABSENT"],
              ["Ketgan", s.left, "#2563eb", "LEFT"],
            ] as const
          ).map(([label, value, color, state]) => (
            <button
              key={label}
              className="hero-metric"
              onClick={() => navigate(`/attendance?state=${state}`)}
            >
              <small>
                <i style={{ background: color }} />
                {label}
              </small>
              <b>{value}</b>
            </button>
          ))}
        </div>
      </section>

      <div className="dash-grid">
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Davomat dinamikasi</h2>
              <p>So‘nggi {days} kun</p>
            </div>
            <Segmented<"7" | "14" | "30">
              value={days}
              onChange={setDays}
              options={[
                { value: "7", label: "7 kun" },
                { value: "14", label: "14 kun" },
                { value: "30", label: "30 kun" },
              ]}
            />
          </div>
          <div className="chart-summary">
            <div>
              <small>O‘rtacha davomat</small>
              <b>{avgRate}%</b>
            </div>
            <div>
              <small>Kechikishlar</small>
              <b className="warn">{totalLate}</b>
            </div>
            <div>
              <small>Kelmaganlar</small>
              <b className="bad">{totalAbsent}</b>
            </div>
            <div className="chart-legend" style={{ marginLeft: "auto" }}>
              <span>
                <i style={{ background: "#22a05a" }} /> Vaqtida
              </span>
              <span>
                <i style={{ background: "#e5962b" }} /> Kech
              </span>
              <span>
                <i style={{ background: "#e5484d" }} /> Kelmagan
              </span>
              <span>
                <i style={{ background: "#2563eb", height: 2, borderRadius: 1 }} /> Davomat %
              </span>
            </div>
          </div>
          <div className="chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chart} margin={{ left: -18, right: 0, top: 12 }} barCategoryGap={days === "30" ? "18%" : "34%"}>
                <defs>
                  <linearGradient id="g-present" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2fbf6c" />
                    <stop offset="100%" stopColor="#1d9150" />
                  </linearGradient>
                  <linearGradient id="g-late" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f2a93b" />
                    <stop offset="100%" stopColor="#d9861d" />
                  </linearGradient>
                  <linearGradient id="g-absent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f0595e" />
                    <stop offset="100%" stopColor="#d63c41" />
                  </linearGradient>
                  <linearGradient id="g-rate" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563eb" stopOpacity={0.16} />
                    <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#eef2f6" strokeDasharray="3 4" vertical={false} />
                <XAxis
                  dataKey="day"
                  axisLine={false}
                  tickLine={false}
                  fontSize={11}
                  tick={(props: { x: number; y: number; payload: { value: string } }) => (
                    <text x={props.x} y={props.y + 12} textAnchor="middle" fontSize={11} fontWeight={props.payload.value === "Bugun" ? 700 : 400} fill={props.payload.value === "Bugun" ? "#2563eb" : "#94a3b8"}>
                      {props.payload.value}
                    </text>
                  )}
                  interval={days === "30" ? 2 : 0}
                />
                <YAxis yAxisId="count" allowDecimals={false} axisLine={false} tickLine={false} fontSize={11} tick={{ fill: "#94a3b8" }} />
                <YAxis yAxisId="rate" orientation="right" domain={[0, 100]} ticks={[0, 50, 100]} axisLine={false} tickLine={false} fontSize={11} tick={{ fill: "#93b0f0" }} tickFormatter={(v: number) => `${v}%`} width={40} />
                <Tooltip cursor={{ fill: "rgba(37,99,235,0.05)", radius: 8 } as object} content={<ChartTooltip />} />
                <Area yAxisId="rate" dataKey="rate" type="monotone" stroke="none" fill="url(#g-rate)" connectNulls isAnimationActive={false} />
                {rated.length > 1 && <ReferenceLine yAxisId="rate" y={avgRate} stroke="#93b0f0" strokeDasharray="4 4" label={{ value: `o‘rtacha ${avgRate}%`, position: "insideTopLeft", fill: "#7c97d6", fontSize: 10.5 }} />}
                {(["present", "late", "absent"] as const).map((key) => (
                  <Bar
                    key={key}
                    yAxisId="count"
                    dataKey={key}
                    name={key === "present" ? "Vaqtida" : key === "late" ? "Kechikkan" : "Kelmagan"}
                    stackId="a"
                    fill={`url(#g-${key})`}
                    maxBarSize={30}
                    shape={(raw: unknown) => {
                      const { x, y, width, height, fill, payload } = raw as { x: number; y: number; width: number; height: number; fill: string; payload: { top: string } };
                      if (!height || height <= 0) return <g />;
                      const r = payload.top === key ? Math.min(6, width / 2, height) : 0;
                      return <path d={`M${x},${y + height} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + height} Z`} fill={fill} />;
                    }}
                  />
                ))}
                <Line
                  yAxisId="rate"
                  dataKey="rate"
                  name="Davomat"
                  type="monotone"
                  stroke="#2563eb"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  dot={days === "30" ? false : { r: 3.5, strokeWidth: 2, fill: "#fff", stroke: "#2563eb" }}
                  activeDot={{ r: 5, strokeWidth: 2, fill: "#fff", stroke: "#2563eb" }}
                  connectNulls
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="card dash-feed">
          <div className="card-head">
            <div>
              <h2>So‘nggi voqealar</h2>
              <p>Kechikishlar, so‘rovlar va tizim xabarlari</p>
            </div>
            <Link to="/notifications" className="link">
              Barchasi <ArrowRight size={14} />
            </Link>
          </div>
          {data.notifications.length ? (
            <div className="feed">
              {data.notifications.map((item) => (
                <article className="feed-item" key={item.id}>
                  <span
                    className={`feed-icon ${item.type === "ATTENDANCE" ? "amber" : item.type === "LEAVE" ? "blue" : "green"}`}
                  >
                    {item.type === "ATTENDANCE" ? (
                      <Clock3 size={15} />
                    ) : item.type === "LEAVE" ? (
                      <Plane size={15} />
                    ) : (
                      <Bell size={15} />
                    )}
                  </span>
                  <div>
                    <b>{item.title}</b>
                    <p>{item.body}</p>
                    <small>
                      {dateUz(item.createdAt)} ·{" "}
                      {new Date(item.createdAt).toLocaleTimeString("en-GB", {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "Asia/Tashkent",
                      })}
                    </small>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <Empty
              icon={Bell}
              title="Hozircha voqealar yo‘q"
              text="Kechikishlar va ta’til so‘rovlari shu yerda ko‘rinadi."
            />
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Bugungi jamoa</h2>
            <p>So‘nggi harakatlar tartibida</p>
          </div>
          <Link to="/attendance" className="link">
            Keldi-ketdi <ArrowRight size={14} />
          </Link>
        </div>
        {data.roster.length ? (
          <div className="table-wrap">
            <table className="table table-cards">
              <thead>
                <tr>
                  <th>Xodim</th>
                  <th>Filial</th>
                  <th>Grafik</th>
                  <th>Keldi → Ketdi</th>
                  <th>Holat</th>
                </tr>
              </thead>
              <tbody>
                {data.roster.slice(0, 10).map((row) => (
                  <tr
                    key={row.employee.id}
                    className="clickable"
                    onClick={() => navigate(`/employees/${row.employee.id}`)}
                  >
                    <td>
                      <Person
                        first={row.employee.firstName}
                        last={row.employee.lastName}
                        photo={row.employee.photoDataUrl}
                        sub={row.position || row.employee.employeeNo}
                      />
                    </td>
                    <td data-label="Filial">{row.branch || "—"}</td>
                    <td data-label="Grafik" className="num">
                      {row.scheduledStart
                        ? `${row.scheduledStart}–${row.scheduledEnd}`
                        : "—"}
                    </td>
                    <td data-label="Vaqt">
                      <span className="times">
                        <b>{row.record?.checkIn || "—"}</b>
                        <span className="arrow">→</span>
                        <b>{row.record?.checkOut || "—"}</b>
                      </span>
                    </td>
                    <td data-label="Holat">
                      <span className="state-cell">
                        <Status value={row.state} live={row.state === "IN"} />
                        {row.late && (
                          <small className="late-text">
                            {row.record?.lateMinutes} daq kech
                          </small>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon={Users}
            title="Xodimlar hali qo‘shilmagan"
            text="Birinchi xodimni qo‘shing — u Telegram bot orqali davomatni belgilay oladi."
            action={
              <Link to="/employees/new" className="btn btn-primary">
                <UserPlus size={16} /> Xodim qo‘shish
              </Link>
            }
          />
        )}
      </section>
      {data.celebrations.length > 0 && (
        <section className="card celebrations">
          <div className="card-head">
            <div>
              <h2>
                <PartyPopper size={17} /> Yaqin tabriklar
              </h2>
              <p>Tug‘ilgan kun va ish yubileylari — xodimga bot orqali avtomatik tabrik boradi</p>
            </div>
          </div>
          <div className="celebration-list">
            {data.celebrations.map((c) => (
              <Link key={`${c.kind}-${c.employeeId}`} to={`/employees/${c.employeeId}`} className={`celebration ${c.daysLeft === 0 ? "today" : ""}`}>
                <span className="celebration-icon">{c.kind === "BIRTHDAY" ? "🎂" : "🏆"}</span>
                <span>
                  <b>{c.name}</b>
                  <small>{c.kind === "BIRTHDAY" ? `Tug‘ilgan kun · ${c.years} yosh` : `${c.years} yillik ish yubileyi`}</small>
                </span>
                <em>{c.daysLeft === 0 ? "Bugun" : c.daysLeft === 1 ? "Ertaga" : `${c.daysLeft} kundan keyin`}</em>
              </Link>
            ))}
          </div>
        </section>
      )}
      {setup.employees > 0 && setup.faceEnrolled < setup.employees && (
        <div className="alert info" style={{ marginTop: 16 }}>
          <ScanFace size={18} />
          <div>
            <b>
              Face ID: {setup.faceEnrolled} / {setup.employees} xodim sozlagan
            </b>
            <p>
              Xodim birinchi marta davomat belgilaganda Face ID avtomatik
              ro‘yxatdan o‘tkaziladi.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function ChartTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as Dashboard["weekly"][number];
  return (
    <div className="chart-tooltip">
      <b>{dateUz(row.date)}</b>
      <span>
        <i style={{ background: "#22a05a" }} /> Vaqtida <em>{row.present}</em>
      </span>
      <span>
        <i style={{ background: "#e5962b" }} /> Kechikkan <em>{row.late}</em>
      </span>
      <span>
        <i style={{ background: "#e5484d" }} /> Kelmagan <em>{row.absent}</em>
      </span>
      <span className="rate">
        Davomat <em>{row.rate === null ? "—" : `${row.rate}%`}</em>
      </span>
    </div>
  );
}
