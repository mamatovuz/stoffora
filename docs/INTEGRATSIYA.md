# Staffora ⇄ Xodimlar boshqaruv boti (Gulnora Farm HR bot) integratsiyasi

## Ulash (faqat UI orqali — `.env` kerak emas)

1. **Sozlamalar → Integratsiyalar → Xodimlar boshqaruv boti → Ulash**
2. Bot API manzili (`https://…` — `/api/v1` avtomatik qo‘shiladi) va API kalit (`gfk_…`) kiritiladi → **Ulanishni tekshirish**
   (`GET /integration/info`, `GET /company`): kompaniya nomi, API versiyasi, ruxsatlar ko‘rsatiladi.
   Kalitga `employees:salary`, `employees:sensitive`, `admin` berilmasligi tavsiya etiladi (minimal ruxsat).
3. **Ulash** — kalit AES-256-GCM bilan shifrlanadi, webhook avtomatik ro‘yxatdan o‘tadi (Staffora ochiq HTTPS manzilda bo‘lsa), aks holda polling.
4. **Hisoblash boshlanish sanasi** — shu sanagacha mashq davri: kechikish, kelmaslik, KPI va ushlanmalar hisoblanmaydi.
5. **Ko‘rib chiqish** — nima yaratiladi / bog‘lanadi / o‘tkaziladi (bazaga yozilmaydi).
6. **Import** — fon ishi, progress bilan. Natija: sonlar va izohlar.

Yagona server siri: `INTEGRATION_ENCRYPTION_KEY` (bo‘lmasa `SESSION_SECRET`) — faqat shifrlash uchun.

## Xodimlarni Staffora'ga ulash

**Integratsiyalar → Xodimlar kirishi → Hammasiga yuborish** — har bir xodimga shaxsiy, bir martalik,
muddatli havola xodimlar boti orqali (`POST /notifications`) boradi:
`https://t.me/<StafforaBot>?start=<kod>`. Xodim bosadi → Staffora boti ochiladi → START → profil ulanadi.
Botdan kelgan Telegram ID bo‘lsa, havolasiz /start ham xodimni tanib ulaydi (Telegram imzolagan `from.id`).
Bot API bildirishnomalarida tugma maydoni yo‘q — havola matn ichida (Telegram uni bosiladigan qiladi).

## Sinxronlash

| Ma’lumot | Bot → Staffora | Staffora → bot |
|---|---|---|
| Filial, bo‘lim, lavozim, xodim | import + webhook/changes | o‘zgarishlar `PATCH`, yangilari `POST` |
| Davomat | tarix `GET /attendance`, hodisalar | Mini App keldi-ketdi → `POST /attendance/check-in|out` (source=staffora, Idempotency-Key) |
| E’lonlar | — | `POST /announcements` (auditoriya bilan), statistika |
| Xabarlar | — | `POST /notifications` (yo‘nalish sozlamasi bo‘yicha) |

Dublikatga qarshi: mapping → `external_ids.staffora` → Telegram ID → telefon → nomi.
Konflikt: 3 tomonlama solishtirish; strategiya — qo‘lda / Staffora / bot / oxirgisi.
Uzish ma’lumotni o‘chirmaydi; qayta ulanganda o‘sha mapping'lar ishlatiladi.

## Texnik

- Kod: `server/integrations/*` (client, sync, worker, routes, access, hooks, announce, webhook, secrets, sqlstore).
- Jadval: `integration_logs`, `integration_events` (dedupe + dead-letter), `integration_outbox` (retry/backoff, 429 Retry-After), `notification_deliveries`.
- Webhook: `POST /api/integrations/:id/webhook`, `X-Webhook-Signature: t=…,v1=HMAC_SHA256(secret, "t.body")`, 5 daqiqadan eskisi rad etiladi.
- Testlar: `tests/integration.test.ts` (27 holat), `tests/counting.test.ts`.
