import { useState } from "react";
import {
  AlarmClock,
  Banknote,
  Download,
  FileSpreadsheet,
  Timer,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { useApi } from "../hooks";
import {
  Empty,
  ErrorBox,
  Field,
  Loading,
  PageHeader,
  Person,
  StatCard,
} from "../components/ui";
import { duration, money, monthYearUz, tashkentIsoDate } from "@/lib/format";
import type { Employee } from "@/lib/types";

type Payroll = {
  month: string;
  rows: {
    employee: Employee;
    days: number;
    workedMinutes: number;
    overtimeMinutes: number;
    lateMinutes: number;
    base: number;
    overtimeAmount: number;
    deduction: number;
    net: number;
  }[];
};

export function PayrollPage() {
  const [month, setMonth] = useState(tashkentIsoDate().slice(0, 7));
  const { data, loading, error } = useApi<Payroll>(`/payroll?month=${month}`);
  const rows = data?.rows || [];
  const total = rows.reduce((s, x) => s + x.net, 0);
  const overtime = rows.reduce((s, x) => s + x.overtimeAmount, 0);
  const deduction = rows.reduce((s, x) => s + x.deduction, 0);
  return (
    <div className="page">
      <PageHeader
        title="Ish haqi"
        subtitle={`${monthYearUz(`${month}-15`)} · davomat asosida hisob-kitob`}
        actions={
          <>
            <div className="date-nav">
              <input
                type="month"
                value={month}
                max={tashkentIsoDate().slice(0, 7)}
                onChange={(e) => e.target.value && setMonth(e.target.value)}
                aria-label="Oy"
              />
            </div>
            <a className="btn" href={`/api/reports/payroll.csv?month=${month}`} download>
              <Download size={16} /> CSV
            </a>
          </>
        }
      />
      <div className="stat-grid">
        <StatCard label="Xodimlar" value={rows.length} icon={Users} />
        <StatCard label="Jami to‘lov" value={money(total)} icon={Wallet} tone="green" />
        <StatCard label="Qo‘shimcha ish" value={money(overtime)} icon={TrendingUp} tone="blue" />
        <StatCard label="Kechikish ushlanmasi" value={money(deduction)} icon={AlarmClock} tone="amber" />
      </div>
      <section className="card">
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <div className="card-body">
            <ErrorBox message={error} />
          </div>
        ) : !rows.length ? (
          <Empty icon={Banknote} title="Hisob-kitob uchun xodim yo‘q" />
        ) : (
          <div className="table-wrap">
            <table className="table table-cards">
              <thead>
                <tr>
                  <th>Xodim</th>
                  <th>Ish kuni</th>
                  <th>Ishlagan</th>
                  <th>Bazaviy</th>
                  <th>Qo‘shimcha</th>
                  <th>Ushlanma</th>
                  <th>Sof summa</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => (
                  <tr key={x.employee.id}>
                    <td>
                      <Person
                        first={x.employee.firstName}
                        last={x.employee.lastName}
                        photo={x.employee.photoDataUrl}
                        sub={x.employee.employeeNo}
                      />
                    </td>
                    <td data-label="Ish kuni" className="num">{x.days}</td>
                    <td data-label="Ishlagan" className="num">{duration(x.workedMinutes)}</td>
                    <td data-label="Bazaviy" className="num">{money(x.base, x.employee.currency)}</td>
                    <td data-label="Qo‘shimcha" className="num" style={{ color: "var(--green)" }}>
                      {x.overtimeAmount ? `+ ${money(x.overtimeAmount, x.employee.currency)}` : "—"}
                    </td>
                    <td data-label="Ushlanma" className="num" style={{ color: "var(--red)" }}>
                      {x.deduction ? `− ${money(x.deduction, x.employee.currency)}` : "—"}
                      {x.lateMinutes > 0 && (
                        <small className="muted" style={{ display: "block" }}>
                          {x.lateMinutes} daq kechikish
                        </small>
                      )}
                    </td>
                    <td data-label="Sof summa" className="num">
                      <b>{money(x.net, x.employee.currency)}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="hint" style={{ marginTop: 12 }}>
        Hisob: soatlik stavka = oylik / 176. Qo‘shimcha ish va kechikish daqiqalari
        shu stavka bo‘yicha hisoblanadi. Yakuniy to‘lovdan oldin buxgalteriya bilan
        tekshiring.
      </p>
    </div>
  );
}

export function ReportsPage() {
  const today = tashkentIsoDate();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const reports = [
    {
      name: "Davomat hisoboti",
      desc: "Har bir kelish/ketish, holat, masofa va tasdiq usuli",
      icon: Timer,
      href: `/api/reports/attendance.csv?from=${from}&to=${to}`,
    },
    {
      name: "Kechikishlar hisoboti",
      desc: "Faqat kechikkan kunlar va daqiqalar",
      icon: AlarmClock,
      href: `/api/reports/attendance.csv?from=${from}&to=${to}&type=late`,
    },
    {
      name: "Ish haqi hisoboti",
      desc: "Tanlangan oyning hisob-kitobi",
      icon: FileSpreadsheet,
      href: `/api/reports/payroll.csv?month=${from.slice(0, 7)}`,
    },
    {
      name: "Xodimlar ro‘yxati",
      desc: "Barcha xodimlar, filial, lavozim, Telegram va Face ID holati",
      icon: Users,
      href: "/api/reports/employees.csv",
    },
  ];
  return (
    <div className="page">
      <PageHeader title="Hisobotlar" subtitle="Excel’da ochiladigan CSV fayllar" />
      <section className="card card-body" style={{ marginBottom: 16 }}>
        <div className="form-grid" style={{ maxWidth: 520 }}>
          <Field label="Boshlanish">
            <input className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Tugash">
            <input className="input" type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
      </section>
      <div className="grid-cards">
        {reports.map((r) => (
          <article className="card" key={r.name}>
            <div className="card-body">
              <span className="branch-icon" style={{ marginBottom: 14 }}>
                <r.icon size={20} />
              </span>
              <h3 style={{ fontSize: 15.5, fontWeight: 650 }}>{r.name}</h3>
              <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                {r.desc}
              </p>
            </div>
            <div className="card-foot">
              <span className="hint">CSV · UTF-8</span>
              <a className="btn btn-sm btn-primary" href={r.href} download>
                <Download size={14} /> Yuklab olish
              </a>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
