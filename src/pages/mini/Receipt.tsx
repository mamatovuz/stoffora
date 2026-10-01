import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, Flame, MapPin, Share2, Timer } from "lucide-react";
import { api } from "../../api";
import { dateLongUz, duration } from "@/lib/format";
import type { Attendance } from "@/lib/types";
import { clearCached, setCached } from "../miniCache";
import { haptic, shareText, useMainButton } from "./tg";

/*
 * Davomat natijasi — to‘liq ekranli «chek»: vaqt, kechikish, ishlangan vaqt,
 * seriya. Yangi rekord bo‘lsa — konfetti. Telegram pastki tugmasi bilan yopiladi.
 */

type Stats = { streak: { current: number; best: number; badge: { emoji: string; label: string } | null } };

export function Receipt({
  row,
  action,
  branch,
  name,
  plannedEnd,
  method,
  onClose,
}: {
  row: Attendance;
  action: "CHECK_IN" | "CHECK_OUT";
  branch?: string;
  name: string;
  plannedEnd?: string;
  method: "FACE" | "BIOMETRIC";
  onClose: () => void;
}) {
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    clearCached("stats");
    void api<Stats>("/mini/stats")
      .then((value) => {
        setCached("stats-mini", value);
        setStats(value);
        // Vaqtida kelib, rekordni yangilasa — konfetti va kuchli tebranish.
        if (action === "CHECK_IN" && !row.lateMinutes && value.streak.current >= 3 && value.streak.current >= value.streak.best) haptic.success();
      })
      .catch(() => undefined);
  }, [action, row.lateMinutes]);
  const late = action === "CHECK_IN" && row.lateMinutes > 0;
  const record = Boolean(stats && action === "CHECK_IN" && !late && stats.streak.current >= 3 && stats.streak.current >= stats.streak.best);
  const time = action === "CHECK_IN" ? row.checkIn : row.checkOut;
  useMainButton({ text: "Yaxshi", onClick: onClose });

  const share = () =>
    void shareText(
      action === "CHECK_IN" ? "Ishdaman" : "Ish kuni yakunlandi",
      action === "CHECK_IN"
        ? `✅ ${name}: ishga ${time} da keldim${late ? "" : " — vaqtida"}${stats?.streak.current ? ` · 🔥 ${stats.streak.current} kun ketma-ket` : ""}`
        : `🏁 ${name}: ish kuni ${time} da yakunlandi · ${duration(row.workedMinutes)}`,
    );

  return (
    <div className={`rc-layer ${late ? "late" : action === "CHECK_OUT" ? "out" : "ok"}`} role="dialog" aria-modal="true" aria-label="Davomat natijasi">
      {record && <Confetti />}
      <div className="rc-card">
        <span className="rc-check">
          <CheckCircle2 size={44} strokeWidth={2.2} />
        </span>
        <small className="rc-kicker">{action === "CHECK_IN" ? "Ishga kelish qayd etildi" : "Ishdan ketish qayd etildi"}</small>
        <b className="rc-time">{time}</b>
        <span className="rc-date">{dateLongUz(row.date)}</span>
        <div className={`rc-badge ${late ? "warn" : "ok"}`}>
          {action === "CHECK_IN" ? (late ? `${row.lateMinutes} daqiqa kechikish` : "Vaqtida! 👏") : `Ishlangan vaqt: ${duration(row.workedMinutes)}`}
        </div>
        <div className="rc-lines">
          {branch && (
            <span>
              <MapPin size={15} /> {branch}
              {typeof row.distanceMeters === "number" ? ` · ${row.distanceMeters} m` : ""}
            </span>
          )}
          {action === "CHECK_IN" && plannedEnd && (
            <span>
              <Clock3 size={15} /> Ish {plannedEnd} da tugaydi
            </span>
          )}
          {action === "CHECK_OUT" && row.overtimeMinutes > 0 && (
            <span>
              <Timer size={15} /> Qo‘shimcha ish: {row.overtimeMinutes} daq
            </span>
          )}
          <span>
            <CheckCircle2 size={15} /> {method === "BIOMETRIC" ? "Biometriya" : "Face ID"} · GPS{row.verification.includes("QR") ? " · QR" : ""}
          </span>
        </div>
        {stats && stats.streak.current > 0 && action === "CHECK_IN" && (
          <div className={`rc-streak ${record ? "record" : ""}`}>
            <Flame size={18} />
            <span>
              <b>{stats.streak.current} kun ketma-ket vaqtida</b>
              <small>{record ? "Yangi rekord! 🎉" : `Rekord: ${stats.streak.best} kun`}</small>
            </span>
            {stats.streak.badge && <em>{stats.streak.badge.emoji}</em>}
          </div>
        )}
        <div className="rc-actions">
          <button className="mini-btn ghost-neutral" onClick={share}>
            <Share2 size={16} /> Ulashish
          </button>
          {!window.Telegram?.WebApp?.initData && (
            <button className="mini-btn" onClick={onClose}>
              Yaxshi
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const COLORS = ["#f59e0b", "#10b981", "#3b82f6", "#ef4444", "#8b5cf6", "#ec4899"];
/** Yengil CSS konfetti (kutubxonasiz). */
function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 48 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.6,
        duration: 1.8 + Math.random() * 1.4,
        rotate: Math.random() * 360,
        color: COLORS[i % COLORS.length],
        size: 6 + Math.random() * 6,
      })),
    [],
  );
  return (
    <div className="rc-confetti" aria-hidden>
      {pieces.map((p, i) => (
        <i
          key={i}
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size * 0.45,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            transform: `rotate(${p.rotate}deg)`,
          }}
        />
      ))}
    </div>
  );
}
