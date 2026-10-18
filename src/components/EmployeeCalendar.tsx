import { useState } from "react";
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
 * pastida og‘ishlar: kechikish va erta ketish. Kun bosilsa — qaydnoma (vaqt, filial, rasm) va
 * (huquq bo‘lsa) «Tuzatish» — kelish/ketish vaqtini shu yerning o‘zida o‘zgartirish (audit bilan).
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

const METHOD: Record<string, string> = { FACE: "Face ID", BIOMETRIC: "Barmoq izi / Face (telefon)", MANUAL: "Qo‘lda" };
const REQUEST_STATUS: Record<string, string> = { PENDING: "Kutilmoqda", APPROVED: "Tasdiqlangan", REJECTED: "Rad etilgan", CANCELLED: "Bekor qilingan" };

const shiftMonth = (month: string, delta: number) => {
  const d = new Date(`${month}-15T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 7);
};
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** Kechikish: 1 soatgacha — sariq, undan ko‘p — qizil (Verifix’dagidek). */
const severity = (minutes: number) => (minutes >= 60 ? "bad" : "warn");

export function EmployeeCalendar({ employeeId, employeeName, canEdit = false }: { employeeId: string; employeeName: string; canEdit?: boolean }) {
  const current = tashkentIsoDate().slice(0, 7);
  const [month, setMonth] = useState(current);
  const [picked, setPicked] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  // Tuzatishdan keyin kun tafsiloti ham qayta yuklanadi.
  const [dayKey, setDayKey] = useState(0);
  const { data, loading, error, reload } = useApi<Month>(`/employees/${employeeId}/history?month=${month}`);
  const shown = data?.month === month ? data : null;

  if (error) return <ErrorBox message={error} />;

  const first = `${month}-01`;
  const offset = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const days = shown?.days || [];
  const trailing = (7 - ((offset + days.length) % 7)) % 7;
  const lastDate = days.at(-1)?.date || first;
  const today = shown?.today || tashkentIsoDate();
  const s = shown?.stats;

  return (
    <div className="ecal">
      <div className="ecal-head">
        <div className="ecal-nav">
          <button className="icon-btn" onClick={() => (setMonth(shiftMonth(month, -1)), setPicked(null))} aria-label="Oldingi oy">
            <ChevronLeft size={16} />
          </button>
          <b>{shown?.label || data?.label || month}</b>
          <button className="icon-btn" onClick={() => (setMonth(shiftMonth(month, 1)), setPicked(null))} disabled={month >= current} aria-label="Keyingi oy">
            <ChevronRight size={16} />
          </button>
          {month !== current && (
            <button className="btn btn-ghost btn-sm" onClick={() => (setMonth(current), setPicked(null))}>
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
        <div className="ecal-grid" role="grid" aria-label="Oylik kalendar">
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
            <DayCell key={d.date} day={d} today={today} picked={picked === d.date} onPick={() => setPicked(picked === d.date ? null : d.date)} />
          ))}
          {Array.from({ length: trailing }, (_, i) => (
            <div key={`n${i}`} className="ecal-cell other" aria-hidden>
              <span className="ecal-num">{Number(addDays(lastDate, i + 1).slice(8))}</span>
            </div>
          ))}
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

      {picked && (
        <DayPanel
          key={`${picked}:${dayKey}`}
          employeeId={employeeId}
          date={picked}
          onClose={() => setPicked(null)}
          onEdit={
            canEdit && picked <= today
              ? () => {
                  const d = days.find((x) => x.date === picked);
                  setEditing({
                    employeeId,
                    employeeName,
                    date: picked,
                    plan: d?.working ? `${d.start}–${d.end}` : undefined,
                    record: d?.recordId ? { id: d.recordId, checkIn: d.checkIn, checkOut: d.checkOut, note: d.note, manual: d.manual } : undefined,
                  });
                }
              : undefined
          }
          hasRecord={Boolean(days.find((x) => x.date === picked)?.recordId)}
        />
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

function DayCell({ day: d, today, picked, onPick }: { day: Day; today: string; picked: boolean; onPick: () => void }) {
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
      onClick={onPick}
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

/** Tanlangan kun: reja, fakt, og‘ishlar va qaydnoma (har bir belgi: vaqt, filial, usul, rasm). */
function DayPanel({ employeeId, date, onClose, onEdit, hasRecord }: { employeeId: string; date: string; onClose: () => void; onEdit?: () => void; hasRecord: boolean }) {
  const { data, loading, error } = useApi<DayDetail>(`/employees/${employeeId}/history/day?date=${date}`);
  const d = data?.date === date ? data : null;
  return (
    <section className="ecal-day">
      <div className="ecal-day-head">
        <b>{dateLongUz(date, true)}</b>
        {onEdit && (
          <button className="btn btn-sm" onClick={onEdit}>
            <Pencil size={14} /> {hasRecord ? "Tuzatish" : "Davomat kiritish"}
          </button>
        )}
        <button className="icon-btn" onClick={onClose} aria-label="Yopish">
          <X size={16} />
        </button>
      </div>
      {error ? (
        <ErrorBox message={error} />
      ) : !d && loading ? (
        <Loading />
      ) : d ? (
        <>
          <div className="ecal-day-facts">
            <div>
              <small>Grafik</small>
              <b>{d.plan.leave ? leaveTypeLabel[d.plan.leave] || "Ta’til" : d.plan.working ? `${d.plan.start} – ${d.plan.end}` : "Dam olish"}</b>
            </div>
            <div>
              <small>Keldi</small>
              <b className={d.attendance?.lateMinutes ? "warn" : ""}>{d.attendance?.checkIn || "—"}</b>
            </div>
            <div>
              <small>Ketdi</small>
              <b className={d.attendance?.earlyLeaveMinutes ? "warn" : ""}>{d.attendance?.checkOut || "—"}</b>
            </div>
            <div>
              <small>Ishladi</small>
              <b>{d.attendance?.workedMinutes ? duration(d.attendance.workedMinutes) : "—"}</b>
            </div>
            {d.attendance?.lateMinutes ? (
              <div>
                <small>Kechikish</small>
                <b className="warn">{duration(d.attendance.lateMinutes)}</b>
              </div>
            ) : null}
            {d.attendance?.earlyLeaveMinutes ? (
              <div>
                <small>Erta ketdi</small>
                <b className="warn">{duration(d.attendance.earlyLeaveMinutes)}</b>
              </div>
            ) : null}
            {d.attendance?.overtimeMinutes ? (
              <div>
                <small>Qo‘shimcha</small>
                <b className="ok">{duration(d.attendance.overtimeMinutes)}</b>
              </div>
            ) : null}
          </div>
          {d.plan.reason && <p className="hint">{d.plan.reason}</p>}
          {d.attendance?.manual && d.attendance.note && <p className="hint">✎ {d.attendance.note}</p>}
          {d.marks.length > 0 && (
            <div className="ecal-marks">
              {d.marks.map((m, i) => (
                <div key={`${m.kind}${m.time}${i}`} className="ecal-mark">
                  {m.photo ? (
                    <img src={m.photo} alt="" />
                  ) : (
                    <span className="ecal-mark-ph" title={m.photoExpired ? "Rasm saqlash muddati o‘tgan" : "Rasm yo‘q"}>
                      <Camera size={16} />
                    </span>
                  )}
                  <span>
                    <b className={m.kind === "IN" ? "in" : "out"}>
                      {m.kind === "IN" ? <LogIn size={14} /> : <LogOut size={14} />} {m.kind === "IN" ? "Kirish" : "Chiqish"} · {m.time}
                    </b>
                    <small>
                      <MapPin size={12} /> {m.branchName || "—"}
                      {typeof m.distanceMeters === "number" ? ` · ${Math.round(m.distanceMeters)} m` : ""} · {METHOD[m.method] || m.method}
                    </small>
                  </span>
                </div>
              ))}
            </div>
          )}
          {d.breaks.length > 0 && (
            <p className="hint">Tanaffus: {d.breaks.map((b) => `${b.start}–${b.end || "…"}`).join(", ")}</p>
          )}
          {d.requests.length > 0 && (
            <div className="ecal-reqs">
              {d.requests.map((r) => (
                <span key={r.id} className="tag">
                  {r.kind}
                  {r.detail ? `: ${r.detail}` : ""} · {REQUEST_STATUS[r.status] || r.status}
                </span>
              ))}
            </div>
          )}
          {!d.attendance && !d.marks.length && <p className="hint">Bu kuni keldi-ketdi qaydi yo‘q.</p>}
        </>
      ) : null}
    </section>
  );
}
