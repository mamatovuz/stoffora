import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { SkeletonList } from "./shared";

/* Mini App — Ish stoli: «bugun nima qilishim kerak», bugungi holat, oy pullari, filial smenasi. */

type Call = <T>(url: string, body?: unknown, method?: string) => Promise<T>;
type Action = { level: "red" | "orange" | "yellow" | "info"; text: string; count: number; view?: string };
type Overview = {
  today: { planned: number; came: number; late: number; absent: number; notYet: number };
  money: { net: number; advance: number; bonus: number; fine: number; overtime: number } | null;
  branches: { id: string; name: string; planned: number; came: number; rate: number }[];
};
type Shift = {
  id: string;
  name: string;
  today: { planned: number; came: number; late: number; absent: number };
  issues: { employeeId: string; name: string; text: string; tone: "bad" | "warn" }[];
  tomorrow: { date: string; planned: number; onLeave: number; required?: number; shortage: number };
};
const som = (v: number) => `${Math.round(v).toLocaleString("ru-RU").replace(/\s/g, " ")} so‘m`;

export function MiniDesk({ call, role, canAttendance, onOpen, onEmployee }: { call: Call; role: string; canAttendance: boolean; onOpen: (view: string) => void; onEmployee: (id: string) => void }) {
  const [actions, setActions] = useState<Action[] | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(false);
  useEffect(() => {
    void call<{ actions: Action[] }>("/workspace/actions")
      .then((r) => setActions(r.actions))
      .catch(() => setActions([]));
    if (canAttendance && role !== "BRANCH_MANAGER") void call<Overview>("/workspace/overview").then(setOverview).catch(() => undefined);
    if (role === "BRANCH_MANAGER") void call<Shift[]>("/workspace/branch-shift").then(setShifts).catch(() => undefined);
  }, [call, role, canAttendance]);
  const list = (actions || []).filter((a) => !onlyProblems || a.level === "red" || a.level === "orange");
  return (
    <>
      {overview && (
        <section className="desk-tiles">
          <div>
            <b>{overview.today.planned}</b>
            <small>rejada</small>
          </div>
          <div className="ok">
            <b>{overview.today.came}</b>
            <small>keldi</small>
          </div>
          <div className="warn">
            <b>{overview.today.late}</b>
            <small>kechikdi</small>
          </div>
          <div className="bad">
            <b>{overview.today.absent}</b>
            <small>kelmadi</small>
          </div>
        </section>
      )}
      {overview?.money && (
        <section className="mini-card desk-money">
          <div>
            <span>Ish haqi (bu oy)</span>
            <b>{som(overview.money.net)}</b>
          </div>
          <div>
            <span>Avans</span>
            <b>{som(overview.money.advance)}</b>
          </div>
          <div>
            <span>Bonus va overtime</span>
            <b className="ok">{som(overview.money.bonus + overview.money.overtime)}</b>
          </div>
          <div>
            <span>Jarima</span>
            <b className="bad">{som(overview.money.fine)}</b>
          </div>
        </section>
      )}
      {shifts?.map((s) => (
        <section className="mini-card desk-shift" key={s.id}>
          <b className="desk-shift-title">{s.name} · bugun</b>
          <div className="desk-tiles inner">
            <div>
              <b>{s.today.planned}</b>
              <small>rejada</small>
            </div>
            <div className="ok">
              <b>{s.today.came}</b>
              <small>keldi</small>
            </div>
            <div className="warn">
              <b>{s.today.late}</b>
              <small>kech</small>
            </div>
            <div className="bad">
              <b>{s.today.absent}</b>
              <small>yo‘q</small>
            </div>
          </div>
          {s.issues.slice(0, 8).map((i) => (
            <button key={`${i.employeeId}:${i.text}`} className={`desk-issue ${i.tone}`} onClick={() => onEmployee(i.employeeId)}>
              ⚠ {i.name} — {i.text}
            </button>
          ))}
          <div className={`desk-tomorrow ${s.tomorrow.shortage ? "bad" : ""}`}>
            Ertaga: rejada {s.tomorrow.planned}
            {s.tomorrow.required ? ` · kerak ${s.tomorrow.required}` : ""}
            {s.tomorrow.shortage ? ` · ⚠ ${s.tomorrow.shortage} xodim yetishmaydi` : s.tomorrow.required ? " · ✓ tayyor" : ""}
          </div>
        </section>
      ))}
      <div className="desk-head">
        <div className="mp-group-title">Sizning bugungi ishlaringiz</div>
        <label>
          <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Faqat muammolar
        </label>
      </div>
      <section className="mini-card">
        {actions === null ? (
          <SkeletonList rows={4} />
        ) : !list.length ? (
          <div className="mini-empty">Hammasi joyida ✓</div>
        ) : (
          <div className="mini-rows">
            {list.map((a) => (
              <button key={a.text} className={`mini-row desk-action ${a.level}`} onClick={() => a.view && onOpen(a.view === "inbox" ? "requests" : a.view)}>
                <i className="desk-dot" />
                <b className="desk-count">{a.count}</b>
                <span>{a.text}</span>
                {a.view && <ChevronRight size={16} />}
              </button>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
