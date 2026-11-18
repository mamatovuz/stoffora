export type Lang = "uz" | "ru" | "en";

export type StoryStep = { label: string; title: string; desc: string; points: string[]; alt: string };

export type PayrollContent = {
  eyebrow: string;
  title: string;
  desc: string;
  result: string;
  units: { currency: string; day: string; hour: string; piece: string; fixed: string };
  types: { name: string; desc: string }[];
  features: { title: string; desc: string }[];
  slip: { period: string; employee: string; type: string; accrued: string; bonus: string; advance: string; penalty: string; total: string; paid: string; remaining: string; partial: string; audit: string };
  cta: string;
};

export type AiContent = {
  eyebrow: string;
  title: string;
  desc: string;
  status: string;
  providers: string;
  points: { title: string; desc: string }[];
  chat: {
    q1: string;
    a1Title: string;
    a1Head: [string, string, string];
    a1Rows: [string, string, string][];
    a1Note: string;
    q2: string;
    confirmBadge: string;
    confirmIntro: string;
    fields: [string, string][];
    confirm: string;
    cancel: string;
    done: string;
    cancelled: string;
    typing: string;
    input: string;
    replay: string;
    footnote: string;
  };
};

export type SiteContent = {
  nav: string[];
  login: string;
  menu: string;
  hero: { badge: string; line1: string; accent: string; desc: string; start: string; explore: string; proof: string[]; floats: { title: string; meta: string; value?: number }[]; ticker: string[] };
  features: { eyebrow: string; title: string; desc: string; items: { title: string; desc: string }[] };
  story: { eyebrow: string; title: string; desc: string; progress: string; steps: StoryStep[] };
  payroll: PayrollContent;
  ai: AiContent;
  showcase: { eyebrow: string; title: string; desc: string; tabs: string[]; details: string[] };
  steps: { eyebrow: string; title: string; items: { title: string; desc: string }[] };
  pricing: { eyebrow: string; title: string; desc: string; popular: string; custom: string; start: string; contact: string; live: string; plans: { name: string; note: string; features: string[] }[] };
  stats: { eyebrow: string; title: string; note: string; items: { value: string; label: string }[] };
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
    floats: [{ title: "Dildora Ahmedova keldi", meta: "08:58 · Face ID · GPS" }, { title: "Ish haqi hisoblandi", meta: "so‘m · 42 xodim", value: 204390638 }, { title: "Staffora AI", meta: "xodim bugun kechikdi", value: 4 }],
    ticker: ["Face ID davomat", "GPS geozona", "QR va terminal", "Oylik · kunlik · soatbay · ishbay", "Avans va bonus", "Qisman to‘lov", "Staffora AI", "Telegram bot", "Ovozli buyruq", "Ko‘p filial", "T-13 tabel", "Excel va 1C eksport", "Ta’til va arizalar", "Audit jurnali"],
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
      { title: "Moliya va ish haqi", desc: "Oylik, kunlik, soatbay va ishbay ish haqi, avans va to‘lovlar." },
      { title: "Hujjatlar va formalar", desc: "Hujjatlar, so‘rovnomalar va formalarni xavfsiz saqlang." },
    ],
  },
  story: {
    eyebrow: "Mahsulot bilan tanishuv",
    title: "Bir platforma — butun ish kuni nazoratda.",
    desc: "Pastga aylantiring: har bir bo‘lim haqiqiy mahsulot ekranida ochiladi.",
    progress: "Bo‘limlar",
    steps: [
      { label: "Panel", title: "Boshqaruv paneli — bir qarashda bugungi holat", desc: "Kim ishda, kim kechikdi va qaysi arizalar javob kutmoqda — barchasi bitta ekranda. Filial va sana bo‘yicha bir bosishda saralang.", points: ["Real vaqt ko‘rsatkichlari", "Arizalar navbati", "Filiallar kesimi"], alt: "Staffora boshqaruv paneli: bugungi davomat kartalari, arizalar va kirish-chiqish jadvali" },
      { label: "Davomat", title: "Davomat — Face ID, GPS va QR bilan", desc: "Xodim kirish-chiqishni telefon yoki terminalda belgilaydi, tizim yuz va joylashuvni tekshiradi. Kechikish va qo‘shimcha vaqt avtomatik hisoblanadi.", points: ["Face ID tekshiruvi", "GPS geozona", "QR va terminal"], alt: "Staffora davomat sahifasi: xodimlarning kelish-ketish vaqtlari, Face ID va GPS belgilari" },
      { label: "Ish haqi", title: "Ish haqi — har bir xodimga o‘z stavkasi", desc: "Oylik, kunlik, soatbay va ishbay stavkalar davomat bilan bog‘langan. Avans, bonus, ushlanma va qisman to‘lovlar bitta hisob-kitobda yuritiladi.", points: ["4 xil stavka turi", "Avans, bonus, ushlanma", "Qisman va to‘liq to‘lov"], alt: "Staffora ish haqi moduli: hisoblangan summa, to‘lov holati va filiallar bo‘yicha xarajat" },
      { label: "Staffora AI", title: "Staffora AI — savol bering, javob real raqamlardan", desc: "Yordamchi bazadagi haqiqiy ma’lumotlardan javob beradi. Ma’lumotni o‘zgartiruvchi har qanday buyruq faqat siz tasdiqlaganingizdan keyin bajariladi.", points: ["Bazadagi real ma’lumot", "O‘zgarish faqat tasdiq bilan", "Ovozli buyruq"], alt: "Staffora AI oynasi: filiallar bo‘yicha bugungi davomat statistikasi jadvali" },
      { label: "Xarita", title: "Xarita va hisobotlar — filiallar bir nigohda", desc: "Filiallar, ruxsat etilgan radius va belgilangan joylarni xaritada kuzating. Davomat, tabel va ish haqi hisobotlarini Excel yoki 1C uchun yuklab oling.", points: ["Geozona va radius", "Excel va CSV", "1C uchun eksport"], alt: "Staffora xaritasi: filiallar joylashuvi va bugun kelgan xodimlar soni" },
    ],
  },
  payroll: {
    eyebrow: "Ish haqi moduli",
    title: "Har qanday stavka — bitta aniq hisob-kitob.",
    desc: "Staffora ish haqini davomat ma’lumotidan avtomatik hisoblaydi. Xodim qaysi stavkada ishlashidan qat’i nazar, raqamlar tushunarli va tekshiriladigan.",
    result: "Hisoblanadi",
    units: { currency: "so‘m", day: "kun", hour: "soat", piece: "dona", fixed: "Belgilangan oylik" },
    types: [
      { name: "Oylik", desc: "Qat’iy oylik maosh. Kechikish va ushlanmalar sozlamaga ko‘ra hisobga olinadi." },
      { name: "Kunlik", desc: "Har bir ishlangan kun uchun to‘lov — davomatdan avtomatik." },
      { name: "Soatbay", desc: "Ishlangan soatlar bo‘yicha: kirish va chiqish vaqtidan." },
      { name: "Ishbay", desc: "Bajarilgan ish hajmi bo‘yicha: tasdiqlangan natijalardan." },
    ],
    features: [
      { title: "Stavka tarixi", desc: "Stavka o‘zgarsa, o‘tgan davrlar eski stavkada qoladi — hisob buzilmaydi." },
      { title: "Avans, bonus va jarima", desc: "Har bir qo‘shimcha yoki ushlanma sababi bilan saqlanadi." },
      { title: "Qisman va to‘liq to‘lov", desc: "Ish haqini bo‘lib to‘lang: tizim qoldiqni o‘zi kuzatadi." },
      { title: "Audit jurnali", desc: "Kim, qachon va nimani o‘zgartirgani — har bir amal yozib boriladi." },
    ],
    slip: { period: "Noyabr 2026 · hisob varag‘i", employee: "Nodira Yusupova", type: "Kunlik", accrued: "Hisoblangan · 22 kun", bonus: "Bonus", advance: "Avans", penalty: "Jarima · kechikish", total: "To‘lanadi", paid: "To‘langan", remaining: "Qoldiq", partial: "Qisman to‘langan", audit: "Har bir o‘zgarish audit jurnalida saqlanadi" },
    cta: "Ish haqi modulini sinab ko‘rish",
  },
  ai: {
    eyebrow: "Staffora AI",
    title: "Savol bering. Javob — bazadagi real raqamlardan.",
    desc: "Staffora AI kompaniyangiz ma’lumotlarini tushunadi: davomat, xodimlar, arizalar va ish haqi. U taxmin qilmaydi va sizning ruxsatingizsiz hech narsani o‘zgartirmaydi.",
    status: "Tayyor",
    providers: "Qo‘llab-quvvatlanadigan provayderlar",
    points: [
      { title: "Faqat real ma’lumot", desc: "Javoblar bazadagi haqiqiy yozuvlardan, sizga ruxsat etilgan doirada." },
      { title: "O‘zgarish faqat tasdiq bilan", desc: "Ma’lumotni o‘zgartiruvchi buyruq avval tasdiqlash kartasi sifatida chiqadi." },
      { title: "O‘z API kalitingiz", desc: "OpenAI, Gemini, Claude yoki Groq — o‘zingizga qulay provayderni ulang." },
      { title: "Telegram bot va ovozli buyruq", desc: "Savolni Telegram orqali yozing yoki ovoz bilan buyruq bering." },
    ],
    chat: {
      q1: "Bugun kim kechikdi?",
      a1Title: "Bugun 4 xodim kechikdi",
      a1Head: ["Xodim", "Keldi", "Kechikish"],
      a1Rows: [["Bekzod Ergashev", "09:24", "+24 daq"], ["Jasur Toshmatov", "09:12", "+12 daq"], ["Otabek Nurmatov", "09:07", "+7 daq"], ["Sardor Aliyev", "09:05", "+5 daq"]],
      a1Note: "Manba: bugungi davomat · 42 xodimdan 33 nafari ishda",
      q2: "ID E-1001 bugun 08:30 da keldi deb belgila",
      confirmBadge: "Tasdiqlash kerak",
      confirmIntro: "Quyidagi o‘zgarish kiritiladi:",
      fields: [["Xodim", "E-1001 · Xurshidbek Abdullayev"], ["Amal", "Kirish vaqtini belgilash"], ["Vaqt", "Bugun, 08:30"]],
      confirm: "Tasdiqlash",
      cancel: "Bekor qilish",
      done: "Bajarildi. O‘zgarish audit jurnaliga yozildi.",
      cancelled: "Bekor qilindi. Ma’lumot o‘zgarmadi.",
      typing: "Staffora AI yozmoqda",
      input: "Savol yoki buyruq yozing…",
      replay: "Suhbatni qayta ko‘rsatish",
      footnote: "Javoblar faqat sizga ruxsat etilgan ma’lumotlardan",
    },
  },
  showcase: {
    eyebrow: "Haqiqiy mahsulot",
    title: "Har bir jarayon ustidan to‘liq nazorat.",
    desc: "Sodda interfeys, tez qarorlar. Staffora’ning mavjud ishchi interfeysi bilan tanishing.",
    tabs: ["Dashboard", "Ish haqi", "Stavkalar", "Staffora AI", "Davomat", "Xodimlar", "Kalendar", "Hisobotlar"],
    details: ["Muhim ko‘rsatkichlar va kunlik holat bir qarashda.", "Hisoblangan, to‘lanadigan va to‘langan summalar — stavka turlari kesimida.", "Har bir xodimning stavkasi va kuchga kirgan sanasi: o‘tgan oylar o‘z stavkasida qoladi.", "Savolga bazadagi raqamlar bilan javob: masalan, filiallar bo‘yicha davomat.", "Kelish-ketishlar va istisnolarni real vaqtda boshqaring.", "Jamoa tarkibi va profillarini tez toping.", "Ish kunlari va muhim sanalarni rejalashtiring.", "Qaror uchun tushunarli va eksport qilinadigan hisobotlar."],
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
    live: "Super Admin sozlamalari bilan avtomatik yangilanadi",
    plans: [
      { name: "FREE", note: "Kichik jamoalar uchun", features: ["10 nafargacha xodim", "1 ta filial", "2 ta rahbar", "Asosiy davomat moduli", "Ish stoli"] },
      { name: "PRO", note: "O‘sayotgan biznes uchun", features: ["Ko‘proq xodimlar", "Kengaytirilgan boshqaruv", "Qo‘shimcha modullar", "Kengaytirilgan hisobotlar", "Ustuvor yordam"] },
      { name: "ENTERPRISE", note: "Katta korxonalar uchun", features: ["Individual konfiguratsiya", "Kengaytirilgan imkoniyatlar", "Maxsus qo‘llab-quvvatlash", "Moslashtirilgan joriy etish", "Xavfsizlik nazorati"] },
    ],
  },
  stats: { eyebrow: "Ishonchli o‘sish", title: "Raqamlar ortida haqiqiy natijalar.", note: "* 2026-yil noyabr holatidagi tasdiqlangan platforma ko‘rsatkichlari.", items: [{ value: "10+", label: "Staffora’dan foydalanayotgan korxona" }, { value: "1 500+", label: "Nazorat uchun saqlangan audit yozuvi" }, { value: "9", label: "Yagona tizimdagi boshqaruv yo‘nalishi" }] },
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
  hero: { badge: "Современная платформа управления персоналом", line1: "Управлять командой", accent: "теперь намного проще.", desc: "Управляйте сотрудниками, посещаемостью, рабочими процессами и компанией в единой платформе Staffora. Все процессы в одном месте, а контроль — всегда в ваших руках.", start: "Начать со Staffora", explore: "Смотреть возможности", proof: ["10+ компаний", "1 500+ записей аудита", "Посещаемость и процессы"], floats: [{ title: "Дильдора Ахмедова пришла", meta: "08:58 · Face ID · GPS" }, { title: "Зарплата рассчитана", meta: "сум · 42 сотрудника", value: 204390638 }, { title: "Staffora AI", meta: "опоздали сегодня", value: 4 }], ticker: ["Посещаемость по Face ID", "GPS-геозона", "QR и терминал", "Оклад · дневная · почасовая · сдельная", "Авансы и бонусы", "Частичная выплата", "Staffora AI", "Telegram-бот", "Голосовые команды", "Много филиалов", "Табель Т-13", "Экспорт в Excel и 1С", "Отпуска и заявки", "Журнал аудита"] },
  features: { eyebrow: "Единый центр управления", title: "Все возможности для бизнеса — в одной платформе.", desc: "Staffora создана, чтобы упростить ежедневные процессы и сделать управление эффективнее.", items: [
    { title: "Контроль посещаемости", desc: "Точно отслеживайте приход, уход, опоздания и рабочее время." }, { title: "Управление сотрудниками", desc: "Сотрудники, должности, отделы и филиалы в одном месте." }, { title: "Карта и геолокация", desc: "Просматривайте разрешённые данные местоположения рабочих процессов." }, { title: "Рабочий стол", desc: "Ежедневные задачи и важные показатели для команды и руководителей." }, { title: "Календарь", desc: "Рабочие дни, важные даты и запланированные процессы." }, { title: "Отпуска и заявки", desc: "Быстро рассматривайте отпуска, разрешения и другие заявки." }, { title: "Отчёты и табель", desc: "Статистика посещаемости, рабочего времени и табель." }, { title: "Финансы и зарплата", desc: "Оклад, дневная, почасовая и сдельная оплата, авансы и выплаты." }, { title: "Документы и формы", desc: "Безопасно храните документы, опросы и формы." }
  ] },
  story: {
    eyebrow: "Знакомство с продуктом",
    title: "Одна платформа — весь рабочий день под контролем.",
    desc: "Прокрутите вниз: каждый раздел открывается на реальном экране продукта.",
    progress: "Разделы",
    steps: [
      { label: "Панель", title: "Панель управления — состояние дня с первого взгляда", desc: "Кто на работе, кто опоздал и какие заявки ждут ответа — всё на одном экране. Фильтр по филиалу и дате в один клик.", points: ["Показатели в реальном времени", "Очередь заявок", "Срез по филиалам"], alt: "Панель управления Staffora: карточки посещаемости за сегодня, заявки и таблица приходов и уходов" },
      { label: "Посещаемость", title: "Посещаемость — Face ID, GPS и QR", desc: "Сотрудник отмечает приход и уход с телефона или терминала, система проверяет лицо и геопозицию. Опоздания и переработки считаются автоматически.", points: ["Проверка Face ID", "GPS-геозона", "QR и терминал"], alt: "Страница посещаемости Staffora: время прихода и ухода сотрудников, отметки Face ID и GPS" },
      { label: "Зарплата", title: "Зарплата — у каждого сотрудника своя ставка", desc: "Оклад, дневная, почасовая и сдельная ставки связаны с посещаемостью. Авансы, бонусы, удержания и частичные выплаты — в одном расчёте.", points: ["4 типа ставок", "Авансы, бонусы, удержания", "Частичная и полная выплата"], alt: "Модуль зарплаты Staffora: начисленная сумма, статус выплат и расходы по филиалам" },
      { label: "Staffora AI", title: "Staffora AI — спросите, ответ из реальных данных", desc: "Ассистент отвечает по фактическим данным из базы. Любая команда, меняющая данные, выполняется только после вашего подтверждения.", points: ["Реальные данные из базы", "Изменения только с подтверждением", "Голосовые команды"], alt: "Окно Staffora AI: таблица посещаемости по филиалам за сегодня" },
      { label: "Карта", title: "Карта и отчёты — все филиалы на виду", desc: "Филиалы, разрешённый радиус и точки отметок на карте. Отчёты по посещаемости, табелю и зарплате — в Excel или для 1С.", points: ["Геозоны и радиус", "Excel и CSV", "Экспорт в 1С"], alt: "Карта Staffora: расположение филиалов и число пришедших сотрудников" },
    ],
  },
  payroll: {
    eyebrow: "Модуль зарплаты",
    title: "Любая ставка — один точный расчёт.",
    desc: "Staffora рассчитывает зарплату автоматически по данным посещаемости. На какой бы ставке ни работал сотрудник, цифры понятны и проверяемы.",
    result: "Начислено",
    units: { currency: "сум", day: "дн.", hour: "ч", piece: "шт.", fixed: "Фиксированный оклад" },
    types: [
      { name: "Оклад", desc: "Фиксированная месячная зарплата. Опоздания и удержания учитываются по настройкам." },
      { name: "Дневная", desc: "Оплата за каждый отработанный день — автоматически из посещаемости." },
      { name: "Почасовая", desc: "По отработанным часам: из времени прихода и ухода." },
      { name: "Сдельная", desc: "По объёму выполненной работы: из подтверждённых результатов." },
    ],
    features: [
      { title: "История ставок", desc: "Если ставка меняется, прошлые периоды остаются на прежней ставке." },
      { title: "Авансы, бонусы и штрафы", desc: "Каждое начисление или удержание хранится вместе с причиной." },
      { title: "Частичная и полная выплата", desc: "Платите частями — система сама отслеживает остаток." },
      { title: "Журнал аудита", desc: "Кто, когда и что изменил — фиксируется каждое действие." },
    ],
    slip: { period: "Ноябрь 2026 · расчётный лист", employee: "Нодира Юсупова", type: "Дневная", accrued: "Начислено · 22 дн.", bonus: "Бонус", advance: "Аванс", penalty: "Штраф · опоздание", total: "К выплате", paid: "Выплачено", remaining: "Остаток", partial: "Выплачено частично", audit: "Каждое изменение сохраняется в журнале аудита" },
    cta: "Попробовать модуль зарплаты",
  },
  ai: {
    eyebrow: "Staffora AI",
    title: "Спросите. Ответ — из реальных данных вашей базы.",
    desc: "Staffora AI понимает данные компании: посещаемость, сотрудников, заявки и зарплату. Он не гадает и ничего не меняет без вашего разрешения.",
    status: "Готов",
    providers: "Поддерживаемые провайдеры",
    points: [
      { title: "Только реальные данные", desc: "Ответы из фактических записей базы в пределах ваших прав доступа." },
      { title: "Изменения только с подтверждением", desc: "Команда, меняющая данные, сначала появляется как карточка подтверждения." },
      { title: "Свой API-ключ", desc: "OpenAI, Gemini, Claude или Groq — подключите удобного провайдера." },
      { title: "Telegram-бот и голосовые команды", desc: "Задайте вопрос в Telegram или дайте команду голосом." },
    ],
    chat: {
      q1: "Кто сегодня опоздал?",
      a1Title: "Сегодня опоздали 4 сотрудника",
      a1Head: ["Сотрудник", "Пришёл", "Опоздание"],
      a1Rows: [["Бекзод Эргашев", "09:24", "+24 мин"], ["Жасур Тошматов", "09:12", "+12 мин"], ["Отабек Нурматов", "09:07", "+7 мин"], ["Сардор Алиев", "09:05", "+5 мин"]],
      a1Note: "Источник: посещаемость за сегодня · на работе 33 из 42",
      q2: "Отметь, что ID E-1001 сегодня пришёл в 08:30",
      confirmBadge: "Нужно подтверждение",
      confirmIntro: "Будет внесено изменение:",
      fields: [["Сотрудник", "E-1001 · Хуршидбек Абдуллаев"], ["Действие", "Отметка времени прихода"], ["Время", "Сегодня, 08:30"]],
      confirm: "Подтвердить",
      cancel: "Отменить",
      done: "Готово. Изменение записано в журнал аудита.",
      cancelled: "Отменено. Данные не изменены.",
      typing: "Staffora AI печатает",
      input: "Напишите вопрос или команду…",
      replay: "Показать диалог снова",
      footnote: "Ответы только из доступных вам данных",
    },
  },
  showcase: { eyebrow: "Реальный продукт", title: "Полный контроль каждого процесса.", desc: "Простой интерфейс и быстрые решения. Познакомьтесь с рабочим интерфейсом Staffora.", tabs: ["Дашборд", "Зарплата", "Ставки", "Staffora AI", "Посещаемость", "Сотрудники", "Календарь", "Отчёты"], details: ["Ключевые показатели и состояние дня с первого взгляда.", "Начислено, к выплате и выплачено — в разрезе типов ставок.", "Ставка каждого сотрудника и дата вступления в силу: прошлые месяцы остаются на своей ставке.", "Ответ на вопрос цифрами из базы: например, посещаемость по филиалам.", "Приходы, уходы и исключения в реальном времени.", "Быстрый поиск состава команды и профилей.", "Планирование рабочих дней и важных дат.", "Понятные экспортируемые отчёты для решений."] },
  steps: { eyebrow: "Как это работает", title: "Работать со Staffora очень просто.", items: [{ title: "Регистрация", desc: "Начните использовать Staffora для своей компании." }, { title: "Добавьте команду", desc: "Добавьте сотрудников и назначьте нужные роли." }, { title: "Начните управлять", desc: "Контролируйте посещаемость и процессы из одного места." }] },
  pricing: { ...uz.pricing, eyebrow: "Прозрачные тарифы", title: "Выберите тариф для своего бизнеса.", desc: "Мы не показываем неподтверждённые цены. Начните с нужных функций и растите вместе с командой.", popular: "Популярный", custom: "Индивидуальная цена", start: "Начать", contact: "Связаться", live: "Обновляется автоматически из настроек Super Admin", plans: [{ name: "FREE", note: "Для небольших команд", features: ["До 10 сотрудников", "1 филиал", "2 руководителя", "Базовая посещаемость", "Рабочий стол"] }, { name: "PRO", note: "Для растущего бизнеса", features: ["Больше сотрудников", "Расширенное управление", "Дополнительные модули", "Расширенные отчёты", "Приоритетная поддержка"] }, { name: "ENTERPRISE", note: "Для крупных компаний", features: ["Индивидуальная конфигурация", "Расширенные возможности", "Особая поддержка", "Настроенное внедрение", "Контроль безопасности"] }] },
  stats: { eyebrow: "Уверенный рост", title: "За цифрами — реальные результаты.", note: "* Подтверждённые показатели платформы на ноябрь 2026 года.", items: [{ value: "10+", label: "компаний используют Staffora" }, { value: "1 500+", label: "записей аудита для контроля" }, { value: "9", label: "направлений управления в одной системе" }] },
  about: { eyebrow: "О Staffora", title: "Создано, чтобы упростить управление бизнесом.", p1: "Staffora — современная цифровая платформа, упрощающая управление сотрудниками и ежедневными процессами компании.", p2: "Наша цель — помочь компаниям экономить время, систематизировать процессы и повышать эффективность управления.", values: [{ title: "Просто", desc: "Превращаем сложные процессы в понятные сценарии." }, { title: "Надёжно", desc: "Каждое важное действие защищено контролем и аудитом." }, { title: "Локально", desc: "Создано под реальные потребности бизнеса Узбекистана." }] },
  faq: { eyebrow: "Вопросы", title: "Часто задаваемые вопросы.", items: [{ q: "Что такое Staffora?", a: "HRM-платформа для управления сотрудниками, посещаемостью и рабочими процессами в одном месте." }, { q: "Для кого предназначена Staffora?", a: "Для организаций от небольших команд до компаний с множеством филиалов." }, { q: "Как подключить компанию?", a: "Отправьте заявку на демо или перейдите в приложение — команда поможет с тарифом и запуском." }, { q: "Как добавить сотрудников?", a: "В панели руководителя можно добавить сотрудника вручную или импортировать список." }, { q: "Работает ли Staffora на мобильных устройствах?", a: "Да: Telegram Mini App и мобильное приложение для сотрудников, responsive-панель для руководителей." }, { q: "Есть ли бесплатный тариф?", a: "Да. FREE включает базовую посещаемость и управление для небольшой команды." }, { q: "Где получить поддержку?", a: "В центре поддержки, Telegram или по электронной почте." }] },
  contact: { eyebrow: "Контакты", title: "Готовы вывести компанию на новый уровень?", desc: "Свяжитесь с нами, чтобы узнать больше о Staffora или начать сотрудничество.", name: "Ваше имя", phone: "Телефон", company: "Компания", message: "Сообщение (необязательно)", send: "Запросить демо", sending: "Отправка…", success: "Заявка принята. Мы скоро свяжемся.", error: "Не удалось отправить. Попробуйте ещё раз.", channels: "Или свяжитесь напрямую" },
  footer: { desc: "Сотрудники, посещаемость и ежедневные процессы в одной платформе.", product: "Продукт", company: "Компания", legal: "Правовая информация", rights: "Все права защищены.", links: ["Возможности", "Тарифы", "О нас", "Контакты", "Конфиденциальность", "Условия", "Поддержка"] },
  common: { learn: "Подробнее", back: "На главную" },
};

const en: SiteContent = {
  ...uz,
  nav: ["Home", "Features", "Pricing", "About", "Contact"], login: "Sign in", menu: "Menu",
  hero: { badge: "Modern workforce management platform", line1: "Managing your team", accent: "just became easier.", desc: "Manage people, attendance, workflows and company operations in one Staffora workspace. Every process in one place, always under your control.", start: "Get started with Staffora", explore: "Explore features", proof: ["10+ companies", "1,500+ audit records", "Attendance and workflows"], floats: [{ title: "Dildora Ahmedova checked in", meta: "08:58 · Face ID · GPS" }, { title: "Payroll calculated", meta: "UZS · 42 employees", value: 204390638 }, { title: "Staffora AI", meta: "employees late today", value: 4 }], ticker: ["Face ID attendance", "GPS geofence", "QR and terminal", "Monthly · daily · hourly · piece rate", "Advances and bonuses", "Partial payments", "Staffora AI", "Telegram bot", "Voice commands", "Multi-branch", "T-13 timesheet", "Excel and 1C export", "Leave and requests", "Audit log"] },
  features: { eyebrow: "One command center", title: "Everything your business needs — in one platform.", desc: "Staffora simplifies daily operations and helps your company run with clarity.", items: [
    { title: "Attendance", desc: "Track arrivals, departures, lateness and working time accurately." }, { title: "People management", desc: "Manage employees, roles, departments and branches in one place." }, { title: "Maps & geolocation", desc: "View permitted work-related location information." }, { title: "Workspace", desc: "Daily work and essential metrics for employees and managers." }, { title: "Calendar", desc: "Track workdays, important dates and scheduled processes." }, { title: "Leave & requests", desc: "Review leave, permission and other requests quickly." }, { title: "Reports & timesheets", desc: "Attendance statistics, working time and timesheet reports." }, { title: "Finance & payroll", desc: "Monthly, daily, hourly and piece-rate pay, advances and payouts." }, { title: "Documents & forms", desc: "Store documents, surveys and forms securely." }
  ] },
  story: {
    eyebrow: "Product tour",
    title: "One platform — the whole workday under control.",
    desc: "Scroll down: each part opens on a real product screen.",
    progress: "Sections",
    steps: [
      { label: "Dashboard", title: "Dashboard — today’s status at a glance", desc: "Who is in, who is late and which requests are waiting — all on one screen. Filter by branch and date in one click.", points: ["Real-time metrics", "Request queue", "Branch breakdown"], alt: "Staffora dashboard: today’s attendance cards, requests and the check-in table" },
      { label: "Attendance", title: "Attendance — Face ID, GPS and QR", desc: "Employees check in and out on their phone or a terminal while the system verifies face and location. Lateness and overtime are calculated automatically.", points: ["Face ID check", "GPS geofence", "QR and terminal"], alt: "Staffora attendance page: employee check-in and check-out times with Face ID and GPS badges" },
      { label: "Payroll", title: "Payroll — every employee on their own rate", desc: "Monthly, daily, hourly and piece rates are tied to attendance. Advances, bonuses, deductions and partial payments live in one calculation.", points: ["4 rate types", "Advances, bonuses, deductions", "Partial and full payments"], alt: "Staffora payroll module: calculated totals, payment status and costs by branch" },
      { label: "Staffora AI", title: "Staffora AI — ask, and get answers from real numbers", desc: "The assistant answers from the actual data in your database. Any command that changes data runs only after you confirm it.", points: ["Real data from your database", "Changes only with confirmation", "Voice commands"], alt: "Staffora AI panel: today’s attendance statistics by branch" },
      { label: "Map", title: "Map and reports — every branch in view", desc: "Track branches, permitted radius and check-in points on the map. Export attendance, timesheet and payroll reports to Excel or 1C.", points: ["Geofence and radius", "Excel and CSV", "1C export"], alt: "Staffora map: branch locations and the number of employees checked in today" },
    ],
  },
  payroll: {
    eyebrow: "Payroll module",
    title: "Any pay rate — one precise calculation.",
    desc: "Staffora calculates payroll automatically from attendance data. Whatever rate an employee is on, the numbers stay clear and verifiable.",
    result: "Calculated",
    units: { currency: "UZS", day: "days", hour: "hours", piece: "pcs", fixed: "Fixed monthly salary" },
    types: [
      { name: "Monthly", desc: "A fixed monthly salary. Lateness and deductions follow your settings." },
      { name: "Daily", desc: "Paid for every day worked — straight from attendance." },
      { name: "Hourly", desc: "Based on hours worked, from check-in and check-out times." },
      { name: "Piece rate", desc: "Based on output, from approved work results." },
    ],
    features: [
      { title: "Rate history", desc: "When a rate changes, past periods keep the old rate." },
      { title: "Advances, bonuses and penalties", desc: "Every addition or deduction is stored with its reason." },
      { title: "Partial and full payments", desc: "Pay in instalments — the system tracks the balance." },
      { title: "Audit log", desc: "Who changed what and when — every action is recorded." },
    ],
    slip: { period: "November 2026 · payslip", employee: "Nodira Yusupova", type: "Daily", accrued: "Accrued · 22 days", bonus: "Bonus", advance: "Advance", penalty: "Penalty · lateness", total: "Net pay", paid: "Paid", remaining: "Balance", partial: "Partially paid", audit: "Every change is kept in the audit log" },
    cta: "Try the payroll module",
  },
  ai: {
    eyebrow: "Staffora AI",
    title: "Ask anything. Answers come from your real data.",
    desc: "Staffora AI understands your company data: attendance, people, requests and payroll. It doesn’t guess, and it changes nothing without your permission.",
    status: "Ready",
    providers: "Supported providers",
    points: [
      { title: "Real data only", desc: "Answers come from actual records, within the access you have." },
      { title: "Changes need confirmation", desc: "Any command that changes data first appears as a confirmation card." },
      { title: "Your own API key", desc: "OpenAI, Gemini, Claude or Groq — connect the provider you prefer." },
      { title: "Telegram bot and voice commands", desc: "Ask in Telegram or give a command by voice." },
    ],
    chat: {
      q1: "Who was late today?",
      a1Title: "4 employees were late today",
      a1Head: ["Employee", "Arrived", "Late by"],
      a1Rows: [["Bekzod Ergashev", "09:24", "+24 min"], ["Jasur Toshmatov", "09:12", "+12 min"], ["Otabek Nurmatov", "09:07", "+7 min"], ["Sardor Aliyev", "09:05", "+5 min"]],
      a1Note: "Source: today’s attendance · 33 of 42 at work",
      q2: "Mark ID E-1001 as arrived at 08:30 today",
      confirmBadge: "Confirmation required",
      confirmIntro: "The following change will be made:",
      fields: [["Employee", "E-1001 · Xurshidbek Abdullayev"], ["Action", "Set check-in time"], ["Time", "Today, 08:30"]],
      confirm: "Confirm",
      cancel: "Cancel",
      done: "Done. The change was written to the audit log.",
      cancelled: "Cancelled. No data was changed.",
      typing: "Staffora AI is typing",
      input: "Type a question or command…",
      replay: "Replay the conversation",
      footnote: "Answers only from data you can access",
    },
  },
  showcase: { eyebrow: "A real product", title: "Complete control over every workflow.", desc: "A calm interface for faster decisions. Explore the working Staffora experience.", tabs: ["Dashboard", "Payroll", "Pay rates", "Staffora AI", "Attendance", "People", "Calendar", "Reports"], details: ["Key metrics and today’s status at a glance.", "Calculated, payable and paid totals — broken down by rate type.", "Each employee’s rate and its effective date — past months keep their own rate.", "Questions answered with numbers from your data, such as attendance by branch.", "Manage arrivals, departures and exceptions in real time.", "Find your team and profiles quickly.", "Plan workdays and important dates.", "Clear, exportable reports built for decisions."] },
  steps: { eyebrow: "How it works", title: "Getting started is remarkably simple.", items: [{ title: "Create your account", desc: "Start using Staffora for your company." }, { title: "Add your team", desc: "Add employees and assign the right roles." }, { title: "Start managing", desc: "Control attendance and daily workflows from one place." }] },
  pricing: { ...uz.pricing, eyebrow: "Clear plans", title: "Choose the right plan for your business.", desc: "We do not invent unconfirmed prices. Start with the capabilities you need and scale with your team.", popular: "Most popular", custom: "Custom pricing", start: "Get started", contact: "Contact us", live: "Updates automatically from Super Admin settings", plans: [{ name: "FREE", note: "For small teams", features: ["Up to 10 employees", "1 branch", "2 managers", "Core attendance", "Workspace"] }, { name: "PRO", note: "For growing businesses", features: ["More employees", "Advanced management", "Additional modules", "Advanced reports", "Priority support"] }, { name: "ENTERPRISE", note: "For large organizations", features: ["Custom configuration", "Advanced capabilities", "Dedicated support", "Tailored onboarding", "Security controls"] }] },
  stats: { eyebrow: "Steady growth", title: "Real outcomes behind the numbers.", note: "* Verified platform figures as of November 2026.", items: [{ value: "10+", label: "companies using Staffora" }, { value: "1,500+", label: "audit records supporting control" }, { value: "9", label: "management areas in one system" }] },
  about: { eyebrow: "About Staffora", title: "Built to make business management simpler.", p1: "Staffora is a modern digital platform that simplifies people management and everyday company operations.", p2: "Our mission is to help companies save time, systemize processes and improve management effectiveness.", values: [{ title: "Simple", desc: "We turn complex operations into clear workflows." }, { title: "Reliable", desc: "Every important action is protected by control and audit." }, { title: "Local", desc: "Built around the real needs of businesses in Uzbekistan." }] },
  faq: { eyebrow: "FAQ", title: "Questions, answered.", items: [{ q: "What is Staffora?", a: "An HRM platform for managing people, attendance and daily workflows in one place." }, { q: "Who is Staffora for?", a: "Organizations ranging from small teams to multi-branch companies." }, { q: "How do I connect my company?", a: "Submit a demo request or open the app. Our team will help with the right plan and rollout." }, { q: "How do I add employees?", a: "Managers can add employees manually or import an existing list." }, { q: "Does Staffora work on mobile?", a: "Yes: a Telegram Mini App and mobile app for employees, plus a responsive manager panel." }, { q: "Is there a free plan?", a: "Yes. FREE includes core attendance and management for a small team." }, { q: "Where can I get support?", a: "Use the support center, Telegram or email." }] },
  contact: { eyebrow: "Contact", title: "Ready to move your company forward?", desc: "Talk to us to learn more about Staffora or begin your rollout.", name: "Your name", phone: "Phone number", company: "Company name", message: "Message (optional)", send: "Request a demo", sending: "Sending…", success: "Your request is in. We’ll contact you soon.", error: "Could not send your request. Please try again.", channels: "Or contact us directly" },
  footer: { desc: "Manage people, attendance and daily operations in one platform.", product: "Product", company: "Company", legal: "Legal", rights: "All rights reserved.", links: ["Features", "Pricing", "About", "Contact", "Privacy", "Terms", "Support"] },
  common: { learn: "Learn more", back: "Back to home" },
};

export const content: Record<Lang, SiteContent> = { uz, ru, en };

export const navHref = ["/#home", "/#features", "/#pricing", "/#about", "/#contact"];
