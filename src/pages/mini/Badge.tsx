import { useCallback, useEffect, useState } from "react";
import { IdCard, RefreshCw } from "lucide-react";
import { api } from "../../api";
import { Sheet, SkeletonList } from "./shared";

/*
 * Raqamli ID (QR guvohnoma): 2 daqiqalik imzolangan QR — qo‘riqchi / rahbar skaner qiladi.
 */

type Badge = { qr: string; expiresAt: string; company: string; employee: { name: string; employeeNo: string; photoDataUrl?: string; position: string; branch: string; startDate: string } };

export function BadgeSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="Mening ID" subtitle="Raqamli guvohnoma" onClose={onClose}>
      <BadgeCard />
    </Sheet>
  );
}

function BadgeCard() {
  const [b, setB] = useState<Badge | null>(null);
  const [left, setLeft] = useState(0);
  const load = useCallback(() => {
    void api<Badge>("/mini/badge")
      .then(setB)
      .catch(() => setB(null));
  }, []);
  useEffect(load, [load]);
  // QR 2 daqiqa amal qiladi — tugashidan oldin o‘zi yangilanadi.
  useEffect(() => {
    if (!b) return;
    const tick = () => {
      const s = Math.max(0, Math.round((Date.parse(b.expiresAt) - Date.now()) / 1000));
      setLeft(s);
      if (s <= 5) load();
    };
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [b, load]);
  if (!b) return <SkeletonList rows={3} />;
  return (
    <section className="mini-card ln-badge">
      <div className="ln-badge-top">
        <IdCard size={16} /> {b.company}
      </div>
      <div className="ln-badge-person">
        {b.employee.photoDataUrl ? <img src={b.employee.photoDataUrl} alt="" /> : <span className="ln-badge-ph">{b.employee.name.slice(0, 1)}</span>}
        <span>
          <b>{b.employee.name}</b>
          <small>{b.employee.position}</small>
          <small>
            {b.employee.branch} · {b.employee.employeeNo}
          </small>
        </span>
      </div>
      <img className="ln-qr" src={b.qr} alt="Xodim QR kodi" />
      <small className="ln-timer">
        <RefreshCw size={12} /> QR {left} soniyadan keyin yangilanadi — skrinshot ishlamaydi
      </small>
    </section>
  );
}
