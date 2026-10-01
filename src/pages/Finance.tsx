import { useState } from "react";
import { Link } from "react-router-dom";
import {
  AlarmClock,
  CalendarRange,
  Check,
  Database,
  HandCoins,
  X,
  AlertTriangle,
  Banknote,
  Download,
  FileSpreadsheet,
  Lock,
  LockOpen,
  PlusCircle,
  Search,
  Send,
  Settings2,
  Trash2,
  Timer,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { useApi } from "../hooks";
import { useAuth } from "../auth";
import { can } from "@/lib/permissions";
import { del, errorText, post, put } from "../api";
import {
  Confirm,
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

type Adjustment = { id: string; employeeId: string; month: string; type: "ADVANCE" | "BONUS" | "FINE"; amount: number; note?: string; createdBy: string; createdAt: string };
type PayrollRow = {
  employee: Employee;
  days: number;
  expectedDays: number;
  absentDays: number;
  lateDays: number;
  lateMinutes: number;
  workedMinutes: number;
  overtimeMinutes: number;
  pendingOvertimeMinutes: number;
  base: number;
  overtimeAmount: number;
  deduction: number;
  absenceDeduction: number;
  bonus: number;
  fine: number;
  advance: number;
  gross: number;
  net: number;
  explanation: string;
  adjustments: Adjustment[];
  kpi: { attendance: number; punctuality: number; score: number; grade: string };
};
type Payroll = {
  month: string;
  rule: string;
  settings: { overtimeRequiresApproval?: boolean; absencePenalty?: string };
  rows: PayrollRow[];
  closed: null | {
    closedAt: string;
    closedBy: string;
    total: number;
    payslipsSentAt?: string;
    lines: {
      employeeId: string;
      employeeNo: string;
      name: string;
      position?: string;
      base: number;
      days: number;
      expectedDays: number;
      absentDays: number;
      lateMinutes: number;
      overtimeAmount: number;
      bonus: number;
      lateDeduction: number;
      absenceDeduction: number;
      fine: number;
      advance: number;
      net: number;
      explanation: string;
    }[];
  };
};

const adjLabels = { ADVANCE: "Avans", BONUS: "Bonus", FINE: "Jarima" } as const;
const when = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function PayrollPage() {
  const toast = useToast();
  const [month, setMonth] = useState(tashkentIsoDate().slice(0, 7));
  const { data, loading, error, reload } = useApi<Payroll>(`/payroll?month=${month}`);
  const [salaryOpen, setSalaryOpen] = useState(false);
  const [adjustFor, setAdjustFor] = useState<PayrollRow | null>(null);
  const [overtimeOpen, setOvertimeOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [q, setQ] = useState("");
  const [advancesOpen, setAdvancesOpen] = useState(false);
  const { user } = useAuth();
  const canEditPayroll = Boolean(user && can(user.role, "payroll.edit"));
  const advanceRequests = useApi<AdvanceRow[]>(canEditPayroll ? "/payroll/advances?status=PENDING" : null);
  const pendingAdvances = advanceRequests.data?.length || 0;
  const rows = data?.rows || [];
  const closed = data?.closed;
  const noSalary = rows.filter((x) => !x.employee.baseSalary).length;
  const pendingOvertime = rows.reduce((s, x) => s + (x.pendingOvertimeMinutes || 0), 0);
  // Yopilgan oyda — muzlatilgan qatorlar.
  const lines = closed
    ? closed.lines.map((l) => ({ id: l.employeeId, sub:`${l.employeeNo}${l.position ? ` · ${l.position}` : ""}`, ...l, deductions: l.lateDeduction + l.absenceDeduction + l.fine, plus: l.overtimeAmount + l.bonus, row: undefined as PayrollRow | undefined }))
    : rows.map((r) => ({
        id: r.employee.id,
        name: `${r.employee.firstName} ${r.employee.lastName}`,
        sub: r.employee.employeeNo,
        base: r.base,
        days: r.days,
        expectedDays: r.expectedDays,
        absentDays: r.absentDays,
        lateMinutes: r.lateMinutes,
        advance: r.advance,
        net: r.net,
        explanation: r.explanation,
        deductions: r.deduction + r.absenceDeduction + r.fine,
        plus: r.overtimeAmount + r.bonus,
        row: r,
      }));
  const visible = lines.filter((l) => `${l.name} ${l.sub}`.toLowerCase().includes(q.toLowerCase()));
  const total = lines.reduce((s, x) => s + x.net, 0);
  const deductions = lines.reduce((s, x) => s + x.deductions, 0);
  const advances = lines.reduce((s, x) => s + x.advance, 0);
  const plus = lines.reduce((s, x) => s + x.plus, 0);
  const avgKpi = rows.length ? Math.round(rows.reduce((s, x) => s + x.kpi.score, 0) / rows.length) : 0;
  return (
    <div className="page">
      <PageHeader
        title="Ish haqi va KPI"
        subtitle={`${monthYearUz(`${month}-15`)} · ${data?.rule || "davomat asosida hisob-kitob"}`}
        actions={
          <>
            <div className="date-nav">
              <input type="month" value={month} max={tashkentIsoDate().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Oy" />
            </div>
            {data?.settings.overtimeRequiresApproval && (
              <button className="btn" onClick={() => setOvertimeOpen(true)}>
                <Timer size={16} /> Qo‘shimcha ish{pendingOvertime ? <span className="btn-count">{Math.round(pendingOvertime / 60)}s</span> : null}
              </button>
            )}
            {canEditPayroll && (
              <button className="btn" onClick={() => setAdvancesOpen(true)}>
                <HandCoins size={16} /> Avans so‘rovlari{pendingAdvances ? <span className="btn-count">{pendingAdvances}</span> : null}
              </button>
            )}
            <button className="btn" onClick={() => setSalaryOpen(true)} disabled={!rows.length || Boolean(closed)}>
              <Wallet size={16} /> Maoshlar
            </button>
            <Link className="btn" to="/settings?tab=payroll">
              <Settings2 size={16} /> Sozlama
            </Link>
            <a className="btn" href={`/api/reports/payroll.xlsx?month=${month}`} download>
              <Download size={16} /> Excel
            </a>
            {closed ? (
              <button className="btn" onClick={() => setReopenOpen(true)}>
                <LockOpen size={16} /> Qayta ochish
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => setCloseOpen(true)} disabled={!rows.length}>
                <Lock size={16} /> Oyni yopish
              </button>
            )}
          </>
        }
      />
      {closed && (
        <div className="alert success" style={{ marginBottom: 16 }}>
          <Lock size={18} />
          <div style={{ flex: 1 }}>
            <b>
              {monthYearUz(`${month}-15`)} yopilgan — raqamlar muzlatilgan
            </b>
            <p>
              {closed.closedBy} · {when(closed.closedAt)}
              {closed.payslipsSentAt ? ` · hisob varaqalari xodimlarga yuborilgan (${when(closed.payslipsSentAt)})` : ""}
            </p>
          </div>
          <button
            className="btn btn-sm"
            onClick={async () => {
              try {
                const r = await post<{ sent: number }>(`/payroll/${month}/payslips`, {});
                toast(`${r.sent} ta xodimga hisob varaqasi yuborildi`);
                void reload(true);
              } catch (reason) {
                toast(errorText(reason), "error");
              }
            }}
          >
            <Send size={14} /> Varaqalarni qayta yuborish
          </button>
        </div>
      )}
      <div className="stat-grid">
        <StatCard label="Qo‘lga beriladi" value={money(total)} note={`${lines.length} xodim`} icon={Wallet} tone="green" />
        <StatCard label="Ushlanmalar" value={money(deductions)} note="kechikish · kelmaslik · jarima" icon={AlarmClock} tone="amber" />
        <StatCard label="Avans berilgan" value={money(advances)} note={`Qo‘shimcha: ${money(plus)}`} icon={Banknote} tone="blue" />
        <StatCard label="O‘rtacha KPI" value={`${avgKpi}`} note="Davomat 60% + vaqtida 40%" icon={TrendingUp} tone="violet" />
      </div>
      {pendingAdvances > 0 && (
        <div className="alert info" style={{ marginBottom: 16 }}>
          <HandCoins size={18} />
          <div style={{ flex: 1 }}>
            <b>{pendingAdvances} ta avans so‘rovi kutmoqda</b>
            <p>Xodimlar Mini App orqali yuborgan. Tasdiqlangan summa shu oy ish haqidan avtomatik ushlanadi.</p>
          </div>
          <button className="btn btn-sm btn-primary" onClick={() => setAdvancesOpen(true)}>
            Ko‘rib chiqish
          </button>
        </div>
      )}
      {!closed && noSalary > 0 && (
        <div className="alert warn" style={{ marginBottom: 16 }}>
          <AlertTriangle size={18} />
          <div style={{ flex: 1 }}>
            <b>{noSalary} ta xodimning oyligi kiritilmagan (0 so‘m)</b>
            <p>Oyliklarni lavozim bo‘yicha yoki alohida kiriting.</p>
          </div>
          <button className="btn btn-sm btn-primary" onClick={() => setSalaryOpen(true)}>
            Kiritish
          </button>
        </div>
      )}
      <section className="card">
        <div className="filters">
          <span className="input-icon">
            <Search size={16} />
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Xodim qidirish…" />
          </span>
        </div>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <div className="card-body">
            <ErrorBox message={error} />
          </div>
        ) : !visible.length ? (
          <Empty icon={Users} title="Hisob-kitob uchun xodim yo‘q" />
        ) : (
          <div className="table-wrap">
            <table className="table table-cards pay-table">
              <thead>
                <tr>
                  <th>Xodim</th>
                  <th>Davomat</th>
                  <th className="num">Oylik</th>
                  <th className="num">Qo‘shimcha</th>
                  <th className="num">Ushlanma</th>
                  <th className="num">Avans</th>
                  <th className="num">Qo‘lga</th>
                  {!closed && <th />}
                </tr>
              </thead>
              <tbody>
                {visible.map((x) => (
                  <tr key={x.id}>
                    <td>
                      {x.row ? (
                        <Person first={x.row.employee.firstName} last={x.row.employee.lastName} photo={x.row.employee.photoDataUrl} sub={x.sub} />
                      ) : (
                        <span className="stack">
                          <b>{x.name}</b>
                          <small>{x.sub}</small>
                        </span>
                      )}
                      <span className="pay-note">{x.explanation}</span>
                    </td>
                    <td data-label="Davomat">
                      <span className="stack">
                        <span>
                          {x.days} / {x.expectedDays} kun
                          {x.row && (
                            <span className={`kpi-pill ${x.row.kpi.grade}`} style={{ marginLeft: 6 }} title={`Davomat ${x.row.kpi.attendance}% · Vaqtida ${x.row.kpi.punctuality}%`}>
                              {x.row.kpi.score}
                            </span>
                          )}
                        </span>
                        <small>
                          {x.absentDays ? <span className="late-text">{x.absentDays} kun kelmagan</span> : "kelmagan kun yo‘q"}
                          {x.lateMinutes ? ` · ${x.lateMinutes} daq kech` : ""}
                        </small>
                      </span>
                    </td>
                    <td data-label="Oylik" className="num">
                      {x.base ? money(x.base) : (
                        <button className="link" onClick={() => setSalaryOpen(true)} disabled={Boolean(closed)}>
                          Kiritilmagan
                        </button>
                      )}
                    </td>
                    <td data-label="Qo‘shimcha" className="num plus">
                      {x.plus ? `+ ${money(x.plus)}` : "—"}
                    </td>
                    <td data-label="Ushlanma" className="num minus">
                      {x.deductions ? `− ${money(x.deductions)}` : "—"}
                    </td>
                    <td data-label="Avans" className="num">
                      {x.advance ? `− ${money(x.advance)}` : "—"}
                    </td>
                    <td data-label="Qo‘lga" className="num">
                      <b>{money(x.net)}</b>
                    </td>
                    {!closed && (
                      <td className="actions">
                        <button className="btn btn-sm" onClick={() => x.row && setAdjustFor(x.row)} title="Avans, bonus yoki jarima">
                          <PlusCircle size={14} /> ±
                        </button>
                      </td>
                    )}
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
      {adjustFor && <AdjustModal row={adjustFor} month={month} onClose={() => setAdjustFor(null)} onChanged={() => void reload(true)} />}
      {overtimeOpen && <OvertimeModal month={month} onClose={() => { setOvertimeOpen(false); void reload(true); }} />}
      {advancesOpen && (
        <AdvanceRequestsModal
          onClose={() => setAdvancesOpen(false)}
          onChanged={() => {
            void reload(true);
            void advanceRequests.reload(true);
          }}
        />
      )}
      {closeOpen && (
        <CloseMonthModal
          month={month}
          total={total}
          count={lines.length}
          pendingOvertime={pendingOvertime}
          noSalary={noSalary}
          onClose={() => setCloseOpen(false)}
          onDone={(sent) => {
            setCloseOpen(false);
            toast(`Oy yopildi${sent ? ` · ${sent} ta xodimga hisob varaqasi yuborildi` : ""}`);
            void reload(true);
          }}
        />
      )}
      {reopenOpen && (
        <Confirm
          title="Oy qayta ochilsinmi?"
          text="Muzlatilgan raqamlar o‘chadi va hisob jonli davomatdan qayta hisoblanadi. Xodimlarga yuborilgan varaqalar qaytmaydi."
          confirmLabel="Qayta ochish"
          onConfirm={async () => {
            await post(`/payroll/${month}/reopen`, {});
            toast("Oy qayta ochildi");
            void reload(true);
          }}
          onClose={() => setReopenOpen(false)}
        />
      )}
      <p className="hint" style={{ marginTop: 12 }}>
        Qo‘lga = oylik + qo‘shimcha ish + bonus − kechikish − kelmaslik − jarima − avans. Oy yopilgach raqamlar muzlatiladi va xodimlarga hisob varaqasi
        yuboriladi.
      </p>
    </div>
  );
}

function AdjustModal({ row, month, onClose, onChanged }: { row: PayrollRow; month: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [type, setType] = useState<Adjustment["type"]>("ADVANCE");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [items, setItems] = useState(row.adjustments || []);
  return (
    <Modal title="Avans, bonus, jarima" subtitle={`${row.employee.firstName} ${row.employee.lastName} · ${monthYearUz(`${month}-15`)}`} onClose={onClose} size="narrow">
      <div className="adj-types">
        {(Object.keys(adjLabels) as Adjustment["type"][]).map((key) => (
          <button key={key} className={`adj-type ${key.toLowerCase()} ${type === key ? "on" : ""}`} onClick={() => setType(key)}>
            {key === "BONUS" ? "+" : "−"} {adjLabels[key]}
          </button>
        ))}
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const created = await post<Adjustment>("/payroll/adjustments", { employeeId: row.employee.id, month, type, amount: parseAmount(amount), note: note || undefined });
            setItems((list) => [...list, created]);
            setAmount("");
            setNote("");
            toast(`${adjLabels[type]} qo‘shildi`);
            onChanged();
          } catch (reason) {
            setError(errorText(reason));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Summa (so‘m)">
          <input className="input" inputMode="numeric" value={amount} onChange={(e) => setAmount(formatAmount(e.target.value))} placeholder="500 000" required />
        </Field>
        <Field label="Izoh">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={type === "ADVANCE" ? "Masalan: 15-sentabr naqd" : type === "BONUS" ? "Masalan: reja bajarildi" : "Masalan: kassa kamomadi"} maxLength={200} />
        </Field>
        <ErrorBox message={error} />
        <div className="form-actions">
          <button className="btn btn-primary" disabled={busy || !parseAmount(amount)}>
            <PlusCircle size={15} /> Qo‘shish
          </button>
        </div>
      </form>
      {items.length > 0 && (
        <div className="adj-list">
          {items.map((a) => (
            <div key={a.id}>
              <span className={`badge ${a.type === "BONUS" ? "green" : a.type === "FINE" ? "red" : "blue"}`}>{adjLabels[a.type]}</span>
              <b>{money(a.amount)}</b>
              <small>{a.note || "—"}</small>
              <button
                className="icon-btn"
                aria-label="O‘chirish"
                onClick={async () => {
                  try {
                    await del(`/payroll/adjustments/${a.id}`);
                    setItems((list) => list.filter((x) => x.id !== a.id));
                    onChanged();
                  } catch (reason) {
                    toast(errorText(reason), "error");
                  }
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

type OvertimeRow = { id: string; date: string; name: string; employeeNo: string; checkIn?: string; checkOut?: string; scheduledEnd: string; overtimeMinutes: number; approved?: boolean; decidedBy?: string };

function OvertimeModal({ month, onClose }: { month: string; onClose: () => void }) {
  const toast = useToast();
  const { data, loading, reload } = useApi<{ rows: OvertimeRow[]; closed: boolean }>(`/overtime?month=${month}`);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const rows = (data?.rows || []).filter((r) => filter === "all" || r.approved === undefined);
  const decide = async (row: OvertimeRow, approved: boolean) => {
    try {
      await post(`/attendance/${row.id}/overtime`, { approved });
      void reload(true);
    } catch (reason) {
      toast(errorText(reason), "error");
    }
  };
  return (
    <Modal title="Qo‘shimcha ishni tasdiqlash" subtitle="Faqat tasdiqlangan qo‘shimcha ish oylikka qo‘shiladi" onClose={onClose} size="wide">
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <button className={`btn btn-sm ${filter === "pending" ? "btn-primary" : ""}`} onClick={() => setFilter("pending")}>
          Kutilmoqda
        </button>
        <button className={`btn btn-sm ${filter === "all" ? "btn-primary" : ""}`} onClick={() => setFilter("all")}>
          Hammasi
        </button>
      </div>
      {loading && !data ? (
        <Loading />
      ) : !rows.length ? (
        <Empty icon={Timer} title="Tasdiq kutayotgan qo‘shimcha ish yo‘q" />
      ) : (
        <div className="ot-list">
          {rows.map((r) => (
            <div key={r.id} className="ot-row">
              <div>
                <b>{r.name}</b>
                <small>
                  {r.date.split("-").reverse().join(".")} · {r.checkIn} – {r.checkOut || "…"} (grafik {r.scheduledEnd} gacha)
                </small>
              </div>
              <span className="ot-min">+{Math.floor(r.overtimeMinutes / 60)} soat {r.overtimeMinutes % 60} daq</span>
              {r.approved === undefined || filter === "all" ? (
                <div className="ot-actions">
                  <button className={`btn btn-sm ${r.approved === false ? "btn-danger-solid" : ""}`} disabled={data?.closed} onClick={() => void decide(r, false)}>
                    Rad
                  </button>
                  <button className={`btn btn-sm ${r.approved ? "btn-primary" : ""}`} disabled={data?.closed} onClick={() => void decide(r, true)}>
                    Tasdiqlash
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function CloseMonthModal({
  month,
  total,
  count,
  pendingOvertime,
  noSalary,
  onClose,
  onDone,
}: {
  month: string;
  total: number;
  count: number;
  pendingOvertime: number;
  noSalary: number;
  onClose: () => void;
  onDone: (sent: number) => void;
}) {
  const [send, setSend] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title={`${monthYearUz(`${month}-15`)} — oyni yopish`} subtitle="Yopilgach raqamlar o‘zgarmaydi" onClose={onClose} size="narrow">
      <div className="close-summary">
        <div>
          <small>Xodimlar</small>
          <b>{count}</b>
        </div>
        <div>
          <small>Jami qo‘lga</small>
          <b>{money(total)}</b>
        </div>
      </div>
      {(pendingOvertime > 0 || noSalary > 0) && (
        <div className="alert warn" style={{ margin: "12px 0" }}>
          <AlertTriangle size={18} />
          <div>
            {pendingOvertime > 0 && <p>Tasdiq kutayotgan qo‘shimcha ish bor ({Math.round(pendingOvertime / 60)} soat) — u oylikka qo‘shilmaydi.</p>}
            {noSalary > 0 && <p>{noSalary} ta xodimning oyligi kiritilmagan.</p>}
          </div>
        </div>
      )}
      <label className="checkbox-row" style={{ margin: "12px 0" }}>
        <input type="checkbox" checked={send} onChange={(e) => setSend(e.target.checked)} />
        Har bir xodimga hisob varaqasini yuborish (bot va Staffora)
      </label>
      <ErrorBox message={error} />
      <div className="form-actions">
        <button className="btn" onClick={onClose} disabled={busy}>
          Bekor qilish
        </button>
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const r = await post<{ sent: number }>(`/payroll/${month}/close`, { sendPayslips: send });
              onDone(r.sent);
            } catch (reason) {
              setError(errorText(reason));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Lock size={15} /> {busy ? "Yopilmoqda…" : "Oyni yopish"}
        </button>
      </div>
    </Modal>
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
  const month = from.slice(0, 7);
  const reports: {
    name: string;
    desc: string;
    icon: typeof Timer;
    xlsx: string;
    csv: string;
    tag?: string;
    kind?: string;
    xlsxLabel?: string;
    csvLabel?: string;
  }[] = [
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
      name: "T-13 tabel (buxgalteriya)",
      desc: `${monthYearUz(`${month}-15`)}: standart T-13 shakli — har kun belgisi (Я, В, ОТ, Б, НН) va soati, yarim oy va oy jamlari, imzo joylari. Chop etishga tayyor.`,
      icon: CalendarRange,
      xlsx: `/api/reports/t13.xlsx?month=${month}`,
      csv: `/api/reports/1c-timesheet.csv?month=${month}`,
      csvLabel: "1C uchun CSV",
      tag: "Yangi",
    },
    {
      name: "1C ga yuklash — ish haqi",
      desc: `${monthYearUz(`${month}-15`)}: tabel raqami, oklad, ishlagan kun/soat, qo‘shimcha, bonus, ushlanmalar, avans va qo‘lga. «;» ajratilgan UTF-8 fayl — 1C’dagi «Загрузка из табличного документа» orqali yuklanadi.`,
      icon: Database,
      kind: "1C",
      xlsx: `/api/reports/1c-payroll.csv?month=${month}`,
      csv: `/api/reports/payroll.xlsx?month=${month}`,
      xlsxLabel: "1C fayli (CSV)",
      csvLabel: "Excel",
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
                <span className={`xlsx-icon ${r.kind === "1C" ? "is-1c" : ""}`}>
                  <r.icon size={20} />
                  <i>{r.kind || "XLSX"}</i>
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
                {r.csvLabel || "CSV"}
              </a>
              <a className="btn btn-sm btn-primary" href={r.xlsx} download>
                <Download size={14} /> {r.xlsxLabel || "Excel yuklab olish"}
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

/* ------------------------------------------------- avans so‘rovlari --- */
type AdvanceRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNo?: string;
  month: string;
  amount: number;
  reason?: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  decidedBy?: string;
  decidedNote?: string;
  createdAt: string;
  baseSalary: number;
  limit?: { max: number; taken: number; percent: number };
};
const advanceStatus: Record<AdvanceRow["status"], [string, string]> = {
  PENDING: ["Kutilmoqda", "amber"],
  APPROVED: ["Tasdiqlangan", "green"],
  REJECTED: ["Rad etilgan", "red"],
  CANCELLED: ["Bekor qilingan", "gray"],
};

function AdvanceRequestsModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { data, loading, reload } = useApi<AdvanceRow[]>("/payroll/advances");
  const [filter, setFilter] = useState<"PENDING" | "ALL">("PENDING");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const rows = (data || []).filter((r) => filter === "ALL" || r.status === "PENDING");
  const decide = async (row: AdvanceRow, approve: boolean) => {
    setBusy(row.id);
    try {
      const amount = parseAmount(amounts[row.id] || "") || undefined;
      await post(`/payroll/advances/${row.id}/decide`, { approve, amount });
      toast(approve ? "Avans tasdiqlandi — ish haqidan ushlanadi" : "Avans rad etildi");
      void reload(true);
      onChanged();
    } catch (reason) {
      toast(errorText(reason), "error");
    } finally {
      setBusy(null);
    }
  };
  return (
    <Modal title="Avans so‘rovlari" subtitle="Xodimlar Mini App orqali so‘raydi; tasdiqlangan summa oylikdan avtomatik ushlanadi" onClose={onClose} size="wide">
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <button className={`btn btn-sm ${filter === "PENDING" ? "btn-primary" : ""}`} onClick={() => setFilter("PENDING")}>
          Kutilmoqda
        </button>
        <button className={`btn btn-sm ${filter === "ALL" ? "btn-primary" : ""}`} onClick={() => setFilter("ALL")}>
          Hammasi
        </button>
      </div>
      {loading && !data ? (
        <Loading />
      ) : !rows.length ? (
        <Empty icon={HandCoins} title="Avans so‘rovlari yo‘q" text="Xodim Mini App’dagi «Oyligim» bo‘limidan avans so‘raganda shu yerda ko‘rinadi." />
      ) : (
        <div className="adv-list">
          {rows.map((r) => {
            const [label, tone] = advanceStatus[r.status];
            return (
              <article key={r.id} className={`adv-card ${r.status === "PENDING" ? "is-pending" : ""}`}>
                <div className="adv-main">
                  <div>
                    <b>{r.employeeName}</b>
                    <small>
                      {r.employeeNo} · {monthYearUz(`${r.month}-15`)} · {when(r.createdAt)}
                    </small>
                  </div>
                  <strong className="num">{money(r.amount)}</strong>
                </div>
                {r.reason && <p className="adv-reason">«{r.reason}»</p>}
                {r.limit && (
                  <div className="adv-meta">
                    <span>Oylik: {money(r.baseSalary)}</span>
                    <span>Chegara ({r.limit.percent}%): {money(r.limit.max)}</span>
                    <span>Shu oy berilgan: {money(r.limit.taken)}</span>
                  </div>
                )}
                <footer>
                  <span className={`badge ${tone}`}>{label}</span>
                  {r.decidedBy && <small className="muted">{r.decidedBy}</small>}
                  {r.status === "PENDING" && (
                    <span className="toolbar adv-actions">
                      <input
                        className="input input-sm"
                        inputMode="numeric"
                        placeholder={`Summa (≤ ${r.amount.toLocaleString("ru-RU")})`}
                        value={amounts[r.id] || ""}
                        onChange={(e) => setAmounts({ ...amounts, [r.id]: formatAmount(e.target.value) })}
                        aria-label="Tasdiqlanadigan summa"
                      />
                      <button className="btn btn-sm btn-primary" disabled={busy === r.id} onClick={() => void decide(r, true)}>
                        <Check size={14} /> Tasdiqlash
                      </button>
                      <button className="btn btn-sm btn-danger" disabled={busy === r.id} onClick={() => void decide(r, false)} aria-label="Rad etish">
                        <X size={14} />
                      </button>
                    </span>
                  )}
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
