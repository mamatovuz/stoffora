import { useEffect, useState } from "react";
import {
  AlertCircle,
  CalendarCheck,
  CalendarRange,
  CheckCircle2,
  ChevronRight,
  Coffee,
  Fingerprint,
  Hourglass,
  LoaderCircle,
  LogOut,
  MapPin,
  ScanFace,
  ShieldCheck,
  TrendingUp,
  Users,
  Wallet,
  FileText,
  MessageCircleQuestion,
  Navigation,
  ListChecks,
  ListTodo,
} from "lucide-react";
import { haversineDistance } from "@/lib/attendance";
import { BirthdayCard } from "./Birthdays";
import { quietPosition } from "./AttendanceFlow";
import type { HelpdeskView } from "./Helpdesk";
import { api, errorText, post } from "../../api";
import { dateLongUz, duration, tashkentClock, tashkentWeekday } from "@/lib/format";
import { breakMinutes, type DeepLink } from "@/lib/mini";
import { SalaryCard } from "../MiniMoney";
import { getCached, setCached } from "../miniCache";
import { NotifItem } from "./Notifications";
import { clockDuration, Sheet, toMinutes, useClock, type Action, type HomeData, type Toast } from "./shared";
import { haptic, shareText } from "./tg";

type Stats = { streak: { current: number; best: number; badge: { emoji: string; label: string } | null } };

function minutesSince(checkIn: string) {
  return Math.max(0, toMinutes(tashkentClock()) - toMinutes(checkIn));
}

/** Bugungi reja: serverdan (shaxsiy dam kuni, ko‘chirish hisobga olingan), bo‘lmasa haftalik grafik. */
function todayPlanOf(data: HomeData) {
  if (data.todayPlan) return data.todayPlan;
  const weekly = data.schedule?.days.find((d) => d.day === tashkentWeekday());
  return weekly ? { enabled: weekly.enabled, start: weekly.start, end: weekly.end, overridden: false } : undefined;
}

export function MiniHome({
  data,
  stale,
  offline,
  quick,
  onAction,
  onNotifications,
  onSalary,
  onNavigate,
  onRefresh,
  onToast,
  onHelpdesk,
  onBirthdays,
}: {
  data: HomeData;
  stale: boolean;
  offline?: boolean;
  /** Biometriya ulangan: tugma ostida «barmoq izi bilan» belgisi. */
  quick?: "finger" | "face" | null;
  onSalary: () => void;
  onAction: (action: Action) => void;
  onNotifications: () => void;
  onNavigate: (link: DeepLink) => void;
  onRefresh: () => Promise<void>;
  onToast: Toast;
  onHelpdesk: (view: HelpdeskView) => void;
  onBirthdays: () => void;
}) {
  const now = useClock();
  const a = data.attendance;
  const working = Boolean(a?.checkIn && !a.checkOut);
  const finished = Boolean(a?.checkOut);
  const day = todayPlanOf(data);
  const clock = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tashkent" });
  const missingSetup = !data.branch || !data.schedule;
  const openBreak = a?.breaks?.find((b) => !b.end);
  const status = finished
    ? { text: "Ish kuni yakunlandi", tone: "done" }
    : openBreak
      ? { text: "Tanaffusda", tone: "late" }
      : working
        ? { text: a?.lateMinutes ? `Ishdasiz · ${a.lateMinutes} daq kech` : "Ishdasiz", tone: a?.lateMinutes ? "late" : "on" }
        : data.todayLeave
          ? { text: "Bugun ta’tildasiz", tone: "off" }
          : !day?.enabled
            ? { text: day?.overridden ? "Dam olish (ko‘chirilgan)" : "Dam olish kuni", tone: "off" }
            : { text: "Hali kelmagansiz", tone: "idle" };
  const qr = (data.branch?.attendanceMode || "QR_GPS_FACE") === "QR_GPS_FACE";
  const [lateOpen, setLateOpen] = useState(false);
  const canNotifyLate = !a?.checkIn && !data.todayLeave && Boolean(day?.enabled) && !missingSetup && !offline;

  const [stats, setStats] = useState<Stats | null>(() => getCached<Stats>("stats-mini"));
  useEffect(() => {
    if (offline || getCached("stats-mini")) return;
    void api<Stats>("/mini/stats")
      .then((value) => {
        setCached("stats-mini", value);
        setStats(value);
      })
      .catch(() => undefined);
  }, [offline]);
  const streak = stats?.streak.current || 0;
  const near = useGeofence(Boolean(!a?.checkIn && day?.enabled && !data.todayLeave && !offline && !stale), data);

  return (
    <div className="mini-body mh">
      <section className={`mh-hero ${status.tone}`}>
        <div className="mh-status">
          <span>
            <i />
            {status.text}
          </span>
          <time>{dateLongUz(now)}</time>
        </div>
        <div className="mh-clock">{clock}</div>
        <div className="mh-meta">
          <MapPin size={13} /> {data.branch?.name || "Filial biriktirilmagan"}
          <span>·</span>
          {day?.enabled ? `${day.start}–${day.end}` : "Dam olish"}
        </div>

        <div className="mh-times">
          <div>
            <small>Keldi</small>
            <b className={a?.checkIn ? "" : "is-blank"}>{a?.checkIn || "--:--"}</b>
            {a?.checkIn && <em className={a.lateMinutes ? "late" : "ok"}>{a.lateMinutes ? `${a.lateMinutes} daq kech` : "vaqtida"}</em>}
          </div>
          <div>
            <small>{finished ? "Ketdi" : "Ishlangan"}</small>
            <b className={finished || working ? "" : "is-blank"}>
              {finished ? a?.checkOut : working && a?.checkIn ? clockDuration(minutesSince(a.checkIn)) : "--:--"}
            </b>
            {finished && <em className="ok">{clockDuration(a?.workedMinutes || 0)} soat</em>}
          </div>
        </div>

        {working && day?.enabled && a?.checkIn && <ShiftProgress start={a.checkIn} end={a.scheduledEnd || day.end} now={now} />}

        {missingSetup ? (
          <div className="mh-done warn">
            <AlertCircle size={17} /> HR filial va grafikni biriktirishi kerak
          </div>
        ) : finished ? (
          <div className="mh-done">
            <CheckCircle2 size={17} /> {a?.checkIn} – {a?.checkOut} · {duration(a?.workedMinutes || 0)}
          </div>
        ) : data.todayLeave && !working ? (
          <div className="mh-leave">
            <div className="mh-done off">🏖 Bugun ta’tildasiz — dam oling!</div>
            <button className="mini-link" onClick={() => onAction("CHECK_IN")}>
              Baribir ishga keldim
            </button>
          </div>
        ) : (
          <button className={`mh-action ${working ? "out" : ""}`} disabled={stale || Boolean(openBreak)} onClick={() => onAction(working ? "CHECK_OUT" : "CHECK_IN")}>
            {stale ? (
              <LoaderCircle size={19} className="spin" />
            ) : working ? (
              <LogOut size={19} />
            ) : quick === "finger" ? (
              <Fingerprint size={19} />
            ) : (
              <ScanFace size={19} />
            )}
            {stale ? "Yangilanmoqda…" : openBreak ? "Avval tanaffusni yakunlang" : working ? "Ishdan ketdim" : "Ishga keldim"}
          </button>
        )}
        <div className="mh-note">
          <ShieldCheck size={12} /> {quick ? (quick === "finger" ? "Barmoq izi" : "Telefon Face ID") : "Face ID"} · GPS{qr ? " · QR" : ""}
        </div>
      </section>

      {!day?.enabled && !a?.checkIn && !data.todayLeave && !missingSetup && (
        <div className="mh-hint rest">
          <CalendarCheck size={16} />
          <span>
            Bugun dam olish kuningiz — kelmasangiz jarima yo‘q. Ishga kelsangiz, shu oydagi sababsiz kelmagan kun qoplanadi
            (bo‘lmasa qo‘shimcha ish hisoblanadi).
          </span>
        </div>
      )}

      {near && !missingSetup && (
        <button
          className="mh-geo"
          onClick={() => {
            haptic.tap("medium");
            onAction("CHECK_IN");
          }}
        >
          <span className="mh-geo-pulse">
            <Navigation size={18} />
          </span>
          <span>
            <b>Siz {data.branch?.name} yonidasiz</b>
            <small>Ishga keldingizmi? Hozir belgilang — {near} m</small>
          </span>
          <ChevronRight size={16} />
        </button>
      )}

      {data.features?.breaks && working && !finished && <BreakCard data={data} now={now} onChanged={onRefresh} onToast={onToast} />}

      <BirthdayCard onOpen={onBirthdays} offline={offline} />

      {canNotifyLate &&
        (data.lateNotice ? (
          <div className="mh-hint info">
            <Hourglass size={16} />
            <span>
              Rahbaringiz ogohlantirildi: ~{data.lateNotice.minutes} daqiqa kechikasiz. «{data.lateNotice.reason}»
            </span>
          </div>
        ) : (
          <button className="mh-late" onClick={() => setLateOpen(true)}>
            <Hourglass size={17} />
            <span>
              <b>Kechikyapsizmi?</b>
              <small>Rahbaringizni oldindan ogohlantiring</small>
            </span>
            <ChevronRight size={16} />
          </button>
        ))}

      <section className="mh-stats">
        <div>
          <b>{data.month.days}</b>
          <small>kun keldi</small>
        </div>
        <div>
          <b className={data.month.late ? "warn" : ""}>{data.month.late}</b>
          <small>kechikish</small>
        </div>
        {streak > 0 ? (
          <button className="mh-streak" onClick={() => onNavigate({ tab: "history", view: "stats" })}>
            <b>
              {stats?.streak.badge?.emoji || "🔥"} {streak}
            </b>
            <small>kun vaqtida</small>
          </button>
        ) : (
          <div>
            <b>{Math.round(data.month.workedMinutes / 60)}</b>
            <small>soat</small>
          </div>
        )}
      </section>

      <SalaryCard onOpen={onSalary} offline={offline} />

      <section className="mh-quick" aria-label="Tezkor bo‘limlar">
        <QuickTile icon={<CalendarRange size={19} />} label="Grafigim" onClick={() => onNavigate({ tab: "history", view: "schedule" })} />
        <QuickTile icon={<TrendingUp size={19} />} label="Statistika" onClick={() => onNavigate({ tab: "history", view: "stats" })} />
        <QuickTile icon={<ListTodo size={19} />} label="Vazifalar" onClick={() => onNavigate({ tab: "work", view: "tasks" })} />
        {data.features?.directory !== false ? (
          <QuickTile icon={<Users size={19} />} label="Hamkasblar" onClick={() => onNavigate({ tab: "profile", section: "directory" })} />
        ) : (
          <QuickTile icon={<FileText size={19} />} label="Hujjatlar" onClick={() => onNavigate({ tab: "profile", section: "docs" })} />
        )}
        <QuickTile icon={<Wallet size={19} />} label="Hisob varaqa" onClick={() => onNavigate({ tab: "profile", section: "payslips" })} />
        <QuickTile icon={<CalendarCheck size={19} />} label="Ta’til" onClick={() => onNavigate({ tab: "leave", view: "leave" })} />
        <QuickTile icon={<MessageCircleQuestion size={19} />} label="HR’ga savol" onClick={() => onHelpdesk("questions")} />
        <QuickTile icon={<ListChecks size={19} />} label="Checklist" onClick={() => onNavigate({ tab: "work", view: "checklist" })} />
      </section>

      {data.month.practiceUntil && (
        <div className="mh-hint info">
          <CalendarCheck size={16} />
          <span>{data.month.practiceUntil.split("-").reverse().join(".")} gacha mashq davri — kechikish va ushlanmalar hisoblanmaydi.</span>
        </div>
      )}
      {!data.month.practiceUntil && data.month.lateMinutes > 0 && (
        <div className="mh-hint warn">
          <AlertCircle size={16} />
          <span>
            Bu oy {data.month.lateMinutes} daqiqa kechikdingiz
            {data.month.deduction ? ` · ${data.month.deduction.toLocaleString("ru-RU")} so‘m ushlanadi` : ""}
          </span>
        </div>
      )}
      {!data.employee.faceEnrolledAt && !finished && !missingSetup && (
        <div className="mh-hint info">
          <ScanFace size={16} />
          <span>Birinchi marta Face ID sozlanadi (~15 soniya). Yorug‘ joyda turing.</span>
        </div>
      )}

      {data.notifications.length > 0 && (
        <section className="mh-notifs">
          <button className="mh-notifs-head" onClick={onNotifications}>
            <span>
              Xabarlar
              {(data.unreadNotifications || 0) > 0 && <span className="mini-badge inline">{data.unreadNotifications}</span>}
            </span>
            <ChevronRight size={16} />
          </button>
          <div className="mn-list">
            {data.notifications.slice(0, 2).map((item) => (
              <NotifItem key={item.id} item={item} onOpen={onNotifications} />
            ))}
          </div>
        </section>
      )}
      {lateOpen && (
        <LateSheet
          start={day?.start || ""}
          onClose={() => setLateOpen(false)}
          onSaved={async (sent) => {
            setLateOpen(false);
            onToast(sent ? "Rahbaringiz ogohlantirildi" : "Ogohlantirish saqlandi — HR panelida ko‘rinadi");
            haptic.success();
            await onRefresh();
          }}
          name={`${data.employee.firstName} ${data.employee.lastName}`}
        />
      )}
    </div>
  );
}

function QuickTile({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      className="mh-tile"
      onClick={() => {
        haptic.select();
        onClick();
      }}
    >
      <span>{icon}</span>
      <small>{label}</small>
    </button>
  );
}

/** Ish kuni halqasi: necha foiz o‘tgani va qancha qolgani. */
export function ShiftProgress({ start, end, now }: { start: string; end: string; now: Date }) {
  const current = toMinutes(tashkentClock(now));
  const total = Math.max(1, toMinutes(end) - toMinutes(start));
  const done = Math.min(total, Math.max(0, current - toMinutes(start)));
  const left = Math.max(0, toMinutes(end) - current);
  const percent = Math.round((done / total) * 100);
  const R = 26;
  const C = 2 * Math.PI * R;
  return (
    <div className="mh-ring" aria-label={`Ish kuni ${percent}%`}>
      <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden>
        <circle cx="32" cy="32" r={R} className="mh-ring-track" />
        <circle cx="32" cy="32" r={R} className="mh-ring-fill" strokeDasharray={C} strokeDashoffset={C * (1 - percent / 100)} />
      </svg>
      <b>{percent}%</b>
      <span>
        <strong>{left ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : "0:00"}</strong>
        <small>{left ? `qoldi · ${end} gacha` : "Ish vaqti tugadi — ketishni belgilang"}</small>
      </span>
    </div>
  );
}

/**
 * Geofence: Mini App ochiq bo‘lsa va xodim hali kelmagan bo‘lsa, filialga yaqinlashganini
 * sezib «Ishga keldingizmi?» taklifini ko‘rsatadi. Faqat joylashuvga oldin ruxsat
 * berilgan bo‘lsa ishlaydi (yangi ruxsat so‘ramaydi) va kam quvvatli rejimda.
 */
function useGeofence(enabled: boolean, data: HomeData) {
  const [near, setNear] = useState<number | null>(null);
  const branch = data.branch;
  const day = todayPlanOf(data);
  useEffect(() => {
    setNear(null);
    if (!enabled || !branch || !day?.enabled) return;
    // Faqat ish boshlanishidan 90 daqiqa oldin — tugashigacha.
    const now = toMinutes(tashkentClock());
    if (now < toMinutes(day.start) - 90 || now > toMinutes(day.end)) return;
    let notified = false;
    let alive = true;
    // Ruxsat so‘ramaydigan joylashuv (allaqachon berilgan bo‘lsa) — har 45 soniyada.
    const check = async () => {
      const position = await quietPosition();
      if (!alive || !position) return;
      const distance = Math.round(haversineDistance(position.coords.latitude, position.coords.longitude, branch.latitude, branch.longitude));
      const inside = distance - Math.min(35, position.coords.accuracy) <= branch.radiusMeters + 40;
      setNear(inside ? distance : null);
      if (inside && !notified) {
        notified = true;
        haptic.success();
      }
    };
    void check();
    const timer = window.setInterval(() => document.visibilityState === "visible" && void check(), 45_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [enabled, branch, day?.enabled, day?.start, day?.end]);
  return near;
}

/* ------------------------------------------------------------ tanaffus --- */
function BreakCard({ data, now, onChanged, onToast }: { data: HomeData; now: Date; onChanged: () => Promise<void>; onToast: Toast }) {
  const [busy, setBusy] = useState(false);
  const breaks = data.attendance?.breaks || [];
  const open = breaks.find((b) => !b.end);
  const total = breakMinutes(breaks, tashkentClock(now));
  const planned = data.schedule?.days.find((d) => d.day === tashkentWeekday())?.breakMinutes || 0;
  async function toggle() {
    setBusy(true);
    try {
      await post("/mini/break", { action: open ? "end" : "start" });
      haptic.success();
      onToast(open ? "Tanaffus yakunlandi" : "Tanaffus boshlandi — yoqimli ishtaha!");
      await onChanged();
    } catch (reason) {
      onToast(errorText(reason), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={`mh-break ${open ? "on" : ""}`}>
      <span className="mini-ico">
        <Coffee size={18} />
      </span>
      <span>
        <b>{open ? `Tanaffusda · ${open.start} dan` : "Tanaffus"}</b>
        <small>
          Bugun: {total} daq{planned ? ` / ${planned} daq` : ""}
        </small>
      </span>
      <button className={`mini-btn sm ${open ? "" : "soft"}`} disabled={busy} onClick={() => void toggle()}>
        {busy ? <LoaderCircle size={15} className="spin" /> : null}
        {open ? "Qaytdim" : "Boshlash"}
      </button>
    </section>
  );
}

/* ----------------------------------------------------------- kechikaman --- */
function LateSheet({ start, name, onClose, onSaved }: { start: string; name: string; onClose: () => void; onSaved: (sent: boolean) => void }) {
  const [minutes, setMinutes] = useState(15);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const presets = ["Tirbandlik", "Transport kechikdi", "Shifokorda", "Oilaviy sabab"];
  async function save() {
    if (reason.trim().length < 3) return setError("Sababni qisqacha yozing.");
    setBusy(true);
    setError("");
    try {
      const result = await post<{ managersNotified: number }>("/mini/late-notice", { minutes, reason: reason.trim() });
      onSaved(result.managersNotified > 0);
    } catch (reason) {
      setError(errorText(reason, "Yuborilmadi."));
      haptic.error();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      title="Kechikaman"
      subtitle={start ? `Ish ${start} da boshlanadi · rahbaringizga xabar boradi` : "Rahbaringizga xabar boradi"}
      onClose={onClose}
      primary={{ text: `~${minutes} daqiqaga kechikaman`, onClick: () => void save(), busy, disabled: reason.trim().length < 3 }}
      secondary={{
        text: "Hamkasbga ulashish",
        onClick: () => void shareText("Kechikaman", `⏳ ${name}: ishga ~${minutes} daqiqa kechikaman.${reason.trim() ? ` Sabab: ${reason.trim()}` : ""}`),
      }}
    >
      <div className="ml-minutes" role="radiogroup" aria-label="Necha daqiqa">
        {[5, 10, 15, 30, 45, 60, 90].map((value) => (
          <button
            key={value}
            role="radio"
            aria-checked={minutes === value}
            className={minutes === value ? "on" : ""}
            onClick={() => {
              haptic.select();
              setMinutes(value);
            }}
          >
            {value < 60 ? `${value} daq` : `${value / 60} soat`.replace("1.5", "1,5")}
          </button>
        ))}
      </div>
      <div className="ms-chips">
        {presets.map((text) => (
          <button type="button" key={text} onClick={() => setReason(text)}>
            {text}
          </button>
        ))}
      </div>
      <label className="ml-field">
        Sabab
        <textarea value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Masalan: avtobus kechikdi" />
      </label>
      {error && (
        <div className="mini-alert">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}
      <p className="mp-note">Ogohlantirish kechikishni bekor qilmaydi, lekin rahbaringiz vaziyatdan xabardor bo‘ladi.</p>
    </Sheet>
  );
}
