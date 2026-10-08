import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  Building2,
  CalendarClock,
  Check,
  Clock3,
  FileSpreadsheet,
  Fingerprint,
  Lock,
  MapPin,
  Menu,
  MoonStar,
  ScanFace,
  Send,
  ShieldCheck,
  Smartphone,
  UserX,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { Logo } from "../components/Logo";
import { appHref } from "../site";

/*
 * Ochiq sayt (landing). Asosiy domenda ochiladi; «Kirish» — panel domeniga (app.…).
 * «Demo so‘rash» formasi /api/public/lead ga yuboriladi (super admin panelida ko‘rinadi).
 */

const features = [
  { icon: ScanFace, title: "Face ID + GPS + QR", text: "Xodim filialda turib, yuzi bilan belgilaydi. Boshqa joydan yoki boshqa odam o‘rniga belgilash ishlamaydi." },
  { icon: MoonStar, title: "Kechki va tungi smenalar", text: "14:00 → 00:00, 22:00 → 06:00 — kechikish, erta ketish va qo‘shimcha ish to‘g‘ri hisoblanadi." },
  { icon: Banknote, title: "Tabel va ish haqi", text: "Oy oxirida tabel o‘zi tuziladi: kechikish, jarima, avans, bonus. HR → moliya → direktor tasdig‘i." },
  { icon: CalendarClock, title: "Ta’til va so‘rovlar", text: "Ta’til, javob, avans, qo‘shimcha ish — xodim telefondan so‘raydi, rahbar bir bosishda tasdiqlaydi." },
  { icon: Send, title: "Telegram Mini App", text: "Hech narsa o‘rnatmasdan: xodim ham, rahbar ham Telegram ichida ishlaydi. iOS va Android ilova ham bor." },
  { icon: FileSpreadsheet, title: "Hisobotlar va Excel", text: "Davomat, vedomost, bank uchun fayl — bir bosishda. Filial, bo‘lim va oy bo‘yicha." },
  { icon: BadgeCheck, title: "Raqamli ID karta", text: "Xodimning QR guvohnomasi: istalgan kamera skaner qilsa — rasmi, lavozimi, filiali chiqadi." },
  { icon: ShieldCheck, title: "Rollar va audit", text: "Direktor, HR, moliya, IT, filial rahbari — har kim faqat o‘z ishini ko‘radi. Har o‘zgarish jurnalda." },
];

const roles = [
  { title: "Direktor", points: ["Bugun kim keldi, kim kelmadi — jonli", "Oy bo‘yicha xarajat va prognoz", "Ish haqini tasdiqlash"] },
  { title: "HR", points: ["Xodim qo‘shish va bo‘shatish", "Grafiklar, ta’tillar, arizalar", "Davomatni tuzatish (sababi bilan)"] },
  { title: "Moliya", points: ["Tabel va vedomost", "Avans va jarimalar", "Bank uchun to‘lov fayli"] },
  { title: "Filial rahbari", points: ["O‘z filiali davomati", "So‘rovlarni tasdiqlash", "Telefondan, Telegram ichida"] },
  { title: "Xodim", points: ["Bir bosishda «Keldim / Ketdim»", "Oyligi va kechikishlari", "Ta’til va avans so‘rash"] },
];

const steps = [
  { title: "Filial va grafik", text: "Filial manzilini xaritada belgilang, ish vaqtini kiriting — 5 daqiqa." },
  { title: "Xodimlarni qo‘shing", text: "Telefon raqami bilan yoki ro‘yxatdan o‘tish boti orqali — xodimlar o‘zlari ulanadi." },
  { title: "Ishlay boshlang", text: "Davomat, tabel va hisobotlar o‘zi yig‘iladi. Siz faqat qaror qabul qilasiz." },
];

/** «Aldab bo‘lmaydi»: kodda haqiqatan ishlaydigan tekshiruvlar (server/mobile.ts, lib/face.ts, lib/gps.ts). */
const guards = [
  { icon: ScanFace, title: "Jonli Face ID", text: "Bir necha kadr olinadi: rasm yoki ekrandagi surat qabul qilinmaydi, takroriy so‘rov rad etiladi." },
  { icon: UserX, title: "Boshqa odam o‘rniga emas", text: "Yuz kompaniyadagi barcha xodimlar bilan solishtiriladi. O‘xshash odam belgilamoqchi bo‘lsa — HR’ga xabar boradi." },
  { icon: MapPin, title: "Filial radiusi", text: "GPS filial atrofidagi radiusni tekshiradi. Uydan yoki yo‘ldan «keldim» bosib bo‘lmaydi." },
  { icon: Fingerprint, title: "Telefon kaliti", text: "Ilova har telefonda o‘z kalitini yaratadi. Kirish faqat Telegram’dan olingan bir martalik kod bilan." },
];

const compare = [
  ["Davomat", "Qog‘oz jurnal, kimdir o‘rniga yozib qo‘yadi", "Face ID + GPS, belgilash soniyalarda"],
  ["Kechikishlar", "Hech kim sanamaydi", "Har daqiqasi avtomatik hisoblanadi"],
  ["Tabel", "Oy oxirida 2–3 kun Excel", "Bir bosishda tayyor, Excel’ga eksport"],
  ["Ish haqi", "Qo‘lda: jarima, avans, bonus", "Hammasi hisobga olingan vedomost"],
  ["So‘rovlar", "Guruhdagi xabarlar yo‘qolib ketadi", "Ta’til, avans — telefondan, tasdiq bir bosishda"],
] as const;

const faq = [
  ["Xodimlarga qimmat telefon kerakmi?", "Yo‘q. Oddiy Android yoki iPhone, Telegram bo‘lsa yetarli. Ilova ixtiyoriy."],
  ["Internet yo‘q bo‘lsa-chi?", "Ilova belgilashni saqlab qo‘yadi va internet qaytganda yuboradi — vaqt to‘g‘ri yoziladi."],
  ["Bir nechta filial bo‘lsa?", "Har filialning o‘z manzili, radiusi va rahbari bo‘ladi. Xodim istalgan filialda belgilashi ham mumkin (ruxsat bersangiz)."],
  [
    "Xodim yangi telefon olsa-chi?",
    "Telegram Mini App → Profil → «Telefon ilovasi»dan kod oladi va yangi telefonda kiritadi — darhol ishlaydi, eski telefondan avtomatik chiqadi.",
  ],
  ["Ma’lumotlar xavfsizmi?", "Har bir rol faqat o‘ziga kerakli ma’lumotni ko‘radi, har bir o‘zgarish audit jurnaliga yoziladi, karta raqamlari shifrlangan."],
  ["Qancha vaqtda ishga tushadi?", "Odatda bir kunda: filial, grafik va xodimlarni qo‘shasiz — ertasiga davomat ishlaydi."],
];

/** Bo‘lim ko‘rinishga kirganda yumshoq paydo bo‘ladi (harakatni kamaytirish yoqilgan bo‘lsa — darhol). */
function Reveal({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return setShown(true);
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`ld-reveal ${shown ? "in" : ""} ${className}`} style={delay ? { transitionDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  );
}

export function LandingPage() {
  const [menu, setMenu] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    document.title = "Staffora — xodimlar davomati va ish haqi";
    document.documentElement.lang = "uz";
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const login = appHref("/login");
  const nav = [
    ["#imkoniyatlar", "Imkoniyatlar"],
    ["#xavfsizlik", "Xavfsizlik"],
    ["#rollar", "Kimlar uchun"],
    ["#qanday", "Qanday ishlaydi"],
    ["#savollar", "Savollar"],
  ];
  return (
    <div className="ld">
      <header className={`ld-nav ${scrolled ? "scrolled" : ""}`}>
        <div className="ld-container ld-nav-in">
          <a href="#top" className="ld-brand" aria-label="Staffora">
            <Logo />
          </a>
          <nav className={`ld-links ${menu ? "open" : ""}`} onClick={() => setMenu(false)}>
            {nav.map(([href, label]) => (
              <a key={href} href={href}>
                {label}
              </a>
            ))}
            <a className="ld-btn ghost ld-only-mobile" href={login}>
              Kirish
            </a>
          </nav>
          <div className="ld-nav-cta">
            <a className="ld-btn ghost ld-hide-mobile" href={login}>
              Kirish
            </a>
            <a className="ld-btn primary" href="#demo">
              Demo so‘rash
            </a>
            <button className="ld-burger" aria-label="Menyu" onClick={() => setMenu(!menu)}>
              {menu ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="ld-hero">
          <div className="ld-container ld-hero-in">
            <div className="ld-hero-copy">
              <span className="ld-pill">
                <i /> Telegram, ilova va veb — bitta tizim
              </span>
              <h1>
                Xodimlar davomati va ish haqi — <em>avtomatik</em>
              </h1>
              <p>
                Staffora kim qachon kelganini Face ID va GPS bilan aniqlaydi, oy oxirida tabel va ish haqini o‘zi hisoblaydi. Direktor, HR va moliya hammasini telefondan ko‘radi.
              </p>
              <div className="ld-hero-cta">
                <a className="ld-btn primary lg" href="#demo">
                  Demo so‘rash <ArrowRight size={18} />
                </a>
                <a className="ld-btn ghost lg" href={login}>
                  Panelga kirish
                </a>
              </div>
              <ul className="ld-ticks">
                <li>
                  <Check size={16} /> Bir kunda ishga tushadi
                </li>
                <li>
                  <Check size={16} /> Kechki smenalar to‘g‘ri hisoblanadi
                </li>
                <li>
                  <Check size={16} /> O‘zbek va rus tilida
                </li>
              </ul>
            </div>
            <HeroPreview />
          </div>
        </section>

        <section className="ld-strip">
          <div className="ld-container ld-strip-in">
            <span>
              <Send size={18} /> Telegram Mini App
            </span>
            <span>
              <Smartphone size={18} /> iOS va Android ilova
            </span>
            <span>
              <Building2 size={18} /> Ko‘p filial
            </span>
            <span>
              <Clock3 size={18} /> 24/7 smenalar
            </span>
          </div>
        </section>

        <section className="ld-section" id="imkoniyatlar">
          <div className="ld-container">
            <div className="ld-head">
              <h2>Kadrlar bo‘limining kundalik ishi — bitta joyda</h2>
              <p>Qog‘oz jurnal, Excel va guruhdagi xabarlar o‘rniga.</p>
            </div>
            <div className="ld-features">
              {features.map(({ icon: Icon, title, text }, i) => (
                <Reveal key={title} delay={(i % 4) * 70}>
                  <article className="ld-feature">
                    <span className="ld-ico">
                      <Icon size={22} />
                    </span>
                    <h3>{title}</h3>
                    <p>{text}</p>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="ld-section ld-dark" id="xavfsizlik">
          <div className="ld-container ld-guard">
            <div className="ld-guard-copy">
              <span className="ld-kicker">
                <Lock size={14} /> Xavfsizlik
              </span>
              <h2>Davomatni aldab bo‘lmaydi</h2>
              <p>Do‘stini o‘rniga belgilash, uydan «keldim» bosish, rasm ko‘rsatish — bularning hech biri ishlamaydi. Har urinish jurnalga yoziladi.</p>
              <div className="ld-guard-grid">
                {guards.map(({ icon: Icon, title, text }, i) => (
                  <Reveal key={title} delay={i * 80}>
                    <article className="ld-guard-item">
                      <Icon size={20} />
                      <div>
                        <h3>{title}</h3>
                        <p>{text}</p>
                      </div>
                    </article>
                  </Reveal>
                ))}
              </div>
            </div>
            <Reveal className="ld-guard-phone-wrap">
              <PhonePreview />
            </Reveal>
          </div>
        </section>

        <section className="ld-section" id="farq">
          <div className="ld-container">
            <div className="ld-head">
              <h2>Oldin va Staffora bilan</h2>
              <p>Bir oyda kadrlar bo‘limi o‘nlab soat vaqtini qaytarib oladi.</p>
            </div>
            <Reveal>
              <div className="ld-compare" role="table" aria-label="Taqqoslash">
                <div className="ld-compare-row head" role="row">
                  <span role="columnheader" />
                  <span role="columnheader">Oldin</span>
                  <span role="columnheader">Staffora bilan</span>
                </div>
                {compare.map(([topic, before, after]) => (
                  <div className="ld-compare-row" role="row" key={topic}>
                    <b role="cell">{topic}</b>
                    <span role="cell" className="before">
                      <XCircle size={16} /> {before}
                    </span>
                    <span role="cell" className="after">
                      <Check size={16} /> {after}
                    </span>
                  </div>
                ))}
              </div>
            </Reveal>
          </div>
        </section>

        <section className="ld-section alt" id="rollar">
          <div className="ld-container">
            <div className="ld-head">
              <h2>Har kim o‘z ishini ko‘radi</h2>
              <p>Saytda nima qilsa — Telegram va ilovada ham xuddi shuni qiladi.</p>
            </div>
            <div className="ld-roles">
              {roles.map((role, i) => (
                <Reveal key={role.title} delay={i * 60}>
                  <article className="ld-role">
                    <h3>
                      <Users size={18} /> {role.title}
                    </h3>
                    <ul>
                      {role.points.map((p) => (
                        <li key={p}>
                          <Check size={15} /> {p}
                        </li>
                      ))}
                    </ul>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="ld-section" id="qanday">
          <div className="ld-container">
            <div className="ld-head">
              <h2>Uch qadamda ishga tushiring</h2>
            </div>
            <ol className="ld-steps">
              {steps.map((step, i) => (
                <li key={step.title}>
                  <Reveal delay={i * 90}>
                    <span>{i + 1}</span>
                    <h3>{step.title}</h3>
                    <p>{step.text}</p>
                  </Reveal>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="ld-section alt" id="savollar">
          <div className="ld-container ld-faq-wrap">
            <div className="ld-head left">
              <h2>Ko‘p so‘raladigan savollar</h2>
              <p>Javob topmadingizmi? Demo so‘rang — qo‘ng‘iroq qilib tushuntiramiz.</p>
            </div>
            <div className="ld-faq">
              {faq.map(([q, a]) => (
                <details key={q}>
                  <summary>{q}</summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="ld-section" id="demo">
          <div className="ld-container">
            <DemoForm />
          </div>
        </section>
      </main>

      <footer className="ld-footer">
        <div className="ld-container ld-footer-grid">
          <div className="ld-footer-brand">
            <Logo />
            <p>Xodimlar davomati, tabel va ish haqi — Telegram, ilova va vebda.</p>
          </div>
          <nav aria-label="Sayt">
            <b>Sayt</b>
            {nav.map(([href, label]) => (
              <a key={href} href={href}>
                {label}
              </a>
            ))}
          </nav>
          <nav aria-label="Hisob">
            <b>Hisob</b>
            <a href={login}>Panelga kirish</a>
            <a href="#demo">Demo so‘rash</a>
            <a href="/privacy.html">Maxfiylik siyosati</a>
            <a href="/delete-account.html">Hisobni o‘chirish</a>
          </nav>
        </div>
        <div className="ld-container ld-footer-in">
          <span>© {new Date().getFullYear()} Staffora</span>
          <span>O‘zbekistonda ishlab chiqilgan</span>
        </div>
      </footer>
      <a className={`ld-sticky-cta ${scrolled ? "show" : ""}`} href="#demo">
        Demo so‘rash <ArrowRight size={16} />
      </a>
    </div>
  );
}

/** Hero’dagi panel ko‘rinishi (rasm emas — yengil HTML). */
function HeroPreview() {
  const rows = [
    ["Aziza Karimova", "08:56", "ishda", "ok"],
    ["Jasur Toshmatov", "09:14", "14 daq kech", "warn"],
    ["Dilnoza Rahimova", "13:58", "kechki smena", "ok"],
    ["Bekzod Aliyev", "—", "kelmagan", "bad"],
  ] as const;
  return (
    <div className="ld-preview-wrap" aria-hidden="true">
      <div className="ld-float-card">
        <span className="ld-float-ico">
          <ScanFace size={18} />
        </span>
        <span>
          <b>Keldim · 08:56</b>
          <small>Face ID 98% · Chilonzor filiali</small>
        </span>
        <Check size={18} className="ok" />
      </div>
      <div className="ld-preview">
        <div className="ld-preview-top">
          <span />
          <span />
          <span />
          <b>Bugun · jonli</b>
        </div>
        <div className="ld-preview-body">
          <div className="ld-preview-big">
            <small>Keldi</small>
            <b>
              42 <span>/ 45</span>
            </b>
            <div className="ld-preview-bar">
              <i style={{ width: "80%" }} />
              <i style={{ width: "13%" }} className="warn" />
              <i style={{ width: "7%" }} className="bad" />
            </div>
          </div>
          <div className="ld-preview-stats">
            <div>
              <small>Ishda</small>
              <b>38</b>
            </div>
            <div>
              <small>Kechikdi</small>
              <b className="warn">6</b>
            </div>
            <div>
              <small>Kelmadi</small>
              <b className="bad">3</b>
            </div>
          </div>
          <ul className="ld-preview-list">
            {rows.map(([name, time, state, tone]) => (
              <li key={name}>
                <span className="ld-av">{name[0]}</span>
                <span>
                  <b>{name}</b>
                  <small>{time}</small>
                </span>
                <em className={tone}>{state}</em>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** Xodim telefonidagi belgilash ekrani (yengil HTML). */
function PhonePreview() {
  return (
    <div className="ld-phone" aria-hidden="true">
      <div className="ld-phone-notch" />
      <div className="ld-phone-screen">
        <small className="ld-phone-time">08:56</small>
        <b className="ld-phone-hi">Xayrli tong, Aziza</b>
        <small className="ld-phone-sub">Ish 09:00 da boshlanadi</small>
        <div className="ld-phone-face">
          <div className="ld-phone-ring" />
          <ScanFace size={54} />
        </div>
        <div className="ld-phone-checks">
          <span>
            <Check size={14} /> Yuz mos keldi · 98%
          </span>
          <span>
            <Check size={14} /> Filial radiusida · 24 m
          </span>
          <span>
            <Check size={14} /> Jonli kadr
          </span>
        </div>
        <div className="ld-phone-btn">Keldim</div>
      </div>
    </div>
  );
}

function DemoForm() {
  const [form, setForm] = useState({ name: "", company: "", phone: "+998 ", employees: "", message: "", website: "" });
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState("");
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setState("sending");
    setError("");
    try {
      const r = await fetch("/api/public/lead", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.message || "Yuborib bo‘lmadi. Qayta urinib ko‘ring.");
      setState("done");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Yuborib bo‘lmadi.");
      setState("idle");
    }
  }
  return (
    <div className="ld-demo">
      <div className="ld-demo-copy">
        <h2>Demo so‘rang</h2>
        <p>Raqamingizni qoldiring — mutaxassisimiz qo‘ng‘iroq qiladi, tizimni sizning korxonangiz misolida ko‘rsatadi va sozlab beradi.</p>
        <ul className="ld-ticks col">
          <li>
            <Check size={16} /> 20 daqiqalik onlayn ko‘rsatuv
          </li>
          <li>
            <Check size={16} /> Filial va grafiklarni birga sozlaymiz
          </li>
          <li>
            <Check size={16} /> Hech qanday majburiyat yo‘q
          </li>
        </ul>
      </div>
      {state === "done" ? (
        <div className="ld-form ld-done">
          <BadgeCheck size={40} />
          <h3>Rahmat! So‘rovingiz qabul qilindi</h3>
          <p>Ish vaqtida tez orada qo‘ng‘iroq qilamiz.</p>
        </div>
      ) : (
        <form className="ld-form" onSubmit={submit}>
          <label>
            Ismingiz
            <input value={form.name} onChange={(e) => set({ name: e.target.value })} required minLength={2} maxLength={80} autoComplete="name" />
          </label>
          <label>
            Kompaniya
            <input value={form.company} onChange={(e) => set({ company: e.target.value })} required minLength={2} maxLength={120} autoComplete="organization" />
          </label>
          <div className="ld-form-row">
            <label>
              Telefon
              <input value={form.phone} onChange={(e) => set({ phone: e.target.value })} required inputMode="tel" autoComplete="tel" maxLength={30} />
            </label>
            <label>
              Xodimlar soni
              <select value={form.employees} onChange={(e) => set({ employees: e.target.value })}>
                <option value="">Tanlang</option>
                <option>1–20</option>
                <option>21–50</option>
                <option>51–200</option>
                <option>200+</option>
              </select>
            </label>
          </div>
          <label>
            Izoh (ixtiyoriy)
            <textarea rows={3} value={form.message} onChange={(e) => set({ message: e.target.value })} maxLength={1000} placeholder="Masalan: 3 ta filial, kechki smena bor" />
          </label>
          {/* Botlar uchun tuzoq — odamga ko‘rinmaydi. */}
          <input className="ld-hp" tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => set({ website: e.target.value })} aria-hidden="true" />
          {error && <p className="ld-error">{error}</p>}
          <button className="ld-btn primary lg" disabled={state === "sending"}>
            {state === "sending" ? "Yuborilmoqda…" : "So‘rov yuborish"}
          </button>
          <small>Ma’lumotlaringiz faqat siz bilan bog‘lanish uchun ishlatiladi.</small>
        </form>
      )}
    </div>
  );
}
