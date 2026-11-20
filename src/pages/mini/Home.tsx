import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Coffee, Fingerprint, LoaderCircle, LogOut, MapPin, ScanFace } from "lucide-react";
import { preloadFaceModels } from "../../components/FaceScanner";
import { prewarmCamera } from "./FaceCheck";
import { errorText, post } from "../../api";
import { dateLongUz, duration, tashkentClock, tashkentWeekday } from "@/lib/format";
import { breakMinutes } from "@/lib/mini";
import { SalaryCard } from "../MiniMoney";
import { clockDuration, todayPlanOf, useMinuteClock, type Action, type HomeData, type Toast } from "./shared";
import { haptic } from "./tg";
import { elapsedMinutes, forwardMinutes } from "@/lib/shift-time";

/*
 * Bosh sahifa — faqat eng kerakli: bugungi holat, «Ishga keldim / Ishdan ketdim» va oylik.
 * Qolgan hamma bo‘limlar pastki menyudagi «Bo‘limlar»da.
 */

/** Kelgandan beri (kechki smenada yarim tundan o‘tsa ham; erta kelganda — 0, «23:38» emas). */
function minutesSince(checkIn: string) {
  return elapsedMinutes(checkIn, tashkentClock());
}

export function MiniHome({
  data,
  stale,
  offline,
  quick,
  onAction,
  onSalary,
  onRefresh,
  onToast,
}: {
  data: HomeData;
  stale: boolean;
  offline?: boolean;
  /** Biometriya ulangan: tugmada barmoq izi belgisi. */
  quick?: "finger" | "face" | null;
  onSalary: () => void;
  onAction: (action: Action) => void;
  onRefresh: () => Promise<void>;
  onToast: Toast;
}) {
  // Hammasi soat:daqiqa aniqligida — daqiqada bir marta yangilash yetarli.
  const now = useMinuteClock();
  const a = data.attendance;
  const working = Boolean(a?.checkIn && !a.checkOut);
  const finished = Boolean(a?.checkOut);
  const day = todayPlanOf(data);
  const clock = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tashkent" });
  const missingSetup = !data.branch || !data.schedule;
  const openBreak = a?.breaks?.find((b) => !b.end);
  // «Kechikishni ishlab yopish»: ketgandan keyin qo‘shimcha ish bilan yopilgan daqiqalar kechikish emas.
  const late = a?.lateMinutes || 0;
  const lateLeft = Math.max(0, late - (a?.lateCoveredMinutes || 0));
  const status = finished
    ? { text: "Ish kuni yakunlandi", tone: "done" }
    : openBreak
      ? { text: "Tanaffusda", tone: "late" }
      : working
        ? { text: late ? `Ishdasiz · ${duration(late)} kech` : "Ishdasiz", tone: late ? "late" : "on" }
        : data.todayLeave
          ? { text: "Bugun ta’tildasiz", tone: "off" }
          : !day?.enabled
            ? { text: day?.overridden ? "Dam olish (ko‘chirilgan)" : "Dam olish kuni", tone: "off" }
            : { text: "Hali kelmagansiz", tone: "idle" };

  // Face ID modellari sahifa tinchlangach (bo‘sh vaqtda) yuklanadi — «Ishga keldim» bosilganda
  // kutish bo‘lmaydi. Trafik tejash rejimi yoki 2G’da — faqat bosilganda.
  const needsFace = !finished && !missingSetup && !offline && !quick && Boolean(data.employee.faceEnrolledAt);
  useEffect(() => {
    if (!needsFace) return;
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (connection?.saveData || /2g$/.test(connection?.effectiveType || "")) return;
    const idle = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    let idleId = 0;
    const timer = window.setTimeout(() => {
      const start = () => void preloadFaceModels().catch(() => undefined);
      if (idle.requestIdleCallback) idleId = idle.requestIdleCallback(start, { timeout: 5000 });
      else start();
    }, 1500);
    return () => {
      window.clearTimeout(timer);
      if (idleId) idle.cancelIdleCallback?.(idleId);
    };
  }, [needsFace]);

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
            {a?.checkIn && (
              <em className={lateLeft ? "late" : "ok"}>{lateLeft ? `${duration(lateLeft)} kech` : late ? "kechikish yopildi" : "vaqtida"}</em>
            )}
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
            <div className="mh-done off">Bugun ta’tildasiz — dam oling</div>
            <button className="mini-link" onClick={() => onAction("CHECK_IN")}>
              Baribir ishga keldim
            </button>
          </div>
        ) : (
          <button
            className={`mh-action ${working ? "out" : ""}`}
            disabled={stale || Boolean(openBreak)}
            // Barmoq tekkan zahoti model va kamera tayyorlana boshlaydi — oyna ochilganda tasvir tayyor turadi.
            onPointerDown={() => {
              void preloadFaceModels().catch(() => undefined);
              if (!quick && data.employee.faceEnrolledAt) prewarmCamera();
            }}
            onClick={() => onAction(working ? "CHECK_OUT" : "CHECK_IN")}
          >
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
      </section>

      {data.features?.breaks && working && <BreakCard data={data} now={now} onChanged={onRefresh} onToast={onToast} />}

      <SalaryCard onOpen={onSalary} offline={offline} />
    </div>
  );
}

/** Ish kuni halqasi: necha foiz o‘tgani va qancha qolgani. */
function ShiftProgress({ start, end, now }: { start: string; end: string; now: Date }) {
  // Kechki smena (14:00 → 00:00) ham: tugash ertasi kunda bo‘lishi mumkin.
  const total = Math.max(1, forwardMinutes(start, end));
  const done = Math.min(total, elapsedMinutes(start, tashkentClock(now)));
  const left = total - done;
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
          Bugun: {duration(total)}
          {planned ? ` / ${duration(planned)}` : ""}
        </small>
      </span>
      <button className={`mini-btn sm ${open ? "" : "soft"}`} disabled={busy} onClick={() => void toggle()}>
        {busy ? <LoaderCircle size={15} className="spin" /> : null}
        {open ? "Qaytdim" : "Boshlash"}
      </button>
    </section>
  );
}
