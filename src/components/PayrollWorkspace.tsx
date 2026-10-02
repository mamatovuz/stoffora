import { useState } from "react";
import { Check, Download, Lock, LockOpen, RotateCcw, TrendingDown, TrendingUp } from "lucide-react";
import { errorText, post } from "../api";
import { useApi } from "../hooks";
import { Empty, ErrorBox, Field, Loading, Modal, useToast } from "./ui";
import { money } from "@/lib/format";

/*
 * Ish haqi jarayoni: Hisoblanmoqda → HR tekshirdi → Moliya tekshirdi → Direktor tasdiqladi → To‘landi 🔒.
 * Har kim faqat o‘z bosqichidagi tugmani ko‘radi (server qaytaradi); tarix — kim/qachon.
 */

type Workflow = {
  stage: "CALCULATING" | "HR_CHECKED" | "FINANCE_CHECKED" | "APPROVED" | "PAID";
  label: string;
  stages: { key: string; label: string }[];
  history: { stage: string; by: string; at: string; note?: string }[];
  can: { hrCheck: boolean; financeCheck: boolean; approve: boolean; markPaid: boolean; reopen: boolean; back: boolean };
};
const when = (iso: string) => new Date(iso).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function PayrollWorkflowBar({ month, onChanged }: { month: string; onChanged?: () => void }) {
  const toast = useToast();
  const { data, reload } = useApi<Workflow>(`/payroll/${month}/workflow`);
  const [busy, setBusy] = useState(false);
  const [reopen, setReopen] = useState(false);
  const [note, setNote] = useState("");
  if (!data) return null;
  const index = data.stages.findIndex((s) => s.key === data.stage);
  async function act(action: string, text: string, extra?: string) {
    setBusy(true);
    try {
      await post(`/payroll/${month}/workflow`, { action, note: extra || undefined });
      toast(text);
      setReopen(false);
      setNote("");
      await reload(true);
      onChanged?.();
    } catch (reason) {
      toast(errorText(reason), "error");
    } finally {
      setBusy(false);
    }
  }
  const last = data.history[data.history.length - 1];
  return (
    <section className="card pw-bar">
      <ol className="pw-steps">
        {data.stages.map((s, i) => (
          <li key={s.key} className={i < index ? "done" : i === index ? "now" : ""}>
            <span>{i < index || data.stage === "PAID" ? "✓" : i + 1}</span>
            {s.label}
            {s.key === "PAID" && data.stage === "PAID" ? " 🔒" : ""}
          </li>
        ))}
      </ol>
      <div className="pw-actions">
        {last && (
          <small className="muted">
            Oxirgi: {last.by} · {when(last.at)}
            {last.note ? ` · «${last.note}»` : ""}
          </small>
        )}
        <span className="pw-buttons">
          {data.can.back && (
            <button className="btn btn-sm" disabled={busy} onClick={() => void act("back", "Qayta tekshirishga qaytarildi")}>
              <RotateCcw size={14} /> Qaytarish
            </button>
          )}
          {data.can.hrCheck && (
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void act("hr_check", "Timesheet tasdiqlandi — moliyaga o‘tdi")}>
              <Check size={14} /> Timesheet’ni tasdiqlash (HR)
            </button>
          )}
          {data.can.financeCheck && (
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void act("finance_check", "Moliya tekshirdi — direktor tasdig‘iga o‘tdi")}>
              <Check size={14} /> Hisobni tasdiqlash (Moliya)
            </button>
          )}
          {data.can.approve && (
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void act("approve", "Tasdiqlandi — oy muzlatildi, hisob varaqalari yuborildi")}>
              <Lock size={14} /> Tasdiqlash va yopish (Direktor)
            </button>
          )}
          {data.can.markPaid && (
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void act("mark_paid", "To‘landi deb belgilandi 🔒")}>
              <Check size={14} /> To‘landi
            </button>
          )}
          {data.can.reopen && (
            <button className="btn btn-sm" disabled={busy} onClick={() => setReopen(true)}>
              <LockOpen size={14} /> Qayta ochish
            </button>
          )}
        </span>
      </div>
      {reopen && (
        <Modal title="Oyni qayta ochish" subtitle="Muzlatilgan vedomost bekor qilinadi, jarayon boshidan boshlanadi. Auditga yoziladi." onClose={() => setReopen(false)} size="narrow">
          <Field label="Sabab (majburiy)">
            <textarea className="input" rows={3} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Masalan: Chilonzor filiali davomatida xato" />
          </Field>
          <div className="form-actions">
            <button className="btn" onClick={() => setReopen(false)}>
              Bekor qilish
            </button>
            <button className="btn btn-danger" disabled={busy || note.trim().length < 3} onClick={() => void act("reopen", "Oy qayta ochildi", note.trim())}>
              <LockOpen size={14} /> Qayta ochish
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

type Compare = { month: string; prev: string; total: number; prevTotal: number; rows: { employeeId: string; name: string; prevNet: number; net: number; change: number; reasons: { text: string; amount: number }[] }[] };

/** Oldingi oy bilan farq: kimning oyligi qancha va nima sababdan o‘zgardi. */
export function PayrollCompare({ month }: { month: string }) {
  const { data, loading, error } = useApi<Compare>(`/payroll/${month}/compare`);
  const [all, setAll] = useState(false);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error || "Ma’lumot yo‘q"} />;
  const changed = data.rows.filter((r) => r.change !== 0);
  const rows = all ? data.rows : changed.slice(0, 30);
  const diff = data.total - data.prevTotal;
  return (
    <section className="card">
      <div className="card-head">
        <h3 className="ws-h">
          {diff >= 0 ? <TrendingUp size={17} /> : <TrendingDown size={17} />} Oldingi oy ({data.prev}) bilan farq: {diff >= 0 ? "+" : "−"} {money(Math.abs(diff))}
        </h3>
        <label className="ws-toggle">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Hammasi ({data.rows.length})
        </label>
      </div>
      {!rows.length ? (
        <Empty icon={TrendingUp} title="O‘zgarish yo‘q" />
      ) : (
        <div className="table-wrap">
          <table className="table money-table">
            <thead>
              <tr>
                <th>Xodim</th>
                <th className="num">O‘tgan oy</th>
                <th className="num">Bu oy</th>
                <th className="num">Farq</th>
                <th>Sababi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employeeId}>
                  <td>
                    <b>{r.name}</b>
                  </td>
                  <td className="num">{money(r.prevNet)}</td>
                  <td className="num">{money(r.net)}</td>
                  <td className={`num ${r.change < 0 ? "minus" : "plus"}`}>
                    <b>
                      {r.change >= 0 ? "+" : "−"} {money(Math.abs(r.change))}
                    </b>
                  </td>
                  <td className="wrap">
                    {r.reasons.slice(0, 3).map((x) => (
                      <small key={x.text} className="pw-reason">
                        {x.text}: {x.amount >= 0 ? "+" : "−"}
                        {money(Math.abs(x.amount))}
                      </small>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function BankExportButton({ month }: { month: string }) {
  return (
    <a className="btn" href={`/api/payroll/${month}/bank.csv`} download title="F.I.Sh, karta raqami, summa — auditga yoziladi">
      <Download size={16} /> Bank fayli
    </a>
  );
}

type Sheet = { rows: { employeeId: string; name: string; employeeNo: string; branch: string; plannedMinutes: number; workedMinutes: number; lateMinutes: number; overtimeMinutes: number; days: number; leaveDays: number; absentDays: number; manualEdits: number }[] };
const hm = (m: number) => (m ? `${Math.floor(m / 60)}s ${m % 60}m` : "—");

/** Timesheet — oy yakuni (HR tekshiradi va tasdiqlaydi). */
export function TimesheetPage() {
  const [month, setMonth] = useState(new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 7));
  const { data, loading, error, reload } = useApi<Sheet>(`/payroll/${month}/timesheet`);
  const [q, setQ] = useState("");
  const rows = (data?.rows || []).filter((r) => `${r.name} ${r.employeeNo} ${r.branch}`.toLowerCase().includes(q.toLowerCase()));
  const sum = (k: keyof Sheet["rows"][number]) => rows.reduce((s, r) => s + Number(r[k] || 0), 0);
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Timesheet</h1>
          <p className="page-subtitle">Oy yakuni: reja, ishlangan vaqt, kechikish, overtime, ta’til va kelmagan kunlar. HR tekshirib tasdiqlaydi — keyin moliyaga o‘tadi.</p>
        </div>
        <div className="toolbar">
          <div className="date-nav">
            <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Oy" />
          </div>
          <a className="btn" href={`/api/reports/t13.xlsx?month=${month}`} download>
            <Download size={16} /> T-13 (Excel)
          </a>
        </div>
      </div>
      <PayrollWorkflowBar month={month} onChanged={() => void reload(true)} />
      <section className="card">
        <div className="filters">
          <input className="input" style={{ maxWidth: 320 }} placeholder="Xodim yoki filial…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <div className="card-body">
            <ErrorBox message={error} />
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table money-table">
              <thead>
                <tr>
                  <th>Xodim</th>
                  <th>Filial</th>
                  <th className="num">Reja</th>
                  <th className="num">Ishlangan</th>
                  <th className="num">Kechikish</th>
                  <th className="num">Overtime</th>
                  <th className="num">Ta’til</th>
                  <th className="num">Kelmagan</th>
                  <th className="num">Qo‘lda</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.employeeId}>
                    <td>
                      <b>{r.name}</b>
                      <small className="muted"> · {r.employeeNo}</small>
                    </td>
                    <td>{r.branch}</td>
                    <td className="num">{hm(r.plannedMinutes)}</td>
                    <td className="num">{hm(r.workedMinutes)}</td>
                    <td className={`num ${r.lateMinutes ? "minus" : ""}`}>{hm(r.lateMinutes)}</td>
                    <td className="num">{hm(r.overtimeMinutes)}</td>
                    <td className="num">{r.leaveDays || "—"}</td>
                    <td className={`num ${r.absentDays ? "minus" : ""}`}>{r.absentDays || "—"}</td>
                    <td className="num">{r.manualEdits || "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>Jami: {rows.length} xodim</td>
                  <td className="num">{hm(sum("plannedMinutes"))}</td>
                  <td className="num">{hm(sum("workedMinutes"))}</td>
                  <td className="num">{hm(sum("lateMinutes"))}</td>
                  <td className="num">{hm(sum("overtimeMinutes"))}</td>
                  <td className="num">{sum("leaveDays")}</td>
                  <td className="num">{sum("absentDays")}</td>
                  <td className="num">{sum("manualEdits")}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
