import { useState } from "react";
import { Link } from "react-router-dom";
import { AlarmClock, Award, CalendarX2, Medal, TrendingDown, TrendingUp, Trophy, UserCheck } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApi } from "../hooks";
import { Empty, ErrorBox, Loading, PageHeader } from "../components/ui";
import { monthYearUz, tashkentIsoDate } from "@/lib/format";

type Summary = { attendanceRate: number | null; punctuality: number | null; lateMinutes: number; absent: number; score: number | null };
type Person = { id: string; name: string; employeeNo: string; branch?: string; expected: number; present: number; late: number; lateMinutes: number; absent: number; score: number };
type Analytics = {
  month: string;
  current: Summary;
  previous: Summary;
  branches: { id: string; name: string; employees: number; attendanceRate: number | null; punctuality: number | null; lateMinutes: number; absent: number; score: number | null }[];
  punctual: Person[];
  latecomers: Person[];
  absentees: Person[];
  daily: { date: string; rate: number | null; late: number; absent: number }[];
};

function Delta({ now, before, inverse, unit = "" }: { now: number | null; before: number | null; inverse?: boolean; unit?: string }) {
  if (now === null || before === null) return <small className="muted">o‘tgan oy bilan solishtirib bo‘lmaydi</small>;
  const diff = now - before;
  if (!diff) return <small className="muted">o‘tgan oydagidek</small>;
  const good = inverse ? diff < 0 : diff > 0;
  const Icon = diff > 0 ? TrendingUp : TrendingDown;
  return (
    <small className={`delta ${good ? "good" : "bad"}`}>
      <Icon size={13} /> {diff > 0 ? "+" : ""}
      {diff}
      {unit} o‘tgan oyga nisbatan
    </small>
  );
}

const medal = (i: number) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`);

export function AnalyticsPage() {
  const [month, setMonth] = useState(tashkentIsoDate().slice(0, 7));
  const { data, loading, error } = useApi<Analytics>(`/analytics?month=${month}`);
  return (
    <div className="page">
      <PageHeader
        title="Tahlil"
        subtitle={`${monthYearUz(`${month}-15`)} · filiallar reytingi va intizom`}
        actions={
          <div className="date-nav">
            <input type="month" value={month} max={tashkentIsoDate().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Oy" />
          </div>
        }
      />
      {loading && !data ? (
        <Loading />
      ) : error || !data ? (
        <ErrorBox message={error || "Yuklanmadi"} />
      ) : (
        <>
          <div className="stat-grid an-kpis">
            <div className="card stat green">
              <div className="stat-top">
                <span>Davomat</span>
                <span className="stat-icon">
                  <UserCheck size={16} />
                </span>
              </div>
              <strong>{data.current.attendanceRate ?? "—"}%</strong>
              <Delta now={data.current.attendanceRate} before={data.previous.attendanceRate} unit="%" />
            </div>
            <div className="card stat blue">
              <div className="stat-top">
                <span>Vaqtida kelish</span>
                <span className="stat-icon">
                  <Award size={16} />
                </span>
              </div>
              <strong>{data.current.punctuality ?? "—"}%</strong>
              <Delta now={data.current.punctuality} before={data.previous.punctuality} unit="%" />
            </div>
            <div className="card stat amber">
              <div className="stat-top">
                <span>Kechikish</span>
                <span className="stat-icon">
                  <AlarmClock size={16} />
                </span>
              </div>
              <strong>{data.current.lateMinutes} daq</strong>
              <Delta now={data.current.lateMinutes} before={data.previous.lateMinutes} inverse unit=" daq" />
            </div>
            <div className="card stat red">
              <div className="stat-top">
                <span>Kelmagan kunlar</span>
                <span className="stat-icon">
                  <CalendarX2 size={16} />
                </span>
              </div>
              <strong>{data.current.absent}</strong>
              <Delta now={data.current.absent} before={data.previous.absent} inverse />
            </div>
          </div>

          <div className="an-grid">
            <section className="card">
              <div className="card-head">
                <div>
                  <h2>
                    <Trophy size={17} /> Filiallar reytingi
                  </h2>
                  <p>Ball = davomat 60% + vaqtida kelish 40%</p>
                </div>
              </div>
              {!data.branches.length ? (
                <Empty title="Ma’lumot yo‘q" text="Bu oyda filiallar bo‘yicha davomat yo‘q." />
              ) : (
                <div className="an-branches">
                  {data.branches.map((b, i) => (
                    <div key={b.id} className="an-branch">
                      <span className="an-rank">{medal(i)}</span>
                      <div className="an-branch-main">
                        <div className="an-branch-top">
                          <b>{b.name}</b>
                          <span className={`an-score ${(b.score ?? 0) >= 90 ? "a" : (b.score ?? 0) >= 75 ? "b" : (b.score ?? 0) >= 60 ? "c" : "d"}`}>{b.score ?? "—"}</span>
                        </div>
                        <div className="an-bar">
                          <i style={{ width: `${b.score ?? 0}%` }} />
                        </div>
                        <small>
                          {b.employees} xodim · davomat {b.attendanceRate ?? "—"}% · vaqtida {b.punctuality ?? "—"}% · {b.lateMinutes} daq kechikish · {b.absent} kun kelmagan
                        </small>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="card">
              <div className="card-head">
                <div>
                  <h2>Kunlik davomat</h2>
                  <p>Kelishi kerak bo‘lganlarning necha foizi keldi</p>
                </div>
              </div>
              <div className="chart-box" style={{ height: 260, padding: "0 12px 12px" }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.daily.map((d) => ({ ...d, day: Number(d.date.slice(8)) }))} margin={{ top: 10, right: 8, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="anRate" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line)" />
                    <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} />
                    <YAxis domain={[0, 100]} tickLine={false} axisLine={false} fontSize={11} unit="%" />
                    <Tooltip formatter={(value) => [`${value}%`, "Davomat"]} labelFormatter={(day) => `${day}-kun`} />
                    <Area type="monotone" dataKey="rate" stroke="var(--brand)" strokeWidth={2} fill="url(#anRate)" connectNulls />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>
          </div>

          <div className="an-lists">
            <PeopleList title="Eng intizomli" icon={Medal} tone="green" rows={data.punctual} value={(p) => `${p.present} kun · 0 kechikish`} empty="Kechikmasdan kelganlar hali yo‘q" />
            <PeopleList title="Ko‘p kechikkanlar" icon={AlarmClock} tone="amber" rows={data.latecomers} value={(p) => `${p.lateMinutes} daq · ${p.late} marta`} empty="Kechikish yo‘q 👏" />
            <PeopleList title="Ko‘p kelmaganlar" icon={CalendarX2} tone="red" rows={data.absentees} value={(p) => `${p.absent} kun`} empty="Sababsiz kelmaganlar yo‘q" />
          </div>
        </>
      )}
    </div>
  );
}

function PeopleList({
  title,
  icon: Icon,
  tone,
  rows,
  value,
  empty,
}: {
  title: string;
  icon: typeof Medal;
  tone: string;
  rows: Person[];
  value: (p: Person) => string;
  empty: string;
}) {
  return (
    <section className="card">
      <div className="card-head">
        <h2 className={`an-list-title ${tone}`}>
          <Icon size={16} /> {title}
        </h2>
      </div>
      {!rows.length ? (
        <p className="muted" style={{ padding: "0 18px 18px", fontSize: 13 }}>
          {empty}
        </p>
      ) : (
        <div className="an-people">
          {rows.map((p, i) => (
            <Link key={p.id} to={`/employees/${p.id}`} className="an-person">
              <span className="an-rank">{i + 1}</span>
              <span>
                <b>{p.name}</b>
                <small>{p.branch || p.employeeNo}</small>
              </span>
              <em className={tone}>{value(p)}</em>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
