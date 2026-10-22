import { useState } from "react";
import { Link } from "react-router-dom";
import { Archive, Building2, CalendarClock, CircleCheck, LifeBuoy, MonitorSmartphone, ShieldAlert, UserCheck, UserX, Users } from "lucide-react";
import { useApi, usePolling } from "../../hooks";
import { PageHeader, StatCard } from "../../components/ui";
import { ActivityTimeline, DateRangeFilter, ErrorState, Section, Skeleton, StatusBadge, ago, num, rangeQuery, usePlatform, type DateRange } from "./kit";
import { ChartCard, Columns, HBars, TrendLine } from "./charts";

/*
 * Umumiy ko‘rinish: Dashboard (KPI — haqiqiy ma’lumotdan, platforma holati, ochiq incidentlar, so‘nggi voqealar),
 * Analitika (sana oralig‘i bo‘yicha grafiklar), So‘nggi faollik.
 */

type Check = { key: string; label: string; status: string; detail: string; latencyMs?: number };
type Overview = {
  generatedAt: string;
  today: string;
  kpis: {
    companies: number;
    active: number;
    blocked: number;
    trial: number;
    archived: number;
    demo: number;
    employees: number;
    branches: number;
    leaders: number;
    presentToday: number;
    absentToday: number;
    activeSessions: number;
    errors24h: number;
    openTickets: number;
    expiringSoon: number;
    platformHealth: string;
  };
  health: { overall: string; checks: Check[] };
  openIncidents: { id: string; title: string; severity: string; lastSeen: string; detail: string }[];
};
type Activity = { id: string; at: string; kind: string; action: string; title: string; actor: string; companyId: string | null };
type Analytics = {
  from: string;
  to: string;
  companiesGrowth: { date: string; total: number; added: number }[];
  activeUsers: { date: string; users: number }[];
  mau: number;
  attendance: { date: string; records: number; employees: number }[];
  moduleUsage: { key: string; label: string; companies: number; requests: number }[];
  plans: { plan: string; companies: number }[];
  apiErrors: { date: string; requests: number; errors: number; clientErrors: number }[];
  resources: { bucket: string; rssMb: number; lagMs: number; p95Ms: number; requests: number }[];
};

const toneOf = (action: string, kind: string) => (kind === "error" ? "bad" : /block|archive|revoke|delete|fail/.test(action) ? "warn" : /create|restore|paid|resolve/.test(action) ? "good" : "default");

function Dashboard() {
  const { data, error, reload } = useApi<Overview>("/super-admin/overview");
  const { can } = usePlatform();
  const { data: activities } = useApi<Activity[]>("/super-admin/activities?limit=12");
  const { data: analytics } = useApi<Analytics>(can("analytics.read") ? "/super-admin/analytics?range=30" : null);
  usePolling(() => void reload(true), 60_000);
  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;
  if (!data) return <Skeleton rows={8} />;
  const k = data.kpis;
  return (
    <>
      <PageHeader title="Dashboard" subtitle={`Platforma holati · ${ago(data.generatedAt)} yangilandi`} actions={<StatusBadge value={k.platformHealth} label={`Platforma: ${k.platformHealth === "OK" ? "sog‘lom" : k.platformHealth === "WARN" ? "ogohlantirish" : "muammo"}`} />} />
      <div className="sa-kpis">
        <StatCard label="Kompaniyalar" value={num(k.companies)} note={`${k.active} faol · ${k.trial} sinovda`} icon={Building2} />
        <StatCard label="Bloklangan" value={num(k.blocked)} note={`${k.archived} arxivda · ${k.demo} demo`} icon={Archive} tone={k.blocked ? "red" : undefined} />
        <StatCard label="Faol xodimlar" value={num(k.employees)} note={`${num(k.branches)} filial`} icon={Users} />
        <StatCard label="Rahbarlar" value={num(k.leaders)} note="Panel foydalanuvchilari" icon={UserCheck} />
        <StatCard label="Bugun keldi" value={num(k.presentToday)} note={`${data.today} · grafik bo‘yicha`} icon={CircleCheck} tone="green" />
        <StatCard label="Bugun kelmadi" value={num(k.absentToday)} note="Ish kuni boshlangan, belgi yo‘q" icon={UserX} tone={k.absentToday ? "amber" : undefined} />
        <StatCard label="Faol sessiyalar" value={num(k.activeSessions)} note="Oxirgi 30 daqiqa" icon={MonitorSmartphone} />
        <StatCard label="Xatolar (24 soat)" value={num(k.errors24h)} note="Server 5xx javoblari" icon={ShieldAlert} tone={k.errors24h ? "red" : undefined} />
        <StatCard label="Ochiq murojaatlar" value={num(k.openTickets)} note="Support Center" icon={LifeBuoy} tone={k.openTickets ? "amber" : undefined} />
        <StatCard label="Tarifi tugayotgan" value={num(k.expiringSoon)} note="7 kun ichida" icon={CalendarClock} tone={k.expiringSoon ? "amber" : undefined} />
      </div>

      <div className="sa-grid-2">
        <Section title="Platforma holati" subtitle="Haqiqiy tekshiruvlar (soxta qiymat yo‘q)" actions={can("monitoring.read") ? <Link className="btn btn-sm" to="/super-admin/monitoring">Monitoring</Link> : undefined}>
          <ul className="sa-checks">
            {data.health.checks.map((c) => (
              <li key={c.key}>
                <StatusBadge value={c.status} />
                <span>
                  <b>{c.label}</b>
                  <small>{c.detail}</small>
                </span>
              </li>
            ))}
          </ul>
        </Section>
        <Section title="So‘nggi muhim voqealar" actions={<Link className="btn btn-sm" to="/super-admin/activities">Hammasi</Link>}>
          {activities ? (
            <ActivityTimeline items={activities.map((a) => ({ id: a.id, at: a.at, title: a.title, meta: a.actor || undefined, tone: toneOf(a.action, a.kind) }))} />
          ) : (
            <Skeleton rows={5} />
          )}
        </Section>
      </div>

      {data.openIncidents.length > 0 && (
        <Section title="Ochiq incidentlar" actions={<Link className="btn btn-sm" to="/super-admin/incidents">Incidentlar</Link>}>
          <ul className="sa-checks">
            {data.openIncidents.map((i) => (
              <li key={i.id}>
                <StatusBadge value={i.severity} />
                <span>
                  <b>{i.title}</b>
                  <small>
                    {i.detail} · {ago(i.lastSeen)}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {analytics && (
        <div className="sa-grid-2">
          <ChartCard title="Kompaniyalar o‘sishi" subtitle="Jami (demo va arxivsiz), 30 kun" table={{ headers: ["Sana", "Jami", "Yangi"], rows: analytics.companiesGrowth.map((r) => [r.date, r.total, r.added]) }}>
            <TrendLine data={analytics.companiesGrowth} x="date" y="total" name="Kompaniyalar" />
          </ChartCard>
          <ChartCard title="Davomat faolligi" subtitle="Kunlik qaydlar soni, 30 kun" table={{ headers: ["Sana", "Qaydlar", "Xodimlar"], rows: analytics.attendance.map((r) => [r.date, r.records, r.employees]) }}>
            <Columns data={analytics.attendance} x="date" y="records" name="Qaydlar" />
          </ChartCard>
        </div>
      )}
    </>
  );
}

function AnalyticsView() {
  const [range, setRange] = useState<DateRange>({ range: "30" });
  const q = rangeQuery(range);
  const params = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]).toString();
  const { data, error, loading, reload } = useApi<Analytics>(`/super-admin/analytics?${params}`);
  return (
    <>
      <PageHeader title="Analitika" subtitle="Faqat haqiqiy ma’lumot; demo kompaniyalar hisobga olinmaydi" actions={<DateRangeFilter value={range} onChange={setRange} />} />
      {error ? (
        <ErrorState message={error} onRetry={() => void reload()} />
      ) : !data ? (
        <Skeleton rows={8} />
      ) : (
        <div className={`sa-grid-2 ${loading ? "is-loading" : ""}`}>
          <ChartCard title="Kompaniyalar o‘sishi" subtitle={`${data.from} — ${data.to}`} table={{ headers: ["Sana", "Jami", "Yangi"], rows: data.companiesGrowth.map((r) => [r.date, r.total, r.added]) }}>
            <TrendLine data={data.companiesGrowth} x="date" y="total" name="Kompaniyalar" />
          </ChartCard>
          <ChartCard title="Faol foydalanuvchilar (DAU)" subtitle={`Panel rahbarlari · davr ichida noyob: ${num(data.mau)}`} table={{ headers: ["Sana", "Foydalanuvchilar"], rows: data.activeUsers.map((r) => [r.date, r.users]) }}>
            <TrendLine data={data.activeUsers} x="date" y="users" name="Faol foydalanuvchilar" />
          </ChartCard>
          <ChartCard title="Davomat faolligi" subtitle="Kunlik keldi-ketdi qaydlari" table={{ headers: ["Sana", "Qaydlar", "Noyob xodimlar"], rows: data.attendance.map((r) => [r.date, r.records, r.employees]) }}>
            <Columns data={data.attendance} x="date" y="records" name="Qaydlar" />
          </ChartCard>
          <ChartCard title="API so‘rovlar" subtitle="Kunlik so‘rovlar soni" table={{ headers: ["Sana", "So‘rovlar", "5xx xatolar", "4xx"], rows: data.apiErrors.map((r) => [r.date, r.requests, r.errors, r.clientErrors]) }}>
            <Columns data={data.apiErrors} x="date" y="requests" name="So‘rovlar" />
          </ChartCard>
          <ChartCard title="API xatoliklari (5xx)" subtitle="Server xatolari — alohida grafikda (boshqa masshtab)" table={{ headers: ["Sana", "5xx", "4xx"], rows: data.apiErrors.map((r) => [r.date, r.errors, r.clientErrors]) }}>
            <Columns data={data.apiErrors} x="date" y="errors" name="Xatolar" color="var(--chart-bad)" />
          </ChartCard>
          <ChartCard title="Tariflar bo‘yicha" subtitle="Kompaniyalar soni" table={{ headers: ["Tarif", "Kompaniyalar"], rows: data.plans.map((r) => [r.plan, r.companies]) }} height={Math.max(160, data.plans.length * 36)}>
            <HBars data={data.plans} label="plan" value="companies" name="Kompaniyalar" />
          </ChartCard>
          <ChartCard title="Modullardan foydalanish" subtitle="Davr ichidagi API so‘rovlari (ko‘pdan kamga)" table={{ headers: ["Modul", "So‘rovlar", "Yoqilgan kompaniyalar"], rows: data.moduleUsage.map((r) => [r.label, r.requests, r.companies]) }} height={Math.max(260, data.moduleUsage.length * 26)}>
            <HBars data={data.moduleUsage} label="label" value="requests" name="So‘rovlar" />
          </ChartCard>
          <div className="sa-stack">
            <ChartCard title="Server xotirasi (RSS, MB)" subtitle="Soatlik, shu server jarayoni" table={{ headers: ["Soat", "RSS MB"], rows: data.resources.map((r) => [r.bucket, r.rssMb]) }} height={140}>
              <TrendLine data={data.resources} x="bucket" y="rssMb" name="RSS" hourly unit="MB" />
            </ChartCard>
            <ChartCard title="Javob vaqti (p95, ms)" subtitle="Soatlik eng yuqori p95" table={{ headers: ["Soat", "p95 ms", "Event loop ms"], rows: data.resources.map((r) => [r.bucket, r.p95Ms, r.lagMs]) }} height={140}>
              <TrendLine data={data.resources} x="bucket" y="p95Ms" name="p95" hourly unit="ms" />
            </ChartCard>
          </div>
        </div>
      )}
    </>
  );
}

function ActivitiesView() {
  const { data, error, reload } = useApi<Activity[]>("/super-admin/activities?limit=100");
  return (
    <>
      <PageHeader title="So‘nggi faollik" subtitle="Platforma auditi, yangi kompaniyalar va yangi muhim xatolar" />
      <Section>{error ? <ErrorState message={error} onRetry={() => void reload()} /> : data ? <ActivityTimeline items={data.map((a) => ({ id: a.id, at: a.at, title: a.title, meta: a.actor || undefined, tone: toneOf(a.action, a.kind) }))} /> : <Skeleton rows={10} />}</Section>
    </>
  );
}

export default function OverviewPages({ view }: { view: string }) {
  if (view === "analytics") return <AnalyticsView />;
  if (view === "activities") return <ActivitiesView />;
  return <Dashboard />;
}

