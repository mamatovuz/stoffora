import { useEffect, useState } from "react";
import { AlertCircle, Download, Gavel, HandCoins, Search } from "lucide-react";
import { PhotoAvatar, Sheet, SkeletonList } from "./shared";
import { haptic } from "./tg";

/*
 * Mini App rahbar rejimi — moliya vositalari:
 *   • Jarima yozish (HR / direktor / moliya — darhol; filial rahbari — taklif, HR tasdiqlaydi).
 *   • «Moliya» ko‘rinishi: shu oy avans oluvchilar va jarimalar.
 * Panel API’lari (/fines, /advances/recipients) — huquq va filial chegarasi serverda.
 */

type Call = <T>(url: string, body?: unknown, method?: string) => Promise<T>;
type Toast = (text: string, tone?: "ok" | "error") => void;
type Person = { id: string; firstName: string; lastName: string; employeeNo?: string; photoDataUrl?: string; branchName?: string; baseSalary?: number };
const som = (value: number) => `${Math.round(value).toLocaleString("ru-RU").replace(/\s/g, " ")} so‘m`;
const parse = (value: string) => Number(value.replace(/[^\d]/g, "")) || 0;

export function FineSheet({ call, direct, onClose, onDone, onError }: { call: Call; direct: boolean; onClose: () => void; onDone: (text: string) => void; onError: Toast }) {
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<Person[] | null>(null);
  const [picked, setPicked] = useState<Person | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (picked) return;
    const timer = window.setTimeout(() => {
      call<Person[]>(`/fines/employees?limit=20&q=${encodeURIComponent(q)}`)
        .then(setPeople)
        .catch((e) => onError(e instanceof Error ? e.message : "Xatolik", "error"));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [q, picked, call, onError]);
  const value = parse(amount);
  const valid = Boolean(picked && value >= 1000 && reason.trim().length >= 3);
  async function save() {
    if (!picked) return;
    setBusy(true);
    setError("");
    try {
      const row = await call<{ status: string }>("/fines", { employeeId: picked.id, amount: value, reason: reason.trim() });
      haptic.success();
      onDone(row.status === "APPROVED" ? `${picked.firstName}: ${som(value)} jarima qo‘llandi — xabar yuborildi` : "Taklif HR’ga yuborildi");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Saqlanmadi");
      haptic.error();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      title={direct ? "Jarima yozish" : "Jarima taklif qilish"}
      subtitle={direct ? "Darhol qo‘llanadi, shu oy oylikdan ushlanadi" : "HR yoki direktor tasdiqlagach qo‘llanadi"}
      onClose={onClose}
      primary={{ text: direct ? `Qo‘llash${value ? ` · ${som(value)}` : ""}` : "Taklif yuborish", onClick: () => void save(), busy, disabled: !valid }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {picked ? (
          <div className="mf-picked">
            <PhotoAvatar employee={picked} />
            <span>
              <b>
                {picked.firstName} {picked.lastName}
              </b>
              <small>
                {picked.branchName}
                {picked.baseSalary ? ` · oylik ${som(picked.baseSalary)}` : ""}
              </small>
            </span>
            <button type="button" className="mini-link" onClick={() => setPicked(null)}>
              O‘zgartirish
            </button>
          </div>
        ) : (
          <>
            <label className="md-search">
              <Search size={16} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Xodimni qidirish" autoFocus />
            </label>
            <div className="mf-list">
              {people === null ? (
                <SkeletonList rows={3} />
              ) : !people.length ? (
                <div className="mini-empty">Topilmadi</div>
              ) : (
                people.map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => {
                      haptic.select();
                      setPicked(p);
                    }}
                  >
                    <PhotoAvatar employee={p} />
                    <span>
                      <b>
                        {p.firstName} {p.lastName}
                      </b>
                      <small>{p.branchName}</small>
                    </span>
                  </button>
                ))
              )}
            </div>
          </>
        )}
        <label>
          Summa (so‘m)
          <input inputMode="numeric" value={value ? value.toLocaleString("ru-RU") : ""} onChange={(e) => setAmount(e.target.value)} placeholder="300 000" />
        </label>
        <div className="mf-quick">
          {[50_000, 100_000, 200_000, 300_000, 500_000].map((n) => (
            <button type="button" key={n} className={value === n ? "on" : ""} onClick={() => setAmount(String(n))}>
              {n / 1000}k
            </button>
          ))}
        </div>
        <label>
          Sabab
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Masalan: kassa kamomadi" />
        </label>
        {error && (
          <div className="mini-alert">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}
      </form>
    </Sheet>
  );
}

type AdvanceRow = { id: string; employeeName: string; branchName: string; baseSalary: number; amount: number; status: string; method?: string; cardMask?: string; paidAt?: string };
type FineRow = { id: string; employeeName: string; branchName: string; amount: number; reason: string; status: string; createdBy: string; proposedBy?: string; createdAt: string };

/** «Moliya» ko‘rinishi: shu oy avans oluvchilar va jarimalar (Excel havolasi bilan). */
export function MoneyView({ call, canAdvances, canFines, onError }: { call: Call; canAdvances: boolean; canFines: boolean; onError: Toast }) {
  const [advances, setAdvances] = useState<AdvanceRow[] | null>(canAdvances ? null : []);
  const [fines, setFines] = useState<FineRow[] | null>(canFines ? null : []);
  const month = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 7);
  useEffect(() => {
    const fail = (e: unknown) => onError(e instanceof Error ? e.message : "Xatolik", "error");
    if (canAdvances) call<{ rows: AdvanceRow[] }>(`/advances/recipients?month=${month}`).then((r) => setAdvances(r.rows)).catch(fail);
    if (canFines) call<FineRow[]>(`/fines?month=${month}`).then((r) => setFines(r.filter((f) => f.status === "APPROVED"))).catch(fail);
  }, [call, canAdvances, canFines, month, onError]);
  const advTotal = (advances || []).reduce((s, r) => s + r.amount, 0);
  const fineTotal = (fines || []).reduce((s, r) => s + r.amount, 0);
  return (
    <>
      <section className="mf-stats">
        {canAdvances && (
          <div>
            <small>Avans · {advances?.length ?? "…"} kishi</small>
            <b>{som(advTotal)}</b>
          </div>
        )}
        {canFines && (
          <div className="bad">
            <small>Jarimalar · {fines?.length ?? "…"} ta</small>
            <b>{som(fineTotal)}</b>
          </div>
        )}
      </section>
      {canAdvances && (
        <>
          <div className="mp-group-title">
            <HandCoins size={15} /> Avans oluvchilar — shu oy
          </div>
          <section className="mini-card">
            {advances === null ? (
              <SkeletonList rows={3} />
            ) : !advances.length ? (
              <div className="mini-empty">Bu oy avans so‘raganlar yo‘q</div>
            ) : (
              <div className="mini-rows">
                {advances.map((r, i) => (
                  <div className="mini-row" key={r.id}>
                    <span className="mf-n">{i + 1}</span>
                    <span>
                      <b>{r.employeeName}</b>
                      <small>
                        {r.branchName} · oylik {som(r.baseSalary)}
                      </small>
                      <small>{r.method === "CASH" ? "Naqd" : r.cardMask || "Karta yo‘q"}</small>
                    </span>
                    <span className="mf-amount">
                      <b>{som(r.amount)}</b>
                      <small className={r.paidAt ? "ok" : r.status === "APPROVED" ? "" : "warn"}>{r.paidAt ? "To‘landi" : r.status === "APPROVED" ? "Tasdiqlangan" : "Kutilmoqda"}</small>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
          <div className="mh-hint info">
            <Download size={16} />
            <span>Excel (karta raqamlari bilan) — saytda: Moliya → Avans oluvchilar.</span>
          </div>
        </>
      )}
      {canFines && (
        <>
          <div className="mp-group-title">
            <Gavel size={15} /> Jarimalar — shu oy
          </div>
          <section className="mini-card">
            {fines === null ? (
              <SkeletonList rows={3} />
            ) : !fines.length ? (
              <div className="mini-empty">Bu oy jarima yo‘q</div>
            ) : (
              <div className="mini-rows">
                {fines.map((r) => (
                  <div className="mini-row" key={r.id}>
                    <span className="mini-ico bad">
                      <Gavel size={16} />
                    </span>
                    <span>
                      <b>{r.employeeName}</b>
                      <small>
                        {r.branchName} · {r.reason}
                      </small>
                      <small>{r.proposedBy ? `${r.proposedBy} (taklif)` : r.createdBy}</small>
                    </span>
                    <span className="mf-amount">
                      <b className="bad">−{som(r.amount)}</b>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
