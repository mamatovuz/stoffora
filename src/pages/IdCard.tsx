import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Check, RefreshCw, X } from "lucide-react";
import { Logo } from "../components/Logo";

/*
 * Ochiq ID karta — xodimning «Mening ID» QR kodini istalgan kamera/skaner ochsa shu sahifa
 * chiqadi. Faqat ochiq ma’lumot: rasm, F.I.Sh, lavozim, bo‘lim, filial, kompaniya, xodim
 * raqami, ishga kirgan sana. JSHSHIR, pasport, telefon, manzil, maosh ko‘rsatilmaydi.
 *
 * Dizayn: qo‘riqchi bir qarashda natijani ko‘rishi uchun tepada katta holat chizig‘i,
 * pastda hujjat ko‘rinishidagi karta (pasport nisbatidagi rasm, mayda bosh harfli yorliqlar).
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
const stamp = (iso: string) => {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("ru-RU", { timeZone: "Asia/Tashkent", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const date = d.toLocaleDateString("ru-RU", { timeZone: "Asia/Tashkent" });
  return { time, date };
};
const tenure = (years: number) => (years >= 1 ? `${years} yil` : "1 yildan kam");

export function IdCardPage() {
  const { token = "" } = useParams();
  const [card, setCard] = useState<Card | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    document.title = "Guvohnomani tekshirish · Staffora";
    setCard(null);
    setError("");
    fetch(`/api/public/badge/${encodeURIComponent(token)}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.message || "Kartani tekshirib bo‘lmadi");
        setCard(body as Card);
      })
      .catch((e: Error) => setError(e.message));
  }, [token]);

  if (error)
    return (
      <main className="idv idv-bad">
        <header className="idv-verdict">
          <span className="idv-mark">
            <X size={30} strokeWidth={3} />
          </span>
          <div>
            <b>Tasdiqlanmadi</b>
            <small>{error}</small>
          </div>
        </header>
        <section className="idv-help">
          <h2>Nima qilish kerak?</h2>
          <ol>
            <li>Xodim Staffora ilovasida «Mening ID» bo‘limini qayta ochsin.</li>
            <li>Ekrandagi yangi QR kodni qayta skanerlang — kod 2 daqiqa amal qiladi.</li>
            <li>Skrinshot yoki chop etilgan QR qabul qilinmaydi.</li>
          </ol>
        </section>
        <Brand />
      </main>
    );

  if (!card)
    return (
      <main className="idv idv-wait">
        <header className="idv-verdict">
          <span className="idv-mark">
            <RefreshCw size={24} className="spin" />
          </span>
          <div>
            <b>Tekshirilmoqda…</b>
            <small>Ma’lumot Staffora tizimidan olinmoqda</small>
          </div>
        </header>
      </main>
    );

  const e = card.employee;
  const checked = stamp(card.checkedAt);
  const initials = e.name.split(" ").slice(0, 2).map((w) => w[0]).join("");
  const today = card.today?.checkIn
    ? card.today.checkOut
      ? { tone: "off", text: `Ishni tugatgan · ${card.today.checkIn}–${card.today.checkOut}` }
      : { tone: "on", text: `Hozir ishda · ${card.today.checkIn} dan` }
    : { tone: "off", text: "Bugun hali kelmagan" };

  return (
    <main className={`idv ${card.valid ? "idv-ok" : "idv-bad"}`}>
      <header className="idv-verdict">
        <span className="idv-mark">{card.valid ? <Check size={30} strokeWidth={3} /> : <X size={30} strokeWidth={3} />}</span>
        <div>
          <b>{card.valid ? "Tasdiqlandi" : "Yaroqsiz"}</b>
          <small>{card.valid ? "Faol xodim · guvohnoma haqiqiy" : "Xodim faol emas — ishdan bo‘shagan"}</small>
        </div>
        <time dateTime={card.checkedAt}>
          {checked.time}
          <small>{checked.date}</small>
        </time>
      </header>

      <article className="idv-card" aria-label="Xodim guvohnomasi">
        <div className="idv-top">
          <span>{card.company.name || "Staffora"}</span>
          <small>Xodim guvohnomasi</small>
        </div>
        <div className="idv-main">
          <div className="idv-photo">{e.photoDataUrl ? <img src={e.photoDataUrl} alt={e.name} /> : <span>{initials}</span>}</div>
          <div className="idv-who">
            <small>Familiya, ism</small>
            <h1>{e.name}</h1>
            <small>Lavozim</small>
            <p>{e.position || "Xodim"}</p>
            <small>Tabel raqami</small>
            <p className="idv-no">{e.employeeNo || "—"}</p>
          </div>
        </div>
        <dl className="idv-grid">
          <div>
            <dt>Bo‘lim</dt>
            <dd>{e.department || "—"}</dd>
          </div>
          <div>
            <dt>Filial</dt>
            <dd>{e.branch || "—"}</dd>
          </div>
          <div>
            <dt>Ishga kirgan</dt>
            <dd>{dmy(e.startDate)}</dd>
          </div>
          <div>
            <dt>Staj</dt>
            <dd>{tenure(e.years)}</dd>
          </div>
        </dl>
        {card.valid && (
          <div className={`idv-today ${today.tone}`}>
            <i />
            {today.text}
          </div>
        )}
      </article>

      <p className="idv-note">
        Ma’lumot {checked.time} da Staffora tizimidan to‘g‘ridan-to‘g‘ri olindi. QR kod har 2 daqiqada yangilanadi — skrinshot bilan soxtalashtirib bo‘lmaydi.
      </p>
      <Brand />
    </main>
  );
}

function Brand() {
  return (
    <footer className="idv-brand">
      <Logo compact />
    </footer>
  );
}
