import { useState } from "react";
import { Banknote, Check, Copy, CreditCard, Eye, HandCoins, Send, X } from "lucide-react";
import { errorText, post } from "../api";
import { useApi } from "../hooks";
import { useAuth } from "../auth";
import { canAny } from "@/lib/permissions";
import { money, monthYearUz } from "@/lib/format";
import { Empty, Loading, useToast } from "./ui";

/*
 * Avans so‘rovlari (panel). Ikki bosqich:
 *   1) HR — xodimning so‘rovini ko‘radi, summani kamaytirishi yoki rad etishi mumkin → moliyaga;
 *   2) Moliya — yakuniy tasdiq (oylikdan ushlanadi), kartaga o‘tkazadi va «To‘landi» belgilaydi.
 * Karta raqami ro‘yxatda yashirin; to‘liq raqam faqat moliyaga, har ochilishi auditga yoziladi.
 */

export type AdvanceRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNo?: string;
  month: string;
  amount: number;
  reason?: string;
  status: "PENDING" | "HR_APPROVED" | "APPROVED" | "REJECTED" | "CANCELLED";
  hrDecidedBy?: string;
  hrNote?: string;
  decidedBy?: string;
  decidedNote?: string;
  payout?: { method: "CARD" | "CASH"; cardMask?: string; cardBrand?: string; holder?: string };
  paidAt?: string;
  paidBy?: string;
  createdAt: string;
  baseSalary: number;
  limit?: { max: number; taken: number; percent: number };
};

export const advanceStatus: Record<AdvanceRow["status"], [string, string]> = {
  PENDING: ["HR ko‘rmoqda", "amber"],
  HR_APPROVED: ["Moliyada", "blue"],
  APPROVED: ["Tasdiqlangan", "green"],
  REJECTED: ["Rad etilgan", "red"],
  CANCELLED: ["Bekor qilingan", "gray"],
};

const parseAmount = (value: string) => Number(value.replace(/\D/g, "")) || 0;
const formatAmount = (value: string) => {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  return digits ? Number(digits).toLocaleString("ru-RU") : "";
};
const when = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tashkent" });

export function AdvanceRequestsPanel({ mode, onChanged }: { mode: "hr" | "finance"; onChanged?: () => void }) {
  const toast = useToast();
  const { user } = useAuth();
  const { data, loading, reload } = useApi<AdvanceRow[]>("/payroll/advances");
  const { data: company } = useApi<{ payroll?: { advanceHrApproval?: boolean } }>("/company");
  const twoStep = company?.payroll?.advanceHrApproval !== false;
  const isHr = Boolean(user && canAny(user.role, ["leave.approve", "employees.edit"]));
  const isFinance = Boolean(user && canAny(user.role, ["payroll.edit"]));
  // Kim qaysi bosqichni ko‘radi: HR — PENDING; moliya — HR_APPROVED (bir bosqichli rejimda PENDING ham).
  const actionable = (r: AdvanceRow) =>
    mode === "hr" ? isHr && twoStep && r.status === "PENDING" : isFinance && (r.status === "HR_APPROVED" || (!twoStep && r.status === "PENDING"));
  const [filter, setFilter] = useState<"ACTION" | "ALL">("ACTION");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [cards, setCards] = useState<Record<string, { number: string; holder?: string; brand?: string }>>({});
  const rows = (data || []).filter((r) =>
    filter === "ALL" ? true : actionable(r) || (mode === "finance" && r.status === "APPROVED" && !r.paidAt),
  );
  const run = async (key: string, task: () => Promise<unknown>, message: string) => {
    setBusy(key);
    try {
      await task();
      toast(message);
      void reload(true);
      onChanged?.();
    } catch (reason) {
      toast(errorText(reason), "error");
    } finally {
      setBusy(null);
    }
  };
  const decide = (row: AdvanceRow, approve: boolean) =>
    run(
      row.id,
      () => post(`/payroll/advances/${row.id}/decide`, { approve, amount: parseAmount(amounts[row.id] || "") || undefined, note: notes[row.id]?.trim() || undefined }),
      approve ? (mode === "hr" && twoStep ? "Tasdiqlandi — moliya bo‘limiga yuborildi" : "Avans tasdiqlandi — ish haqidan ushlanadi") : "Avans rad etildi",
    );
  const reveal = async (row: AdvanceRow) => {
    setBusy(`card:${row.id}`);
    try {
      const card = await post<{ number: string; holder?: string; brand?: string }>(`/payroll/advances/${row.id}/card`);
      setCards((list) => ({ ...list, [row.id]: card }));
    } catch (reason) {
      toast(errorText(reason), "error");
    } finally {
      setBusy(null);
    }
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text.replace(/\s/g, ""));
      toast("Karta raqami nusxalandi");
    } catch {
      toast("Nusxalab bo‘lmadi — qo‘lda belgilang", "error");
    }
  };

  return (
    <>
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <button className={`btn btn-sm ${filter === "ACTION" ? "btn-primary" : ""}`} onClick={() => setFilter("ACTION")}>
          {mode === "hr" ? "HR tasdig‘i kutilmoqda" : "Moliya ishi"}
        </button>
        <button className={`btn btn-sm ${filter === "ALL" ? "btn-primary" : ""}`} onClick={() => setFilter("ALL")}>
          Hammasi
        </button>
        {twoStep && (
          <span className="muted" style={{ fontSize: 12.5 }}>
            Tartib: xodim → HR → moliya → to‘lov
          </span>
        )}
      </div>
      {loading && !data ? (
        <Loading />
      ) : !rows.length ? (
        <Empty
          icon={HandCoins}
          title={filter === "ACTION" ? "Hozircha ish yo‘q" : "Avans so‘rovlari yo‘q"}
          text={mode === "hr" ? "Xodim Mini App’dan avans so‘raganda avval shu yerga tushadi." : "HR tasdiqlagan avanslar shu yerda ko‘rinadi."}
        />
      ) : (
        <div className="adv-list">
          {rows.map((r) => {
            const [label, tone] = advanceStatus[r.status];
            const card = cards[r.id];
            const canAct = actionable(r);
            return (
              <article key={r.id} className={`adv-card ${canAct ? "is-pending" : ""}`}>
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
                {r.payout && (
                  <div className={`adv-payout ${r.payout.method === "CARD" ? "card" : "cash"}`}>
                    {r.payout.method === "CARD" ? <CreditCard size={16} /> : <Banknote size={16} />}
                    {r.payout.method === "CARD" ? (
                      <span>
                        <b className="num">{card ? card.number : r.payout.cardMask}</b>
                        <small>
                          {r.payout.cardBrand} · {r.payout.holder}
                        </small>
                      </span>
                    ) : (
                      <span>
                        <b>Naqd</b>
                        <small>Kassadan beriladi</small>
                      </span>
                    )}
                    {r.payout.method === "CARD" && isFinance && mode === "finance" && ["HR_APPROVED", "APPROVED", "PENDING"].includes(r.status) && (
                      <span className="toolbar">
                        {card ? (
                          <button className="btn btn-sm" onClick={() => void copy(card.number)}>
                            <Copy size={14} /> Nusxa
                          </button>
                        ) : (
                          <button className="btn btn-sm" disabled={busy === `card:${r.id}`} onClick={() => void reveal(r)} title="Ko‘rish auditga yoziladi">
                            <Eye size={14} /> Raqamni ko‘rish
                          </button>
                        )}
                      </span>
                    )}
                  </div>
                )}
                {r.limit && (
                  <div className="adv-meta">
                    <span>Oylik: {money(r.baseSalary)}</span>
                    <span>
                      Chegara ({r.limit.percent}%): {money(r.limit.max)}
                    </span>
                    <span>Shu oy berilgan: {money(r.limit.taken)}</span>
                  </div>
                )}
                {(r.hrDecidedBy || r.paidAt) && (
                  <div className="adv-steps">
                    {r.hrDecidedBy && (
                      <span className={r.status === "REJECTED" && !r.decidedBy?.length ? "bad" : "ok"}>
                        ✓ HR: {r.hrDecidedBy}
                        {r.hrNote ? ` — «${r.hrNote}»` : ""}
                      </span>
                    )}
                    {r.status === "APPROVED" && r.decidedBy && <span className="ok">✓ Moliya: {r.decidedBy}</span>}
                    {r.paidAt && (
                      <span className="ok">
                        💸 To‘landi: {when(r.paidAt)} · {r.paidBy}
                      </span>
                    )}
                  </div>
                )}
                <footer>
                  <span className={`badge ${tone}`}>{r.status === "APPROVED" && !r.paidAt ? "Tasdiqlangan · to‘lanmagan" : r.paidAt ? "To‘langan" : label}</span>
                  {r.status === "REJECTED" && r.decidedBy && <small className="muted">{r.decidedBy}</small>}
                  {canAct && (
                    <span className="toolbar adv-actions">
                      <input
                        className="input input-sm"
                        inputMode="numeric"
                        placeholder={`Summa (≤ ${r.amount.toLocaleString("ru-RU")})`}
                        value={amounts[r.id] || ""}
                        onChange={(e) => setAmounts({ ...amounts, [r.id]: formatAmount(e.target.value) })}
                        aria-label="Tasdiqlanadigan summa"
                      />
                      <input className="input input-sm" placeholder="Izoh (ixtiyoriy)" value={notes[r.id] || ""} maxLength={200} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} aria-label="Izoh" />
                      <button className="btn btn-sm btn-primary" disabled={busy === r.id} onClick={() => void decide(r, true)}>
                        {mode === "hr" && twoStep ? <Send size={14} /> : <Check size={14} />} {mode === "hr" && twoStep ? "Moliyaga yuborish" : "Tasdiqlash"}
                      </button>
                      <button className="btn btn-sm btn-danger" disabled={busy === r.id} onClick={() => void decide(r, false)} aria-label="Rad etish">
                        <X size={14} />
                      </button>
                    </span>
                  )}
                  {mode === "finance" && isFinance && r.status === "APPROVED" && !r.paidAt && (
                    <span className="toolbar adv-actions">
                      <button className="btn btn-sm btn-primary" disabled={busy === `paid:${r.id}`} onClick={() => void run(`paid:${r.id}`, () => post(`/payroll/advances/${r.id}/paid`), "To‘landi deb belgilandi — xodimga xabar ketdi")}>
                        <Banknote size={14} /> {r.payout?.method === "CARD" ? "O‘tkazildi" : "Berildi"}
                      </button>
                    </span>
                  )}
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
