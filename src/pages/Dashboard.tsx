import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Building2,
  CalendarClock,
  Check,
  ClipboardList,
  Clock3,
  Network,
  Plane,
  ScanFace,
  Send,
  UserPlus,
  Users,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useApi, usePolling } from "../hooks";
import { useAuth } from "../auth";
import {
  Empty,
  ErrorBox,
  Loading,
  PageHeader,
  Person,
  Status,
} from "../components/ui";
import type { Notification } from "@/lib/types";
import { dateLongUz, dateUz, weekdayShortUz } from "@/lib/format";
import type { RosterRow, RosterStats } from "../types";

type Dashboard = {
  stats: RosterStats;
  roster: RosterRow[];
  weekly: { date: string; present: number; late: number; absent: number }[];
  setup: {
    branches: number;
    departments: number;
    positions: number;
    schedules: number;
    employees: number;
    telegramLinked: number;
    faceEnrolled: number;
  };
  bot: { state: string; username?: string };
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
  const { data, loading, error, reload } = useApi<Dashboard>("/dashboard");
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
  const expected = Math.max(0, s.total - s.dayOff - s.leave);
  const rate = expected ? Math.round((s.present / expected) * 100) : 0;
  const onTime = Math.max(0, s.present - s.late);
  const bar = (value: number) =>
    s.total ? `${(value / s.total) * 100}%` : "0%";
  const setup = data.setup;
  const steps = [
    {
      done: setup.schedules > 0,
      title: "Ish grafigini yarating",
      text: "Ish vaqti, tanaffus va kechikish imtiyozi",
      to: "/schedules",
      icon: ClipboardList,
    },
    {
      done: setup.branches > 0,
      title: "Filial qo‘shing",
      text: "Manzil, GPS nuqta va davomat radiusi",
      to: "/branches",
      icon: Building2,
    },
    {
      done: setup.departments > 0 && setup.positions > 0,
      title: "Bo‘lim va lavozimlar",
      text: "Tashkiliy tuzilmani belgilang",
      to: setup.departments ? "/positions" : "/departments",
      icon: Network,
    },
    {
      done: setup.employees > 0,
      title: "Xodimlarni qo‘shing",
      text: "Telefon raqami bilan — bot orqali ulanadi",
      to: "/employees/new",
      icon: UserPlus,
    },
    {
      done: setup.employees > 0 && setup.telegramLinked > 0,
      title: "Xodimlar Telegram’ni ulasin",
      text: data.bot.username
        ? `@${data.bot.username} → /start → telefon raqam`
        : "Bot tokenini sozlang",
      to: "/employees",
      icon: Send,
    },
  ];
  const setupDone = steps.filter((step) => step.done).length;
  const chart = data.weekly.map((item) => ({
    ...item,
    day: weekdayShortUz(item.date),
  }));

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

      {setupDone < steps.length && (
        <section className="card onboarding">
          <div>
            <span className="badge blue plain">Boshlash</span>
            <h2 style={{ marginTop: 10 }}>Staffora’ni 5 qadamda sozlang</h2>
            <p>
              Keldi-ketdi ishlashi uchun avval grafik va filial kerak. So‘ng
              xodimlarni qo‘shing — ular botda telefon raqamini yuborib avtomatik
              ulanadi.
            </p>
            <div className="progress" style={{ maxWidth: 320 }}>
              <i style={{ width: `${(setupDone / steps.length) * 100}%` }} />
            </div>
            <p className="hint" style={{ marginTop: 8 }}>
              {setupDone} / {steps.length} bajarildi
            </p>
            {data.bot.state !== "running" && (
              <div className="alert warn" style={{ marginTop: 16 }}>
                <AlertTriangle size={18} />
                <div>
                  <b>Telegram bot ishlamayapti</b>
                  <p>
                    Serverda TELEGRAM_BOT_TOKEN va HTTPS APP_URL sozlanganini
                    tekshiring. Holat: {data.bot.state}.
                  </p>
                </div>
              </div>
            )}
          </div>
          <div className="checklist">
            {steps.map((step) => (
              <Link
                key={step.title}
                to={step.to}
                className={`check-item ${step.done ? "done" : ""}`}
              >
                <span className="check-dot">
                  <Check size={14} strokeWidth={3} />
                </span>
                <span>
                  <b>{step.title}</b>
                  <small>{step.text}</small>
                </span>
                <step.icon size={17} className="faint" />
              </Link>
            ))}
          </div>
        </section>
      )}

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
              <h2>Haftalik dinamika</h2>
              <p>So‘nggi 7 kun</p>
            </div>
            <div className="chart-legend">
              <span>
                <i style={{ background: "#22a05a" }} /> Vaqtida
              </span>
              <span>
                <i style={{ background: "#e5962b" }} /> Kechikkan
              </span>
              <span>
                <i style={{ background: "#e5484d" }} /> Kelmagan
              </span>
            </div>
          </div>
          <div className="chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ left: -18, right: 6, top: 14 }} barGap={3}>
                <CartesianGrid stroke="#eef2f6" vertical={false} />
                <XAxis
                  dataKey="day"
                  axisLine={false}
                  tickLine={false}
                  fontSize={11}
                  tick={{ fill: "#64748b" }}
                />
                <YAxis
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                  fontSize={11}
                  tick={{ fill: "#64748b" }}
                />
                <Tooltip
                  cursor={{ fill: "rgba(37,99,235,0.05)" }}
                  contentStyle={{
                    border: "1px solid #e2e8f0",
                    borderRadius: 10,
                    fontSize: 12,
                    boxShadow: "0 8px 24px rgba(15,23,42,.08)",
                  }}
                  labelFormatter={(_, payload) =>
                    payload?.[0] ? dateUz(payload[0].payload.date) : ""
                  }
                />
                <Bar dataKey="present" name="Vaqtida" stackId="a" fill="#22a05a" radius={[0, 0, 0, 0]} maxBarSize={34} />
                <Bar dataKey="late" name="Kechikkan" stackId="a" fill="#e5962b" maxBarSize={34} />
                <Bar dataKey="absent" name="Kelmagan" stackId="a" fill="#e5484d" radius={[6, 6, 0, 0]} maxBarSize={34} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="card">
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
