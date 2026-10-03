import { useEffect, useState, type ReactNode } from "react";
import { BarChart3, Briefcase, Camera, ChevronLeft, ChevronRight, Clock3, Crosshair, ListChecks, LogIn, LogOut, MapPin, ScanFace } from "lucide-react";
import { dateLongUz, duration, tashkentIsoDate } from "@/lib/format";
import { weekdayShort, weekOrder } from "../../types";
import { Sheet, SkeletonList } from "./shared";
import { TileMap } from "./TileMap";
import { haptic } from "./tg";

/*
 * Davomat tarixi (Mini App): oy kalendari (kun ranglari), tanlangan kun — kirish/chiqish, grafik,
 * tafsilotlar, qaydnoma (rasm + xarita), so‘rovlar; oylik statistika diagrammasi.
 * Xodimning o‘zi (/mini/history) va rahbar (/employees/:id/history) uchun bir xil.
 */

type Tone = "ontime" | "late" | "absent" | "leave" | "off" | "future" | "working" | "restwork" | "none";
type Day = { date: string; tone: Tone };
type MonthData = { month: string; label: string; days: Day[]; stats: { ontime: number; late: number; absent: number; leave: number; remaining: number; off: number; plannedMinutes: number; workedMinutes: number; lateMinutes: number; overtimeMinutes: number } };
type Mark = { kind: "IN" | "OUT"; time: string; branchName: string; latitude?: number; longitude?: number; accuracy?: number; distanceMeters?: number; method: string; qr?: boolean; photo?: string; photoExpired?: boolean; branch?: { latitude: number; longitude: number; radius: number } };
type DayData = {
  date: string;
  plan: { working: boolean; start: string; end: string; reason?: string; leave?: string; plannedMinutes: number };
  attendance: { checkIn?: string; checkOut?: string; lateMinutes: number; earlyLeaveMinutes: number; workedMinutes: number; overtimeMinutes: number } | null;
  breaks: { start: string; end?: string }[];
  marks: Mark[];
  requests: { id: string; kind: string; detail: string; status: string }[];
};
export type Fetcher = <T>(path: string) => Promise<T>;

const MONTHS = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun", "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr"];
const monthTitle = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const LEAVE: Record<string, string> = { VACATION: "Ta’til", SICK: "Kasallik", PERMISSION: "Ruxsat", UNPAID: "O‘z hisobidan", OTHER: "Boshqa" };
const STATUS: Record<string, [string, string]> = { PENDING: ["Kutilmoqda", "warn"], APPROVED: ["Tasdiqlandi", "ok"], REJECTED: ["Rad etildi", "bad"], CANCELLED: ["Bekor", ""] };
const COLORS = { ontime: "#5BA24A", late: "#E8A03A", absent: "#E5484D", leave: "#8B5CF6", remaining: "#8E9AAF" };
const shift = (month: string, d: number) => {
  const x = new Date(`${month}-15T00:00:00Z`);
  x.setUTCMonth(x.getUTCMonth() + d);
  return x.toISOString().slice(0, 7);
};
const hours = (m: number) => (m % 60 ? duration(m) : `${m / 60} soat`);

export function Donut({ slices, size = 140, center }: { slices: { label: string; value: number; color: string }[]; size?: number; center?: string }) {
  const shown = slices.filter((s) => s.value > 0);
  const total = shown.reduce((n, s) => n + s.value, 0);
  const stroke = size * 0.2;
  const r = (size - stroke) / 2;
  const len = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="hc-donut">
      <div className="hc-ring" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={size / 2} cy={size / 2} r={r} className="hc-track" strokeWidth={stroke} fill="none" />
          {shown.map((s) => {
            const part = (s.value / total) * len;
            const el = <circle key={s.label} cx={size / 2} cy={size / 2} r={r} stroke={s.color} strokeWidth={stroke} fill="none" strokeDasharray={`${Math.max(0, part - (shown.length > 1 ? 2 : 0))} ${len}`} strokeDashoffset={-offset} />;
            offset += part;
            return el;
          })}
        </svg>
        <b>{center ?? total}</b>
      </div>
      <ul>
        {shown.map((s) => (
          <li key={s.label}>
            <i style={{ background: s.color }} />
            <span>
              <b>
                {s.value} <small>· {Math.round((s.value / total) * 100)}%</small>
              </b>
              <small>{s.label}</small>
            </span>
          </li>
        ))}
        {!shown.length && <li className="hc-muted">Ma’lumot yo‘q</li>}
      </ul>
    </div>
  );
}

export function HistoryCalendar({ fetcher, base }: { fetcher: Fetcher; base: string }) {
  const today = tashkentIsoDate();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const [data, setData] = useState<MonthData | null>(null);
  const [day, setDay] = useState<DayData | null>(null);
  const [error, setError] = useState("");
  const [mark, setMark] = useState<Mark | null>(null);
  useEffect(() => {
    let live = true;
    setData(null);
    setError("");
    fetcher<MonthData>(`${base}?month=${month}`)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Xatolik"));
    return () => {
      live = false;
    };
  }, [fetcher, base, month]);
  useEffect(() => {
    let live = true;
    setDay(null);
    fetcher<DayData>(`${base}/day?date=${selected}`)
      .then((d) => live && setDay(d))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [fetcher, base, selected]);
  const go = (d: number) => {
    haptic.select();
    const next = shift(month, d);
    setMonth(next);
    setSelected(next === today.slice(0, 7) ? today : `${next}-01`);
  };
  const offset = (new Date(`${month}-01T12:00:00Z`).getUTCDay() + 6) % 7;
  const s = data?.stats;
  return (
    <div className="hc">
      <section className="mini-card hc-cal">
        <div className="hc-nav">
          <button onClick={() => go(-1)} aria-label="Oldingi oy">
            <ChevronLeft size={18} />
          </button>
          <b>{monthTitle(month)}</b>
          <button onClick={() => go(1)} disabled={month >= today.slice(0, 7)} aria-label="Keyingi oy">
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="hc-grid hc-week">
          {weekOrder.map((d) => (
            <span key={d} className={d === 0 ? "sun" : ""}>
              {weekdayShort[d]}
            </span>
          ))}
        </div>
        {error ? (
          <p className="hc-muted">{error}</p>
        ) : !data ? (
          <SkeletonList rows={3} />
        ) : (
          <div className="hc-grid">
            {Array.from({ length: offset }, (_, i) => (
              <span key={`b${i}`} />
            ))}
            {data.days.map((d) => (
              <button
                key={d.date}
                className={`hc-day ${d.tone} ${d.date === selected ? "picked" : ""} ${d.date === today ? "today" : ""}`}
                onClick={() => {
                  haptic.select();
                  setSelected(d.date);
                }}
              >
                {d.date.slice(8)}
              </button>
            ))}
          </div>
        )}
        <div className="hc-legend">
          {(
            [
              ["Vaqtida", "ontime"],
              ["Kechikdi", "late"],
              ["Kelmadi", "absent"],
              ["Ta’til", "leave"],
              ["Dam", "off"],
            ] as const
          ).map(([label, tone]) => (
            <span key={tone}>
              <i className={`hc-dot ${tone}`} /> {label}
            </span>
          ))}
        </div>
      </section>

      {!day ? (
        <SkeletonList rows={3} />
      ) : (
        <>
          <p className="hc-date">{dateLongUz(new Date(`${day.date}T07:00:00Z`))}</p>
          <section className="mini-card hc-pair">
            <Big value={day.attendance?.checkIn || "--:--"} label="kirish" />
            <Big value={day.attendance?.checkOut || "--:--"} label="chiqish" />
          </section>
          <Block icon={<BarChart3 size={18} />} title="Ish jadvali">
            <div className="hc-pair">
              <Big small value={day.plan.leave ? LEAVE[day.plan.leave] || "Ta’til" : day.plan.working ? `${day.plan.start} - ${day.plan.end}` : "Dam olish"} label={day.plan.working ? "ish kuni" : day.plan.reason || "dam olish kuni"} />
              <Big small value={day.breaks.length ? day.breaks.map((b) => `${b.start} - ${b.end || "…"}`).join(", ") : "--:-- - --:--"} label="tanaffus" />
            </div>
          </Block>
          <Block icon={<Clock3 size={18} />} title="Kun tafsilotlari">
            <Big small value={hours(day.plan.plannedMinutes)} label="Ish jadvali bo‘yicha" />
            <Big small value={hours(day.attendance?.workedMinutes || 0)} label="Ishlangan vaqt" />
            {day.attendance?.lateMinutes ? <Big small tone="warn" value={`${day.attendance.lateMinutes} daq`} label="Kechikish" /> : null}
            {day.attendance?.earlyLeaveMinutes ? <Big small tone="warn" value={`${day.attendance.earlyLeaveMinutes} daq`} label="Erta ketish" /> : null}
            {day.attendance?.overtimeMinutes ? <Big small tone="ok" value={hours(day.attendance.overtimeMinutes)} label="Qo‘shimcha ish" /> : null}
            {!day.attendance && day.plan.working && day.date < today ? <Big small tone="bad" value={hours(day.plan.plannedMinutes)} label="Kelmagan (yo‘qlik)" /> : null}
          </Block>
          <Block icon={<Crosshair size={18} />} title="Qaydnoma">
            {!day.marks.length ? (
              <p className="hc-muted center">Belgi yo‘q</p>
            ) : (
              [...day.marks].reverse().map((m, i) => (
                <button key={i} className="hc-mark" onClick={() => setMark(m)}>
                  {m.kind === "IN" ? <LogIn size={22} className="in" /> : <LogOut size={22} className="out" />}
                  <span>
                    <b>{m.kind === "IN" ? "Kirish" : "Chiqish"}</b>
                    <small>
                      {m.branchName}
                      {m.method === "MANUAL" ? " · qo‘lda" : ""}
                    </small>
                  </span>
                  <span className="hc-mark-time">
                    {m.time}
                    <small>
                      {m.photo && <ScanFace size={12} />}
                      {m.latitude !== undefined && <MapPin size={12} />}
                    </small>
                  </span>
                  <ChevronRight size={16} className="hc-chev" />
                </button>
              ))
            )}
          </Block>
          <Block icon={<ListChecks size={18} />} title="So‘rovlar">
            {!day.requests.length ? (
              <p className="hc-muted center">So‘rovlar yo‘q</p>
            ) : (
              day.requests.map((r) => (
                <div key={r.id} className="hc-mark">
                  <span>
                    <b>{r.kind}</b>
                    {r.detail && <small>{r.detail}</small>}
                  </span>
                  <span className={`mini-chip ${(STATUS[r.status] || ["", ""])[1]}`}>{(STATUS[r.status] || [r.status])[0]}</span>
                </div>
              ))
            )}
          </Block>
        </>
      )}

      {s && (
        <Block icon={<Briefcase size={18} />} title={`Oylik statistika · ${monthTitle(month)}`}>
          <Donut
            slices={[
              { label: "vaqtida", value: s.ontime, color: COLORS.ontime },
              { label: "kechikdi", value: s.late, color: COLORS.late },
              { label: "kelmadi", value: s.absent, color: COLORS.absent },
              { label: "ta’til", value: s.leave, color: COLORS.leave },
              { label: "qoldi", value: s.remaining, color: COLORS.remaining },
            ]}
          />
          <div className="hc-pair">
            <Big small value={hours(s.plannedMinutes)} label="rejaga muvofiq" />
            <Big small value={hours(s.workedMinutes)} label="ishlab chiqilgan" />
          </div>
          {(s.lateMinutes > 0 || s.overtimeMinutes > 0) && (
            <div className="hc-pair">
              <Big small value={`${s.lateMinutes} daq`} label="jami kechikish" />
              <Big small value={hours(s.overtimeMinutes)} label="qo‘shimcha ish" />
            </div>
          )}
        </Block>
      )}

      {mark && (
        <Sheet title={mark.kind === "IN" ? "Qayd (kirish)" : "Qayd (chiqish)"} subtitle={`${mark.time} · ${(day?.date || selected).split("-").reverse().join(".")}`} onClose={() => setMark(null)}>
          <div className="hc-detail">
            <section className="mini-card hc-media">
              <div className="hc-head">
                <Camera size={18} /> Fotosurat
              </div>
              {mark.photo ? <img src={mark.photo} alt="Belgi rasmi" /> : <p className="hc-muted">{mark.photoExpired ? "Rasm 62 kundan so‘ng o‘chiriladi." : mark.method === "MANUAL" ? "Qo‘lda belgilangan — rasm yo‘q." : "Rasm saqlanmagan."}</p>}
            </section>
            <section className="mini-card hc-media">
              <div className="hc-head">
                <MapPin size={18} /> Koordinatalar
              </div>
              {mark.latitude !== undefined && mark.longitude !== undefined ? (
                <TileMap
                  height={240}
                  compact
                  fitKey={`${mark.latitude},${mark.longitude}`}
                  points={[
                    { id: "me", lat: mark.latitude, lng: mark.longitude, kind: "me", label: mark.kind === "IN" ? "Kirish" : "Chiqish", tone: "ok", accuracy: mark.accuracy },
                    ...(mark.branch ? [{ id: "b", lat: mark.branch.latitude, lng: mark.branch.longitude, kind: "branch" as const, label: mark.branchName, tone: "info" as const }] : []),
                  ]}
                  circles={mark.branch ? [{ id: "r", lat: mark.branch.latitude, lng: mark.branch.longitude, radius: mark.branch.radius }] : []}
                />
              ) : (
                <p className="hc-muted">Koordinata saqlanmagan.</p>
              )}
              <div className="hc-place">
                <b>{mark.branchName}</b>
                <small>{[mark.accuracy !== undefined ? `Aniqlik: ${mark.accuracy} m` : "", mark.distanceMeters !== undefined ? `filialdan ${mark.distanceMeters} m` : "", mark.method === "BIOMETRIC" ? "barmoq izi" : mark.method === "MANUAL" ? "qo‘lda" : "Face ID", mark.qr ? "QR" : ""].filter(Boolean).join(" · ")}</small>
              </div>
            </section>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function Block({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="mini-card hc-block">
      <div className="hc-head">
        {icon} {title}
      </div>
      {children}
    </section>
  );
}
function Big({ value, label, small, tone }: { value: string; label: string; small?: boolean; tone?: "ok" | "warn" | "bad" }) {
  return (
    <div className={`hc-big ${small ? "small" : ""} ${tone || ""}`}>
      <b>{value}</b>
      <small>{label}</small>
    </div>
  );
}
