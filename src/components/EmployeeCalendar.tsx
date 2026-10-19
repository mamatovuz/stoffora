import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Camera, ChevronLeft, ChevronRight, LogIn, LogOut, MapPin, Pencil, X } from "lucide-react";
import { useApi } from "../hooks";
import { ErrorBox, Loading } from "./ui";
import { AttendanceEditModal, type EditTarget } from "./AttendanceEdit";
import { dateLongUz, duration, tashkentIsoDate } from "@/lib/format";
import { leaveTypeLabel, weekdayShort, weekOrder } from "../types";

/*
 * Xodim kalendari (sayt, xodim profili) — minimal ko‘rinish:
 *   katakda faqat haqiqiy keldi–ketdi vaqti va holat nuqtasi (yashil — vaqtida, sariq — kechikdi,
 *   qizil — kelmadi, binafsha — ta’til); kelajak kunlarda — grafik (och rangda), dam olish kuni — kulrang.
 * Kun bosilsa — katak yonida kichik oyna: asosiy raqamlar darhol (oylik ma’lumotdan), qaydnoma
 * (rasm, filial, usul) esa fonda yuklanadi. Huquq bo‘lsa — «Tuzatish».
 * Ma’lumot manbai — /employees/:id/history (Mini App va ilovadagi taqvim bilan bir xil).
 */

type Tone = "ontime" | "late" | "absent" | "leave" | "off" | "future" | "working" | "restwork" | "none";
type Day = {
  date: string;
  tone: Tone;
  working: boolean;
  start: string;
  end: string;
  overridden?: boolean;
  reason?: string;
  leave?: string;
  checkIn?: string;
  checkOut?: string;
  lateMinutes: number;
  earlyLeaveMinutes?: number;
  workedMinutes: number;
  overtimeMinutes?: number;
  noCheckout?: boolean;
  recordId?: string;
  manual?: boolean;
  note?: string;
  branchId?: string;
};
type Month = {
  month: string;
  label: string;
  today: string;
  days: Day[];
  stats: { ontime: number; late: number; absent: number; leave: number; remaining: number; off: number; plannedMinutes: number; workedMinutes: number; lateMinutes: number; overtimeMinutes: number };
};
type DayDetail = {
  date: string;
  plan: { working: boolean; start: string; end: string; reason?: string; leave?: string; plannedMinutes: number };
  attendance: { id?: string; manual?: boolean; checkIn?: string; checkOut?: string; lateMinutes: number; earlyLeaveMinutes: number; workedMinutes: number; overtimeMinutes: number; note?: string } | null;
  breaks: { start: string; end?: string }[];
  marks: { kind: "IN" | "OUT"; time: string; branchName: string; method: string; distanceMeters?: number; accuracy?: number; photo?: string; photoExpired?: boolean }[];
  requests: { id: string; kind: string; detail: string; status: string }[];
};
/** Oyna joylashuvi — bosilgan katakka nisbatan (px, kalendar to‘riga nisbatan). */
type Spot = { date: string; left: number; top: number; side: "right" | "left" | "below" };

const METHOD: Record<string, string> = { FACE: "Face ID", BIOMETRIC: "Barmoq izi / Face (telefon)", MANUAL: "Qo‘lda" };
const REQUEST_STATUS: Record<string, string> = { PENDING: "Kutilmoqda", APPROVED: "Tasdiqlangan", REJECTED: "Rad etilgan", CANCELLED: "Bekor qilingan" };
const STATUS: Partial<Record<Tone, { label: string; cls: string }>> = {
  ontime: { label: "Vaqtida keldi", cls: "ok" },
  working: { label: "Ishda", cls: "ok" },
  restwork: { label: "Dam olish kunida ishladi", cls: "ok" },
  late: { label: "Kechikdi", cls: "warn" },
  absent: { label: "Kelmadi", cls: "bad" },
  leave: { label: "Ta’til", cls: "leave" },
  off: { label: "Dam olish kuni", cls: "rest" },
  future: { label: "Reja", cls: "plan" },
};
const POP_W = 360;

const shiftMonth = (month: string, delta: number) => {
  const d = new Date(`${month}-15T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 7);
};
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const restLabel = (d: Day) => (d.reason && d.reason !== "Shaxsiy dam olish kuni" ? d.reason : "Dam olish");

export function EmployeeCalendar({ employeeId, employeeName, canEdit = false }: { employeeId: string; employeeName: string; canEdit?: boolean }) {
  const current = tashkentIsoDate().slice(0, 7);
  const [month, setMonth] = useState(current);
  const [spot, setSpot] = useState<Spot | null>(null);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  // Tuzatishdan keyin kun tafsiloti ham qayta yuklanadi.
  const [dayKey, setDayKey] = useState(0);
  const grid = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const { data, loading, error, reload } = useApi<Month>(`/employees/${employeeId}/history?month=${month}`);
  const shown = data?.month === month ? data : null;

  // Tashqariga bosish, Esc yoki oyna o‘lchami o‘zgarsa — oyna yopiladi (tuzatish oynasi ochiq bo‘lmasa).
  useEffect(() => {
    if (!spot || editing) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      if (pop.current?.contains(t) || t.closest?.(".ecal-cell")) return;
      setSpot(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSpot(null);
    const onResize = () => setSpot(null);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [spot, editing]);

  if (error) return <ErrorBox message={error} />;

  const first = `${month}-01`;
  const offset = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const days = shown?.days || [];
  const trailing = (7 - ((offset + days.length) % 7)) % 7;
  const lastDate = days.at(-1)?.date || first;
  const today = shown?.today || tashkentIsoDate();
  const s = shown?.stats;
  const pickedDay = spot ? days.find((d) => d.date === spot.date) : undefined;
  const goMonth = (next: string) => {
    setMonth(next);
    setSpot(null);
  };

  /** Oynani katak yoniga joylash: o‘ngda joy bo‘lsa — o‘ngga, bo‘lmasa chapga, u ham bo‘lmasa — ostiga. */
  const pick = (date: string, cell: HTMLElement) => {
    if (spot?.date === date) return setSpot(null);
    const width = grid.current?.clientWidth || 0;
    const w = Math.min(POP_W, width - 16);
    const left = cell.offsetLeft;
    const right = left + cell.offsetWidth;
    if (right + 8 + w <= width) setSpot({ date, left: right + 8, top: cell.offsetTop, side: "right" });
    else if (left - 8 - w >= 0) setSpot({ date, left: left - 8 - w, top: cell.offsetTop, side: "left" });
    else setSpot({ date, left: Math.max(0, Math.min(width - w, left + cell.offsetWidth / 2 - w / 2)), top: cell.offsetTop + cell.offsetHeight + 8, side: "below" });
  };

  return (
    <div className="ecal">
      <div className="ecal-head">
        <div className="ecal-nav">
          <button className="icon-btn" onClick={() => goMonth(shiftMonth(month, -1))} aria-label="Oldingi oy">
            <ChevronLeft size={16} />
          </button>
          <b>{shown?.label || data?.label || month}</b>
          <button className="icon-btn" onClick={() => goMonth(shiftMonth(month, 1))} disabled={month >= current} aria-label="Keyingi oy">
            <ChevronRight size={16} />
          </button>
          {month !== current && (
            <button className="btn btn-ghost btn-sm" onClick={() => goMonth(current)}>
              Bugun
            </button>
          )}
        </div>
        {s && (
          <div className="ecal-sum">
            <span className="ok">
              <i /> Vaqtida <b>{s.ontime}</b>
            </span>
            <span className="warn">
              <i /> Kechikdi <b>{s.late}</b>
              {s.lateMinutes ? <small>· {duration(s.lateMinutes)}</small> : null}
            </span>
            <span className="bad">
              <i /> Kelmadi <b>{s.absent}</b>
            </span>
            {s.leave ? (
              <span className="leave">
                <i /> Ta’til <b>{s.leave}</b>
              </span>
            ) : null}
            <span className="plain">
              Ishladi <b>{duration(s.workedMinutes)}</b> / {duration(s.plannedMinutes)}
            </span>
          </div>
        )}
      </div>

      {!shown && loading ? (
        <Loading />
      ) : (
        <div className="ecal-grid" role="grid" aria-label="Oylik kalendar" ref={grid}>
          {weekOrder.map((d) => (
            <div key={d} className="ecal-wd" role="columnheader">
              {weekdayShort[d]}
            </div>
          ))}
          {Array.from({ length: offset }, (_, i) => (
            <div key={`p${i}`} className="ecal-cell other" aria-hidden>
              <span className="ecal-num">{Number(addDays(first, i - offset).slice(8))}</span>
            </div>
          ))}
          {days.map((d) => (
            <DayCell key={d.date} day={d} today={today} picked={spot?.date === d.date} onPick={(cell) => pick(d.date, cell)} />
          ))}
          {Array.from({ length: trailing }, (_, i) => (
            <div key={`n${i}`} className="ecal-cell other" aria-hidden>
              <span className="ecal-num">{Number(addDays(lastDate, i + 1).slice(8))}</span>
            </div>
          ))}
          {spot && pickedDay && (
            <DayPop
              key={`${spot.date}:${dayKey}`}
              ref={pop}
              spot={spot}
              day={pickedDay}
              employeeId={employeeId}
              onClose={() => setSpot(null)}
              onEdit={
                canEdit && spot.date <= today
                  ? () =>
                      setEditing({
                        employeeId,
                        employeeName,
                        date: pickedDay.date,
                        plan: pickedDay.working ? `${pickedDay.start}–${pickedDay.end}` : undefined,
                        record: pickedDay.recordId
                          ? { id: pickedDay.recordId, checkIn: pickedDay.checkIn, checkOut: pickedDay.checkOut, note: pickedDay.note, manual: pickedDay.manual }
                          : undefined,
                      })
                  : undefined
              }
            />
          )}
        </div>
      )}

      {editing && (
        <AttendanceEditModal
          target={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setDayKey((k) => k + 1);
            void reload(true);
          }}
        />
      )}
    </div>
  );
}

function DayCell({ day: d, today, picked, onPick }: { day: Day; today: string; picked: boolean; onPick: (cell: HTMLElement) => void }) {
  const isToday = d.date === today;
  const status = STATUS[d.tone];
  const early = d.earlyLeaveMinutes || 0;
  let main: React.ReactNode = null;
  let sub: React.ReactNode = null;
  if (d.checkIn) {
    const open = !d.checkOut && !d.noCheckout;
    main = (
      <span className="ecal-time">
        {d.checkIn}
        {d.checkOut ? ` – ${d.checkOut}` : open ? " – …" : ""}
      </span>
    );
    if (d.lateMinutes > 0) sub = <span className="ecal-note warn">{duration(d.lateMinutes)} kech</span>;
    else if (early > 0) sub = <span className="ecal-note warn">{duration(early)} erta ketdi</span>;
    else if (d.noCheckout) sub = <span className="ecal-note warn">Ketish yo‘q</span>;
    else if (open) sub = <span className="ecal-note ok">Ishda</span>;
  } else if (d.tone === "absent") main = <span className="ecal-note bad">Kelmadi</span>;
  else if (d.leave) main = <span className="ecal-note leave">{leaveTypeLabel[d.leave] || "Ta’til"}</span>;
  else if (d.tone === "off") main = <span className="ecal-note rest">{restLabel(d)}</span>;
  else if (d.working && d.tone === "future") main = <span className="ecal-plan">{d.start} – {d.end}</span>;

  return (
    <button
      className={`ecal-cell t-${d.tone}${isToday ? " today" : ""}${picked ? " picked" : ""}`}
      onClick={(e) => onPick(e.currentTarget)}
      aria-pressed={picked}
      aria-label={`${dateLongUz(d.date)}${status ? ` — ${status.label}` : ""}`}
      role="gridcell"
    >
      <span className="ecal-num">
        <span>{Number(d.date.slice(8))}</span>
        {d.manual && (
          <i className="ecal-manual" title="Qo‘lda tuzatilgan">
            <Pencil size={11} />
          </i>
        )}
        {status && d.tone !== "future" && d.tone !== "off" && <i className={`ecal-dot ${status.cls}`} />}
      </span>
      {main}
      {sub}
    </button>
  );
}

/** Tanlangan kun: asosiy raqamlar darhol, qaydnoma (rasm, filial, usul) — fonda yuklanadi. */
function DayPop({
  ref,
  spot,
  day: d,
  employeeId,
  onClose,
  onEdit,
}: {
  ref: React.Ref<HTMLDivElement>;
  spot: Spot;
  day: Day;
  employeeId: string;
  onClose: () => void;
  onEdit?: () => void;
}) {
  const { data, loading, error } = useApi<DayDetail>(`/employees/${employeeId}/history/day?date=${d.date}`);
  const detail = data?.date === d.date ? data : null;
  const status = STATUS[d.tone];
  const early = d.earlyLeaveMinutes || 0;
  const plan = d.leave ? leaveTypeLabel[d.leave] || "Ta’til" : d.working ? `${d.start} – ${d.end}` : restLabel(d);
  const extra = [
    d.lateMinutes > 0 && { label: "Kechikish", value: duration(d.lateMinutes), cls: "warn" },
    early > 0 && { label: "Erta ketdi", value: duration(early), cls: "warn" },
    (d.overtimeMinutes || 0) > 0 && { label: "Qo‘shimcha", value: duration(d.overtimeMinutes || 0), cls: "ok" },
  ].filter(Boolean) as { label: string; value: string; cls: string }[];

  return (
    <div
      ref={ref}
      className={`ecal-pop side-${spot.side}`}
      style={{ left: spot.left, top: spot.top, "--pop-w": `${POP_W}px` } as CSSProperties}
      role="dialog"
      aria-label={dateLongUz(d.date, true)}
    >
      <div className="ecal-pop-head">
        <div>
          <b>{dateLongUz(d.date, true)}</b>
          {status && (
            <span className={`ecal-status ${status.cls}`}>
              <i className={`ecal-dot ${status.cls}`} /> {status.label}
            </span>
          )}
        </div>
        {onEdit && (
          <button className="icon-btn" onClick={onEdit} aria-label={d.recordId ? "Tuzatish" : "Davomat kiritish"} title={d.recordId ? "Tuzatish" : "Davomat kiritish"}>
            <Pencil size={15} />
          </button>
        )}
        <button className="icon-btn" onClick={onClose} aria-label="Yopish">
          <X size={16} />
        </button>
      </div>

      <div className="ecal-pop-facts">
        <div>
          <small>Keldi</small>
          <b className={d.lateMinutes ? "warn" : ""}>{d.checkIn || "—"}</b>
        </div>
        <div>
          <small>Ketdi</small>
          <b className={early ? "warn" : ""}>{d.checkOut || "—"}</b>
        </div>
        <div>
          <small>Ishladi</small>
          <b>{d.workedMinutes ? duration(d.workedMinutes) : "—"}</b>
        </div>
      </div>

      <div className="ecal-pop-rows">
        <div>
          <span>Grafik</span>
          <b className={d.overridden ? "changed" : ""} title={d.overridden ? "Grafik shu kun uchun o‘zgartirilgan" : undefined}>
            {plan}
          </b>
        </div>
        {extra.map((x) => (
          <div key={x.label}>
            <span>{x.label}</span>
            <b className={x.cls}>{x.value}</b>
          </div>
        ))}
      </div>

      {d.manual && d.note && <p className="ecal-pop-note">✎ {d.note}</p>}

      {error ? (
        <ErrorBox message={error} />
      ) : !detail && loading ? (
        <div className="ecal-pop-skel" aria-hidden>
          <i />
          <i />
        </div>
      ) : detail ? (
        <>
          {detail.marks.length > 0 && (
            <div className="ecal-marks">
              {detail.marks.map((m, i) => (
                <div key={`${m.kind}${m.time}${i}`} className="ecal-mark">
                  {m.photo ? (
                    <img src={m.photo} alt="" />
                  ) : (
                    <span className="ecal-mark-ph" title={m.photoExpired ? "Rasm saqlash muddati o‘tgan" : "Rasm yo‘q"}>
                      <Camera size={15} />
                    </span>
                  )}
                  <span>
                    <b className={m.kind === "IN" ? "in" : "out"}>
                      {m.kind === "IN" ? <LogIn size={13} /> : <LogOut size={13} />} {m.kind === "IN" ? "Kirish" : "Chiqish"} · {m.time}
                    </b>
                    <small>
                      <MapPin size={11} /> {m.branchName || "—"}
                      {typeof m.distanceMeters === "number" ? ` · ${Math.round(m.distanceMeters)} m` : ""} · {METHOD[m.method] || m.method}
                    </small>
                  </span>
                </div>
              ))}
            </div>
          )}
          {detail.breaks.length > 0 && <p className="ecal-pop-note">Tanaffus: {detail.breaks.map((b) => `${b.start}–${b.end || "…"}`).join(", ")}</p>}
          {detail.requests.length > 0 && (
            <div className="ecal-reqs">
              {detail.requests.map((r) => (
                <span key={r.id} className="tag">
                  {r.kind}
                  {r.detail ? `: ${r.detail}` : ""} · {REQUEST_STATUS[r.status] || r.status}
                </span>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
