import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { RosterRow } from "../MiniManager";

/*
 * Rahbar paneli — «Umumiy»: bugungi davomat (bosiladigan raqamlar), hozirgina kim keldi/ketdi,
 * filiallar bo‘yicha davomat va oy pullari (huquqi borlarga). Tasdiq kutayotgan ishlar —
 * «So‘rovlar» tabida (badge bilan), bu yerda takrorlanmaydi.
 */

type Call = <T>(url: string, body?: unknown, method?: string) => Promise<T>;
type Money = { net: number; advance: number; bonus: number; fine: number; overtime?: number };
type Overview = {
  today: { planned: number; came: number; late: number; absent: number; notYet: number };
  money: Money | null;
  branches: { id: string; name: string; planned: number; came: number; rate: number }[];
};
type Shift = { id: string; name: string; tomorrow: { date: string; planned: number; onLeave: number; required?: number; shortage: number } };
const som = (v: number) => `${Math.round(v).toLocaleString("ru-RU").replace(/\s/g, " ")} so‘m`;
const MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];

export function MiniDesk({
  call,
  role,
  canAttendance,
  canMoney,
  rows,
  onOpen,
  onBranch,
  onEmployee,
}: {
  call: Call;
  role: string;
  canAttendance: boolean;
  canMoney: boolean;
  /** Bugungi davomat ro‘yxati (rahbar panelining o‘zi yuklaydi); null — hali yuklanmoqda. */
  rows: RosterRow[] | null;
  onOpen: (view: string) => void;
  onBranch: (name: string) => void;
  onEmployee: (id: string) => void;
}) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [finance, setFinance] = useState<Money | null>(null);
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const month = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 7);
  useEffect(() => {
    if (canAttendance) void call<Overview>("/workspace/overview").then(setOverview).catch(() => undefined);
    // Moliya xodimi davomatni ko‘rmaydi — oy xulosasi moliya API’sidan.
    else if (canMoney) void call<Money>(`/finance/summary?month=${month}`).then(setFinance).catch(() => undefined);
    if (role === "BRANCH_MANAGER") void call<Shift[]>("/workspace/branch-shift").then(setShifts).catch(() => undefined);
  }, [call, role, canAttendance, canMoney, month]);

  const today = overview?.today;
  const money = overview?.money || finance;
  const branches = overview?.branches || [];
  const tomorrow = (shifts || []).filter((s) => s.tomorrow.planned || s.tomorrow.required);

  return (
    <>
      {canAttendance && (
        <>
          <div className="mp-group-title">Bugun</div>
          <div className="desk-tiles" role="group" aria-label="Bugungi davomat" aria-busy={!today}>
            {(
              [
                ["ALL", today?.planned, "rejada", ""],
                ["IN", today?.came, "keldi", "ok"],
                ["LATE", today?.late, "kechikdi", "warn"],
                ["ABSENT", today?.absent, "kelmadi", "bad"],
              ] as const
            ).map(([filter, value, label, tone]) => (
              <button key={filter} className={tone} onClick={() => onOpen(`today:${filter}`)}>
                <b className={value === undefined ? "desk-sk" : ""}>{value ?? "–"}</b>
                <small>{label}</small>
              </button>
            ))}
          </div>
          <RecentList rows={rows} onEmployee={onEmployee} onAll={() => onOpen("today")} />
        </>
      )}

      {branches.length > 1 && (
        <>
          <div className="mp-group-title">Filiallar</div>
          <section className="mini-card desk-branches">
            {branches.map((b) => (
              <button key={b.id} className="desk-branch" onClick={() => onBranch(b.name)}>
                <span className="desk-branch-top">
                  <b>{b.name}</b>
                  <small>
                    {b.came}/{b.planned}
                  </small>
                  <strong className={b.rate >= 90 ? "ok" : b.rate >= 70 ? "warn" : "bad"}>{b.rate}%</strong>
                </span>
                <span className="desk-bar" aria-hidden>
                  <i className={b.rate >= 90 ? "ok" : b.rate >= 70 ? "warn" : "bad"} style={{ width: `${Math.min(100, Math.max(0, b.rate))}%` }} />
                </span>
              </button>
            ))}
          </section>
        </>
      )}

      {tomorrow.length > 0 && (
        <>
          <div className="mp-group-title">Ertaga</div>
          <section className="mini-card desk-money">
            {tomorrow.map((s) => (
              <div key={s.id}>
                <span>{s.name}</span>
                <b className={s.tomorrow.shortage ? "bad" : ""}>
                  {s.tomorrow.planned} kishi{s.tomorrow.shortage ? ` · ${s.tomorrow.shortage} yetishmaydi` : ""}
                </b>
              </div>
            ))}
          </section>
        </>
      )}

      {money && (
        <>
          <div className="mp-group-title">Bu oy · {MONTHS[Number(month.slice(5, 7)) - 1]}</div>
          <section className="mini-card desk-money">
            <div>
              <span>Ish haqi</span>
              <b>{som(money.net)}</b>
            </div>
            <div>
              <span>Avans</span>
              <b>{som(money.advance)}</b>
            </div>
            <div>
              <span>{money.overtime ? "Bonus va qo‘shimcha ish" : "Bonus"}</span>
              <b className="ok">{som(money.bonus + (money.overtime || 0))}</b>
            </div>
            <div>
              <span>Jarima</span>
              <b className="bad">{som(money.fine)}</b>
            </div>
          </section>
        </>
      )}
    </>
  );
}

/** Hozirgina: bugun kim qachon keldi / ketdi — eng yangisi tepada (5 ta). */
function RecentList({ rows, onEmployee, onAll }: { rows: RosterRow[] | null; onEmployee: (id: string) => void; onAll: () => void }) {
  if (!rows) return null;
  const events = rows
    .flatMap((r) => [
      ...(r.record?.checkIn ? [{ r, time: r.record.checkIn, kind: "in" as const }] : []),
      ...(r.record?.checkOut ? [{ r, time: r.record.checkOut, kind: "out" as const }] : []),
    ])
    .sort((a, b) => b.time.localeCompare(a.time))
    .slice(0, 5);
  if (!events.length) return null;
  return (
    <>
      <div className="desk-head">
        <div className="mp-group-title">Hozirgina</div>
        <button className="mini-link desk-all" onClick={onAll}>
          Hammasi <ChevronRight size={14} />
        </button>
      </div>
      <section className="mini-card desk-recent">
        <div className="mini-rows">
          {events.map(({ r, time, kind }) => {
            const late = kind === "in" && r.late;
            return (
              <button key={`${r.employee.id}:${kind}`} className="mini-row desk-ev" onClick={() => onEmployee(r.employee.id)}>
                <span className="mg-avatar sm">
                  {r.employee.photoDataUrl ? <img src={r.employee.photoDataUrl} alt="" /> : `${r.employee.firstName[0] || ""}${r.employee.lastName[0] || ""}`}
                </span>
                <span>
                  <b>
                    {r.employee.firstName} {r.employee.lastName}
                  </b>
                  {r.branch && <small>{r.branch}</small>}
                </span>
                {/* Holat — kichik nuqta va matn: yashil keldi, sariq kechikib keldi, kulrang ketdi. */}
                <span className={`desk-ev-time ${kind}${late ? " late" : ""}`}>
                  {kind === "in" ? (late ? "kechikib" : "keldi") : "ketdi"} <b>{time}</b>
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}
