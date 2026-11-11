"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, CheckCircle2, Headphones, Mail, Send } from "lucide-react";
import { About, Contact, Features, PageHero, Pricing, Showcase } from "./sections";
import { useLanguage } from "./language-provider";

export function FeaturesRoute() {
  const { t } = useLanguage();
  return <main><PageHero eyebrow={t.features.eyebrow} title={t.features.title} description={t.features.desc} /><Features condensed /><Showcase /></main>;
}

export function PricingRoute() {
  const { t } = useLanguage();
  return <main><PageHero eyebrow={t.pricing.eyebrow} title={t.pricing.title} description={t.pricing.desc} /><Pricing page /><Contact /></main>;
}

export function AboutRoute() {
  const { t } = useLanguage();
  return <main><PageHero eyebrow={t.about.eyebrow} title={t.about.title} description={t.about.p1} /><About page /></main>;
}

export function ContactRoute() {
  const { t } = useLanguage();
  return <main><PageHero eyebrow={t.contact.eyebrow} title={t.contact.title} description={t.contact.desc} /><Contact page /></main>;
}

type LegalKind = "privacy" | "terms";
const legal = {
  uz: {
    privacy: { title: "Maxfiylik siyosati", desc: "Staffora shaxsiy va korporativ ma’lumotlarga qanday munosabatda bo‘lishini tushuntiradi.", updated: "Yangilangan: 2026-yil 3-noyabr", sections: [["Biz qanday ma’lumotlarni olamiz", "Hisob ma’lumotlari, kompaniya va xodim profili, davomat yozuvlari, qurilma va xavfsizlik jurnallari faqat xizmatni ko‘rsatish uchun qayta ishlanadi."], ["Ma’lumotlardan foydalanish", "Ma’lumotlar autentifikatsiya, davomat, hisobotlar, texnik yordam, xavfsizlik va qonuniy majburiyatlarni bajarish uchun ishlatiladi."], ["Saqlash va himoya", "Ruxsatlar rol asosida cheklanadi, muhim amallar audit qilinadi va transportdagi ma’lumotlar HTTPS orqali himoyalanadi."], ["Ulashish", "Staffora ma’lumotlarni sotmaydi. Xizmat infratuzilmasi provayderlari faqat zarur hajmda va tegishli himoya ostida foydalanishi mumkin."], ["Huquqlaringiz", "Tashkilotingiz administratori orqali ma’lumotga kirish, tuzatish yoki qonun ruxsat bergan doirada o‘chirishni so‘rashingiz mumkin."], ["Bog‘lanish", "Maxfiylik bo‘yicha savollarni support@staffora.uz manziliga yuboring."]] },
    terms: { title: "Foydalanish shartlari", desc: "Staffora platformasidan foydalanishning asosiy qoidalari.", updated: "Yangilangan: 2026-yil 3-noyabr", sections: [["Xizmat", "Staffora xodimlar, davomat va korxona ish jarayonlarini boshqarish uchun dasturiy platforma taqdim etadi."], ["Hisob va xavfsizlik", "Foydalanuvchi kirish ma’lumotlarini himoya qilishga, tashkilot esa rollar va ruxsatlarni to‘g‘ri belgilashga javobgar."], ["Maqbul foydalanish", "Xizmatni buzish, ruxsatsiz kirish, zararli kod tarqatish yoki boshqa foydalanuvchilar ma’lumotlarini noqonuniy olish taqiqlanadi."], ["Tarif va to‘lov", "Amaldagi tarif, limit va to‘lov shartlari buyurtma yoki platformada ko‘rsatilgan kelishuv bilan belgilanadi. Tasdiqlanmagan narxlar kuchga ega emas."], ["Mavjudlik", "Rejalashtirilgan texnik ishlar va Staffora nazoratidan tashqaridagi hodisalar bundan mustasno, xizmatning barqarorligi uchun oqilona choralar ko‘riladi."], ["Bog‘lanish", "Shartlar bo‘yicha savollar: support@staffora.uz."]] },
  },
  ru: {
    privacy: { title: "Политика конфиденциальности", desc: "Как Staffora работает с личными и корпоративными данными.", updated: "Обновлено: 3 ноября 2026 г.", sections: [["Какие данные мы получаем", "Данные аккаунта, компании, сотрудников, посещаемости, устройства и журналы безопасности обрабатываются только для работы сервиса."], ["Использование", "Данные нужны для входа, посещаемости, отчётов, поддержки, безопасности и юридических обязанностей."], ["Хранение и защита", "Доступ ограничен ролями, важные действия аудируются, передача защищена HTTPS."], ["Передача", "Staffora не продаёт данные. Инфраструктурные провайдеры получают только необходимый объём под защитой."], ["Ваши права", "Через администратора организации можно запросить доступ, исправление или допустимое законом удаление."], ["Контакты", "Вопросы о конфиденциальности: support@staffora.uz."]] },
    terms: { title: "Условия использования", desc: "Основные правила использования платформы Staffora.", updated: "Обновлено: 3 ноября 2026 г.", sections: [["Сервис", "Staffora предоставляет платформу управления сотрудниками, посещаемостью и процессами."], ["Аккаунт и безопасность", "Пользователь защищает данные входа, организация корректно назначает роли и разрешения."], ["Допустимое использование", "Запрещены взлом, несанкционированный доступ, вредоносный код и незаконное получение данных."], ["Тарифы и оплата", "Условия определяются подтверждённым заказом или соглашением в платформе."], ["Доступность", "Мы принимаем разумные меры для стабильности, кроме плановых работ и внешних обстоятельств."], ["Контакты", "Вопросы об условиях: support@staffora.uz."]] },
  },
  en: {
    privacy: { title: "Privacy Policy", desc: "How Staffora handles personal and corporate information.", updated: "Updated: November 3, 2026", sections: [["Information we process", "Account, company, employee, attendance, device and security log data is processed only to provide the service."], ["How we use it", "Data supports authentication, attendance, reporting, support, security and legal obligations."], ["Storage and protection", "Role-based access limits data, important actions are audited, and data in transit is protected with HTTPS."], ["Sharing", "Staffora does not sell data. Infrastructure providers receive only what is necessary under appropriate safeguards."], ["Your rights", "You can request access, correction or legally permitted deletion through your organization administrator."], ["Contact", "Privacy questions: support@staffora.uz."]] },
    terms: { title: "Terms of Use", desc: "The core rules for using the Staffora platform.", updated: "Updated: November 3, 2026", sections: [["Service", "Staffora provides software for managing people, attendance and company workflows."], ["Accounts and security", "Users protect credentials; organizations assign roles and permissions correctly."], ["Acceptable use", "Disruption, unauthorized access, malware and unlawful data access are prohibited."], ["Plans and payment", "The active plan, limits and payment terms are defined by a confirmed order or in-platform agreement."], ["Availability", "We take reasonable measures for reliability, excluding planned maintenance and events outside our control."], ["Contact", "Questions about these terms: support@staffora.uz."]] },
  },
};

export function LegalRoute({ kind }: { kind: LegalKind }) {
  const { lang } = useLanguage();
  const page = legal[lang][kind];
  return <main><PageHero eyebrow="Staffora · Legal" title={page.title} description={page.desc} /><section className="section legal-section"><div className="container legal-layout"><aside><span>{page.updated}</span><a href="mailto:support@staffora.uz"><Mail size={16} />support@staffora.uz</a></aside><div className="legal-content">{page.sections.map(([title, text], i) => <article key={title}><span>0{i + 1}</span><div><h2>{title}</h2><p>{text}</p></div></article>)}</div></div></section></main>;
}

export function SupportRoute() {
  const { lang } = useLanguage();
  const copy = {
    uz: { eyebrow: "Yordam markazi", title: "Sizga qanday yordam bera olamiz?", desc: "Savolingizni yuboring — murojaat to‘g‘ridan-to‘g‘ri Staffora yordam markaziga tushadi.", name: "Ismingiz", email: "Email", company: "Kompaniya (ixtiyoriy)", subject: "Mavzu", message: "Savol yoki muammo tafsiloti", send: "Murojaat yuborish", ok: "Murojaatingiz qabul qilindi.", bad: "Yuborib bo‘lmadi. Qayta urinib ko‘ring." },
    ru: { eyebrow: "Центр поддержки", title: "Как мы можем помочь?", desc: "Отправьте вопрос — он поступит напрямую в центр поддержки Staffora.", name: "Ваше имя", email: "Email", company: "Компания (необязательно)", subject: "Тема", message: "Опишите вопрос или проблему", send: "Отправить обращение", ok: "Обращение принято.", bad: "Не удалось отправить. Попробуйте ещё раз." },
    en: { eyebrow: "Support center", title: "How can we help?", desc: "Send your question directly to the Staffora support team.", name: "Your name", email: "Email", company: "Company (optional)", subject: "Subject", message: "Question or issue details", send: "Send request", ok: "Your request has been received.", bad: "Could not send. Please try again." },
  }[lang];
  const [state, setState] = useState<"idle" | "sending" | "ok" | "bad">("idle");
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setState("sending"); const data = Object.fromEntries(new FormData(event.currentTarget)); try { const response = await fetch("/api/public/support/tickets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }); if (!response.ok) throw new Error(); event.currentTarget.reset(); setState("ok"); } catch { setState("bad"); } };
  return <main><PageHero eyebrow={copy.eyebrow} title={copy.title} description={copy.desc} /><section className="section support-section"><div className="container support-grid"><div className="support-channels"><article><Send /><div><h3>Telegram</h3><a href="https://t.me/staffora_support">@staffora_support <ArrowRight size={14} /></a></div></article><article><Mail /><div><h3>Email</h3><a href="mailto:support@staffora.uz">support@staffora.uz</a></div></article><article><Headphones /><div><h3>Working hours</h3><p>Du–Ju · 09:00–18:00</p></div></article></div><form className="lead-form" onSubmit={submit}><label><span>{copy.name}</span><input name="name" minLength={2} maxLength={80} required /></label><label><span>{copy.email}</span><input name="email" type="email" maxLength={120} required /></label><label><span>{copy.company}</span><input name="company" maxLength={120} /></label><label><span>{copy.subject}</span><input name="subject" minLength={3} maxLength={160} required /></label><label><span>{copy.message}</span><textarea name="message" minLength={10} maxLength={4000} rows={6} required /></label><input name="website" className="honey" tabIndex={-1} aria-hidden="true" /><button className="button button-primary button-large" disabled={state === "sending"}>{copy.send}<CheckCircle2 size={17} /></button>{state === "ok" && <p className="form-message success">{copy.ok}</p>}{state === "bad" && <p className="form-message error">{copy.bad}</p>}</form></div></section></main>;
}
