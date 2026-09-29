import { Link } from "react-router-dom";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock3,
  UserPlus,
  Users,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useApi } from "../hooks";
import { useAuth } from "../auth";
import {
  Avatar,
  ErrorBox,
  Loading,
  PageHeader,
  Status,
} from "../components/ui";
import type { Attendance, Employee, Notification } from "@/lib/types";
import { dateLongUz, dateUz, weekdayShortUz } from "@/lib/format";

type Row = Attendance & {
  employee?: Employee;
  branch?: string;
  department?: string;
  position?: string;
};
type Dashboard = {
  stats: {
    total: number;
    present: number;
    late: number;
    absent: number;
    leave: number;
  };
  attendance: Row[];
  weekly: { date: string; present: number; late: number; absent: number }[];
  notifications: Notification[];
  leave: number;
};

export function DashboardPage() {
  const { user } = useAuth();
  const { data, loading, error } = useApi<Dashboard>("/dashboard");
  if (loading)
    return (
      <div className="page">
        <Loading />
      </div>
    );
  if (error || !data)
    return (
      <div className="page">
        <ErrorBox message={error} />
      </div>
    );

  const accounted =
    data.stats.present + data.stats.late + data.stats.absent + data.stats.leave;
  const rate = accounted
    ? Math.round(((data.stats.present + data.stats.late) / accounted) * 100)
    : 0;
  const chart = data.weekly.map((item) => ({
    ...item,
    day: weekdayShortUz(item.date),
  }));

  return (
    <div className="page dashboard-page">
      <PageHeader
        title={`Xayrli kun, ${user?.name.split(" ")[0] || "jamoa"}`}
        subtitle={dateLongUz(new Date(), true)}
        actions={
          <>
            <Link className="btn" to="/leave">
              <CalendarClock size={16} /> So‘rovlar{" "}
              {data.leave > 0 && (
                <span className="button-count">{data.leave}</span>
              )}
            </Link>
            <Link className="btn btn-primary" to="/employees/new">
              <UserPlus size={16} /> Xodim qo‘shish
            </Link>
          </>
        }
      />

      <section className="attendance-overview">
        <div className="overview-primary">
          <span className="overview-icon">
            <Users size={21} />
          </span>
          <div>
            <small>Faol xodimlar</small>
            <strong>{data.stats.total}</strong>
            <span>
              Bugungi davomat <b>{rate}%</b>
            </span>
          </div>
        </div>
        <div className="overview-metrics">
          <OverviewMetric
            label="Ishda"
            value={data.stats.present}
            tone="green"
          />
          <OverviewMetric
            label="Kechikkan"
            value={data.stats.late}
            tone="amber"
          />
          <OverviewMetric
            label="Kelmagan"
            value={data.stats.absent}
            tone="red"
          />
          <OverviewMetric
            label="Ta’tilda"
            value={data.stats.leave}
            tone="blue"
          />
        </div>
        <Link to="/attendance" className="overview-link">
          Davomatni boshqarish <ArrowRight size={15} />
        </Link>
      </section>

      <div className="dashboard-grid">
        <section className="card chart-card">
          <div className="section-head">
            <div>
              <h2>Haftalik davomat</h2>
              <small className="subtle">Haqiqiy qaydlar dinamikasi</small>
            </div>
            <div className="chart-legend">
              <span className="present">Ishda</span>
              <span className="late">Kechikkan</span>
            </div>
          </div>
          <div className="section-body dashboard-chart">
            {chart.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={chart}
                  margin={{ left: -24, right: 8, top: 12 }}
                >
                  <defs>
                    <linearGradient
                      id="attendanceArea"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="5%" stopColor="#117A65" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#117A65" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#EDF1EF" vertical={false} />
                  <XAxis
                    dataKey="day"
                    axisLine={false}
                    tickLine={false}
                    fontSize={10}
                  />
                  <YAxis
                    allowDecimals={false}
                    axisLine={false}
                    tickLine={false}
                    fontSize={10}
                  />
                  <Tooltip
                    contentStyle={{
                      border: "1px solid #E3E9E6",
                      borderRadius: 9,
                      fontSize: 11,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="present"
                    name="Ishda"
                    stroke="#117A65"
                    strokeWidth={2}
                    fill="url(#attendanceArea)"
                  />
                  <Area
                    type="monotone"
                    dataKey="late"
                    name="Kechikkan"
                    stroke="#C98220"
                    strokeWidth={1.5}
                    fill="transparent"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="chart-empty">
                Grafik uchun davomat qaydlari yetarli emas
              </div>
            )}
          </div>
        </section>

        <section className="card activity-card">
          <div className="section-head">
            <div>
              <h2>Faoliyat lentasi</h2>
              <small className="subtle">So‘nggi tizim xabarlari</small>
            </div>
            <Link to="/notifications" className="text-link">
              Barchasi <ArrowRight size={14} />
            </Link>
          </div>
          <div className="activity-feed">
            {data.notifications.slice(0, 5).map((item) => (
              <article key={item.id}>
                <span className="feed-dot">
                  <CheckCircle2 size={14} />
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
        </section>
      </div>

      <section className="card today-team">
        <div className="section-head">
          <div>
            <h2>Bugungi jamoa</h2>
            <small className="subtle">Davomat holati real vaqtda</small>
          </div>
          <Link to="/attendance" className="text-link">
            Barchasini ko‘rish <ArrowRight size={14} />
          </Link>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Xodim</th>
                <th>Lavozim va bo‘lim</th>
                <th>Filial</th>
                <th>Grafik</th>
                <th>Kelish</th>
                <th>Chiqish</th>
                <th>Holat</th>
              </tr>
            </thead>
            <tbody>
              {data.attendance.slice(0, 8).map((item) => (
                <tr key={item.id}>
                  <td>
                    <Link
                      to={`/employees/${item.employeeId}`}
                      className="cell-person"
                    >
                      <Avatar
                        first={item.employee?.firstName || "?"}
                        last={item.employee?.lastName}
                        photo={item.employee?.photoDataUrl}
                      />
                      <span>
                        <b>
                          {item.employee?.firstName} {item.employee?.lastName}
                        </b>
                        <small>{item.employee?.employeeNo}</small>
                      </span>
                    </Link>
                  </td>
                  <td>
                    <span className="stacked-cell">
                      <b>{item.position || "—"}</b>
                      <small>{item.department || "—"}</small>
                    </span>
                  </td>
                  <td>{item.branch || "—"}</td>
                  <td>
                    {item.scheduledStart}–{item.scheduledEnd}
                  </td>
                  <td className="time-cell">
                    <Clock3 size={13} /> {item.checkIn || "—"}
                  </td>
                  <td>{item.checkOut || "—"}</td>
                  <td>
                    <Status value={item.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function OverviewMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="overview-metric">
      <i className={tone} />
      <span>
        <small>{label}</small>
        <b>{value}</b>
      </span>
    </div>
  );
}
