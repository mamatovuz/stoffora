import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Camera, ChevronLeft, ChevronRight, LogIn, LogOut, MapPin, Pencil, X } from "lucide-react";
import { useApi } from "../hooks";
import { ErrorBox, Loading } from "./ui";
import { AttendanceEditModal, type EditTarget } from "./AttendanceEdit";
import { dateLongUz, duration, tashkentIsoDate } from "@/lib/format";
import { leaveTypeLabel, weekdayShort, weekOrder } from "../types";

/*
 * Xodim kalendari (sayt, xodim profili): har kunda ikki qator —
 *   ko‘k — grafik bo‘yicha reja (14:00 – 00:00), qizg‘ish — dam olish kuni, binafsha — ta’til;
 *   yashil — haqiqatda keldi-ketdi (14:06 – 23:53), sariq — ketish belgilanmagan, qizil — kelmadi;
 * pastida og‘ishlar: kechikish va erta ketish.
 * Kun bosilsa — katak yonida kichik karta: asosiy raqamlar darhol (oylik ma’lumotdan), qaydnoma
 * (rasm, filial, usul) esa fonda yuklanadi. Pastki qatorlarda karta tepaga qarab ochiladi. Huquq bo‘lsa — «Tuzatish».
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
/** Karta joylashuvi — bosilgan katakka nisbatan (px, .ecal-wrap ga nisbatan). */
type Spot = { date: string; left: number; cellTop: number; cellBottom: number; side: "right" | "left" | "below" };

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
/** Kechikish: 1 soatgacha — sariq, undan ko‘p — qizil (Verifix’dagidek). */
const severity = (minutes: number) => (minutes >= 60 ? "bad" : "warn");

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

  /** Kartani katak yoniga joylash: o‘ngda joy bo‘lsa — o‘ngga, bo‘lmasa chapga, u ham bo‘lmasa — ustiga/ostiga. */
  const pick = (date: string, cell: HTMLElement) => {
    if (spot?.date === date) return setSpot(null);
    const width = grid.current?.clientWidth || 0;
    const w = Math.min(POP_W, width - 16);
    const left = cell.offsetLeft;
    const right = left + cell.offsetWidth;
    const base = { date, cellTop: cell.offsetTop, cellBottom: cell.offsetTop + cell.offsetHeight };
    if (right + 8 + w <= width) setSpot({ ...base, left: right + 8, side: "right" });
    else if (left - 8 - w >= 0) setSpot({ ...base, left: left - 8 - w, side: "left" });
    else setSpot({ ...base, left: Math.max(0, Math.min(width - w, left + cell.offsetWidth / 2 - w / 2)), side: "below" });
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
              <span className="rest">
                <i /> Ta’til <b>{s.leave}</b>
              </span>
            ) : null}
            <span className="plain">
              Ishladi <b>{duration(s.workedMinutes)}</b> / reja {duration(s.plannedMinutes)}
            </span>
          </div>
        )}
      </div>

      {!shown && loading ? (
        <Loading />
      ) : (
        <div className="ecal-wrap">
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
          </div>
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

      <div className="ecal-legend">
        <span>
          <i className="plan" /> Grafik (reja)
        </span>
        <span>
          <i className="fact" /> Keldi – ketdi
        </span>
        <span>
          <i className="nocheck" /> Ketish belgilanmagan
        </span>
        <span>
          <i className="rest" /> Dam olish kuni
        </span>
        <span>
          <i className="dev" /> Kechikish / erta ketish
        </span>
        <span>
          <em className="ecal-manual">✎</em> Qo‘lda tuzatilgan
        </span>
      </div>

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
  const plan = d.leave ? (
    <span className="ecal-bar leave">{leaveTypeLabel[d.leave] || "Ta’til"}</span>
  ) : d.working ? (
    <span className={`ecal-bar plan ${d.overridden ? "changed" : ""}`} title={d.overridden ? `Grafik o‘zgartirilgan${d.reason ? `: ${d.reason}` : ""}` : undefined}>
      {d.start}–{d.end}
    </span>
  ) : d.tone !== "none" ? (
    <span className="ecal-bar rest" title={d.reason}>
      {d.reason && d.reason !== "Shaxsiy dam olish kuni" ? d.reason : "Dam olish kuni"}
    </span>
  ) : null;
  let fact = null;
  if (d.checkIn) {
    const open = !d.checkOut && !d.noCheckout;
    fact = (
      <span className={`ecal-bar ${d.noCheckout ? "nocheck" : "fact"}`}>
        {d.checkIn}–{d.checkOut || (open ? "ishda" : "chiqish yo‘q")}
      </span>
    );
  } else if (d.tone === "absent") fact = <span className="ecal-bar absent">Kelmadi</span>;
  const early = d.earlyLeaveMinutes || 0;
  return (
    <button
      className={`ecal-cell ${isToday ? "today" : ""} ${picked ? "picked" : ""} ${d.tone}`}
      onClick={(e) => onPick(e.currentTarget)}
      aria-pressed={picked}
      aria-label={dateLongUz(d.date)}
      role="gridcell"
    >
      <span className="ecal-num">
        {d.manual && (
          <i className="ecal-manual" title="Qo‘lda tuzatilgan">
            ✎
          </i>
        )}
        {isToday && <em>Bugun</em>}
        {Number(d.date.slice(8))}
      </span>
      {plan}
      {fact}
      {d.lateMinutes > 0 && <span className={`ecal-dev ${severity(d.lateMinutes)}`}>− {duration(d.lateMinutes)} kech</span>}
      {early > 0 && <span className={`ecal-dev ${severity(early)}`}>− {duration(early)} erta</span>}
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
  const self = useRef<HTMLDivElement | null>(null);
  const [top, setTop] = useState<number | null>(null);
  // Karta balandligi ma’lum bo‘lgach joylashadi: to‘rning pastki yarmida (20-sanadan keyingi qatorlar) —
  // katak ostki chizig‘iga tekislanib tepaga ochiladi; har holda kalendardan tashqariga chiqmaydi.
  useLayoutEffect(() => {
    const el = self.current;
    const wrap = el?.offsetParent as HTMLElement | null;
    if (!el || !wrap) return;
    const h = el.offsetHeight;
    const room = wrap.clientHeight;
    const lower = (spot.cellTop + spot.cellBottom) / 2 > room / 2;
    let next = spot.side === "below" ? (lower ? spot.cellTop - 8 - h : spot.cellBottom + 8) : lower ? spot.cellBottom - h : spot.cellTop;
    next = Math.max(0, Math.min(next, room - h));
    setTop(next);
    // Karta ekrandan chiqib qolsa — sahifa yumshoq suriladi.
    requestAnimationFrame(() => el.scrollIntoView?.({ block: "nearest", behavior: "smooth" }));
  }, [spot, detail, loading]);
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
      ref={(el) => {
        self.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
      }}
      className={`ecal-pop side-${spot.side}${top !== null && top + 1 < spot.cellTop ? " up" : ""}`}
      style={{ left: spot.left, top: top ?? spot.cellTop, visibility: top === null ? "hidden" : undefined, "--pop-w": `${POP_W}px` } as CSSProperties}
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
