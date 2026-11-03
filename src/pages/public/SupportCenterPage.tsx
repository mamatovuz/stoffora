import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, CheckCircle2, ChevronDown, Clock3, LifeBuoy, Mail, MessageCircle, Search, Send } from "lucide-react";
import { api, ApiError } from "../../api";
import { PublicLayout, usePublicMeta } from "./PublicLayout";

type Contacts = { platformName: string; email: string | null; telegram: string | null; phone: string | null; hours: string | null };
type Faq = { question: string; answer: React.ReactNode; searchable: string };
type FaqGroup = { title: string; items: Faq[] };

const item = (question: string, answer: React.ReactNode, searchable = ""): Faq => ({ question, answer, searchable: `${question} ${searchable}` });
const groups: FaqGroup[] = [
  {
    title: "Umumiy savollar",
    items: [
      item("Staffora nima?", <>Staffora — xodimlar, filiallar, ish jadvallari, davomat, ta’til va HR jarayonlarini yagona joyda boshqarishga yordam beruvchi platforma.</>, "HR platforma xodim davomat"),
      item("Staffora kimlar uchun mo‘ljallangan?", <>Platforma bir yoki bir nechta filialga ega kompaniyalar, ularning administratorlari, rahbarlari, HR va moliya mutaxassislari hamda xodimlari uchun mo‘ljallangan. Har bir foydalanuvchi faqat o‘z roliga ochilgan bo‘limlarni ko‘radi.</>, "kompaniya rahbar xodim HR"),
      item("Qanday ro‘yxatdan o‘tiladi?", <>Kompaniya akkaunti tashkilot administratori tomonidan yaratiladi. Xodim profili esa kompaniya tomonidan qo‘shiladi va berilgan ulash kodi yoki taklif jarayoni orqali mobil ilova yoki Telegram Mini App’ga bog‘lanadi. Akkauntingiz bo‘lmasa, kompaniyangiz administratoriga murojaat qiling.</>, "registratsiya akkaunt ulash kodi"),
    ],
  },
  {
    title: "Akkaunt va profil",
    items: [
      item("Parolni qanday o‘zgartirish mumkin?", <>Panelga kirgach, <strong>Profil va sozlamalar</strong> bo‘limini oching va xavfsizlik qismida joriy hamda yangi parolni kiriting. Yangi parol kamida 10 belgidan iborat bo‘lishi kerak.</>, "sozlamalar xavfsizlik"),
      item("Telefon raqamini qanday yangilash mumkin?", <>Xodim telefon raqami kompaniya ma’lumoti hisoblanadi. Uni yangilash uchun HR yoki kompaniya administratoriga murojaat qiling. Administrator xodim kartasida yangi raqamni saqlaydi.</>, "profil raqam o‘zgartirish"),
      item("Akkauntga kira olmasam nima qilaman?", <>Avval email yoki telefon raqami to‘g‘ri yozilganini va internet aloqasini tekshiring. Telegram orqali kirishda bot akkauntga ulangan bo‘lishi kerak. Muammo qolsa, quyidagi forma orqali murojaat yuboring va xato matnini yozing. Parolingizni hech qachon yubormang.</>, "login kirish parol kod"),
    ],
  },
  {
    title: "Davomat",
    items: [
      item("Xodim qanday qilib ishga kelganini belgilaydi?", <>Kompaniya sozlagan rejimga qarab xodim mobil ilova yoki Telegram Mini App’da “Ishga keldim” tugmasini bosadi. Filial QR kodi, geolokatsiya yoki yuz bilan tasdiqlash talab qilinishi mumkin. Muvaffaqiyatli belgi ekranda tasdiqlanadi va tarixga qo‘shiladi.</>, "ishga kelish ketish QR Face ID"),
      item("Geolokatsiya nima uchun kerak?", <>Geolokatsiya belgi qo‘yilgan vaqtda xodim ruxsat etilgan filial hududida ekanini tekshirish uchun ishlatiladi. Ruxsat faqat kompaniya shu rejimni yoqqanida so‘raladi. GPS aniqligi past bo‘lsa, ochiq joyga chiqib qayta urinib ko‘ring.</>, "GPS joylashuv filial radius"),
      item("Davomat tarixini qayerdan ko‘rish mumkin?", <>Xodim ilova yoki Mini App’dagi <strong>Tarix</strong> bo‘limida o‘z qaydlarini ko‘radi. Rahbarlar esa paneldagi <strong>Davomat</strong>, <strong>Kalendar</strong> yoki <strong>Tabel</strong> sahifalaridan vakolati doirasidagi ma’lumotlarni ko‘rishi mumkin.</>, "tarix kalendar tabel"),
    ],
  },
  {
    title: "Kompaniya boshqaruvi",
    items: [
      item("Xodim qanday qo‘shiladi?", <>Paneldagi <strong>Xodimlar</strong> sahifasida “Yangi xodim” tugmasini bosing. Ism, filial, bo‘lim, lavozim, grafik va aloqa ma’lumotlarini kiriting. Ko‘p xodim uchun import vositasidan foydalanish mumkin.</>, "employee import yangi"),
      item("Filial qanday yaratiladi?", <><strong>Filiallar</strong> bo‘limida yangi filial oching, manzil va xaritadagi nuqtani belgilang, ruxsat etilgan radius hamda davomat usulini tanlang. Bu amal uchun tegishli boshqaruv huquqi kerak.</>, "branch manzil radius xarita"),
      item("Rahbar qanday tayinlanadi?", <>Avval xodim yoki panel foydalanuvchisini yarating, so‘ng unga mos rahbar rolini va boshqaradigan filiallarni biriktiring. Foydalanuvchi faqat rol va filial doirasida ma’lumot ko‘radi.</>, "rol filial rahbari permissions"),
    ],
  },
  {
    title: "Texnik muammolar",
    items: [
      item("Ilova ishlamay qolsa nima qilish kerak?", <>Internet aloqasini tekshiring, ilovani to‘liq yoping va qayta oching. So‘ng ilovaning oxirgi versiyasi o‘rnatilganini tekshiring. Muammo takrorlansa, qurilma modeli, ilova versiyasi, vaqt va ko‘ringan xatoni murojaatga kiriting.</>, "xato crash versiya internet"),
      item("Ma’lumotlar yangilanmasa nima qilish kerak?", <>Sahifani yangilang va internet aloqasini tekshiring. Filtrlar yoki tanlangan sana eski qiymatda qolmaganiga ishonch hosil qiling. Bir necha daqiqadan keyin ham o‘zgarmasa, qaysi sahifa va qaysi yozuv yangilanmayotganini aniq ko‘rsatib murojaat yuboring.</>, "sync sinxron yangilash"),
      item("Bildirishnomalar kelmasa nima qilish kerak?", <>Qurilma sozlamalarida Staffora uchun bildirishnoma ruxsati yoqilganini, “Bezovta qilmaslik” rejimi faol emasligini va ilovadagi bildirishnoma sozlamalarini tekshiring. Akkauntdan chiqib-kirish yoki ilovani qayta o‘rnatishdan oldin support’ga murojaat qilish tavsiya etiladi.</>, "push notification ruxsat"),
    ],
  },
];

const normalize = (value: string) => value.toLocaleLowerCase("uz").replace(/[ʻ‘’`']/g, "").trim();

export function SupportCenterPage() {
  usePublicMeta({ title: "Yordam markazi — Staffora", description: "Staffora bo‘yicha tezkor javoblar, akkaunt va davomat yo‘riqnomalari hamda yordam xizmatiga murojaat formasi.", path: "/support" });
  const [query, setQuery] = useState("");
  const [contacts, setContacts] = useState<Contacts | null>(null);
  const [contactError, setContactError] = useState(false);
  useEffect(() => {
    api<Contacts>("/public/support/contacts")
      .then(setContacts)
      .catch(() => setContactError(true));
  }, []);
  const filtered = useMemo(() => {
    const needle = normalize(query);
    if (!needle) return groups;
    return groups.map((group) => ({ ...group, items: group.items.filter((entry) => normalize(entry.searchable).includes(needle)) })).filter((group) => group.items.length);
  }, [query]);
  const resultCount = filtered.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <PublicLayout>
      <section className="support-hero">
        <div className="public-container">
          <span className="public-eyebrow"><LifeBuoy size={15} /> Yordam markazi</span>
          <h1>Sizga qanday yordam bera olamiz?</h1>
          <p>Staffora platformasidan foydalanish bo‘yicha savollaringiz bormi? Biz sizga yordam berishga tayyormiz.</p>
          <label className="support-search">
            <Search size={21} aria-hidden="true" />
            <span className="sr-only">Savol yoki muammoni qidiring</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Savol yoki muammoni yozing…" autoComplete="off" />
            {query && <kbd>{resultCount} ta natija</kbd>}
          </label>
        </div>
      </section>

      <section className="support-section" aria-labelledby="faq-title">
        <div className="public-container">
          <div className="public-section-heading">
            <div><span className="public-eyebrow">Bilimlar bazasi</span><h2 id="faq-title">Ko‘p so‘raladigan savollar</h2></div>
            <p>Javobni topmasangiz, pastdagi forma orqali bizga yozing.</p>
          </div>
          {filtered.length ? (
            <div className="faq-grid">
              {filtered.map((group) => (
                <section className="faq-group" key={group.title}>
                  <h3>{group.title}</h3>
                  <div className="faq-list">
                    {group.items.map((entry) => (
                      <details key={entry.question} open={query ? true : undefined}>
                        <summary>{entry.question}<ChevronDown size={18} aria-hidden="true" /></summary>
                        <div>{entry.answer}</div>
                      </details>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="support-empty"><Search size={28} /><h3>Javob topilmadi</h3><p>Qidiruv so‘zini o‘zgartiring yoki quyidagi forma orqali murojaat yuboring.</p></div>
          )}
        </div>
      </section>

      <section className="support-contact" aria-labelledby="contact-title">
        <div className="public-container support-contact-grid">
          <div className="support-contact-copy">
            <span className="public-eyebrow">Biz bilan bog‘laning</span>
            <h2 id="contact-title">Savolingiz javobsiz qolmaydi</h2>
            <p>Muammoni batafsil yozing. Support jamoasi murojaatni platformadagi yordam navbatida qabul qiladi.</p>
            <div className="contact-cards" aria-live="polite">
              {!contacts && !contactError && <div className="contact-loading"><span className="mini-spinner" /> Aloqa ma’lumotlari yuklanmoqda…</div>}
              {contactError && <div className="contact-note"><AlertCircle size={18} /> Aloqa ma’lumotlarini yuklab bo‘lmadi. Formadan foydalanishingiz mumkin.</div>}
              {contacts?.telegram && <a href={contacts.telegram.startsWith("http") ? contacts.telegram : `https://t.me/${contacts.telegram.replace(/^@/, "")}`} target="_blank" rel="noreferrer"><MessageCircle size={20} /><span><small>Telegram</small><strong>{contacts.telegram}</strong></span></a>}
              {contacts?.email && <a href={`mailto:${contacts.email}`}><Mail size={20} /><span><small>Elektron pochta</small><strong>{contacts.email}</strong></span></a>}
              {contacts?.hours && <div><Clock3 size={20} /><span><small>Ish vaqti</small><strong>{contacts.hours}</strong></span></div>}
              {contacts && !contacts.telegram && !contacts.email && !contacts.hours && <div className="contact-note"><AlertCircle size={18} /> To‘g‘ridan-to‘g‘ri kontaktlar hali administrator tomonidan kiritilmagan. Murojaat formasi ishlaydi.</div>}
            </div>
            <p className="support-privacy">Forma orqali yuborilgan ma’lumotlar murojaatni ko‘rib chiqish uchun ishlatiladi. Batafsil: <Link to="/privacy">Maxfiylik siyosati</Link>.</p>
          </div>
          <SupportForm />
        </div>
      </section>
    </PublicLayout>
  );
}

const initialForm = { name: "", email: "", category: "Umumiy savol", subject: "", message: "", website: "" };

function SupportForm() {
  const [form, setForm] = useState(initialForm);
  const [state, setState] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [feedback, setFeedback] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setState("sending");
    setFeedback("");
    try {
      const result = await api<{ ok: true; number: number }>("/public/support/tickets", { method: "POST", body: JSON.stringify(form) });
      setState("success");
      setFeedback(`Murojaatingiz qabul qilindi. Raqami: #${result.number}.`);
      setForm(initialForm);
    } catch (reason) {
      setState("error");
      setFeedback(reason instanceof ApiError ? reason.message : "Murojaat yuborilmadi. Birozdan keyin qayta urinib ko‘ring.");
    }
  };
  return (
    <form className="support-form" onSubmit={submit} aria-labelledby="support-form-title">
      <div className="support-form-head"><span>Support form</span><h2 id="support-form-title">Muammo haqida xabar yuboring</h2></div>
      <div className="support-form-row">
        <label><span>Ism</span><input className="input" required minLength={2} maxLength={80} autoComplete="name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ism va familiyangiz" /></label>
        <label><span>Email</span><input className="input" required type="email" maxLength={160} autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="siz@example.com" /></label>
      </div>
      <label><span>Muammo kategoriyasi</span><select className="select" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option>Umumiy savol</option><option>Akkaunt va profil</option><option>Davomat</option><option>Kompaniya boshqaruvi</option><option>Texnik muammo</option><option>Tarif va to‘lov</option><option>Maxfiylik va ma’lumotlar</option></select></label>
      <label><span>Murojaat mavzusi</span><input className="input" required minLength={3} maxLength={160} value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} placeholder="Muammoni qisqa yozing" /></label>
      <label><span>Muammo tavsifi</span><textarea className="textarea" required minLength={10} maxLength={5000} rows={6} value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} placeholder="Qaysi sahifa, qachon va qanday xato yuz berganini batafsil yozing. Parol yoki maxfiy kalit yubormang." /></label>
      <label className="form-honeypot" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={form.website} onChange={(event) => setForm({ ...form, website: event.target.value })} /></label>
      {feedback && <div className={`support-feedback ${state}`} role={state === "error" ? "alert" : "status"}>{state === "success" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}<span>{feedback}</span></div>}
      <button className="btn btn-primary btn-lg" disabled={state === "sending"}>{state === "sending" ? <span className="mini-spinner light" /> : <Send size={17} />}{state === "sending" ? "Yuborilmoqda…" : "Murojaatni yuborish"}</button>
    </form>
  );
}
