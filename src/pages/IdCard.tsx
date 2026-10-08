import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { BadgeCheck, BriefcaseBusiness, Building2, CalendarDays, Clock3, Hash, Network, ShieldAlert } from "lucide-react";
import { Logo } from "../components/Logo";

/*
 * Ochiq ID karta — xodimning «Mening ID» QR kodini istalgan kamera/skaner ochsa shu sahifa
 * chiqadi. Faqat ochiq ma’lumot: rasm, F.I.Sh, lavozim, bo‘lim, filial, kompaniya, xodim
 * raqami, ishga kirgan sana. JSHSHIR, pasport, telefon, manzil, maosh ko‘rsatilmaydi.
 */

type Card = {
  valid: boolean;
  checkedAt: string;
  company: { name: string };
  employee: {
    name: string;
    employeeNo: string;
    photoDataUrl?: string;
    position: string;
    department: string;
    branch: string;
    startDate?: string;
    years: number;
    status: string;
  };
  today: { checkIn?: string; checkOut?: string } | null;
};

const dmy = (iso?: string) => (iso ? iso.slice(0, 10).split("-").reverse().join(".") : "—");
const clock = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { timeZone: "Asia/Tashkent", hour: "2-digit", minute: "2-digit" });

export function IdCardPage() {
  const { token = "" } = useParams();
  const [card, setCard] = useState<Card | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    document.title = "ID karta · Staffora";
    fetch(`/api/public/badge/${encodeURIComponent(token)}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.message || "Kartani tekshirib bo‘lmadi");
        setCard(body as Card);
      })
      .catch((e: Error) => setError(e.message));
  }, [token]);

  const e = card?.employee;
  const initials = e ? e.name.split(" ").slice(0, 2).map((w) => w[0]).join("") : "";
  return (
    <div className="idc-page">
      <div className="idc-wrap">
        {error ? (
          <div className="idc-card idc-error">
            <ShieldAlert size={36} />
            <b>{error}</b>
            <p>Xodim ilovada «Mening ID» ni qayta ochib, yangi QR kodni ko‘rsatsin. QR kod 2 daqiqa amal qiladi.</p>
          </div>
        ) : !card || !e ? (
          <div className="idc-card idc-loading">
            <div className="screen-loader"><span /></div>
          </div>
        ) : (
          <div className={`idc-card ${card.valid ? "" : "invalid"}`}>
            <div className="idc-head">
              <span>{card.company.name || "Staffora"}</span>
              <small>Xodim guvohnomasi</small>
            </div>
            <div className="idc-body">
              {e.photoDataUrl ? <img className="idc-photo" src={e.photoDataUrl} alt="" /> : <div className="idc-photo idc-initials">{initials}</div>}
              <h1>{e.name}</h1>
              <p className="idc-role">{e.position || "Xodim"}</p>
              <div className={`idc-status ${card.valid ? "ok" : "bad"}`}>
                {card.valid ? <BadgeCheck size={18} /> : <ShieldAlert size={18} />}
                {card.valid ? "Haqiqiy · faol xodim" : "Faol emas — ishdan bo‘shagan"}
              </div>
            </div>
            <dl className="idc-list">
              <div>
                <dt>
                  <Hash size={15} /> Xodim raqami
                </dt>
                <dd>{e.employeeNo || "—"}</dd>
              </div>
              <div>
                <dt>
                  <Network size={15} /> Bo‘lim
                </dt>
                <dd>{e.department || "—"}</dd>
              </div>
              <div>
                <dt>
                  <BriefcaseBusiness size={15} /> Lavozim
                </dt>
                <dd>{e.position || "—"}</dd>
              </div>
              <div>
                <dt>
                  <Building2 size={15} /> Filial
                </dt>
                <dd>{e.branch || "—"}</dd>
              </div>
              <div>
                <dt>
                  <CalendarDays size={15} /> Ishga kirgan
                </dt>
                <dd>
                  {dmy(e.startDate)}
                  {e.years ? ` · ${e.years} yil` : ""}
                </dd>
              </div>
              {card.valid && (
                <div>
                  <dt>
                    <Clock3 size={15} /> Bugun
                  </dt>
                  <dd>{card.today?.checkIn ? (card.today.checkOut ? `${card.today.checkIn} – ${card.today.checkOut} ishladi` : `${card.today.checkIn} dan ishda`) : "hali kelmagan"}</dd>
                </div>
              )}
            </dl>
            <div className="idc-foot">Tekshirildi: {clock(card.checkedAt)} · Staffora orqali tasdiqlangan</div>
          </div>
        )}
        <div className="idc-brand">
          <Logo compact />
        </div>
      </div>
    </div>
  );
}
