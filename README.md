# Staffora

Staffora — ko‘p kompaniyali xodimlar, davomat, filiallar, ish grafiklari, ta’til va ish haqi ma’lumotlarini boshqarish platformasi.

## Hozirgi bosqich

Ushbu repository sayt, Telegram Bot va Telegram Mini App bosqichlarini o‘z ichiga oladi:

- Company Admin / HR web panel
- Super Admin web panel
- Node.js + Express REST API
- tenant-level data isolation va RBAC
- xodim, filial, bo‘lim, lavozim, grafik va ta’til boshqaruvi
- davomat hisoblash va qo‘lda tahrir qilganda audit log
- dinamik, 60 soniyalik signed QR ekran
- payroll-ready oylik hisob-kitob
- CSV hisobot, bildirishnoma va e’lonlar
- responsive desktop/tablet/mobile interfeys
- grammY asosidagi Telegram Bot (`/start`, `/profile`, `/attendance`, `/schedule`, `/leave`, `/help`)
- Telegram `initData` HMAC autentifikatsiyasi
- mobil-native Mini App: bosh sahifa, davomat, ta’til va profil
- kamera orqali QR skanerlash, GPS radius, qisqa sessiya va replay himoyasi
- bir martalik Face ID ro‘yxatdan o‘tkazish, serverda yuzni solishtirish va xodim rasmi
- HR panelidan bir martalik Telegram ulanish havolasi

## Texnologiyalar

- Frontend: React 19, Vite, TypeScript, React Router, Recharts, Tailwind/PostCSS
- Backend: Node.js, Express, TypeScript, Zod
- Database: SQLite (`better-sqlite3`), WAL rejimi va Railway Volume
- Security: HttpOnly JWT cookie, Helmet, login rate limit, backend RBAC, tenant filtering
- Test: Vitest

Next.js ishlatilmagan.

## Ishga tushirish

```bash
npm install
copy .env.example .env
npm run dev
```

Frontend: `http://localhost:3000`

API: `http://localhost:4000`

Demo ma’lumotlar yo‘q. Birinchi ochilishda `/setup` sahifasi chiqadi — kompaniya nomi,
egasining ismi, email va parolni kiritasiz. Xohlasangiz buni `.env` orqali avtomatik
qilish mumkin: `BOOTSTRAP_COMPANY_NAME`, `BOOTSTRAP_OWNER_NAME`, `BOOTSTRAP_ADMIN_EMAIL`,
`BOOTSTRAP_ADMIN_PASSWORD` (va ixtiyoriy `BOOTSTRAP_SUPER_ADMIN_EMAIL/PASSWORD`).
Ochiq serverda begona odam sozlab qo‘ymasligi uchun `SETUP_TOKEN` qo‘yish mumkin.

**Super admin** (barcha kompaniyalarni boshqaradi) uchun standart login yo‘q. Railway
Variables’ga qo‘shing va qayta deploy qiling — bazada super admin bo‘lmasa avtomatik yaratiladi:

```env
BOOTSTRAP_SUPER_ADMIN_EMAIL=super@sizning-domen.uz
BOOTSTRAP_SUPER_ADMIN_PASSWORD=<kamida 10 belgilik kuchli parol>
```

So‘ng `/login` sahifasida shu email va parol bilan kiring (`/super-admin` ochiladi).

## Buyruqlar

```bash
npm run dev        # frontend va backend
npm run typecheck  # TypeScript tekshiruvi
npm test           # biznes-qoida testlari
npm run build      # production build
npm start          # build qilingan server
```

## SQLite ma’lumotlar bazasi

Staffora lokal va Railway production muhitida SQLite ishlatadi. Lokal default manzil `data/staffora.sqlite`, Railway uchun tavsiya etilgan manzil `/data/staffora.sqlite`.

Birinchi ishga tushishda jadval avtomatik yaratiladi. Eski versiyadagi demo yozuvlar (Gulnora Farm va h.k.) faqat ularning ID’lari bo‘yicha avtomatik o‘chiriladi — siz kiritgan ma’lumotlar saqlanadi.

SQLite WAL rejimida ishlaydi. Railway’da SQLite ishlatilganda servisni **1 replica** bilan ishlating — bitta volume’ni bir nechta replica orasida bo‘lish tavsiya etilmaydi.

## Railway’ga deploy qilish

### 1. GitHub repository’ni ulang

Railway’da yangi Project yarating, `Deploy from GitHub repo` orqali STAFFORA repository’sini tanlang va servisga public domain yarating.

### 2. Build va start command

Service → Settings ichida:

```text
Build Command: npm run build
Start Command: npm start
Healthcheck Path: /health
```

`package.json` Node.js `20–24` versiyalarini talab qiladi. Railway bergan `PORT` qiymatini server avtomatik o‘qiydi; `PORT` variable’ni qo‘lda yaratish kerak emas.

### 3. Persistent Volume

Servisga Volume ulang va mount path sifatida aynan quyidagini yozing:

```text
/data
```

Keyin Service → Variables ichida:

```env
SQLITE_PATH=/data/staffora.sqlite
```

Volume faqat runtime vaqtida ulanadi. Shu sababli database yaratish yoki migratsiyani build/pre-deploy command’ga qo‘ymang — dastur uni `npm start` vaqtida avtomatik tayyorlaydi.

### 4. Railway Variables

`.env.example` faylida barcha keylar batafsil izohlangan. Production uchun kamida quyidagilarni kiriting:

```env
NODE_ENV=production
APP_URL=https://SIZNING-DOMENINGIZ.up.railway.app
SQLITE_PATH=/data/staffora.sqlite
SESSION_SECRET=<kamida-32-belgilik-tasodifiy-secret>
JWT_SECRET=<boshqa-tasodifiy-secret>
QR_SIGNING_SECRET=<yana-boshqa-tasodifiy-secret>
COOKIE_SECURE=true
FACE_MATCH_THRESHOLD=0.50
TELEGRAM_BOT_TOKEN=<BotFather-tokeni>
TELEGRAM_BOT_USERNAME=<username-@-belgisiz>
TELEGRAM_WEBAPP_URL=https://SIZNING-DOMENINGIZ.up.railway.app/mini-app
TELEGRAM_DEV_MODE=false
```

> ⚠️ `TELEGRAM_WEBAPP_URL` va `APP_URL` albatta **https://** bo‘lsin. `http://localhost` bo‘lsa
> Telegram «Staffora’ni ochish» tugmasini ko‘rsatmaydi. Qiymat bo‘sh qolsa, Railway domenidan
> avtomatik olinadi. Production’da bot webhook rejimida ishlaydi (`/api/telegram/webhook`).

Secret yaratish buyrug‘i:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Uni uch marta ishga tushirib, uchta alohida secret oling. Production’da secret yetishmasa yoki `TELEGRAM_DEV_MODE=true` bo‘lsa server xavfsizlik uchun ishga tushmaydi.

### 5. Deploydan keyingi tekshiruv

```text
https://SIZNING-DOMENINGIZ.up.railway.app/health
```

Sog‘lom javob:

```json
{ "status": "ok", "database": "sqlite-ready", "uptimeSeconds": 12 }
```

Database backup’ini Railway Volume Backups orqali yoqing. SQLite fayli `/data/staffora.sqlite`, WAL yordamchi fayllari ham shu volume ichida saqlanadi.

## Telegram Bot va Mini App sozlash

1. BotFather orqali bot yarating va `/setcommands` uchun quyidagilarni kiriting:

```text
start - Staffora bosh sahifasi
profile - Mening profilim
attendance - Bugungi davomat
schedule - Ish grafigim
leave - Ta'til so'rovi
help - Yordam
```

2. HTTPS domeningizdagi Mini App manzilini BotFather’da sozlang, masalan:

```text
https://staffora.example.com/mini-app
```

3. `.env` ichida quyidagilarni to‘ldiring:

```env
TELEGRAM_BOT_TOKEN=<BotFather-tokeni>
TELEGRAM_BOT_USERNAME=staffora_bot
TELEGRAM_WEBAPP_URL=https://staffora.example.com/mini-app
TELEGRAM_DEV_MODE=false
COOKIE_SECURE=true
```

Bot token mavjud bo‘lsa Express server bilan birga polling rejimida ishga tushadi. Production’da webhook rejimiga o‘tkazish mumkin.

Lokal Mini App preview uchun `.env` ichida `TELEGRAM_DEV_MODE=true` qiling va `http://localhost:3000/mini-app` sahifasini oching. Development rejimi faqat lokal muhit uchun; production’da o‘chirilsin.

Davomat oqimi:

```text
Mini App Telegram auth
→ Face ID birinchi marta ro‘yxatdan o‘tkaziladi yoki mavjud namuna tasdiqlanadi
→ 2 daqiqalik attendance session
→ kamera bilan branch QR
→ signed QR va server nonce tekshiruvi
→ GPS radius tekshiruvi
→ check-in/check-out holati tekshiruvi
→ audit log va Telegram bildirishnomasi
```

Face ID modellari `npm run dev` va `npm run build` vaqtida lokal npm paketidan
`public/face-models` ichiga avtomatik ko‘chiriladi. Kamera production muhitida HTTPS
talab qiladi; Railway public domaini HTTPS bilan ishlaydi. Yuz mos kelmasa attendance
sessiyasi yaratilmaydi. Face ID namunasi bir marta kiritiladi, qayta sozlashni HR xodim
profilidagi “Face ID’ni qayta sozlash” amali orqali bajaradi.

Yuz deskriptori va profil rasmi shaxsiy ma’lumot hisoblanadi. Xodim roziligini oling,
unga kirishni faqat vakolatli rollar bilan cheklang va Volume backup nusxalarini ham
xuddi production ma’lumoti kabi himoyalang.

## Asosiy imkoniyatlar (yangi)

- **Keldi-ketdi**: kunlik to‘liq ro‘yxat (ishda / ketdi / kelmadi / ta’tilda / kutilmoqda), qo‘lda belgilash, tahrirlash, audit.
- **Face ID** (iPhone uslubida): bosh aylantirib doirani to‘ldirish, jonlilik tekshiruvi, 5–6 namuna, replay himoyasi.
- **Excel hisobotlar** (.xlsx): Xulosa, Batafsil, rangli Tabel (xodim × kun), Kechikishlar, Ish haqi vedomosti, Xodimlar.
- **KPI va kechikish jarimasi**: Sozlamalar → Ish haqi va jarima (daqiqasiga summa / soatlik stavka / o‘chiq, oylik bepul daqiqalar). Moliya bo‘limida har bir xodim uchun qisqa izoh.
- **2 bosqichli kirish**: Sozlamalar → Xavfsizlik → Telegram’ni ulash → yoqish. Kod bot orqali keladi.
- **Qurilmalar**: panelga kirgan qurilmalar ro‘yxati va chiqarib yuborish.
- **Telegram bot**: telefon raqam orqali ulanish, kelmaganlarga va ketishni unutganlarga eslatma.
- **Rasm kanali**: Sozlamalar → Rasm kanali. Har bir keldi-ketdida Face ID rasmi (vaqt, sana, filial, kechikish bilan) maxfiy Telegram kanalga tushadi. Bot vaqtincha ishlamasa rasm navbatda saqlanadi va keyin yuboriladi. Kanaldagi eski rasmlar belgilangan muddatdan keyin avtomatik o‘chiriladi. Bot kanalga «Xabar joylash» va «Xabarlarni o‘chirish» huquqli admin bo‘lishi kerak.
- **Ishdan bo‘shaganlar**: xodim profilida «Ishdan bo‘shatish» (sana, sabab) → alohida ro‘yxat, «Qayta ishga olish». Bo‘shaganlar ish haqi va davomat hisobiga kirmaydi.
- **Ekran qulfi**: Sozlamalar → Ekran qulfi. Belgilangan daqiqa harakatsizlikdan keyin panel xiralashib qulflanadi, alohida qulf paroli bilan ochiladi. Qulf serverda ham belgilanadi — sahifani yangilash uni ochmaydi.
- **Mini App**: Telegram 8.0+ da telefonlarda to‘liq ekran rejimida ochiladi.

## Xavfsizlik eslatmalari

- `.env` faylini commit qilmang.
- Production’da `SESSION_SECRET` va `QR_SIGNING_SECRET` uchun kamida 32 belgilik tasodifiy qiymat qo‘ying.
- HTTPS ishlating va `COOKIE_SECURE=true` qiling.
- Lokal file adapterni ko‘p instansli production serverda ishlatmang.
- Telegram initData tekshiruvi bot/Mini App bosqichida qo‘shiladi.

## Papkalar

```text
src/       React/Vite frontend
server/    Express API va auth middleware
lib/       umumiy turlar, seed, storage va biznes qoidalari
tests/     kritik unit testlar
data/      lokal runtime data (gitignore)
```
