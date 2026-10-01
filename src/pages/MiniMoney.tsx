import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Banknote, ChevronRight, CreditCard, Eye, EyeOff, HandCoins, LoaderCircle, Trash2, Wallet } from "lucide-react";
import { cardBrand, cardDigits, cardError, CARD_BRAND_LABELS, formatCard, holderError } from "@/lib/card";
import { api, del, errorText, post } from "../api";
import { Sheet } from "./mini/shared";
import { confirmNative, haptic } from "./mini/tg";
import { dateUz } from "@/lib/format";

/*
 * «Mening oyligim» — oy davomida real vaqtda: ishlab topilgan, ushlanmalar,
 * qo‘lga tegadigan taxminiy summa. Shu yerdan avans so‘raladi.
 * Summa sukut bo‘yicha yashirin (yonidagi odam ko‘rmasin) — ko‘z belgisi bilan ochiladi.
 */

type AdvanceRequest = {
  id: string;
  amount: number;
  reason?: string;
  status: "PENDING" | "HR_APPROVED" | "APPROVED" | "REJECTED" | "CANCELLED";
  hrDecidedBy?: string;
  decidedNote?: string;
  createdAt: string;
  payout?: { method: "CARD" | "CASH"; cardMask?: string; cardBrand?: string; holder?: string };
  paidAt?: string;
};
type SavedCard = { mask: string; brand: string; holder: string };
export type Salary = {
  month: string;
  label: string;
  closed: boolean;
  base: number;
  workingDays: number;
  days: number;
  expectedDays: number;
  absentDays: number;
  lateMinutes: number;
  overtimeAmount: number;
  pendingOvertimeMinutes: number;
  bonus: number;
  lateDeduction: number;
  absenceDeduction: number;
  fine: number;
  advance: number;
  net: number;
  earnedToDate: number;
  limit: { enabled: boolean; percent: number; max: number; taken: number; pending: number; available: number; closed: boolean };
  requests: AdvanceRequest[];
  savedCard?: SavedCard | null;
};
type Toast = (text: string, tone?: "ok" | "error") => void;

const som = (value: number) => `${Math.round(value).toLocaleString("ru-RU").replace(/\s/g, " ")} so‘m`;
const HIDE_KEY = "staffora:mini:salary-visible";
const readVisible = () => {
  try {
    return localStorage.getItem(HIDE_KEY) === "1";
  } catch {
    return false;
  }
};

let cached: { at: number; data: Salary } | null = null;
export function useSalary(enabled = true) {
  const [data, setData] = useState<Salary | null>(() => cached?.data || null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const next = await api<Salary>("/mini/salary");
      cached = { at: Date.now(), data: next };
      setData(next);
      setError("");
    } catch (reason) {
      setError(errorText(reason));
    }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    // 30 soniya ichida qayta ochilsa — so‘rov yubormaymiz.
    if (cached && Date.now() - cached.at < 30_000) return;
    void load();
  }, [enabled, load]);
  return { data, error, reload: load };
}

export function SalaryCard({ onOpen, offline }: { onOpen: () => void; offline?: boolean }) {
  const { data } = useSalary(!offline);
  const [visible, setVisible] = useState(readVisible);
  if (!data || !data.base) return null;
  const toggle = (event: React.MouseEvent) => {
    event.stopPropagation();
    const next = !visible;
    setVisible(next);
    try {
      localStorage.setItem(HIDE_KEY, next ? "1" : "0");
    } catch {
      /* muhim emas */
    }
  };
  const progress = data.base ? Math.min(100, Math.round((data.earnedToDate / data.base) * 100)) : 0;
  const deductions = data.lateDeduction + data.absenceDeduction + data.fine;
  return (
    <button className="ms-card" onClick={onOpen}>
      <div className="ms-top">
        <span className="ms-ico">
          <Wallet size={18} />
        </span>
        <span className="ms-title">
          <small>{data.closed ? `${data.label} — yopilgan` : `${data.label} · taxminan qo‘lga`}</small>
          <b className={visible ? "" : "ms-hidden"}>{visible ? som(data.net) : "••• ••• so‘m"}</b>
        </span>
        <span className="ms-eye" role="button" tabIndex={0} onClick={toggle} aria-label={visible ? "Yashirish" : "Ko‘rsatish"}>
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </span>
      </div>
      <div className="ms-bar" aria-hidden>
        <i style={{ width: `${progress}%` }} />
      </div>
      <div className="ms-foot">
        <span>
          {data.days}/{data.workingDays} kun
        </span>
        {deductions > 0 && <span className="warn">−{visible ? som(deductions) : "•••"} ushlanma</span>}
        {data.limit.enabled && data.limit.available > 0 && <span className="ok">Avans mumkin</span>}
        <ChevronRight size={16} />
      </div>
    </button>
  );
}

const statusChip: Record<AdvanceRequest["status"], [string, string]> = {
  PENDING: ["HR ko‘rmoqda", "warn"],
  HR_APPROVED: ["Moliyada", "info"],
  APPROVED: ["Tasdiqlandi", "ok"],
  REJECTED: ["Rad etildi", "bad"],
  CANCELLED: ["Bekor qilindi", ""],
};

export function SalarySheet({ onClose, onToast }: { onClose: () => void; onToast: Toast }) {
  const { data, error, reload } = useSalary();
  const [asking, setAsking] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  // To‘lov usuli: kartaga (saqlangan yoki yangi) yoki naqd.
  const [method, setMethod] = useState<"CARD" | "CASH">("CARD");
  const [useSaved, setUseSaved] = useState(true);
  const [card, setCard] = useState("");
  const [holder, setHolder] = useState("");
  const [remember, setRemember] = useState(true);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    void reload();
  }, [reload]);
  const digits = Number(amount.replace(/\D/g, "")) || 0;
  const saved = data?.savedCard || null;
  const newCard = method === "CARD" && !(saved && useSaved);
  const cardProblem = newCard ? cardError(card) : null;
  const holderProblem = newCard ? holderError(holder) : null;
  const brand = cardDigits(card).length >= 4 ? CARD_BRAND_LABELS[cardBrand(card)] : "";
  const amountOk = Boolean(data && digits >= 10_000 && digits <= data.limit.available);
  const formOk = amountOk && !cardProblem && !holderProblem;
  async function submit(event?: React.FormEvent) {
    event?.preventDefault();
    setTouched(true);
    if (!data || !amountOk) return setFormError(`Summa 10 000 dan ${data ? som(data.limit.available) : "—"} gacha bo‘lsin.`);
    if (cardProblem || holderProblem) return setFormError(cardProblem || holderProblem || "");
    setBusy(true);
    setFormError("");
    try {
      await post("/mini/advances", {
        amount: digits,
        reason: reason.trim() || undefined,
        payout: method === "CASH" ? { method } : newCard ? { method, cardNumber: cardDigits(card), holder: holder.trim(), remember } : { method, useSaved: true },
      });
      setCard("");
      setHolder("");
      setTouched(false);
      onToast("Avans so‘rovi yuborildi — javob Telegram’ga keladi");
      haptic.success();
      setAsking(false);
      setAmount("");
      setReason("");
      await reload();
    } catch (reason) {
      setFormError(errorText(reason, "So‘rov yuborilmadi."));
    } finally {
      setBusy(false);
    }
  }
  async function cancel(id: string) {
    if (!(await confirmNative("Avans so‘rovini bekor qilasizmi?", { ok: "Bekor qilish", destructive: true }))) return;
    try {
      await post(`/mini/advances/${id}/cancel`, {});
      onToast("So‘rov bekor qilindi");
      await reload();
    } catch (reason) {
      onToast(errorText(reason), "error");
    }
  }
  async function forgetCard() {
    if (!(await confirmNative("Saqlangan karta o‘chirilsinmi?", { ok: "O‘chirish", destructive: true }))) return;
    await del("/mini/payout-card").catch(() => undefined);
    setUseSaved(false);
    await reload();
  }
  const pending = data?.requests.some((r) => r.status === "PENDING" || r.status === "HR_APPROVED");
  const canAsk = Boolean(data?.limit.enabled && !pending && data.limit.available >= 10_000);
  return (
    <Sheet
      title="Mening oyligim"
      subtitle={data ? (data.closed ? `${data.label} — oy yopilgan` : `${data.label} · bugungi holat`) : "Yuklanmoqda…"}
      onClose={onClose}
      className="ms-sheet"
      primary={
        asking
          ? { text: digits ? `So‘rash · ${som(digits)}` : "Summani kiriting", onClick: () => void submit(), busy, disabled: !formOk }
          : canAsk
            ? { text: "Avans so‘rash", onClick: () => setAsking(true) }
            : null
      }
      secondary={asking ? { text: "Bekor qilish", onClick: () => setAsking(false) } : null}
    >
        {!data ? (
          error ? (
            <div className="mini-alert">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          ) : (
            <div className="mini-loader">
              <LoaderCircle className="spin" />
            </div>
          )
        ) : (
          <>
            <div className="ms-hero">
              <small>Taxminan qo‘lga</small>
              <b>{som(data.net)}</b>
              <span>
                Oylik {som(data.base)} · {data.days}/{data.workingDays} ish kuni
              </span>
            </div>
            <div className="ms-lines">
              <Line label="Hozirgacha ishlab topilgan" value={som(data.earnedToDate)} />
              {data.overtimeAmount > 0 && <Line label="Qo‘shimcha ish" value={`+${som(data.overtimeAmount)}`} tone="ok" />}
              {data.pendingOvertimeMinutes > 0 && <Line label="Tasdiq kutayotgan qo‘shimcha ish" value={`${Math.round(data.pendingOvertimeMinutes / 60)} soat`} />}
              {data.bonus > 0 && <Line label="Bonus" value={`+${som(data.bonus)}`} tone="ok" />}
              {data.lateDeduction > 0 && <Line label={`Kechikish (${data.lateMinutes} daq)`} value={`−${som(data.lateDeduction)}`} tone="bad" />}
              {data.absenceDeduction > 0 && <Line label={`Kelmagan ${data.absentDays} kun`} value={`−${som(data.absenceDeduction)}`} tone="bad" />}
              {data.fine > 0 && <Line label="Jarima" value={`−${som(data.fine)}`} tone="bad" />}
              {data.advance > 0 && <Line label="Olingan avans" value={`−${som(data.advance)}`} />}
            </div>
            <p className="ms-note">Oy oxirigacha davomatga qarab o‘zgaradi. Yakuniy summa oy yopilgach hisob varaqasida keladi.</p>

            {data.limit.enabled && !asking && !canAsk && (
              <div className="mh-hint info">
                <HandCoins size={16} />
                <span>{pending ? "Avans so‘rovingiz ko‘rib chiqilmoqda" : "Bu oy avans chegarasi tugagan"}</span>
              </div>
            )}
            {asking && (
              <form className="ms-form" onSubmit={submit}>
                <label>
                  Summa (ko‘pi bilan {som(data.limit.available)})
                  <input
                    inputMode="numeric"
                    autoFocus
                    value={amount}
                    onChange={(e) => {
                      const value = e.target.value.replace(/\D/g, "").slice(0, 10);
                      setAmount(value ? Number(value).toLocaleString("ru-RU").replace(/\s/g, " ") : "");
                    }}
                    placeholder="Masalan: 500 000"
                    required
                  />
                </label>
                <div className="ms-chips">
                  {[0.25, 0.5, 1].map((part) => {
                    const value = Math.floor((data.limit.available * part) / 10_000) * 10_000;
                    return value >= 10_000 ? (
                      <button type="button" key={part} onClick={() => setAmount(value.toLocaleString("ru-RU").replace(/\s/g, " "))}>
                        {part === 1 ? "Hammasi" : `${part * 100}%`} · {value.toLocaleString("ru-RU").replace(/\s/g, " ")}
                      </button>
                    ) : null;
                  })}
                </div>
                <label>
                  Sabab (ixtiyoriy)
                  <input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Masalan: oilaviy sabab" />
                </label>
                <div className="ms-payout">
                  <span className="ms-payout-title">Pulni qanday olasiz?</span>
                  <div className="mini-seg" role="radiogroup">
                    <button type="button" role="radio" aria-checked={method === "CARD"} className={method === "CARD" ? "on" : ""} onClick={() => setMethod("CARD")}>
                      <CreditCard size={15} /> Kartaga
                    </button>
                    <button type="button" role="radio" aria-checked={method === "CASH"} className={method === "CASH" ? "on" : ""} onClick={() => setMethod("CASH")}>
                      <Banknote size={15} /> Naqd
                    </button>
                  </div>
                  {method === "CARD" && saved && useSaved && (
                    <div className="ms-card-saved">
                      <span className="ms-card-chip">{saved.brand}</span>
                      <span>
                        <b>{saved.mask}</b>
                        <small>{saved.holder}</small>
                      </span>
                      <button type="button" className="mini-link" onClick={() => setUseSaved(false)}>
                        Boshqa karta
                      </button>
                      <button type="button" className="ms-card-del" aria-label="Kartani o‘chirish" onClick={() => void forgetCard()}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  )}
                  {newCard && (
                    <>
                      <label className={touched && cardProblem && cardDigits(card).length ? "invalid" : ""}>
                        Karta raqami{brand ? ` · ${brand}` : ""}
                        <input
                          inputMode="numeric"
                          autoComplete="cc-number"
                          value={formatCard(card)}
                          maxLength={19}
                          onChange={(e) => setCard(cardDigits(e.target.value).slice(0, 16))}
                          onBlur={() => setTouched(true)}
                          placeholder="8600 0000 0000 0000"
                        />
                        {cardDigits(card).length === 16 && !cardProblem && <small className="ok">✓ Karta raqami to‘g‘ri</small>}
                        {touched && cardProblem && cardDigits(card).length > 0 && <small className="bad">{cardProblem}</small>}
                      </label>
                      <label className={touched && holderProblem && holder ? "invalid" : ""}>
                        Qabul qiluvchi (karta egasi)
                        <input
                          autoComplete="cc-name"
                          value={holder}
                          maxLength={60}
                          onChange={(e) => setHolder(e.target.value)}
                          onBlur={() => setTouched(true)}
                          placeholder="Ism Familiya"
                        />
                        {touched && holderProblem && holder && <small className="bad">{holderProblem}</small>}
                      </label>
                      <label className="sw-toggle">
                        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                        <span>Keyingi safar uchun kartani eslab qolish</span>
                      </label>
                      {saved && (
                        <button type="button" className="mini-link" onClick={() => setUseSaved(true)}>
                          ← Saqlangan karta ({saved.mask})
                        </button>
                      )}
                      <small className="ms-secure">🔒 Karta raqami shifrlangan holda saqlanadi va faqat moliya bo‘limi o‘tkazma uchun ko‘radi.</small>
                    </>
                  )}
                  {method === "CASH" && <small className="ms-secure">Tasdiqlangach, kassadan olasiz — tayyor bo‘lganda xabar keladi.</small>}
                </div>
                {formError && (
                  <div className="mini-alert">
                    <AlertCircle size={18} />
                    <span>{formError}</span>
                  </div>
                )}
              </form>
            )}
            {data.requests.length > 0 && (
              <>
                <div className="mp-group-title">Avans so‘rovlarim</div>
                <section className="mini-card">
                  <div className="mini-rows">
                    {data.requests.map((r) => {
                      const [label, tone] = statusChip[r.status];
                      return (
                        <div className="mini-row" key={r.id}>
                          <span className="mini-ico">
                            <HandCoins size={18} />
                          </span>
                          <span>
                            <b>{som(r.amount)}</b>
                            <small>
                              {dateUz(r.createdAt.slice(0, 10))}
                              {r.payout?.method === "CARD" ? ` · 💳 ${r.payout.cardMask?.slice(-4) ? `•••• ${r.payout.cardMask.slice(-4)}` : "karta"}` : r.payout?.method === "CASH" ? " · 💵 naqd" : ""}
                              {r.decidedNote ? ` · ${r.decidedNote}` : r.reason ? ` · ${r.reason}` : ""}
                            </small>
                            {r.paidAt && <small className="ok">✓ {r.payout?.method === "CASH" ? "Kassada tayyor" : "O‘tkazildi"} · {dateUz(r.paidAt.slice(0, 10))}</small>}
                            {r.status === "PENDING" && (
                              <button className="mini-link-danger" onClick={() => void cancel(r.id)}>
                                Bekor qilish
                              </button>
                            )}
                          </span>
                          <span className={`mini-chip ${tone}`}>{label}</span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </>
            )}
          </>
        )}
    </Sheet>
  );
}

function Line({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="ps-line">
      <span>{label}</span>
      <b className={tone}>{value}</b>
    </div>
  );
}
