import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlarmClock,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Bell,
  Building2,
  Cake,
  CalendarDays,
  CalendarX2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  Download,
  FileWarning,
  Gavel,
  Hourglass,
  Inbox,
  MapPin,
  Megaphone,
  Plane,
  Search,
  ShieldAlert,
  Smartphone,
  TrendingUp,
  UserCheck,
  UserPlus,
  UserX,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from "recharts";
import { useApi, usePolling } from "../hooks";
import { useAuth } from "../auth";
import { Avatar, Empty, ErrorBox, PageHeader, Segmented } from "../components/ui";
import type { Notification } from "@/lib/types";
import { canOpenPage } from "@/lib/permissions";
import { dateLongUz, dateUz, duration, tashkentIsoDate, weekdayShortUz } from "@/lib/format";
import { addDays, type RosterRow, type RosterStats } from "../types";
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
type Days = "7" | "14" | "30";
type Tone = "red" | "amber" | "green" | "violet" | "blue" | "gray";
type ServerAction = { level: "red" | "orange" | "yellow" | "info"; text: string; count: number; link?: string };
type Actions = { actions: ServerAction[]; inbox: { total: number; urgent: number } };

/*
 * Holatlar bir-birini takrorlamaydi: har bir faol xodim bugun faqat bitta holatda —
 * keldi (ishda yoki ketgan), kelmagan, ta’tilda, dam olishda yoki kutilmoqda (smenasi hali boshlanmagan).
 * «Kechikkan» — kelganlarning ichidagi qism, alohida guruh emas.
 * Davomat % = kelganlar / (kelganlar + kelmaganlar): smenasi hali boshlanmaganlar hisobga kirmaydi.
 */
const rateOf = (came: number, absent: number) => (came + absent ? (came / (came + absent)) * 100 : null);
const num = (n: number) => n.toLocaleString("ru-RU").replace(/[  ]/g, " ");
const pct = (n: number, digits = 0) => `${n.toFixed(digits).replace(".", ",")}%`;
const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** Davomat darajasi: ≥90% — yaxshi, 70–89% — o‘rtacha, <70% — kritik (server ogohlantirishi ham 70%). */
const rateTone = (rate: number | null): Tone => (rate === null ? "gray" : rate >= 90 ? "green" : rate >= 70 ? "amber" : "red");

export function DashboardPage() {
  const { user } = useAuth();
  const today = useMemo(() => tashkentIsoDate(), []);
  const [date, setDate] = useState(today);
  const [days, setDays] = useState<Days>("7");
  const isToday = date === today;
  const { data, loading, error, reload } = useApi<Dashboard>(`/dashboard?days=${days}${isToday ? "" : `&date=${date}`}`);
  const actions = useApi<Actions>("/workspace/actions");
  usePolling(() => {
    if (isToday) void reload(true);
    void actions.reload(true);
  }, 30_000);
  const allowed = (path: string) => (user ? canOpenPage(user.role, path, user.modules) : false);

  if (!data)
    return (
      <div className="page db">
        {error ? <ErrorBox message={error} /> : <DashSkeleton />}
      </div>
    );

  const s = data.stats;
  const yesterday = data.weekly[data.weekly.length - 2];
  const yRate = yesterday?.rate ?? null;
  const rate = rateOf(s.present, s.absent);
  const planned = Math.max(0, s.total - s.dayOff - s.leave);
  const prev = isToday ? "kecha" : "oldingi kun";
  const monthStart = `${date.slice(0, 7)}-01`;

  return (
    <div className={`page db ${loading ? "is-refreshing" : ""}`}>
      <PageHeader
        title="Bosh sahifa"
        subtitle={isToday ? "Korxonangizning bugungi faoliyati va muhim ko‘rsatkichlari" : `${dateLongUz(date)} holatiga ko‘ra faoliyat va ko‘rsatkichlar`}
        actions={
          <>
            <DatePick value={date} max={today} onChange={setDate} />
            {allowed("/reports") && (
              <a className="btn" href={`/api/reports/attendance.xlsx?from=${monthStart}&to=${date}`} download>
                <Download size={16} /> Hisobotni yuklash
              </a>
            )}
            {allowed("/employees/new") && (
              <Link className="btn btn-primary" to="/employees/new">
                <UserPlus size={16} /> Xodim qo‘shish
              </Link>
            )}
          </>
        }
      />
      {error && <ErrorBox message={error} />}

      <SetupChecklist data={data} />

      <section className="db-kpis" aria-label="Asosiy ko‘rsatkichlar">
        <Kpi label="Jami xodimlar" value={s.total} icon={Users} note={`Faol · ${num(planned)} nafari rejada`} to={allowed("/employees") ? "/employees" : undefined} />
        <Kpi
          label={isToday ? "Bugun ishda" : "Ishga kelgan"}
          value={s.present}
          icon={UserCheck}
          tone="green"
          note={rate === null ? "Hali davomat yo‘q" : `${pct(rate)} davomat`}
          compare={yRate === null ? undefined : `${prev} ${yRate}%`}
          meter={rate ?? 0}
          to={isToday ? "/attendance?state=IN" : undefined}
        />
        <Kpi
          label="Kechikkanlar"
          value={s.late}
          icon={AlarmClock}
          tone="amber"
          note={s.present ? `Kelganlarning ${pct((s.late / s.present) * 100)}` : "Kechikish yo‘q"}
          compare={yesterday ? `${prev} ${num(yesterday.late)}` : undefined}
          to={isToday ? "/attendance?state=LATE" : undefined}
        />
        <Kpi
          label="Kelmaganlar"
          value={s.absent}
          icon={UserX}
          tone="red"
          note={s.absent ? "Sababi ko‘rsatilmagan" : "Hamma joyida"}
          compare={yesterday ? `${prev} ${num(yesterday.absent)}` : undefined}
          to={isToday ? "/attendance?state=ABSENT" : undefined}
        />
        <Kpi label="Ta’tilda" value={s.leave} icon={Plane} tone="violet" note="Tasdiqlangan ta’til" to={allowed("/leave") ? "/leave" : undefined} />
      </section>

      <div className="db-row db-row-main">
        <AttendanceCard weekly={data.weekly} days={days} onDays={setDays} />
        <ActionCenter data={actions.data} loading={actions.loading} leave={allowed("/leave") ? data.leave : 0} more={allowed("/workspace")} />
      </div>

      <BranchTable roster={data.roster} isToday={isToday} more={allowed("/branches") ? "/branches" : null} />

      <div className="db-row db-row-split">
        <TeamCard roster={data.roster} isToday={isToday} more={allowed("/attendance")} />
        <EventsCard items={data.notifications} more={allowed("/notifications")} />
      </div>
    </div>
  );
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
    <div className="db-date" role="group" aria-label="Sana">
      <button type="button" className="db-date-step" aria-label="Oldingi kun" disabled={value <= min} onClick={() => onChange(addDays(value, -1))}>
        <ChevronLeft size={16} />
      </button>
      <button type="button" className="db-date-btn" onClick={open} aria-label={`Sana: ${dateLongUz(value)}. O‘zgartirish`}>
        <CalendarDays size={15} />
        <span>{dateLongUz(value)}</span>
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
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ KPI --- */
function Kpi({
  label,
  value,
  icon: Icon,
  tone,
  note,
  compare,
  meter,
  to,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  tone?: Tone;
  note: string;
  compare?: string;
  meter?: number;
  to?: string;
}) {
  const body = (
    <>
      <span className="db-kpi-top">
        <span>{label}</span>
        <Icon size={16} strokeWidth={1.8} aria-hidden />
      </span>
      <span className="db-kpi-value">
        <strong>{num(value)}</strong>
        {compare && <small>{compare}</small>}
      </span>
      {meter !== undefined && (
        <span className="db-meter" aria-hidden>
          <i className={rateTone(meter)} style={{ width: `${Math.min(100, meter)}%` }} />
        </span>
      )}
      <span className={`db-kpi-note ${tone || ""}`}>{note}</span>
    </>
  );
  return to ? (
    <Link to={to} className="db-kpi is-link">
      {body}
    </Link>
  ) : (
    <div className="db-kpi">{body}</div>
  );
}

/* --------------------------------------------------- davomat dinamikasi --- */
function AttendanceCard({ weekly, days, onDays }: { weekly: Dashboard["weekly"]; days: Days; onDays: (d: Days) => void }) {
  const lastIso = weekly[weekly.length - 1]?.date;
  const realToday = tashkentIsoDate();
  // Davomat hisobi boshlangan kundan ko‘rsatamiz — oldingi bo‘sh kunlar grafikning yarmini egallamasin.
  const firstData = weekly.findIndex((d) => d.present + d.late + d.absent > 0);
  const series = firstData > 0 ? weekly.slice(firstData) : weekly;
  const chart = series.map((item) => ({
    ...item,
    day: item.date === lastIso && lastIso === realToday ? "Bugun" : days === "7" ? weekdayShortUz(item.date) : String(Number(item.date.slice(8))),
    // Ustunning eng yuqori (nolga teng bo‘lmagan) qismi — faqat uning uchi yumaloqlanadi.
    top: item.absent ? "absent" : item.late ? "late" : "present",
  }));
  const came = series.reduce((sum, d) => sum + d.present + d.late, 0);
  const late = series.reduce((sum, d) => sum + d.late, 0);
  const absent = series.reduce((sum, d) => sum + d.absent, 0);
  // O‘rtacha — og‘irlikli: jami kelganlar / jami kutilganlar (1 kishilik kun 10 kishilik kun bilan teng emas).
  const avg = rateOf(came, absent);
  const worst = series.filter((d) => d.rate !== null).sort((a, b) => (a.rate as number) - (b.rate as number))[0];

  return (
    <section className="card db-card">
      <div className="db-head">
        <div>
          <h2>Davomat dinamikasi</h2>
          <p>{`So‘nggi ${days} kunlik davomat ko‘rsatkichlari`}</p>
        </div>
        <Segmented<Days>
          value={days}
          onChange={onDays}
          options={[
            { value: "7", label: "7 kun" },
            { value: "14", label: "14 kun" },
            { value: "30", label: "30 kun" },
          ]}
        />
      </div>
      {firstData < 0 ? (
        <Empty icon={Clock3} title="Hali davomat yo‘q" text="Xodimlar kelib-ketishni belgilay boshlagach, kunlik davomat shu yerda ko‘rinadi." />
      ) : (
        <>
          <div className="db-legend" aria-hidden>
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
          <div className="db-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ left: -4, right: 4, top: 6 }} barCategoryGap={chart.length > 14 ? "24%" : "40%"}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis
                  dataKey="day"
                  axisLine={false}
                  tickLine={false}
                  minTickGap={6}
                  interval={chart.length > 14 ? "preserveStartEnd" : 0}
                  tick={(props: { x: number; y: number; payload: { value: string } }) => (
                    <text x={props.x} y={props.y + 12} textAnchor="middle" fontSize={11} fontWeight={props.payload.value === "Bugun" ? 600 : 400} fill={props.payload.value === "Bugun" ? "var(--ink)" : "var(--chart-axis)"}>
                      {props.payload.value}
                    </text>
                  )}
                />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} width={46} tick={{ fill: "var(--chart-axis)", fontSize: 11 }} tickFormatter={(v: number) => num(v)} />
                <Tooltip cursor={{ fill: "var(--hover-tint)" }} content={<ChartTooltip />} isAnimationActive={false} />
                {(["present", "late", "absent"] as const).map((key) => (
                  <Bar
                    key={key}
                    dataKey={key}
                    name={key === "present" ? "Vaqtida" : key === "late" ? "Kechikkan" : "Kelmagan"}
                    stackId="day"
                    maxBarSize={30}
                    isAnimationActive={false}
                    shape={(raw: unknown) => {
                      const { x, y, width, height, payload } = raw as { x: number; y: number; width: number; height: number; payload: { top: string } };
                      if (!height || height <= 0) return <g />;
                      const color = `var(--chart-${key === "present" ? "ok" : key === "late" ? "late" : "bad"})`;
                      // Eng yuqori qism — uchi 3px yumaloq; pastdagilar ustidan 1.5px oraliq (segmentlar ajralib turadi).
                      if (payload.top !== key) {
                        const h = Math.max(0, height - 1.5);
                        return h ? <rect x={x} y={y + 1.5} width={width} height={h} style={{ fill: color }} /> : <g />;
                      }
                      const r = Math.min(3, width / 2, height);
                      return <path d={`M${x},${y + height} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + height} Z`} style={{ fill: color }} />;
                    }}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
            {/* Ekran o‘quvchilar uchun jadval ko‘rinishi */}
            <table className="sr-only">
              <caption>Kunlik davomat</caption>
              <thead>
                <tr>
                  <th>Sana</th>
                  <th>Vaqtida</th>
                  <th>Kechikkan</th>
                  <th>Kelmagan</th>
                  <th>Davomat</th>
                </tr>
              </thead>
              <tbody>
                {series.map((d) => (
                  <tr key={d.date}>
                    <td>{dateUz(d.date)}</td>
                    <td>{d.present}</td>
                    <td>{d.late}</td>
                    <td>{d.absent}</td>
                    <td>{d.rate === null ? "—" : `${d.rate}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="db-insight">
            <TrendingUp size={15} aria-hidden />
            <span>
              {`Oxirgi ${series.length} kunda o‘rtacha davomat:`} <b>{avg === null ? "—" : pct(avg, 1)}</b>
            </span>
            <span className="db-insight-side">
              <span>Kechikishlar</span> <b>{num(late)}</b>
              {worst && worst.rate !== null && worst.rate < 100 && (
                <>
                  <span className="db-dot" aria-hidden>
                    ·
                  </span>
                  <span>Eng past kun</span> <b>{`${dateUz(worst.date).slice(0, 6)} — ${worst.rate}%`}</b>
                </>
              )}
            </span>
          </div>
        </>
      )}
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

/* ------------------------------------------------------ e’tibor markazi --- */
const LEVEL_TONE: Record<ServerAction["level"], Tone> = { red: "red", orange: "amber", yellow: "amber", info: "blue" };
const TONE_RANK: Record<Tone, number> = { red: 0, amber: 1, violet: 2, blue: 3, green: 4, gray: 5 };

function actionIcon(a: ServerAction): LucideIcon {
  const t = a.text;
  if (/kelmagan/.test(t)) return UserX;
  if (/kechik/.test(t)) return AlarmClock;
  if (/hujjat/.test(t)) return FileWarning;
  if (/onboarding/.test(t)) return UserPlus;
  if (/belgilash/.test(t)) return ClipboardCheck;
  if (/anketa/.test(t)) return ClipboardList;
  if (/jarima/.test(t)) return Gavel;
  if (/avans|oylik|oy \(/.test(t)) return Wallet;
  if (/telefon/.test(t)) return Smartphone;
  if (/filialda davomat/.test(t)) return MapPin;
  if (/ertaga/.test(t)) return CalendarX2;
  if (/tug‘ilgan|yillig/.test(t)) return Cake;
  if (/sinov/.test(t)) return Hourglass;
  if (/shoshilinch/.test(t)) return ShieldAlert;
  return CircleAlert;
}

function ActionCenter({ data, loading, leave, more }: { data: Actions | null; loading: boolean; leave: number; more: boolean }) {
  const items = useMemo(() => {
    const list: { key: string; icon: LucideIcon; title: string; note?: string; count: number; tone: Tone; link: string }[] = [];
    if (data?.inbox.total)
      list.push({
        key: "inbox",
        icon: Inbox,
        title: "Tasdiqlash kutilmoqda",
        note: data.inbox.urgent ? `${data.inbox.urgent} tasi shoshilinch` : undefined,
        count: data.inbox.total,
        tone: data.inbox.urgent ? "red" : "amber",
        link: "/inbox",
      });
    if (leave) list.push({ key: "leave", icon: Plane, title: "Ta’til so‘rovlari", count: leave, tone: "amber", link: "/leave" });
    for (const a of data?.actions || []) {
      // Shoshilinch tasdiqlar — yuqoridagi umumiy «Tasdiqlash kutilmoqda» bandida.
      if (a.link === "/inbox" && data?.inbox.total) continue;
      list.push({ key: a.text, icon: actionIcon(a), title: cap(a.text), count: a.count, tone: LEVEL_TONE[a.level], link: a.link || "/workspace" });
    }
    return list.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]);
  }, [data, leave]);
  const shown = items.slice(0, 6);

  return (
    <section className="card db-card db-actions">
      <div className="db-head">
        <div>
          <h2>E’tibor talab qiladi</h2>
          <p>Bugun ko‘rib chiqilishi kerak bo‘lgan masalalar</p>
        </div>
        {items.length > 0 && <span className="db-head-count">{items.length}</span>}
      </div>
      {shown.length ? (
        <ul className="db-action-list">
          {shown.map((item) => (
            <li key={item.key}>
              <Link to={item.link} className="db-action">
                <span className="db-action-icon">
                  <item.icon size={15} strokeWidth={1.8} aria-hidden />
                </span>
                <span className="db-action-text">
                  <b>{item.title}</b>
                  {item.note && <small>{item.note}</small>}
                </span>
                <span className={`db-count ${item.tone}`}>{num(item.count)}</span>
                <ChevronRight size={15} className="db-chevron" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      ) : loading && !data ? (
        <div className="db-action-list">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="db-sk db-sk-row" />
          ))}
        </div>
      ) : (
        <div className="db-clear">
          <CheckCircle2 size={20} aria-hidden />
          <b>Hammasi joyida</b>
          <small>Kutilayotgan so‘rov yoki muammo yo‘q.</small>
        </div>
      )}
      {more && (
        <Link to="/workspace" className="db-foot-link">
          Barcha vazifalarni ko‘rish
          {items.length > shown.length && <small>+{items.length - shown.length}</small>}
          <ChevronRight size={14} aria-hidden />
        </Link>
      )}
    </section>
  );
}

/* ----------------------------------------------------- filiallar jadvali --- */
type BranchRow = { key: string; name: string; total: number; came: number; late: number; absent: number; waiting: number; rate: number | null };
type SortKey = "name" | "total" | "came" | "late" | "absent" | "rate";
type BranchFilter = "ALL" | "red" | "amber" | "green";

function branchRows(roster: RosterRow[]): BranchRow[] {
  const map = new Map<string, BranchRow>();
  for (const row of roster) {
    const key = row.branchId || row.branch || "none";
    const b = map.get(key) || { key, name: row.branch || "Filialsiz", total: 0, came: 0, late: 0, absent: 0, waiting: 0, rate: null };
    b.total += 1;
    if (row.state === "IN" || row.state === "LEFT") b.came += 1;
    if (row.late) b.late += 1;
    if (row.state === "ABSENT") b.absent += 1;
    if (row.state === "NOT_YET" || row.state === "UPCOMING") b.waiting += 1;
    map.set(key, b);
  }
  return [...map.values()].map((b) => ({ ...b, rate: rateOf(b.came, b.absent) }));
}

const BRANCH_STATE: Record<Tone, string> = { green: "Yaxshi", amber: "O‘rtacha", red: "Kritik", gray: "Kutilmoqda", blue: "", violet: "" };

function BranchTable({ roster, isToday, more }: { roster: RosterRow[]; isToday: boolean; more: string | null }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<BranchFilter>("ALL");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "rate", dir: 1 });
  const [expanded, setExpanded] = useState(false);
  const all = useMemo(() => branchRows(roster), [roster]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter((b) => (!q || b.name.toLowerCase().includes(q)) && (filter === "ALL" || rateTone(b.rate) === filter))
      .sort((a, b) => {
        if (sort.key === "name") return a.name.localeCompare(b.name, "uz") * sort.dir;
        // Ma’lumoti yo‘q filial har doim oxirida.
        const av = a[sort.key] ?? (sort.dir === 1 ? Infinity : -Infinity);
        const bv = b[sort.key] ?? (sort.dir === 1 ? Infinity : -Infinity);
        return (av - bv) * sort.dir || b.total - a.total;
      });
  }, [all, query, filter, sort]);
  const shown = expanded ? rows : rows.slice(0, 8);
  const toggle = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "name" ? 1 : -1 }));
  const head = (key: SortKey, label: string, align?: "num") => {
    const active = sort.key === key;
    const Icon = !active ? ArrowUpDown : sort.dir === 1 ? ArrowUp : ArrowDown;
    return (
      <th className={align} aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
        <button type="button" className={`db-sort ${active ? "on" : ""}`} onClick={() => toggle(key)}>
          {label}
          <Icon size={12} aria-hidden />
        </button>
      </th>
    );
  };

  return (
    <section className="card db-card">
      <div className="db-head">
        <div>
          <h2>Filiallar faoliyati</h2>
          <p>{isToday ? "Filiallar bo‘yicha bugungi davomat va ish jarayoni" : "Filiallar bo‘yicha tanlangan kundagi davomat va ish jarayoni"}</p>
        </div>
        {all.length > 0 && (
          <div className="db-tools">
            <label className="db-search">
              <Search size={14} aria-hidden />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filial qidirish" aria-label="Filial qidirish" />
            </label>
            <label className="db-select">
              <select value={filter} onChange={(e) => setFilter(e.target.value as BranchFilter)} aria-label="Holat bo‘yicha saralash">
                <option value="ALL">Barchasi</option>
                <option value="red">Kritik</option>
                <option value="amber">O‘rtacha</option>
                <option value="green">Yaxshi</option>
              </select>
            </label>
            {more && (
              <Link to={more} className="btn btn-sm">
                Batafsil
              </Link>
            )}
          </div>
        )}
      </div>
      {!all.length ? (
        <Empty icon={Building2} title="Filiallar bo‘yicha ma’lumot yo‘q" text="Xodimlar filialga biriktirilgach, har bir filialning davomati shu yerda ko‘rinadi." />
      ) : !rows.length ? (
        <Empty icon={Search} title="Mos filial topilmadi" text="Qidiruv yoki holat filtrini o‘zgartirib ko‘ring." />
      ) : (
        <div className="table-wrap db-table-wrap">
          <table className="table db-table db-branches">
            <thead>
              <tr>
                {head("name", "Filial")}
                {head("total", "Xodimlar", "num")}
                {head("came", "Ishda", "num")}
                {head("late", "Kechikkan", "num")}
                {head("absent", "Kelmagan", "num")}
                {head("rate", "Davomat")}
                <th>Holat</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((b) => {
                const tone = rateTone(b.rate);
                return (
                  <tr key={b.key}>
                    <td>
                      <span className="db-branch">
                        <span className="db-branch-icon">
                          <Building2 size={14} strokeWidth={1.8} aria-hidden />
                        </span>
                        <b>{b.name}</b>
                      </span>
                    </td>
                    <td className="num">{num(b.total)}</td>
                    <td className="num">{num(b.came)}</td>
                    <td className={`num ${b.late ? "t-amber" : "t-zero"}`}>
                      <span className="db-n">{num(b.late)}</span>
                    </td>
                    <td className={`num ${b.absent ? "t-red" : "t-zero"}`}>
                      <span className="db-n">{num(b.absent)}</span>
                    </td>
                    <td>
                      <span className="db-rate">
                        <span className="db-meter">
                          <i className={tone} style={{ width: `${b.rate ?? 0}%` }} />
                        </span>
                        <b className="num">{b.rate === null ? "—" : pct(b.rate, 1)}</b>
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${tone}`}>{b.rate === null ? (b.waiting ? "Kutilmoqda" : "Reja yo‘q") : BRANCH_STATE[tone]}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 8 && (
        <button type="button" className="db-foot-link" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Qisqartirish" : `Yana ${rows.length - 8} ta filial`}
          <ChevronRight size={14} aria-hidden style={{ transform: expanded ? "rotate(-90deg)" : "rotate(90deg)" }} />
        </button>
      )}
    </section>
  );
}

/* --------------------------------------------------------- bugungi jamoa --- */
type TeamFilter = "ALL" | "LATE" | "ABSENT";
const TEAM_FILTERS: Record<TeamFilter, (row: RosterRow) => boolean> = {
  ALL: () => true,
  LATE: (row) => row.late,
  ABSENT: (row) => row.state === "ABSENT",
};

function stateBadge(row: RosterRow): [string, Tone, boolean?] {
  const state = row.state as string;
  if (state === "IN") return row.late ? ["Kechikkan", "amber"] : ["Ishda", "green", true];
  if (state === "LEFT") return ["Ketdi", "blue"];
  if (state === "ABSENT") return ["Kelmagan", "red"];
  if (state === "ON_LEAVE") return ["Ta’tilda", "violet"];
  if (state === "DAY_OFF") return ["Dam olishda", "gray"];
  if (state === "PRACTICE") return ["Mashq davri", "amber"];
  return ["Kutilmoqda", "gray"];
}

function TeamCard({ roster, isToday, more }: { roster: RosterRow[]; isToday: boolean; more: boolean }) {
  const navigate = useNavigate();
  const [team, setTeam] = useState<TeamFilter>("ALL");
  const rows = roster.filter(TEAM_FILTERS[team]).slice(0, 5);
  return (
    <section className="card db-card">
      <div className="db-head">
        <div>
          <h2>{isToday ? "Bugungi xodimlar" : "Kun bo‘yicha xodimlar"}</h2>
          <p>Xodimlarning so‘nggi davomat holati</p>
        </div>
        {roster.length > 0 && (
          <Segmented<TeamFilter>
            value={team}
            onChange={setTeam}
            options={[
              { value: "ALL", label: "Hammasi" },
              { value: "LATE", label: "Kechikkan", count: roster.filter(TEAM_FILTERS.LATE).length },
              { value: "ABSENT", label: "Kelmagan", count: roster.filter(TEAM_FILTERS.ABSENT).length },
            ]}
          />
        )}
      </div>
      {!roster.length ? (
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
      ) : !rows.length ? (
        <div className="db-clear">
          <CheckCircle2 size={20} aria-hidden />
          <b>{team === "LATE" ? "Kechikkan xodim yo‘q" : "Kelmagan xodim yo‘q"}</b>
          <small>Bu holatda hech kim yo‘q.</small>
        </div>
      ) : (
        <div className="table-wrap db-table-wrap">
          <table className="table db-table db-team">
            <thead>
              <tr>
                <th>Xodim</th>
                <th>Filial</th>
                <th>Ish vaqti</th>
                <th>Keldi</th>
                <th>Holat</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const [label, tone, live] = stateBadge(row);
                return (
                  <tr key={row.employee.id} className="clickable" onClick={() => navigate(`/employees/${row.employee.id}`)}>
                    <td>
                      <span className="db-person">
                        <Avatar first={row.employee.firstName} last={row.employee.lastName} photo={row.employee.photoDataUrl} size="sm" />
                        <span>
                          <Link to={`/employees/${row.employee.id}`} onClick={(e) => e.stopPropagation()}>
                            {row.employee.firstName} {row.employee.lastName}
                          </Link>
                          <small>{row.position || row.employee.employeeNo}</small>
                        </span>
                      </span>
                    </td>
                    <td className="db-cell-muted">{row.branch || "—"}</td>
                    <td className="num db-cell-muted">{row.scheduledStart ? `${row.scheduledStart}–${row.scheduledEnd}` : "—"}</td>
                    <td>
                      <span className="db-time">
                        <b>{row.record?.checkIn || "—"}</b>
                        {row.late && row.record?.lateMinutes ? <small>+{duration(row.record.lateMinutes)}</small> : null}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${tone} ${live ? "live" : ""}`}>{label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {more && roster.length > 0 && (
        <Link to="/attendance" className="db-foot-link">
          Barcha xodimlar <small>{num(roster.length)}</small>
          <ChevronRight size={14} aria-hidden />
        </Link>
      )}
    </section>
  );
}

/* -------------------------------------------------------- so‘nggi voqealar --- */
function eventLook(type: string): [LucideIcon, Tone] {
  if (type === "ATTENDANCE" || type === "ATTENDANCE_QR") return [Clock3, "amber"];
  if (type === "ATTENDANCE_REQUEST") return [ClipboardCheck, "blue"];
  if (type === "LEAVE") return [Plane, "violet"];
  if (type === "REGISTRATION" || type === "EMPLOYEES") return [UserPlus, "green"];
  if (type === "PAYROLL" || type === "ADVANCE" || type === "BONUS" || type === "FINE" || type === "SETTLEMENT") return [Wallet, "blue"];
  if (type === "ANNOUNCEMENT") return [Megaphone, "blue"];
  if (type === "SECURITY" || type === "FACE_VERIFICATION" || /LOGIN|CODE/.test(type)) return [ShieldAlert, "red"];
  if (type === "DOCUMENT" || type === "PASSPORT") return [FileWarning, "amber"];
  if (type === "BIRTHDAY") return [Cake, "violet"];
  return [Bell, "gray"];
}

function relTime(iso: string, now = Date.now()) {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "hozirgina";
  if (min < 60) return `${min} daqiqa oldin`;
  const hours = Math.floor(min / 60);
  if (hours < 24 && tashkentIsoDate(iso) === tashkentIsoDate(new Date(now))) return `${hours} soat oldin`;
  const clock = new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tashkent" });
  if (tashkentIsoDate(iso) === addDays(tashkentIsoDate(new Date(now)), -1)) return `Kecha, ${clock}`;
  return `${dateUz(iso).slice(0, 6)}, ${clock}`;
}

function EventsCard({ items, more }: { items: Notification[]; more: boolean }) {
  return (
    <section className="card db-card">
      <div className="db-head">
        <div>
          <h2>So‘nggi voqealar</h2>
          <p>Davomat, so‘rovlar va tizim xabarlari</p>
        </div>
      </div>
      {items.length ? (
        <ol className="db-events">
          {items.slice(0, 5).map((item) => {
            const [Icon, tone] = eventLook(item.type);
            return (
              <li key={item.id} className={item.read ? "" : "unread"}>
                <span className={`db-event-icon ${tone}`}>
                  <Icon size={14} strokeWidth={1.9} aria-hidden />
                </span>
                <span className="db-event-text">
                  <b>{item.title}</b>
                  {item.body && <small>{item.body}</small>}
                </span>
                <time dateTime={item.createdAt}>{relTime(item.createdAt)}</time>
              </li>
            );
          })}
        </ol>
      ) : (
        <Empty icon={Bell} title="Hozircha voqealar yo‘q" text="Kechikishlar, so‘rovlar va tizim xabarlari shu yerda ko‘rinadi." />
      )}
      {more && items.length > 0 && (
        <Link to="/notifications" className="db-foot-link">
          Barcha voqealar
          <ChevronRight size={14} aria-hidden />
        </Link>
      )}
    </section>
  );
}

/* ------------------------------------------------------------- skeleton --- */
function DashSkeleton() {
  return (
    <div aria-busy="true" aria-label="Yuklanmoqda">
      <div className="db-sk-head">
        <span className="db-sk" style={{ width: 160, height: 26 }} />
        <span className="db-sk" style={{ width: 320, height: 14 }} />
      </div>
      <div className="db-kpis">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="db-kpi">
            <span className="db-sk" style={{ width: "55%", height: 12 }} />
            <span className="db-sk" style={{ width: "40%", height: 28, margin: "10px 0 8px" }} />
            <span className="db-sk" style={{ width: "70%", height: 11 }} />
          </span>
        ))}
      </div>
      <div className="db-row db-row-main">
        <span className="card db-sk-card" style={{ height: 380 }} />
        <span className="card db-sk-card" style={{ height: 380 }} />
      </div>
    </div>
  );
}
