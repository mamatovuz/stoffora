import { useState } from "react";
import { Link } from "react-router-dom";
import {
  AlarmClock,
  AlertTriangle,
  Banknote,
  Download,
  FileSpreadsheet,
  Settings2,
  Timer,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { useApi } from "../hooks";
import { errorText, put } from "../api";
import {
  Empty,
  ErrorBox,
  Field,
  Loading,
  Modal,
  PageHeader,
  Person,
  StatCard,
  useToast,
} from "../components/ui";
import { duration, money, monthYearUz, tashkentIsoDate } from "@/lib/format";
import type { Employee } from "@/lib/types";
import type { Meta } from "../types";

type Payroll = {
  month: string;
  rule: string;
  rows: {
    employee: Employee;
    days: number;
    expectedDays: number;
    absentDays: number;
    lateDays: number;
    lateMinutes: number;
    chargeableLateMinutes: number;
    workedMinutes: number;
    overtimeMinutes: number;
    base: number;
    overtimeAmount: number;
    deduction: number;
    net: number;
    explanation: string;
    kpi: { attendance: number; punctuality: number; score: number; grade: string };
  }[];
};

export function PayrollPage() {
  const [month, setMonth] = useState(tashkentIsoDate().slice(0, 7));
  const { data, loading, error, reload } = useApi<Payroll>(`/payroll?month=${month}`);
  const [salaryOpen, setSalaryOpen] = useState(false);
  const rows = data?.rows || [];
  const noSalary = rows.filter((x) => !x.employee.baseSalary).length;
  const total = rows.reduce((s, x) => s + x.net, 0);
  const deduction = rows.reduce((s, x) => s + x.deduction, 0);
  const avgKpi = rows.length ? Math.round(rows.reduce((s, x) => s + x.kpi.score, 0) / rows.length) : 0;
  const lateCount = rows.filter((x) => x.lateMinutes > 0).length;
  return (
    <div className="page">
      <PageHeader
        title="Ish haqi va KPI"
        subtitle={`${monthYearUz(`${month}-15`)} · ${data?.rule || "davomat asosida hisob-kitob"}`}
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
            <button className="btn" onClick={() => setSalaryOpen(true)} disabled={!rows.length}>
              <Wallet size={16} /> Maoshlar
            </button>
            <Link className="btn" to="/settings?tab=payroll">
              <Settings2 size={16} /> Jarima sozlamasi
            </Link>
            <a className="btn btn-primary" href={`/api/reports/payroll.xlsx?month=${month}`} download>
              <Download size={16} /> Excel
            </a>
          </>
        }
      />
      <div className="stat-grid">
        <StatCard label="Jami to‘lov" value={money(total)} note={`${rows.length} xodim`} icon={Wallet} tone="green" />
        <StatCard label="Kechikish ushlanmasi" value={money(deduction)} note={`${lateCount} xodim kechikkan`} icon={AlarmClock} tone="amber" />
        <StatCard label="O‘rtacha KPI" value={`${avgKpi}`} note="Davomat 60% + vaqtida kelish 40%" icon={TrendingUp} tone="violet" />
        <StatCard label="Qo‘shimcha ish" value={money(rows.reduce((s, x) => s + x.overtimeAmount, 0))} icon={Banknote} tone="blue" />
      </div>
      {noSalary > 0 && (
        <div className="alert warn" style={{ marginBottom: 16 }}>
          <AlertTriangle size={18} />
          <div style={{ flex: 1 }}>
            <b>{noSalary} ta xodimning oyligi kiritilmagan (0 so‘m)</b>
            <p>
              Integratsiyada maosh faqat bot kalitida <code>employees:salary</code> ruxsati bo‘lsa keladi. Oyliklarni shu yerda
              lavozim bo‘yicha yoki alohida kiriting.
            </p>
          </div>
          <button className="btn btn-sm btn-primary" onClick={() => setSalaryOpen(true)}>
            Kiritish
          </button>
        </div>
      )}
      <section className="card">
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <div className="card-body">
            <ErrorBox message={error} />
          </div>
        ) : !rows.length ? (
          <Empty icon={Users} title="Hisob-kitob uchun xodim yo‘q" />
        ) : (
          <div className="table-wrap">
            <table className="table table-cards">
              <thead>
                <tr>
                  <th>Xodim</th>
                  <th>KPI</th>
                  <th>Davomat</th>
                  <th>Kechikish</th>
                  <th>Oylik</th>
                  <th>Ushlanma</th>
                  <th>To‘lanadi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => (
                  <tr key={x.employee.id}>
                    <td>
                      <Person first={x.employee.firstName} last={x.employee.lastName} photo={x.employee.photoDataUrl} sub={x.employee.employeeNo} />
                      <span className="pay-note">{x.explanation}</span>
                    </td>
                    <td data-label="KPI">
                      <span className={`kpi-pill ${x.kpi.grade}`} title={`Davomat ${x.kpi.attendance}% · Vaqtida ${x.kpi.punctuality}%`}>
                        {x.kpi.score} · {x.kpi.grade}
                      </span>
                    </td>
                    <td data-label="Davomat" className="num">
                      <span className="stack">
                        <span>
                          {x.days} / {x.expectedDays} kun
                        </span>
                        <small>{x.absentDays ? `${x.absentDays} kun kelmagan` : duration(x.workedMinutes)}</small>
                      </span>
                    </td>
                    <td data-label="Kechikish" className="num">
                      {x.lateMinutes ? (
                        <span className="stack">
                          <span className="late-text">{x.lateMinutes} daq</span>
                          <small>{x.lateDays} marta</small>
                        </span>
                      ) : (
                        <span className="faint">—</span>
                      )}
                    </td>
                    <td data-label="Oylik" className="num">
                      {x.base ? (
                        money(x.base, x.employee.currency)
                      ) : (
                        <button className="link" onClick={() => setSalaryOpen(true)}>
                          Kiritilmagan
                        </button>
                      )}
                      {x.overtimeAmount > 0 && (
                        <small className="muted" style={{ display: "block", color: "var(--green)" }}>
                          + {money(x.overtimeAmount, x.employee.currency)}
                        </small>
                      )}
                    </td>
                    <td data-label="Ushlanma" className="num" style={{ color: x.deduction ? "var(--red)" : undefined }}>
                      {x.deduction ? `− ${money(x.deduction, x.employee.currency)}` : "—"}
                    </td>
                    <td data-label="To‘lanadi" className="num">
                      <b>{money(x.net, x.employee.currency)}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {salaryOpen && (
        <SalaryModal
          employees={rows.map((x) => x.employee)}
          onClose={() => setSalaryOpen(false)}
          onSaved={() => {
            setSalaryOpen(false);
            void reload(true);
          }}
        />
      )}
      <p className="hint" style={{ marginTop: 12 }}>
        Kechikish daqiqalari grafikdagi imtiyozdan keyin hisoblanadi va oy davomida yig‘ilib, oylikdan bir marta ushlanadi.
        Ushlanma oylikdan oshmaydi. Yakuniy to‘lovdan oldin buxgalteriya bilan tekshiring.
      </p>
    </div>
  );
}

export function ReportsPage() {
  const today = tashkentIsoDate();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [branch, setBranch] = useState("");
  const { data: meta } = useApi<Meta>("/meta");
  const q = `from=${from}&to=${to}${branch ? `&branch=${branch}` : ""}`;
  const presets: [string, string, string][] = [
    ["Bugun", today, today],
    ["Shu oy", `${today.slice(0, 7)}-01`, today],
    ["O‘tgan oy", ...lastMonth(today)],
  ];
  const reports = [
    {
      name: "Davomat hisoboti",
      desc: "3 varaq: Xulosa (xodim bo‘yicha), Batafsil (har bir keldi-ketdi) va rangli Tabel (xodim × kun).",
      icon: Timer,
      xlsx: `/api/reports/attendance.xlsx?${q}`,
      csv: `/api/reports/attendance.csv?from=${from}&to=${to}`,
      tag: "Eng to‘liq",
    },
    {
      name: "Kechikishlar",
      desc: "Faqat kechikkan kunlar: kim, qachon, necha daqiqa.",
      icon: AlarmClock,
      xlsx: `/api/reports/attendance.xlsx?${q}&type=late`,
      csv: `/api/reports/attendance.csv?from=${from}&to=${to}&type=late`,
    },
    {
      name: "Ish haqi vedomosti",
      desc: `${monthYearUz(`${from.slice(0, 7)}-15`)} uchun: ish kuni, soat, qo‘shimcha ish, ushlanma, imzo ustuni.`,
      icon: FileSpreadsheet,
      xlsx: `/api/reports/payroll.xlsx?month=${from.slice(0, 7)}`,
      csv: `/api/reports/payroll.csv?month=${from.slice(0, 7)}`,
    },
    {
      name: "Xodimlar ro‘yxati",
      desc: "Filial, lavozim, grafik, oylik, Telegram va Face ID holati.",
      icon: Users,
      xlsx: "/api/reports/employees.xlsx",
      csv: "/api/reports/employees.csv",
    },
  ];
  return (
    <div className="page">
      <PageHeader title="Hisobotlar" subtitle="Chiroyli formatlangan Excel (.xlsx) fayllar" />
      <section className="card card-body" style={{ marginBottom: 16 }}>
        <div className="toolbar" style={{ marginBottom: 14 }}>
          {presets.map(([label, a, b]) => (
            <button
              key={label}
              className={`btn btn-sm ${from === a && to === b ? "btn-primary" : ""}`}
              onClick={() => {
                setFrom(a);
                setTo(b);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="form-grid cols-3">
          <Field label="Boshlanish">
            <input className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Tugash" hint="Ko‘pi bilan 92 kun">
            <input className="input" type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="Filial">
            <select className="select" value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">Barcha filiallar</option>
              {meta?.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </section>
      <div className="grid-cards">
        {reports.map((r) => (
          <article className="card report-card" key={r.name}>
            <div className="card-body">
              <div className="branch-top">
                <span className="xlsx-icon">
                  <r.icon size={20} />
                  <i>XLSX</i>
                </span>
                {r.tag && <span className="badge green plain">{r.tag}</span>}
              </div>
              <h3 style={{ fontSize: 15.5, fontWeight: 650 }}>{r.name}</h3>
              <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                {r.desc}
              </p>
            </div>
            <div className="card-foot">
              <a className="link" href={r.csv} download>
                CSV
              </a>
              <a className="btn btn-sm btn-primary" href={r.xlsx} download>
                <Download size={14} /> Excel yuklab olish
              </a>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function lastMonth(today: string): [string, string] {
  const [y, m] = today.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 2, 1));
  const last = new Date(Date.UTC(y, m - 1, 0));
  return [first.toISOString().slice(0, 10), last.toISOString().slice(0, 10)];
}

/* ------------------------------------------------ maoshlarni kiritish --- */

type SalaryRow = { id: string; name: string; no: string; positionId: string; branchId: string; salary: number };

const formatAmount = (value: string) => {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  return digits ? Number(digits).toLocaleString("ru-RU").replace(/\s/g, " ") : "";
};
const parseAmount = (value: string) => Number(value.replace(/\D/g, "")) || 0;

function SalaryModal({ employees, onClose, onSaved }: { employees: Employee[]; onClose: () => void; onSaved: () => void }) {
  const { data: meta } = useApi<Meta>("/meta");
  const toast = useToast();
  const [onlyEmpty, setOnlyEmpty] = useState(true);
  const [q, setQ] = useState("");
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(employees.map((e) => [e.id, e.baseSalary ? formatAmount(String(e.baseSalary)) : ""])),
  );
  const [bulkPosition, setBulkPosition] = useState("");
  const [bulkAmount, setBulkAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const positions = new Map((meta?.positions || []).map((p) => [p.id, p.name]));
  const branches = new Map((meta?.branches || []).map((b) => [b.id, b.name]));
  const rows: SalaryRow[] = employees
    .map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}`.trim(), no: e.employeeNo, positionId: e.positionId, branchId: e.branchId, salary: e.baseSalary }))
    .filter((r) => (!onlyEmpty || !r.salary) && `${r.name} ${r.no}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (positions.get(a.positionId) || "").localeCompare(positions.get(b.positionId) || "") || a.name.localeCompare(b.name));
  const changed = employees.filter((e) => parseAmount(values[e.id] || "") !== e.baseSalary && (values[e.id] || "") !== "");
  const usedPositions = [...new Set(employees.map((e) => e.positionId))].filter((id) => positions.has(id));
  return (
    <Modal title="Maoshlarni kiritish" subtitle="Oylik (so‘m) — bir martada bir nechta xodimga" onClose={onClose} size="wide">
      <div className="salary-bulk">
        <Field label="Lavozim bo‘yicha to‘ldirish">
          <select className="select" value={bulkPosition} onChange={(e) => setBulkPosition(e.target.value)}>
            <option value="">Lavozimni tanlang…</option>
            {usedPositions.map((id) => (
              <option key={id} value={id}>
                {positions.get(id)} ({employees.filter((e) => e.positionId === id).length})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Oylik">
          <input className="input" inputMode="numeric" placeholder="4 000 000" value={bulkAmount} onChange={(e) => setBulkAmount(formatAmount(e.target.value))} />
        </Field>
        <button
          type="button"
          className="btn"
          disabled={!bulkPosition || !bulkAmount}
          onClick={() => {
            setValues((v) => {
              const next = { ...v };
              for (const e of employees) if (e.positionId === bulkPosition && (!onlyEmpty || !e.baseSalary)) next[e.id] = bulkAmount;
              return next;
            });
            toast(`${positions.get(bulkPosition)} lavozimidagilarga qo‘yildi — saqlashni unutmang`);
          }}
        >
          Qo‘llash
        </button>
      </div>
      <div className="ic-toolbar" style={{ margin: "4px 0 10px" }}>
        <input className="input" style={{ maxWidth: 260 }} placeholder="Qidirish…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="checkbox-row">
          <input type="checkbox" checked={onlyEmpty} onChange={(e) => setOnlyEmpty(e.target.checked)} />
          Faqat maoshi kiritilmaganlar
        </label>
      </div>
      <div className="salary-list">
        {rows.map((r) => (
          <label key={r.id} className={`salary-row ${values[r.id] ? "" : "empty"}`}>
            <span>
              <b>{r.name}</b>
              <small>
                {r.no} · {positions.get(r.positionId) || "—"}
                {branches.get(r.branchId) ? ` · ${branches.get(r.branchId)}` : ""}
              </small>
            </span>
            <span className="salary-input">
              <input
                className="input"
                inputMode="numeric"
                placeholder="0"
                value={values[r.id] || ""}
                onChange={(e) => setValues((v) => ({ ...v, [r.id]: formatAmount(e.target.value) }))}
              />
              <em>so‘m</em>
            </span>
          </label>
        ))}
        {!rows.length && <p className="muted" style={{ padding: 16, textAlign: "center" }}>Hamma xodimning maoshi kiritilgan.</p>}
      </div>
      <ErrorBox message={error} />
      <div className="form-actions">
        <button className="btn" onClick={onClose}>
          Bekor qilish
        </button>
        <button
          className="btn btn-primary"
          disabled={busy || !changed.length}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const result = await put<{ updated: number }>("/employees/salaries", {
                items: changed.map((e) => ({ id: e.id, baseSalary: parseAmount(values[e.id]) })),
              });
              toast(`${result.updated} ta xodim maoshi saqlandi`);
              onSaved();
            } catch (reason) {
              setError(errorText(reason));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Wallet size={15} /> Saqlash ({changed.length})
        </button>
      </div>
    </Modal>
  );
}
