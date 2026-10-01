/*
 * Rus tili. Interfeys o‘zbekcha yozilgan; ruscha tanlanganda ko‘rsatilgan matn
 * (matn tugunlari va placeholder / title / aria-label) lug‘at bo‘yicha almashtiriladi.
 * Shu tufayli komponentlar kodini o‘zgartirmasdan butun ekran tarjima bo‘ladi,
 * o‘zbekchaga qaytilganda asl matn tiklanadi.
 */

export type Lang = "uz" | "ru";
const STORAGE_KEY = "staffora_lang";

export function storedLang(): Lang | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "ru" || value === "uz" ? value : null;
  } catch {
    return null;
  }
}
export function rememberLang(lang: Lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* saqlab bo‘lmasa ham ishlayveradi */
  }
}

/* ------------------------------------------------------------ lug‘at --- */
const RU: Record<string, string> = {
  // umumiy
  "Xatolik": "Ошибка",
  "Muvaffaqiyatli": "Успешно",
  "Yopish": "Закрыть",
  "Orqaga": "Назад",
  "Bekor qilish": "Отменить",
  "Saqlash": "Сохранить",
  "Yuborish": "Отправить",
  "Yuborilmoqda…": "Отправка…",
  "Qayta urinish": "Повторить",
  "Tanlang": "Выберите",
  "Turi": "Тип",
  "Sabab": "Причина",
  "Sabab (ixtiyoriy)": "Причина (необязательно)",
  "Boshlanish": "Начало",
  "Tugash": "Окончание",
  "Qisqacha yozing": "Кратко опишите",
  "Yangilanmoqda…": "Обновление…",
  "Tasdiq": "Подтверждение",
  "Kutilmoqda": "Ожидает",
  "Tasdiqlandi": "Одобрено",
  "Rad etildi": "Отклонено",
  "Bekor qilindi": "Отменено",
  "Yo‘q": "Нет",
  "Bugun": "Сегодня",
  "Kecha": "Вчера",
  "Boshqa": "Другое",
  "Staffora": "Staffora",
  // navigatsiya
  "Asosiy": "Главная",
  "Tarix": "История",
  "Ta’til": "Отпуск",
  "Profil": "Профиль",
  "Xabarnomalar": "Уведомления",
  "Xabarlar": "Сообщения",
  "Salom,": "Привет,",
  // kirish
  "Mini App Telegram tashqarisida ochildi. Uni botdagi «Staffora» tugmasi orqali oching.":
    "Mini App открыт вне Telegram. Откройте его кнопкой «Staffora» в боте.",
  "Kirish amalga oshmadi.": "Не удалось войти.",
  "Hisobingizni ulang": "Подключите аккаунт",
  "Kirib bo‘lmadi": "Не удалось войти",
  "Telegram orqali qayta oching.": "Откройте заново через Telegram.",
  "Botga qayting va": "Вернитесь в бот и нажмите",
  "«📱 Telefon raqamni yuborish»": "«📱 Отправить номер телефона»",
  "tugmasini bosing": "",
  "tugmasini bosing.": "",
  "Raqamingiz HR profilidagi bilan mos kelsa — Mini App’ni qayta oching":
    "Если номер совпадает с профилем в HR — откройте Mini App заново",
  "Botni ochish": "Открыть бот",
  // asosiy ekran
  "Ish kuni yakunlandi": "Рабочий день завершён",
  "Ishdasiz": "Вы на работе",
  "Bugun ta’tildasiz": "Сегодня вы в отпуске",
  "Dam olish kuni": "Выходной день",
  "Hali kelmagansiz": "Вы ещё не отметились",
  "Filial biriktirilmagan": "Филиал не назначен",
  "HR filial va grafikni biriktirishi kerak": "HR должен назначить филиал и график",
  "Dam olish": "Выходной",
  "Dam": "Вых.",
  "Keldi": "Пришёл",
  "Ketdi": "Ушёл",
  "Ishlangan": "Отработано",
  "Ishdan ketdim": "Я ухожу",
  "Ishga keldim": "Я пришёл",
  "kun keldi": "дней на работе",
  "kechikish": "опозданий",
  "soat": "часов",
  "soat ishladi": "часов отработано",
  "daq kechikish": "мин опозданий",
  "Bu oy": "В этом месяце",
  "daqiqa kechikdingiz": "мин опозданий",
  "gacha mashq davri — kechikish va ushlanmalar hisoblanmaydi.":
    "— пробный период, опоздания и удержания не считаются.",
  "Birinchi marta Face ID sozlanadi (~15 soniya). Yorug‘ joyda turing.":
    "При первом входе настраивается Face ID (~15 секунд). Встаньте в светлом месте.",
  "Ish vaqti tugadi": "Рабочее время закончилось",
  // davomat oqimi
  "Qurilma joylashuvni aniqlay olmaydi.": "Устройство не может определить местоположение.",
  "Joylashuvga ruxsat berilmagan. Telefon sozlamalarida Telegram uchun joylashuvni yoqing.":
    "Нет доступа к геолокации. Включите геолокацию для Telegram в настройках телефона.",
  "GPS signal topilmadi. Ochiq joyga chiqib qayta urinib ko‘ring.": "Нет сигнала GPS. Выйдите на открытое место и повторите.",
  "Joylashuv aniqlanmadi.": "Местоположение не определено.",
  "Joylashuv aniqlanmadi": "Местоположение не определено",
  "Tekshiruv amalga oshmadi.": "Проверка не удалась.",
  "Bu Staffora davomat QR kodi emas. Filial ekranidagi QR’ni skanerlang.":
    "Это не QR-код Staffora. Отсканируйте QR на экране филиала.",
  "Ishga kelish": "Приход на работу",
  "Ishdan ketish": "Уход с работы",
  "Joylashuv aniqlanmoqda…": "Определяем местоположение…",
  "Siz filial hududidasiz": "Вы на территории филиала",
  "Filialdan uzoqdasiz": "Вы далеко от филиала",
  "GPS yoqilgan bo‘lsin": "Включите GPS",
  "Qayta aniqlash": "Определить заново",
  "QR kodni skanerlash": "Сканировать QR-код",
  "Kamerani ochish": "Открыть камеру",
  "Ichki kamera orqali skanerlash": "Сканировать встроенной камерой",
  "Server tekshirmoqda…": "Сервер проверяет…",
  "Qayta yuborish": "Отправить снова",
  "Davomatni faqat filial hududida belgilash mumkin. Filialga yaqinroq kelib, ↻ tugmasini bosing.":
    "Отметиться можно только на территории филиала. Подойдите ближе и нажмите ↻.",
  "Kamerani ochib bo‘lmadi. Telegram’ga kamera ruxsatini bering.": "Не удалось открыть камеру. Разрешите Telegram доступ к камере.",
  // tarix
  "Davomat tarixi": "История посещений",
  "Hali davomat qaydlari yo‘q": "Записей пока нет",
  "Ish davom etmoqda": "Работа продолжается",
  "Kechikdi": "Опоздал",
  "Kechikkan": "Опоздание",
  "Vaqtida": "Вовремя",
  "Ishda": "На работе",
  "Kelmagan": "Не пришёл",
  // so‘rovlar
  "So‘rovlar": "Заявки",
  "Ta’til va smena almashish": "Отпуск и обмен сменами",
  "Smena almashish": "Обмен сменами",
  "Yangi so‘rov": "Новая заявка",
  "Hali so‘rov yubormagansiz": "Вы ещё не отправляли заявок",
  "So‘rov bekor qilindi": "Заявка отменена",
  "So‘rov HR’ga yuborildi": "Заявка отправлена в HR",
  "So‘rov yuborilmadi.": "Заявка не отправлена.",
  "Ta’til so‘rovi": "Заявка на отпуск",
  "HR ko‘rib chiqadi, javob Telegram’ga keladi": "HR рассмотрит, ответ придёт в Telegram",
  "Mehnat ta’tili": "Трудовой отпуск",
  "Kasallik": "Больничный",
  "Ruxsat (javob)": "Отгул",
  "Haq to‘lanmaydigan": "За свой счёт",
  // smena almashish
  "Smenani almashtirish": "Обменяться сменой",
  "Filialingizda boshqa xodim yo‘q.": "В вашем филиале нет других сотрудников.",
  "Sizga so‘rov keldi": "Вам пришла заявка",
  "Roziman": "Согласен",
  "Almashishlar yo‘q": "Обменов нет",
  "Hamkasb javobi": "Ждёт коллегу",
  "Rahbar tasdig‘i": "Ждёт руководителя",
  "Rozilik yuborildi — rahbar tasdig‘i kutilmoqda": "Согласие отправлено — ждём руководителя",
  "So‘rov hamkasbingizga yuborildi": "Заявка отправлена коллеге",
  "Hamkasb rozi bo‘lgach, rahbar tasdiqlaydi": "После согласия коллеги подтверждает руководитель",
  "Hamkasb": "Коллега",
  "Men bermoqchi bo‘lgan ish kunim": "Мой рабочий день, который отдаю",
  "Evaziga uning bir ish kunini olaman": "Взамен возьму его рабочий день",
  "Men ishlab beradigan kun": "День, который я отработаю",
  "Masalan: shifokor qabuli": "Например: приём у врача",
  "Siz ishlaysiz": "Работаете вы",
  "siz ishlaysiz": "работаете вы",
  "hamkasb ishlaydi": "работает коллега",
  "U ishlaydi": "Работает коллега",
  "Sabab:": "Причина:",
  // profil
  "Lavozim belgilanmagan": "Должность не указана",
  "Face ID yo‘q": "Нет Face ID",
  "✓ Face ID": "✓ Face ID",
  "Oylik": "Оклад",
  "Kechikish ushlanmasi": "Удержание за опоздания",
  "Ish joyi": "Место работы",
  "Kompaniya": "Компания",
  "Bo‘lim": "Отдел",
  "Filial": "Филиал",
  "Ish boshlagan": "Начал работать",
  "Aloqa": "Контакты",
  "Telefon": "Телефон",
  "Ulangan ✓": "Подключён ✓",
  "Ulanmagan": "Не подключён",
  "Ma’lumotlarni o‘zgartirish uchun HR bo‘limiga murojaat qiling.": "Чтобы изменить данные, обратитесь в HR.",
  "Til": "Язык",
  "Hujjatlarim": "Мои документы",
  "Yuklash": "Загрузить",
  "Hujjat yuklandi — HR ko‘radi": "Документ загружен — HR проверит",
  "Yuklab bo‘lmadi.": "Не удалось загрузить.",
  "Muddati o‘tgan": "Просрочен",
  "Hujjat turi": "Тип документа",
  "Amal qilish muddati": "Срок действия",
  "Amal qilish muddati (ixtiyoriy)": "Срок действия (необязательно)",
  "Pasport / ID karta": "Паспорт / ID-карта",
  "Diplom": "Диплом",
  "Tibbiy ma’lumotnoma": "Медицинская справка",
  "Sanitariya daftarchasi": "Санитарная книжка",
  "Mehnat shartnomasi": "Трудовой договор",
  "Boshqa hujjat": "Другой документ",
  "Hisob varaqalari": "Расчётные листы",
  "Qo‘shimcha ish": "Сверхурочные",
  "Bonus": "Бонус",
  "Jarima": "Штраф",
  "Avans": "Аванс",
  "Ish kunlari": "Рабочие дни",
  "Qo‘lga": "К выплате",
  // xabarnomalar
  "Davomat": "Посещаемость",
  "E’lon": "Объявление",
  "Xabar": "Сообщение",
  "O‘qilmagan": "Непрочитанные",
  "Hammasi o‘qilgan": "Все прочитано",
  "O‘qildi": "Прочитано",
  "Xabarlar yo‘q": "Сообщений нет",
  "E’lonlar, ta’til javoblari va eslatmalar shu yerda ko‘rinadi.": "Здесь появятся объявления, ответы по отпускам и напоминания.",
  // hafta kunlari
  "Yakshanba": "Воскресенье",
  "Dushanba": "Понедельник",
  "Seshanba": "Вторник",
  "Chorshanba": "Среда",
  "Payshanba": "Четверг",
  "Shanba": "Суббота",
  "Ya": "Вс",
  "Du": "Пн",
  "Se": "Вт",
  "Ch": "Ср",
  "Pa": "Чт",
  "Ju": "Пт",
  "Sh": "Сб",
  // Face ID
  "Profil rasmini tayyorlab bo‘lmadi.": "Не удалось подготовить фото профиля.",
  "Tayyorlanmoqda": "Подготовка",
  "Kamera ochilmoqda…": "Открываем камеру…",
  "Face ID uchun sayt HTTPS orqali ochilishi kerak.": "Для Face ID сайт должен открываться по HTTPS.",
  "Kameraga kirish imkoni yo‘q. Telegram ilovasini yangilang.": "Нет доступа к камере. Обновите Telegram.",
  "Kameraga ruxsat so‘rovini tasdiqlang (Ruxsat berish / Allow)": "Разрешите доступ к камере (Разрешить / Allow)",
  "Yuzingizni doira ichiga joylang": "Поместите лицо в круг",
  "Yaqinroq keling": "Подойдите ближе",
  "Biroz uzoqroq turing": "Отодвиньтесь немного",
  "Yuzingizni markazga olib keling": "Поместите лицо в центр",
  "Juda qorong‘i — yorug‘roq joyga o‘ting": "Слишком темно — перейдите в светлое место",
  "Tekshiruv davomida boshqa yuz aniqlandi. Qaytadan boshlang.": "Во время проверки обнаружено другое лицо. Начните заново.",
  "Tekshiruv davomida boshqa yuz aniqlandi. Qaytadan urinib ko‘ring.": "Во время проверки обнаружено другое лицо. Попробуйте ещё раз.",
  "Kameraga to‘g‘ri qarang": "Смотрите прямо в камеру",
  "Qimirlamang…": "Не двигайтесь…",
  "Boshingizni sekin aylantiring": "Медленно поворачивайте голову",
  "Doirani to‘ldirish uchun boshingizni aylana bo‘ylab harakatlantiring": "Двигайте головой по кругу, чтобы заполнить круг",
  "Boshingizni kattaroq aylana bo‘ylab harakatlantiring": "Двигайте головой по большему кругу",
  "Davom eting…": "Продолжайте…",
  "Yana to‘g‘ri qarang": "Снова смотрите прямо",
  "Oxirgi namuna": "Последний снимок",
  "Kameraga qarang": "Смотрите в камеру",
  "Boshingizni chapga buring": "Поверните голову влево",
  "Boshingizni o‘ngga buring": "Поверните голову вправо",
  "Jonli odam ekanini tekshiramiz": "Проверяем, что вы живой человек",
  "Boshqa tomonga — chapga": "В другую сторону — влево",
  "Boshqa tomonga — o‘ngga": "В другую сторону — вправо",
  "Boshingizni biroz ko‘proq buring": "Поверните голову чуть сильнее",
  "Tekshirilmoqda": "Проверка",
  "Saqlanmoqda": "Сохранение",
  "Face ID sozlandi": "Face ID настроен",
  "Kameraga ruxsat berilmadi. Telefon sozlamalarida Telegram uchun kamerani yoqing.":
    "Нет доступа к камере. Разрешите камеру для Telegram в настройках телефона.",
  "Old kamera topilmadi.": "Фронтальная камера не найдена.",
  "Kamera boshqa ilova tomonidan band. Uni yopib qayta urinib ko‘ring.": "Камера занята другим приложением. Закройте его и повторите.",
  "Face ID tasdiqlanmadi.": "Face ID не подтверждён.",
  "Yuz tanilmadi": "Лицо не распознано",
  "Endi davomatni yuzingiz bilan tasdiqlaysiz": "Теперь вы отмечаетесь по лицу",
  "Face ID’ni sozlash": "Настройка Face ID",
  "Davomat faqat sizning yuzingiz bilan tasdiqlanadi. Buning uchun yuzingizni bir marta turli burchaklardan skanerlaymiz.":
    "Отметка подтверждается только вашим лицом. Для этого один раз отсканируем лицо с разных сторон.",
  "Yorug‘ joyda turing, ko‘zoynak va niqobni yeching": "Встаньте в светлом месте, снимите очки и маску",
  "Telefonni yuzingiz ro‘parasida ushlang": "Держите телефон напротив лица",
  "Boshingizni sekin aylantirib doirani to‘ldiring": "Медленно поворачивайте голову, заполняя круг",
  "Boshlash": "Начать",
  "Keyinroq": "Позже",
  "Yuz ma’lumoti shifrlangan vektor ko‘rinishida saqlanadi va faqat davomat uchun ishlatiladi.":
    "Данные лица хранятся в виде зашифрованного вектора и используются только для учёта посещаемости.",
  // server xabarlari (ko‘p uchraydiganlari)
  "Tarmoq xatosi. Internetni tekshiring.": "Ошибка сети. Проверьте интернет.",
  "Juda ko‘p so‘rov. Birozdan keyin urinib ko‘ring.": "Слишком много запросов. Попробуйте позже.",
  "O‘tgan kunni almashtirib bo‘lmaydi.": "Нельзя обменять прошедший день.",
  "Bu kun uchun ko‘rib chiqilayotgan so‘rov bor.": "На этот день уже есть заявка на рассмотрении.",
  "Hamkasb topilmadi.": "Коллега не найден.",
  "So‘rov topilmadi.": "Заявка не найдена.",
  "So‘rovga allaqachon javob berilgan.": "На заявку уже ответили.",
  // internetsiz rejim
  "Internet yo‘q": "Нет интернета",
  "Davomatni belgilashingiz mumkin — telefonda saqlanadi": "Можно отмечаться — отметка сохранится в телефоне",
  "Saqlandi": "Сохранено",
  "Internet kelishi bilan yuboriladi": "Отправится, когда появится интернет",
  "Hozir yuborish": "Отправить сейчас",
  // oyligim va avans
  "Mening oyligim": "Моя зарплата",
  "Taxminan qo‘lga": "Примерно к выплате",
  "Hozirgacha ishlab topilgan": "Заработано на сегодня",
  "Tasdiq kutayotgan qo‘shimcha ish": "Сверхурочные на подтверждении",
  "Olingan avans": "Полученный аванс",
  "Oy oxirigacha davomatga qarab o‘zgaradi. Yakuniy summa oy yopilgach hisob varaqasida keladi.":
    "Сумма меняется до конца месяца в зависимости от посещаемости. Итог придёт в расчётном листе после закрытия месяца.",
  "Avans so‘rash": "Запросить аванс",
  "Avans so‘rovi ko‘rib chiqilmoqda": "Заявка на аванс рассматривается",
  "Bu oy avans chegarasi tugagan": "Лимит аванса на этот месяц исчерпан",
  "Avans so‘rovlarim": "Мои заявки на аванс",
  "Avans so‘rovlari": "Заявки на аванс",
  "Avans mumkin": "Аванс доступен",
  "ushlanma": "удержание",
  "Hammasi": "Все",
  "Masalan: oilaviy sabab": "Например: семейные обстоятельства",
  "Masalan: 500 000": "Например: 500 000",
  "Yashirish": "Скрыть",
  "Ko‘rsatish": "Показать",
  "Avans so‘rovi yuborildi — javob Telegram’ga keladi": "Заявка на аванс отправлена — ответ придёт в Telegram",
  // rahbar rejimi
  "Rahbar": "Руководитель",
  "Kelmadi": "Не пришёл",
  "Hali yo‘q": "Ещё нет",
  "keldi": "пришли",
  "Bu ro‘yxatda hech kim yo‘q": "В этом списке никого нет",
  "Hamma so‘rovlar ko‘rib chiqilgan": "Все заявки рассмотрены",
  "Ta’til so‘rovlari": "Заявки на отпуск",
  "Ta’tilda": "В отпуске",
  "Mashq": "Пробный",
  "Davomatni ko‘rish huquqingiz yo‘q.": "Нет прав на просмотр посещаемости.",
  "Ta’til tasdiqlandi": "Отпуск одобрен",
  "Ta’til rad etildi": "Отпуск отклонён",
  "Almashish tasdiqlandi": "Обмен одобрен",
  "Avans tasdiqlandi": "Аванс одобрен",
  "Avans rad etildi": "Аванс отклонён",
  "Yangilash": "Обновить",
  "Qo‘ng‘iroq": "Позвонить",
  // ko‘rinish
  "Ko‘rinish": "Оформление",
  "Mavzu": "Тема",
  "Avto": "Авто",
  "Yorug‘": "Светлая",
  "Tungi": "Тёмная",
  "Shrift": "Шрифт",
  "Oddiy": "Обычный",
  "Katta": "Крупный",
  "Yuqori kontrast": "Высокий контраст",
  "📲 Telefon ekraniga Staffora yorlig‘ini qo‘shish": "📲 Добавить ярлык Staffora на экран телефона",
  "Telefon ekranida yorliq": "Ярлык на экране телефона",
  "Qo‘shilgan ✓": "Добавлен ✓",
};


/* Panel (veb) — menyu, sarlavhalar, tugmalar, jadval ustunlari. */
const RU_PANEL: Record<string, string> = {
  "Bosh sahifa": "Главная", "Xodimlar": "Сотрудники", "Kalendar": "Календарь", "Ta’til va yo‘qlik": "Отпуска и отсутствия",
  "Arizalar": "Анкеты", "Ishdan bo‘shaganlar": "Уволенные", "Tashkilot": "Организация", "Filiallar": "Филиалы",
  "Ish grafiklari": "Графики работы", "Bo‘limlar": "Отделы", "Lavozimlar": "Должности", "Hisobot va aloqa": "Отчёты и связь",
  "Ish haqi": "Зарплата", "Tahlil": "Аналитика", "Hisobotlar": "Отчёты", "E’lonlar": "Объявления", "Bildirishnomalar": "Уведомления",
  "Tizim": "Система", "Panel foydalanuvchilari": "Пользователи панели", "Rollar": "Роли", "Audit jurnali": "Журнал аудита",
  "Sozlamalar": "Настройки", "Yangi xodim": "Новый сотрудник", "Xodim profili": "Профиль сотрудника", "Chiqish": "Выйти",
  "Tizimdan chiqish": "Выйти из системы", "Menyuni yopish": "Закрыть меню", "Menyuni ochish": "Открыть меню",
  "Menyuni yoyish": "Развернуть меню", "Menyuni yig‘ish": "Свернуть меню", "Xodim qidirish": "Поиск сотрудника",
  "Xodim, ID yoki telefon…": "Сотрудник, ID или телефон…", "Ekranni qulflash": "Заблокировать экран", "Integratsiyalar": "Интеграции",
  "Xodim": "Сотрудник", "Holat": "Статус", "Grafik": "График", "Faol": "Активен", "Lavozim": "Должность",
  "Sana": "Дата", "Tanlang…": "Выберите…", "Kechikish": "Опоздание", "Ishladi": "Отработал", "Keldi → Ketdi": "Пришёл → Ушёл",
  "Qo‘shish": "Добавить", "Bot": "Бот", "Xato": "Ошибка", "Ulangan": "Подключён", "Barchasi": "Все", "Barcha filiallar": "Все филиалы",
  "Ishdan bo‘shatish": "Уволить", "Hammasi": "Все", "Nusxalash": "Копировать", "Xodim chegarasi": "Лимит сотрудников",
  "Hujjat yuklash": "Загрузить документ", "Tahrirlash": "Редактировать", "O‘chirish": "Удалить", "Dinamik QR": "Динамический QR",
  "Nofaol": "Неактивен", "Amal": "Действие", "Kim": "Кто", "Obyekt": "Объект", "Vaqt": "Время", "Nomi": "Название",
  "Foydalanuvchi": "Пользователь", "Rol": "Роль", "Telegram’ni uzish": "Отключить Telegram", "Qayta ishga olish": "Восстановить",
  "Butunlay o‘chirish": "Удалить навсегда", "Ulanish": "Подключение", "Ishlagan davr": "Стаж", "Bu oy kelgan": "Пришёл в этом месяце",
  "Uzish": "Отключить", "Profil rasmi": "Фото профиля", "Ma’lumot": "Информация", "Toifa": "Категория", "Maydon": "Поле",
  "Ogohlantirish": "Предупреждение", "Konfliktlar": "Конфликты", "Qayta": "Снова", "Ta’til qo‘shish": "Добавить отпуск",
  "Tasdiqlangan": "Одобрено", "Tasdiqlash": "Одобрить", "Telegram bot": "Telegram-бот", "Parol": "Пароль", "Ishlayapti": "Работает",
  "Grafik yaratish": "Создать график", "Platforma boshqaruvi": "Управление платформой", "Egasi": "Владелец", "Xodim / filial": "Сотр. / филиал",
  "Tarif": "Тариф", "Yaratilgan": "Создан", "Sinov": "Пробный", "Yo‘q, bekor qilish": "Нет, отменить", "Hujjat yo‘q": "Документов нет",
  "Ochish": "Открыть", "Hujjat o‘chirilsinmi?": "Удалить документ?", "Ma’lumot yo‘q": "Нет данных", "Eng intizomli": "Самые дисциплинированные",
  "Ko‘p kechikkanlar": "Чаще опаздывают", "Ko‘p kelmaganlar": "Чаще отсутствуют", "Vaqtida kelish": "Пунктуальность",
  "Kelmagan kunlar": "Дни отсутствия", "Filiallar reytingi": "Рейтинг филиалов", "Kunlik davomat": "Посещаемость по дням",
  "Keldi-ketdi": "Приход-уход", "Shubhali joylashuv": "Подозрительная геолокация", "Davomat qaydini o‘chirish": "Удалить отметку",
  "Ketgan": "Ушёл", "Belgilash": "Отметить", "Filialgacha masofa": "Расстояние до филиала", "Koordinata": "Координаты",
  "Xaritada ko‘rish →": "Открыть на карте →", "Hali filial yo‘q": "Филиалов пока нет", "Filialni o‘chirish": "Удалить филиал",
  "Filial qo‘shish": "Добавить филиал", "Birinchi filialni qo‘shish": "Добавить первый филиал", "Bugun keldi": "Сегодня пришли",
  "Radius": "Радиус", "Davomat kalendari": "Календарь посещаемости", "Qaydlar yo‘q": "Записей нет", "E’lonlar yo‘q": "Объявлений нет",
  "Yangi e’lon": "Новое объявление", "Yozuvlar yo‘q": "Записей нет", "E’lon yuborish": "Отправить объявление", "Topilmadi": "Не найдено",
  "Hammasini o‘qilgan qilish": "Отметить все прочитанными", "Hozircha voqealar yo‘q": "Событий пока нет",
  "Xodimlar hali qo‘shilmagan": "Сотрудники ещё не добавлены", "7 kun": "7 дней", "14 kun": "14 дней", "30 kun": "30 дней",
  "Telegram bot ishlamayapti": "Telegram-бот не работает", "Bugungi davomat · jonli": "Посещаемость сегодня · онлайн",
  "Davomat dinamikasi": "Динамика посещаемости", "O‘rtacha davomat": "Средняя посещаемость", "Kechikishlar": "Опоздания",
  "Kelmaganlar": "Отсутствующие", "Kech": "Поздно", "Davomat %": "Посещаемость %", "So‘nggi voqealar": "Последние события",
  "Bugungi jamoa": "Команда сегодня", "Yaqin tabriklar": "Ближайшие поздравления", "Rollar va ruxsatlar": "Роли и права",
  "Foydalanuvchini o‘chirish": "Удалить пользователя", "Yangi panel foydalanuvchisi": "Новый пользователь панели",
  "Foydalanuvchini tahrirlash": "Редактировать пользователя", "Foydalanuvchi qo‘shish": "Добавить пользователя",
  "Qaysi filiallarni ko‘radi?": "Какие филиалы видит?", "Tarif chegarasiga yetildi": "Достигнут лимит тарифа",
  "Shartnoma va maosh": "Договор и оклад", "Qo‘shimcha ma’lumotlar": "Дополнительные данные", "Ta’til so‘rovlari yo‘q": "Заявок на отпуск нет",
  "Xodim butunlay o‘chirilsinmi?": "Удалить сотрудника навсегда?", "Face ID’ni qayta sozlash": "Перенастроить Face ID",
  "Davomat qaydlari yo‘q": "Отметок нет", "Xodimni tahrirlash": "Редактировать сотрудника", "Ishdan bo‘shaganlar yo‘q": "Уволенных нет",
  "Butunlay o‘chirilsinmi?": "Удалить навсегда?", "Xodim qo‘shish": "Добавить сотрудника", "Barcha bo‘limlar": "Все отделы",
  "Faol va nofaol": "Активные и неактивные", "Qayd yo‘q": "Нет записи", "To‘liq stavka": "Полная ставка", "Yarim stavka": "Полставки",
  "Shartnoma": "Договор", "Nofaol (vaqtincha)": "Неактивен (временно)", "Bu oy kechikish": "Опоздания за месяц",
  "Bu oy ishlagan": "Отработано за месяц", "Oylik maosh": "Месячный оклад", "Xodimni butunlay o‘chirish": "Удалить сотрудника навсегда",
  "Qayta sozlash": "Перенастроить", "Kiritilmagan": "Не указано", "Ish haqi va KPI": "Зарплата и KPI",
  "Avans, bonus yoki jarima": "Аванс, бонус или штраф", "Oy qayta ochilsinmi?": "Открыть месяц заново?", "Avans, bonus, jarima": "Аванс, бонус, штраф",
  "Qo‘shimcha ishni tasdiqlash": "Подтвердить сверхурочные", "Maoshlarni kiritish": "Ввести оклады", "Maoshlar": "Оклады",
  "Qayta ochish": "Открыть заново", "Oyni yopish": "Закрыть месяц", "Varaqalarni qayta yuborish": "Отправить листы снова",
  "Qo‘shimcha": "Сверхурочные", "Ushlanma": "Удержание", "Jami qo‘lga": "Итого к выплате", "Excel yuklab olish": "Скачать Excel",
  "Ism-familiya": "Имя и фамилия", "Matn": "Текст", "Raqam": "Число", "Tug‘ilgan sana": "Дата рождения", "Summa": "Сумма",
  "Smena": "Смена", "Ish vaqti": "Рабочее время", "Hafta kuni": "День недели", "Anketa savollari": "Вопросы анкеты",
  "Standart": "Стандарт", "Savol qo‘shish": "Добавить вопрос", "Bot matnlari": "Тексты бота", "Sinxronlash": "Синхронизировать",
  "Xodim yo‘q": "Сотрудников нет", "Jurnal": "Журнал", "Yangilash": "Обновить", "Tayyor": "Готово", "Yangi": "Новый",
  "Hozir ishda": "Сейчас на работе", "Filial xodimlari": "Сотрудники филиала", "Rad etilgan": "Отклонено", "O‘chirilgan": "Удалено",
  "Rad etish": "Отклонить", "Grafik yo‘q": "Графиков нет", "Nusxa olish": "Копировать", "Grafikni o‘chirish": "Удалить график",
  "Tanaffus (daqiqa)": "Перерыв (мин)", "Qat’iy": "Строгий", "Moslashuvchan": "Гибкий", "Smenali": "Сменный",
  "Mening profilim": "Мой профиль", "Ulash": "Подключить", "Parolni o‘zgartirish": "Сменить пароль", "Parolni yangilash": "Обновить пароль",
  "Kirgan qurilmalar": "Устройства входа", "Boshqalaridan chiqish": "Выйти с других", "Shu qurilma": "Это устройство",
  "Kechikish uchun ushlanma": "Удержание за опоздание", "Qo‘shimcha ish uchun to‘lash": "Оплата сверхурочных",
  "Sababsiz kelmagan kun uchun ushlanma": "Удержание за прогул", "Rejim": "Режим", "Muammo": "Проблема", "Ekran qulfi": "Блокировка экрана",
  "Xavfli zona": "Опасная зона", "Barcha xodimlarni o‘chirish": "Удалить всех сотрудников", "Yangi kompaniya": "Новая компания",
  "Kompaniya yaratish": "Создать компанию", "To‘xtatilgan": "Приостановлена", "Email manzil": "Email", "Kompaniya nomi": "Название компании",
  "Smena almashish so‘rovlari yo‘q": "Заявок на обмен сменами нет", "Beradi": "Отдаёт", "Oladi": "Берёт", "Boshqaruv paneli": "Панель управления",
  "Tasdiq kutilmoqda": "Ожидает подтверждения", "Hamkasb javobi kutilmoqda": "Ждёт ответа коллеги", "Bekor qilingan": "Отменено",
  "Qo‘lda": "Вручную", "Qurilma": "Устройство", "Yuklanmoqda…": "Загрузка…", "Qidirish": "Поиск", "Qidirish…": "Поиск…",
  "Keyingi": "Далее", "Oldingi": "Назад", "Umumiy": "Общий", "Jami": "Итого", "Tavsif": "Описание", "Manzil": "Адрес", "Izoh": "Комментарий",
  "So‘rov tasdiqlandi": "Заявка одобрена", "So‘rov rad etildi": "Заявка отклонена", "Ta’til qo‘shildi": "Отпуск добавлен",
  "Almashish tasdiqlandi — grafik yangilandi": "Обмен одобрен — график обновлён", "Almashish rad etildi": "Обмен отклонён",
  "Kutilayotgan so‘rov yo‘q": "Ожидающих заявок нет", "So‘rovlar yo‘q": "Заявок нет",
  "Xodimlar Telegram Mini App orqali ta’til so‘rovi yuboradi.": "Сотрудники отправляют заявки на отпуск через Telegram Mini App.",
  "Til": "Язык",
  "ishlaydi": "работает", "Kompaniya egasi": "Владелец компании", "HR administrator": "HR-администратор",
  "HR mutaxassisi": "HR-специалист", "Moliya": "Финансы", "IT administrator": "IT-администратор", "Filial rahbari": "Руководитель филиала",
  "Super admin": "Суперадмин",
};
Object.assign(RU, RU_PANEL);

const MONTHS: Record<string, string> = {
  yanvar: "января", fevral: "февраля", mart: "марта", aprel: "апреля", may: "мая", iyun: "июня",
  iyul: "июля", avgust: "августа", sentabr: "сентября", oktabr: "октября", noyabr: "ноября", dekabr: "декабря",
  yan: "янв", fev: "фев", mar: "мар", apr: "апр", iyn: "июн", iyl: "июл", avg: "авг", sen: "сен", okt: "окт", noy: "ноя", dek: "дек",
};
const MONTH_NOM: Record<string, string> = {
  yanvar: "Январь", fevral: "Февраль", mart: "Март", aprel: "Апрель", may: "Май", iyun: "Июнь",
  iyul: "Июль", avgust: "Август", sentabr: "Сентябрь", oktabr: "Октябрь", noyabr: "Ноябрь", dekabr: "Декабрь",
};

/** Raqamli / dinamik matnlar uchun andozalar. */
const PATTERNS: [RegExp, (...m: string[]) => string][] = [
  [/^Ishdasiz · (\d+) daq kech$/, (_, n) => `На работе · опоздание ${n} мин`],
  [/^·?\s*(\d+) daq kech$/, (m, n) => `${m.startsWith("·") ? "· " : ""}опоздание ${n} мин`],
  [/^(\d+) soat (\d+) daq qoldi$/, (_, h, m) => `осталось ${h} ч ${m} мин`],
  [/^(\d+) daq oldin$/, (_, n) => `${n} мин назад`],
  [/^(\d+) ta o‘qilmagan$/, (_, n) => `${n} непрочитанных`],
  [/^Ish kuni (\d+)%$/, (_, n) => `Рабочий день ${n}%`],
  [/^(\d+) kun$/, (_, n) => `${n} дн.`],
  [/^(\d+) oy$/, (_, n) => `${n} мес.`],
  [/^(\d+) yil (\d+) oy$/, (_, y, m) => `${y} г. ${m} мес.`],
  [/^Moslik (\d+)%$/, (_, n) => `Совпадение ${n}%`],
  [/^Kelmagan (\d+) kun$/, (_, n) => `Не пришёл ${n} дн.`],
  [/^Kechikish \((\d+) daq\)$/, (_, n) => `Опоздания (${n} мин)`],
  [/^Hozir ta’tilda: (\d+) nafar$/, (_, n) => `Сейчас в отпуске: ${n}`],
  [/^(\d+) ta o‘qilmagan bildirishnoma$/, (_, n) => `${n} непрочитанных уведомлений`],
  [/^Ish grafigi · (.+)$/, (_, n) => `График работы · ${n}`],
  [/^(\d+) ta belgi telefonda saqlangan — aloqa tiklanishi bilan yuboriladi$/, (_, n) => `${n} отмет. сохранено в телефоне — отправятся, когда появится связь`],
  [/^Internet yo‘q — (kelish|ketish) (\S+) da telefonda saqlandi\. Aloqa tiklanishi bilan avtomatik yuboriladi\.$/, (_, a, t) => `Нет интернета — ${a === "kelish" ? "приход" : "уход"} в ${t} сохранён в телефоне. Отправится автоматически.`],
  [/^(.+) · taxminan qo‘lga$/, (_, m) => `${m} · примерно к выплате`],
  [/^(.+) · bugungi holat$/, (_, m) => `${m} · на сегодня`],
  [/^(.+) — (oy )?yopilgan$/, (_, m) => `${m} — месяц закрыт`],
  [/^Summa \(ko‘pi bilan (.+)\)$/, (_, v) => `Сумма (не более ${v.replace(" so‘m", " сум")})`],
  [/^Oylik (.+) · (\d+)\/(\d+) ish kuni$/, (_, v, a, b) => `Оклад ${v.replace(" so‘m", " сум")} · ${a}/${b} раб. дней`],
  [/^(\d+)\/(\d+) kun$/, (_, a, b) => `${a}/${b} дн.`],
  [/^Rahbar paneli · (.+)$/, (_, c) => `Панель руководителя · ${c}`],
  [/^(\d+) ta shubhali belgi \(GPS \/ internetsiz\) — panelda ko‘rib chiqing$/, (_, n) => `Подозрительных отметок: ${n} (GPS / без интернета) — проверьте в панели`],
  [/^· grafik (\S+)$/, (_, t) => `· график ${t}`],
  [/^shu oy olgan: (.+)$/, (_, v) => `получено в этом месяце: ${v}`],
  [/^Internetsiz belgilar yuborildi: (.+)$/, (_, v) => `Отметки без интернета отправлены: ${v}`],
  [/^(.+) gacha$/, (_, d) => `до ${d}`],
  [/^Ishga kelish (\S+) da qayd etildi(.*)$/, (_, t, rest) => `Приход отмечен в ${t}${rest.replace(/(\d+) daqiqa kechikish/, "опоздание $1 мин")}`],
  [/^Ketish (\S+) da qayd etildi\. Ishlagan vaqt: (.+)\.$/, (_, t, d) => `Уход отмечен в ${t}. Отработано: ${d}.`],
  [/^(.+) ekranidagi QR kodni skanerlang$/, (_, b) => `Отсканируйте QR-код на экране «${b}»`],
  [/^Masofa: (\d+) m · ruxsat: (\d+) m · aniqlik ±(\d+) m$/, (_, d, r, a) => `Расстояние: ${d} м · допустимо: ${r} м · точность ±${a} м`],
  [/^· ([\d\s ]+) so‘m ushlanadi$/, (_, n) => `· удержание ${n} сум`],
  [/^([A-Z][a-z]+) (\d{4}) — hisob varaqasi$/, (_, m, y) => `${MONTH_NOM[m.toLowerCase()] || m} ${y} — расчётный лист`],
  [/^([a-z]+) (\d{4})$/, (m, mon, y) => (MONTH_NOM[mon] ? `${MONTH_NOM[mon]} ${y}` : m)],
];

/** Oxirgi bosqich: so‘m, daq, oy nomlari kabi bo‘laklar. */
function tokens(text: string) {
  return text
    .replace(/(\d)\s?so‘m/g, "$1 сум")
    .replace(/(\d)\s?daq\b/g, "$1 мин")
    .replace(/(\d{1,2})-([a-z]{3,8})( \d{4})?/g, (m, d, mon, y = "") => (MONTHS[mon] ? `${Number(d)} ${MONTHS[mon]}${y}` : m));
}

export function translate(text: string, lang: Lang): string {
  if (lang === "uz" || !text) return text;
  const lead = text.match(/^\s*/)![0];
  const trail = text.match(/\s*$/)![0];
  const core = text.trim();
  if (!core || !/[a-zA-Z]/.test(core)) return text;
  if (core in RU) return lead + RU[core] + trail;
  for (const [re, fn] of PATTERNS) {
    const m = core.match(re);
    if (m) return lead + fn(...(m as unknown as string[])) + trail;
  }
  const t = tokens(core);
  return t === core ? text : lead + t + trail;
}

/* --------------------------------------------- DOM bo‘yicha tarjimon --- */
const ATTRS = ["placeholder", "title", "aria-label"];

/**
 * `root` ichidagi barcha matnni tanlangan tilga o‘giradi va o‘zgarishlarni
 * kuzatib boradi. Qaytgan funksiya kuzatishni to‘xtatib, asl matnni tiklaydi.
 */
export function startTranslator(root: HTMLElement, lang: Lang) {
  if (lang === "uz") return () => undefined;
  const original = new WeakMap<Node, string>();
  const applied = new WeakMap<Node, string>();
  const attrOriginal = new WeakMap<Element, Record<string, string>>();
  const attrApplied = new WeakMap<Element, Record<string, string>>();
  // Himoya: biror tugun qayta-qayta yozilsa (tashqi kod bilan "tortishuv"), uni tinch qo‘yamiz.
  const writes = new WeakMap<Node, { count: number; since: number }>();
  const tooMany = (node: Node) => {
    const now = Date.now();
    const entry = writes.get(node);
    if (!entry || now - entry.since > 2000) {
      writes.set(node, { count: 1, since: now });
      return false;
    }
    entry.count += 1;
    return entry.count > 20;
  };

  const doText = (node: Text) => {
    const value = node.nodeValue || "";
    if (applied.get(node) === value) return;
    const next = translate(value, lang);
    original.set(node, value);
    if (next !== value) {
      if (tooMany(node)) return;
      applied.set(node, next);
      node.nodeValue = next;
    } else applied.delete(node);
  };
  const doAttrs = (el: Element) => {
    for (const name of ATTRS) {
      const value = el.getAttribute(name);
      if (!value) continue;
      const done = attrApplied.get(el) || {};
      if (done[name] === value) continue;
      const next = translate(value, lang);
      if (next === value || tooMany(el)) continue;
      attrOriginal.set(el, { ...(attrOriginal.get(el) || {}), [name]: value });
      attrApplied.set(el, { ...done, [name]: next });
      el.setAttribute(name, next);
    }
  };
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) return doText(node as Text);
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (["SCRIPT", "STYLE", "TEXTAREA", "INPUT"].includes(el.tagName)) return doAttrs(el);
    if (el.closest("[data-no-translate]")) return;
    doAttrs(el);
    el.childNodes.forEach(walk);
  };

  walk(root);
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "characterData") doText(m.target as Text);
      else if (m.type === "attributes") doAttrs(m.target as Element);
      else m.addedNodes.forEach(walk);
    }
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });

  return () => {
    observer.disconnect();
    // Asl o‘zbekcha matnni tiklaymiz.
    const restore = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node as Text;
        if (applied.get(text) === text.nodeValue && original.has(text)) text.nodeValue = original.get(text)!;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node as Element;
      const orig = attrOriginal.get(el);
      const done = attrApplied.get(el);
      if (orig && done) for (const [name, value] of Object.entries(orig)) if (el.getAttribute(name) === done[name]) el.setAttribute(name, value);
      el.childNodes.forEach(restore);
    };
    restore(root);
  };
}

/** Kod ichida to‘g‘ridan-to‘g‘ri kerak bo‘lganda. */
export const tr = (text: string, lang: Lang) => translate(text, lang);
