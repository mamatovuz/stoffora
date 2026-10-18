import { useEffect, useState } from "react";
import { Banknote, Check, Copy, CreditCard, Download, Eye, HandCoins, Megaphone, Send, X } from "lucide-react";
import { errorText, post } from "../api";
import { useApi } from "../hooks";
import { useAuth } from "../auth";
import { canAny } from "@/lib/permissions";
import { dateUz, money, monthYearUz } from "@/lib/format";
import { Empty, ErrorBox, Field, Loading, Modal, useToast } from "./ui";

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
  const [announcing, setAnnouncing] = useState(false);
  // Excel ro‘yxati qaysi oy uchun (standart — joriy oy, Toshkent vaqti).
  const [exportMonth, setExportMonth] = useState(() => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 7));
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
        <span className="adv-export" style={{ marginLeft: "auto" }}>
          <input type="month" className="input" value={exportMonth} onChange={(e) => e.target.value && setExportMonth(e.target.value)} aria-label="Ro‘yxat oyi" />
          <a
            className="btn btn-sm"
            href={`/api/payroll/advances.xlsx?month=${exportMonth}`}
            download
            title={isFinance ? "Kartaga o‘tkazish (to‘liq karta raqamlari bilan), naqd qaydnoma va barcha so‘rovlar" : "Karta raqamlari yashirilgan — to‘liq raqam moliya bo‘limida"}
          >
            <Download size={14} /> Excel ro‘yxat
          </a>
          <button className="btn btn-sm" onClick={() => setAnnouncing(true)}>
            <Megaphone size={14} /> Xodimlarga xabar
          </button>
        </span>
      </div>
      {announcing && <AdvanceAnnounceModal onClose={() => setAnnouncing(false)} />}
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

type AnnouncePreview = {
  month: string;
  label: string;
  title: string;
  message: string;
  recipients: number;
  withTelegram: number;
  requested: number;
  window: { always: boolean; open: boolean; text: string; opensOn?: string; closesOn?: string };
  auto: boolean;
  blocker?: string;
  last: { at: string; by?: string; recipients: number; auto: boolean } | null;
};

/**
 * «Avans oluvchilar ro‘yxati» xabari: xodimga ilovada e’lon, Telegram’da «💰 Avans so‘rash» tugmasi va
 * telefonga push bo‘lib boradi — bosilsa avans formasi ochiladi. Faqat shu oy hali so‘ramaganlarga.
 */
function AdvanceAnnounceModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const { data, loading, error } = useApi<AnnouncePreview>("/payroll/advances/announce");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!data) return;
    setTitle((value) => value || data.title);
    setMessage((value) => value || data.message);
  }, [data]);
  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await post<{ recipients: number; telegram: number }>("/payroll/advances/announce", { title: title.trim(), message: message.trim() });
      toast(`Xabar ${result.recipients} xodimga yuborildi (Telegram: ${result.telegram})`);
      onClose();
    } catch (reason) {
      toast(errorText(reason), "error");
    } finally {
      setBusy(false);
    }
  };
  const when = (iso: string) => `${dateUz(iso)}, ${new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tashkent" })}`;
  return (
    <Modal title="Avans oluvchilar ro‘yxati" subtitle="Xodimlarga e’lon, Telegram xabari va push — bosilsa avans formasi ochiladi" onClose={onClose}>
      {error ? (
        <ErrorBox message={error} />
      ) : loading && !data ? (
        <Loading />
      ) : data ? (
        <form className="adv-announce" onSubmit={send}>
          <div className="adv-announce-kpis">
            <div>
              <b>{data.recipients}</b>
              <small>xodimga boradi</small>
            </div>
            <div>
              <b>{data.withTelegram}</b>
              <small>Telegram ulangan</small>
            </div>
            <div>
              <b>{data.requested}</b>
              <small>allaqachon so‘ragan</small>
            </div>
          </div>
          {data.blocker ? (
            <div className="alert warn">{data.blocker}</div>
          ) : (
            <p className="hint">
              {data.window.always
                ? "Avans so‘rovlari oy davomida qabul qilinadi."
                : data.window.open
                  ? `Avans oynasi ochiq (${data.window.text}${data.window.closesOn ? `, ${dateUz(data.window.closesOn)} gacha` : ""}).`
                  : `Avans oynasi hozir yopiq — ${data.window.text}${data.window.opensOn ? `, keyingisi ${dateUz(data.window.opensOn)}` : ""}. Xodim xabarni ko‘radi, so‘rovni esa oyna ochilganda yuboradi.`}
              {!data.window.always && data.auto ? " Oyna ochilgan kuni soat 09:00 da xabar avtomatik ham yuboriladi." : ""}
            </p>
          )}
          {data.last && (
            <p className="hint">
              Bu oy {data.last.auto ? "avtomatik" : data.last.by ? `${data.last.by} tomonidan` : ""} yuborilgan: {when(data.last.at)} · {data.last.recipients} xodim. Qayta yuborilsa — faqat hali so‘ramaganlarga boradi.
            </p>
          )}
          <Field label="Sarlavha">
            <input className="input" value={title} maxLength={120} minLength={3} required onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Xabar matni" hint="Har bir xodimga oxirida o‘z avans chegarasi qo‘shiladi.">
            <textarea className="textarea" rows={5} value={message} maxLength={1500} minLength={10} required onChange={(e) => setMessage(e.target.value)} />
          </Field>
          <div className="adv-announce-preview" aria-label="Telefonda ko‘rinishi">
            <small>Telefonda shunday ko‘rinadi</small>
            <b>📢 {title || "…"}</b>
            <p>{message}</p>
            <span>💰 Avans so‘rash</span>
          </div>
          <div className="form-actions">
            <button type="button" className="btn" onClick={onClose}>
              Bekor qilish
            </button>
            <button className="btn btn-primary" disabled={busy || Boolean(data.blocker) || !data.recipients}>
              <Send size={15} /> {data.recipients ? `${data.recipients} xodimga yuborish` : "Yuboriladigan xodim yo‘q"}
            </button>
          </div>
        </form>
      ) : null}
    </Modal>
  );
}
