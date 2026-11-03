export type Lang = "uz" | "ru" | "en";

export type SiteContent = {
  nav: string[];
  login: string;
  menu: string;
  hero: { badge: string; line1: string; accent: string; desc: string; start: string; explore: string; proof: string[] };
  features: { eyebrow: string; title: string; desc: string; items: { title: string; desc: string }[] };
  showcase: { eyebrow: string; title: string; desc: string; tabs: string[]; details: string[] };
  steps: { eyebrow: string; title: string; items: { title: string; desc: string }[] };
  pricing: { eyebrow: string; title: string; desc: string; popular: string; custom: string; start: string; contact: string; plans: { name: string; note: string; features: string[] }[] };
  stats: { eyebrow: string; title: string; items: { value: string; label: string }[] };
  about: { eyebrow: string; title: string; p1: string; p2: string; values: { title: string; desc: string }[] };
  faq: { eyebrow: string; title: string; items: { q: string; a: string }[] };
  contact: { eyebrow: string; title: string; desc: string; name: string; phone: string; company: string; message: string; send: string; sending: string; success: string; error: string; channels: string };
  footer: { desc: string; product: string; company: string; legal: string; rights: string; links: string[] };
  common: { learn: string; back: string };
};

const uz: SiteContent = {
  nav: ["Bosh sahifa", "Imkoniyatlar", "Tariflar", "Biz haqimizda", "Bog‘lanish"],
  login: "Tizimga kirish",
  menu: "Menyu",
  hero: {
    badge: "Zamonaviy xodimlarni boshqarish platformasi",
    line1: "Jamoangizni boshqarish",
    accent: "endi ancha oson.",
    desc: "Staffora orqali xodimlar, davomat, ish jarayonlari va korxona faoliyatini yagona platformada boshqaring. Barcha jarayonlar bir joyda, nazorat esa doimo sizning qo‘lingizda.",
    start: "Staffora bilan boshlash",
    explore: "Imkoniyatlarni ko‘rish",
    proof: ["10+ korxona", "1 500+ audit yozuvi", "Davomat va ish jarayonlari"],
  },
  features: {
    eyebrow: "Yagona boshqaruv markazi",
    title: "Biznesingiz uchun barcha imkoniyatlar — bir platformada.",
    desc: "Staffora korxonangizdagi kundalik ish jarayonlarini soddalashtirish va samarali boshqarish uchun yaratilgan.",
    items: [
      { title: "Davomat nazorati", desc: "Kelish-ketish, kechikish va ish vaqtini aniq nazorat qiling." },
      { title: "Xodimlar boshqaruvi", desc: "Xodimlar, lavozimlar, bo‘limlar va filiallarni bir joydan boshqaring." },
      { title: "Xarita va geolokatsiya", desc: "Ruxsat etilgan ish jarayonlariga oid joylashuv ma’lumotlarini ko‘ring." },
      { title: "Ish stoli", desc: "Rahbar va xodimlar uchun kundalik vazifalar va muhim ko‘rsatkichlar." },
      { title: "Kalendar", desc: "Ish kunlari, muhim sanalar va rejalashtirilgan jarayonlarni kuzating." },
      { title: "Ta’til va arizalar", desc: "Ta’til, ruxsat va boshqa arizalarni tez ko‘rib chiqing." },
      { title: "Hisobot va tabel", desc: "Davomat statistikasi, ish vaqti va tabel hisobotlarini oling." },
      { title: "Moliya va ish haqi", desc: "Ish haqi va ichki moliyaviy jarayonlarni tartibli boshqaring." },
      { title: "Hujjatlar va formalar", desc: "Hujjatlar, so‘rovnomalar va formalarni xavfsiz saqlang." },
    ],
  },
  showcase: {
    eyebrow: "Haqiqiy mahsulot",
    title: "Har bir jarayon ustidan to‘liq nazorat.",
    desc: "Sodda interfeys, tez qarorlar. Staffora’ning mavjud ishchi interfeysi bilan tanishing.",
    tabs: ["Dashboard", "Davomat", "Xodimlar", "Xarita", "Kalendar", "Hisobotlar"],
    details: ["Muhim ko‘rsatkichlar va kunlik holat bir qarashda.", "Kelish-ketishlar va istisnolarni real vaqtda boshqaring.", "Jamoa tarkibi va profillarini tez toping.", "Filial va ruxsat etilgan geolokatsiya holatini ko‘ring.", "Ish kunlari va muhim sanalarni rejalashtiring.", "Qaror uchun tushunarli va eksport qilinadigan hisobotlar."],
  },
  steps: {
    eyebrow: "Qanday ishlaydi",
    title: "Staffora bilan ishlash juda oson.",
    items: [
      { title: "Ro‘yxatdan o‘tish", desc: "Korxonangiz uchun Staffora tizimidan foydalanishni boshlang." },
      { title: "Jamoangizni qo‘shing", desc: "Xodimlaringizni kiriting va kerakli rollarni belgilang." },
      { title: "Boshqarishni boshlang", desc: "Davomat va kundalik jarayonlarni yagona joydan nazorat qiling." },
    ],
  },
  pricing: {
    eyebrow: "Shaffof tariflar",
    title: "Biznesingizga mos tarifni tanlang.",
    desc: "Tasdiqlanmagan narxlarni ko‘rsatmaymiz. Imkoniyatdan boshlang, jamoangiz bilan birga kengaying.",
    popular: "Eng ommabop",
    custom: "Individual narx",
    start: "Boshlash",
    contact: "Bog‘lanish",
    plans: [
      { name: "FREE", note: "Kichik jamoalar uchun", features: ["10 nafargacha xodim", "1 ta filial", "2 ta rahbar", "Asosiy davomat moduli", "Ish stoli"] },
      { name: "PRO", note: "O‘sayotgan biznes uchun", features: ["Ko‘proq xodimlar", "Kengaytirilgan boshqaruv", "Qo‘shimcha modullar", "Kengaytirilgan hisobotlar", "Ustuvor yordam"] },
      { name: "ENTERPRISE", note: "Katta korxonalar uchun", features: ["Individual konfiguratsiya", "Kengaytirilgan imkoniyatlar", "Maxsus qo‘llab-quvvatlash", "Moslashtirilgan joriy etish", "Xavfsizlik nazorati"] },
    ],
  },
  stats: { eyebrow: "Ishonchli o‘sish", title: "Raqamlar ortida haqiqiy natijalar.", items: [{ value: "10+", label: "Staffora’dan foydalanayotgan korxona" }, { value: "1 500+", label: "Nazorat uchun saqlangan audit yozuvi" }, { value: "9", label: "Yagona tizimdagi boshqaruv yo‘nalishi" }] },
  about: {
    eyebrow: "Staffora haqida",
    title: "Biznes boshqaruvini soddalashtirish uchun yaratilgan.",
    p1: "Staffora — korxonalardagi xodimlar va kundalik ish jarayonlarini boshqarishni osonlashtiruvchi zamonaviy raqamli platforma.",
    p2: "Maqsadimiz — korxonalarga vaqtni tejash, jarayonlarni tizimlashtirish va boshqaruv samaradorligini oshirishda yordam berish.",
    values: [{ title: "Sodda", desc: "Murakkab jarayonlarni tushunarli ish oqimiga aylantiramiz." }, { title: "Ishonchli", desc: "Har bir muhim amal nazorat va audit bilan himoyalangan." }, { title: "Mahalliy", desc: "O‘zbekiston biznesining real ehtiyojlariga mos yaratilgan." }],
  },
  faq: {
    eyebrow: "Savol-javob",
    title: "Ko‘p so‘raladigan savollar.",
    items: [
      { q: "Staffora nima?", a: "Staffora — xodimlar, davomat va korxonaning kundalik ish jarayonlarini yagona joyda boshqaradigan HRM platformasi." },
      { q: "Staffora kimlar uchun mo‘ljallangan?", a: "Kichik jamoalardan tortib ko‘p filialli korxonalargacha — tartibli xodimlar boshqaruviga muhtoj tashkilotlar uchun." },
      { q: "Qanday qilib korxonani ulash mumkin?", a: "Demo so‘rovi yuboring yoki Staffora ilovasiga o‘ting. Jamoamiz mos tarif va joriy etish bo‘yicha yordam beradi." },
      { q: "Xodimlarni qanday qo‘shish mumkin?", a: "Rahbar panelida xodimni qo‘lda qo‘shish yoki mavjud ro‘yxatdan import qilish imkoniyati bor." },
      { q: "Staffora mobil qurilmalarda ishlaydimi?", a: "Ha. Xodimlar uchun mobilga mos Telegram Mini App va mobil ilova, rahbarlar uchun responsive veb-panel mavjud." },
      { q: "Bepul tarif mavjudmi?", a: "Ha. FREE tarif kichik jamoalar uchun asosiy davomat va boshqaruv imkoniyatlarini beradi." },
      { q: "Texnik yordamni qayerdan olish mumkin?", a: "Yordam markazi, Telegram yoki email orqali murojaat qilishingiz mumkin." },
    ],
  },
  contact: { eyebrow: "Bog‘lanish", title: "Korxonangizni yangi bosqichga olib chiqishga tayyormisiz?", desc: "Staffora haqida batafsil ma’lumot olish yoki hamkorlikni boshlash uchun biz bilan bog‘laning.", name: "Ismingiz", phone: "Telefon raqam", company: "Korxona nomi", message: "Xabar (ixtiyoriy)", send: "Demo so‘rash", sending: "Yuborilmoqda…", success: "So‘rovingiz qabul qilindi. Tez orada bog‘lanamiz.", error: "So‘rovni yuborib bo‘lmadi. Qayta urinib ko‘ring.", channels: "Yoki to‘g‘ridan-to‘g‘ri bog‘laning" },
  footer: { desc: "Xodimlar, davomat va kundalik ish jarayonlarini yagona platformada boshqaring.", product: "Mahsulot", company: "Kompaniya", legal: "Huquqiy", rights: "Barcha huquqlar himoyalangan.", links: ["Imkoniyatlar", "Tariflar", "Biz haqimizda", "Bog‘lanish", "Maxfiylik siyosati", "Foydalanish shartlari", "Yordam"] },
  common: { learn: "Batafsil", back: "Bosh sahifaga qaytish" },
};

const ru: SiteContent = {
  ...uz,
  nav: ["Главная", "Возможности", "Тарифы", "О нас", "Контакты"], login: "Войти", menu: "Меню",
  hero: { badge: "Современная платформа управления персоналом", line1: "Управлять командой", accent: "теперь намного проще.", desc: "Управляйте сотрудниками, посещаемостью, рабочими процессами и компанией в единой платформе Staffora. Все процессы в одном месте, а контроль — всегда в ваших руках.", start: "Начать со Staffora", explore: "Смотреть возможности", proof: ["10+ компаний", "1 500+ записей аудита", "Посещаемость и процессы"] },
  features: { eyebrow: "Единый центр управления", title: "Все возможности для бизнеса — в одной платформе.", desc: "Staffora создана, чтобы упростить ежедневные процессы и сделать управление эффективнее.", items: [
    { title: "Контроль посещаемости", desc: "Точно отслеживайте приход, уход, опоздания и рабочее время." }, { title: "Управление сотрудниками", desc: "Сотрудники, должности, отделы и филиалы в одном месте." }, { title: "Карта и геолокация", desc: "Просматривайте разрешённые данные местоположения рабочих процессов." }, { title: "Рабочий стол", desc: "Ежедневные задачи и важные показатели для команды и руководителей." }, { title: "Календарь", desc: "Рабочие дни, важные даты и запланированные процессы." }, { title: "Отпуска и заявки", desc: "Быстро рассматривайте отпуска, разрешения и другие заявки." }, { title: "Отчёты и табель", desc: "Статистика посещаемости, рабочего времени и табель." }, { title: "Финансы и зарплата", desc: "Системное управление зарплатами и внутренними финансами." }, { title: "Документы и формы", desc: "Безопасно храните документы, опросы и формы." }
  ] },
  showcase: { eyebrow: "Реальный продукт", title: "Полный контроль каждого процесса.", desc: "Простой интерфейс и быстрые решения. Познакомьтесь с рабочим интерфейсом Staffora.", tabs: ["Дашборд", "Посещаемость", "Сотрудники", "Карта", "Календарь", "Отчёты"], details: ["Ключевые показатели и состояние дня с первого взгляда.", "Приходы, уходы и исключения в реальном времени.", "Быстрый поиск состава команды и профилей.", "Филиалы и разрешённые геоданные.", "Планирование рабочих дней и важных дат.", "Понятные экспортируемые отчёты для решений."] },
  steps: { eyebrow: "Как это работает", title: "Работать со Staffora очень просто.", items: [{ title: "Регистрация", desc: "Начните использовать Staffora для своей компании." }, { title: "Добавьте команду", desc: "Добавьте сотрудников и назначьте нужные роли." }, { title: "Начните управлять", desc: "Контролируйте посещаемость и процессы из одного места." }] },
  pricing: { ...uz.pricing, eyebrow: "Прозрачные тарифы", title: "Выберите тариф для своего бизнеса.", desc: "Мы не показываем неподтверждённые цены. Начните с нужных функций и растите вместе с командой.", popular: "Популярный", custom: "Индивидуальная цена", start: "Начать", contact: "Связаться", plans: [{ name: "FREE", note: "Для небольших команд", features: ["До 10 сотрудников", "1 филиал", "2 руководителя", "Базовая посещаемость", "Рабочий стол"] }, { name: "PRO", note: "Для растущего бизнеса", features: ["Больше сотрудников", "Расширенное управление", "Дополнительные модули", "Расширенные отчёты", "Приоритетная поддержка"] }, { name: "ENTERPRISE", note: "Для крупных компаний", features: ["Индивидуальная конфигурация", "Расширенные возможности", "Особая поддержка", "Настроенное внедрение", "Контроль безопасности"] }] },
  stats: { eyebrow: "Уверенный рост", title: "За цифрами — реальные результаты.", items: [{ value: "10+", label: "компаний используют Staffora" }, { value: "1 500+", label: "записей аудита для контроля" }, { value: "9", label: "направлений управления в одной системе" }] },
  about: { eyebrow: "О Staffora", title: "Создано, чтобы упростить управление бизнесом.", p1: "Staffora — современная цифровая платформа, упрощающая управление сотрудниками и ежедневными процессами компании.", p2: "Наша цель — помочь компаниям экономить время, систематизировать процессы и повышать эффективность управления.", values: [{ title: "Просто", desc: "Превращаем сложные процессы в понятные сценарии." }, { title: "Надёжно", desc: "Каждое важное действие защищено контролем и аудитом." }, { title: "Локально", desc: "Создано под реальные потребности бизнеса Узбекистана." }] },
  faq: { eyebrow: "Вопросы", title: "Часто задаваемые вопросы.", items: [{ q: "Что такое Staffora?", a: "HRM-платформа для управления сотрудниками, посещаемостью и рабочими процессами в одном месте." }, { q: "Для кого предназначена Staffora?", a: "Для организаций от небольших команд до компаний с множеством филиалов." }, { q: "Как подключить компанию?", a: "Отправьте заявку на демо или перейдите в приложение — команда поможет с тарифом и запуском." }, { q: "Как добавить сотрудников?", a: "В панели руководителя можно добавить сотрудника вручную или импортировать список." }, { q: "Работает ли Staffora на мобильных устройствах?", a: "Да: Telegram Mini App и мобильное приложение для сотрудников, responsive-панель для руководителей." }, { q: "Есть ли бесплатный тариф?", a: "Да. FREE включает базовую посещаемость и управление для небольшой команды." }, { q: "Где получить поддержку?", a: "В центре поддержки, Telegram или по электронной почте." }] },
  contact: { eyebrow: "Контакты", title: "Готовы вывести компанию на новый уровень?", desc: "Свяжитесь с нами, чтобы узнать больше о Staffora или начать сотрудничество.", name: "Ваше имя", phone: "Телефон", company: "Компания", message: "Сообщение (необязательно)", send: "Запросить демо", sending: "Отправка…", success: "Заявка принята. Мы скоро свяжемся.", error: "Не удалось отправить. Попробуйте ещё раз.", channels: "Или свяжитесь напрямую" },
  footer: { desc: "Сотрудники, посещаемость и ежедневные процессы в одной платформе.", product: "Продукт", company: "Компания", legal: "Правовая информация", rights: "Все права защищены.", links: ["Возможности", "Тарифы", "О нас", "Контакты", "Конфиденциальность", "Условия", "Поддержка"] },
  common: { learn: "Подробнее", back: "На главную" },
};

const en: SiteContent = {
  ...uz,
  nav: ["Home", "Features", "Pricing", "About", "Contact"], login: "Sign in", menu: "Menu",
  hero: { badge: "Modern workforce management platform", line1: "Managing your team", accent: "just became easier.", desc: "Manage people, attendance, workflows and company operations in one Staffora workspace. Every process in one place, always under your control.", start: "Get started with Staffora", explore: "Explore features", proof: ["10+ companies", "1,500+ audit records", "Attendance and workflows"] },
  features: { eyebrow: "One command center", title: "Everything your business needs — in one platform.", desc: "Staffora simplifies daily operations and helps your company run with clarity.", items: [
    { title: "Attendance", desc: "Track arrivals, departures, lateness and working time accurately." }, { title: "People management", desc: "Manage employees, roles, departments and branches in one place." }, { title: "Maps & geolocation", desc: "View permitted work-related location information." }, { title: "Workspace", desc: "Daily work and essential metrics for employees and managers." }, { title: "Calendar", desc: "Track workdays, important dates and scheduled processes." }, { title: "Leave & requests", desc: "Review leave, permission and other requests quickly." }, { title: "Reports & timesheets", desc: "Attendance statistics, working time and timesheet reports." }, { title: "Finance & payroll", desc: "Keep payroll and internal financial workflows organized." }, { title: "Documents & forms", desc: "Store documents, surveys and forms securely." }
  ] },
  showcase: { eyebrow: "A real product", title: "Complete control over every workflow.", desc: "A calm interface for faster decisions. Explore the working Staffora experience.", tabs: ["Dashboard", "Attendance", "People", "Map", "Calendar", "Reports"], details: ["Key metrics and today’s status at a glance.", "Manage arrivals, departures and exceptions in real time.", "Find your team and profiles quickly.", "Review branches and approved location activity.", "Plan workdays and important dates.", "Clear, exportable reports built for decisions."] },
  steps: { eyebrow: "How it works", title: "Getting started is remarkably simple.", items: [{ title: "Create your account", desc: "Start using Staffora for your company." }, { title: "Add your team", desc: "Add employees and assign the right roles." }, { title: "Start managing", desc: "Control attendance and daily workflows from one place." }] },
  pricing: { ...uz.pricing, eyebrow: "Clear plans", title: "Choose the right plan for your business.", desc: "We do not invent unconfirmed prices. Start with the capabilities you need and scale with your team.", popular: "Most popular", custom: "Custom pricing", start: "Get started", contact: "Contact us", plans: [{ name: "FREE", note: "For small teams", features: ["Up to 10 employees", "1 branch", "2 managers", "Core attendance", "Workspace"] }, { name: "PRO", note: "For growing businesses", features: ["More employees", "Advanced management", "Additional modules", "Advanced reports", "Priority support"] }, { name: "ENTERPRISE", note: "For large organizations", features: ["Custom configuration", "Advanced capabilities", "Dedicated support", "Tailored onboarding", "Security controls"] }] },
  stats: { eyebrow: "Steady growth", title: "Real outcomes behind the numbers.", items: [{ value: "10+", label: "companies using Staffora" }, { value: "1,500+", label: "audit records supporting control" }, { value: "9", label: "management areas in one system" }] },
  about: { eyebrow: "About Staffora", title: "Built to make business management simpler.", p1: "Staffora is a modern digital platform that simplifies people management and everyday company operations.", p2: "Our mission is to help companies save time, systemize processes and improve management effectiveness.", values: [{ title: "Simple", desc: "We turn complex operations into clear workflows." }, { title: "Reliable", desc: "Every important action is protected by control and audit." }, { title: "Local", desc: "Built around the real needs of businesses in Uzbekistan." }] },
  faq: { eyebrow: "FAQ", title: "Questions, answered.", items: [{ q: "What is Staffora?", a: "An HRM platform for managing people, attendance and daily workflows in one place." }, { q: "Who is Staffora for?", a: "Organizations ranging from small teams to multi-branch companies." }, { q: "How do I connect my company?", a: "Submit a demo request or open the app. Our team will help with the right plan and rollout." }, { q: "How do I add employees?", a: "Managers can add employees manually or import an existing list." }, { q: "Does Staffora work on mobile?", a: "Yes: a Telegram Mini App and mobile app for employees, plus a responsive manager panel." }, { q: "Is there a free plan?", a: "Yes. FREE includes core attendance and management for a small team." }, { q: "Where can I get support?", a: "Use the support center, Telegram or email." }] },
  contact: { eyebrow: "Contact", title: "Ready to move your company forward?", desc: "Talk to us to learn more about Staffora or begin your rollout.", name: "Your name", phone: "Phone number", company: "Company name", message: "Message (optional)", send: "Request a demo", sending: "Sending…", success: "Your request is in. We’ll contact you soon.", error: "Could not send your request. Please try again.", channels: "Or contact us directly" },
  footer: { desc: "Manage people, attendance and daily operations in one platform.", product: "Product", company: "Company", legal: "Legal", rights: "All rights reserved.", links: ["Features", "Pricing", "About", "Contact", "Privacy", "Terms", "Support"] },
  common: { learn: "Learn more", back: "Back to home" },
};

export const content: Record<Lang, SiteContent> = { uz, ru, en };

export const navHref = ["/#home", "/#features", "/#pricing", "/#about", "/#contact"];
