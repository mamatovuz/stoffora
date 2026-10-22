# Super Admin Control Center 2.0

Platforma egasi va jamoasi uchun boshqaruv markazi: `/super-admin/*` (panel) va `/api/super-admin/*` (API).
Mavjud tizim qayta yozilmagan — barcha o‘zgarishlar qo‘shimcha (additive) va orqaga mos.

## Arxitektura

| Qatlam | Joylashuv | Vazifa |
| --- | --- | --- |
| Sof mantiq | `lib/platform/*` | tariflar/obuna, promo, feature flag, sog‘liq bahosi, onboarding, RBAC, xavfsizlik yordamchilari |
| Modul siyosati | `lib/modules.ts` → `moduleDecision` | global → vaqtinchalik override → kompaniya → tarif |
| Server | `server/platform/*` | marshrutlar, audit, telemetriya, fon ishlari, bildirishnoma, webhook, zaxira, monitoring |
| Panel | `src/pages/superadmin/*` | Layout (yon menyu), kit (DataTable, Drawer, ConfirmDialog, Reauth), sahifalar |
| Kompaniya tomoni | `src/pages/Support.tsx`, `src/pages/PreviewEntry.tsx`, `src/components/Shell.tsx` | «Staffora yordami», ko‘rish rejimi banneri, texnik ishlar banneri, kompaniya almashtirish |

So‘rov oqimi: `requestContext` (request ID) → `telemetryMiddleware` → `requireAuth` → `previewGuard` → `originGuard` (CSRF, faqat `/super-admin`) → `requirePlatform(perm)` → marshrut → `platformAudit`.

## Ma’lumotlar bazasi o‘zgarishlari (destruktiv emas)

`prisma db push --force-reset`, `migrate reset`, `DROP TABLE` ishlatilmagan. Mavjud yozuvlarga tegilmaydi.

**`core_rows` ichidagi yangi kolleksiyalar** (`lib/types.ts` → `Database`; `normalizeDatabase` bo‘sh massiv bilan to‘ldiradi):
`subscriptionPlans, promoCodes, promoRedemptions, billingRecords, companyContracts, supportTickets, platformNotifications, featureFlags, apiKeys, webhookEndpoints, platformIncidents, backupRecords, previewSessions, translationOverrides` va bitta obyekt `platformSettings`.

**Mavjud obyektlarga ixtiyoriy maydonlar:** `Company` — `subscription, archive, demo, internal, moduleOverrides, onboardingNotes, onboardingCompletedAt`; `User` — `platformRole, blockedAt/By/Reason, extraCompanyIds, lastLoginAt`.

**Yangi SQL jadvallar** (`lib/backend.ts`, `CREATE TABLE IF NOT EXISTS`, SQLite va Postgres):
`platform_audit, platform_errors, platform_metrics, platform_usage, platform_active_users, platform_security, platform_jobs, platform_deliveries, webhook_deliveries, company_health, platform_i18n_missing`.

Orqaga moslik qoidalari:
- `platformRole` yo‘q super admin — **Owner** (mavjud administrator hech narsa yo‘qotmaydi).
- Tarif modul cheklovlari faqat obunasi bor kompaniyalarga qo‘llanadi; obunasiz kompaniya avvalgidek ishlaydi.
- Arxiv = `SUSPENDED` + `archive` maydoni (yangi holat qiymati qo‘shilmagan).

## Rollar va ruxsatlar

| Rol | Qisqacha |
| --- | --- |
| OWNER | Hammasi, jumladan zaxira yaratish/yuklab olish va administratorlar |
| ADMIN | `backups.manage`dan tashqari hammasi; Owner rolini bera olmaydi |
| SUPPORT | Kompaniyalarni ko‘rish, ko‘rish rejimi, murojaatlar, sessiyalar, monitoring |
| FINANCE | Tariflar, obunalar, hisob-kitob, promo, shartnomalar, eksport |
| ANALYST | Faqat o‘qish: dashboard, analitika, monitoring, obuna va hisob-kitob ko‘rinishi |

To‘liq matritsa: panel → Xavfsizlik → Administratorlar (`/super-admin/admin-roles`). Manba: `lib/platform/permissions.ts`.
UI’da ruxsat faqat yashirish uchun; har bir endpoint serverda `requirePlatform` bilan tekshiriladi.

## Xavfsizlik

- **Qayta autentifikatsiya** (428 `REAUTH_REQUIRED` → parol): arxivlash, egalikni o‘tkazish, rahbar parolini tiklash, administrator yaratish/rol/bloklash, zaxira yaratish/yuklab olish, kompaniya ma’lumoti eksporti, xavfli sozlamalar.
- **Ko‘rish rejimi**: alohida qisqa muddatli token (`/preview#token`, faqat shu tabning `sessionStorage`i), `previewSessions` yozuviga bog‘langan; har so‘rovda holat, muddat, kompaniya, rejim va administrator ruxsati tekshiriladi. `READ_ONLY` — barcha yozish so‘rovlari serverda 403. `SUPPORT` (yozish) — sozlamada yoqilgan bo‘lishi, sabab va Owner tasdig‘i kerak (Owner’dan boshqalar uchun — boshqa Owner tasdiqlaydi, o‘z so‘rovini tasdiqlab bo‘lmaydi); har bir yozish auditga tushadi. Ko‘rish tabidan «Chiqish» super admin sessiyasini yopmaydi.
- **API kalit**: `stf_<prefix>_<secret>`, bazada faqat HMAC xesh, bir marta ko‘rsatiladi, bitta kompaniya + aniq doira (scope).
- **Webhook**: HMAC imzo, secret AES-256-GCM bilan shifrlangan, faqat https, DNS natijasi xususiy/lokal bo‘lsa ulanmaydi (SSRF), TLS tekshiruvi o‘chirilmaydi.
- **Audit**: parol/token/kalit maydonlari va matndagi maxfiy qiymatlar yashiriladi (`maskSecrets`).
- **CSRF**: `/super-admin` yozish so‘rovlarida Origin tekshiruvi + `SameSite=Lax` cookie.
- «To‘langan» holati faqat to‘lov dalili (`paymentReference`) bilan; promo kod bitta tranzaksiyada tekshiriladi — ikki marta ishlatilmaydi.
- Hard delete oddiy amal sifatida yo‘q (faqat demo kompaniyalar tozalanadi). Zaxiradan tiklash avtomatik emas — «Tekshirish» faqat faylni tekshiradi.

## Sog‘liq bahosi (0–100)

Faollik 30 (davomat / kutilgan ish kunlari) · Barqarorlik 20 (5xx ulushi) · Integratsiya 10 (bot + Telegram ulanganlar) · Modullar 10 · Sozlash 20 (onboarding %) · Incidentlar 10 (har ochiq incident va xato webhook uchun −3).
Baho: ≥ 75 GOOD, ≥ 50 FAIR, aks holda POOR. Bu kompaniyaning platformadan foydalanishi haqida — xodimlarni baholash uchun emas.

## Saqlash muddatlari (standart)

Audit 365 kun · metrikalar 90 · foydalanish 400 · hal qilingan xatolar 90 · yetkazishlar 90 · fon ishlari 30 · xavfsizlik hodisalari 180 · topilmagan tarjimalar 90 · eksport fayllari 24 soat. O‘zgartirish: Sozlamalar → «Ma’lumotlarni saqlash muddati». Kompaniya ma’lumotlari (xodimlar, davomat) tozalanmaydi.

## Muhit o‘zgaruvchilari

| O‘zgaruvchi | Majburiy | Izoh |
| --- | --- | --- |
| `SESSION_SECRET` | Ha (prod, ≥ 32 belgi) | Sessiya, ko‘rish tokeni, API kalit xeshi va webhook secret shifri shu kalitdan. **Almashtirilsa** — barcha sessiyalar, API kalitlar va webhook secretlar yaroqsiz bo‘ladi (qayta yaratish kerak). |
| `COOKIE_SECURE=true` | Tavsiya | HTTPS’da cookie `Secure` |
| `RAILWAY_VOLUME_MOUNT_PATH` | Tavsiya | Zaxira nusxalar doimiy diskda (`<path>/backups`); bo‘lmasa `./data/backups` (konteyner qayta yaratilsa yo‘qoladi) |
| `RAILWAY_API_TOKEN` | Yo‘q | Hozircha faqat «bor/yo‘q» ko‘rsatiladi |
| `WEBHOOK_ALLOW_PRIVATE=true` | Yo‘q | Faqat development’da lokal webhook sinovi; productionda e’tiborsiz qoldiriladi |
| `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `JWT_SECRET` | Mavjud | O‘zgarmagan |

## Deploy

1. `npm run typecheck && npm test && npm run build`.
2. Deploy — jadvallar birinchi ishga tushishda `CREATE TABLE IF NOT EXISTS` bilan yaratiladi, kolleksiyalar bo‘sh holda qo‘shiladi; standart tariflar (narxsiz) bir marta yaratiladi.
3. Kirgandan keyin: Sozlamalar → yordam aloqalari, zaxira jadvali (`scheduleHours`), kerak bo‘lsa administratorlar uchun 2FA.
4. Avtomatik Telegram xabarlari (administratorlarga, tarif muddati) **standartda o‘chiq** — sozlamada yoqilmaguncha hech kimga real xabar ketmaydi.

## Rollback

Kod avvalgi versiyaga qaytarilsa: yangi kolleksiyalar `core_rows`da qoladi, eski kod ularni o‘qimaydi; yangi jadvallar ishlatilmaydi. Hech qanday ma’lumot o‘chirilmaydi, migratsiyani qaytarish shart emas.
Eslatma: `platformRole`, `blockedAt` kabi maydonlar eski kodda e’tiborsiz qoladi — bloklangan foydalanuvchi eski kodda yana kira oladi.

## Zaxira va tiklash rejasi

- SQLite: `better-sqlite3` backup API (izchil nusxa). Postgres: JSONL.gz eksport (`core_rows` + platforma jadvallari). Supabase ishlatilsa — uning PITR/kundalik zaxirasi asosiy manba.
- «Tekshirish» — fayl yaxlitligi va yozuvlar sonini tekshiradi, productionga tegmaydi.
- Tiklash qo‘lda: alohida muhitda faylni tiklash → tekshirish → texnik ishlar banneri → almashtirish.

## Endpointlar

| Metod | Yo‘l (`/api` bilan) | Ruxsat |
| --- | --- | --- |
| GET | `/super-admin/plans` | subscriptions.read |
| POST | `/super-admin/plans` | plans.manage |
| PATCH | `/super-admin/plans/:id` | plans.manage |
| GET | `/super-admin/subscriptions` | subscriptions.read |
| POST | `/super-admin/companies/:id/subscription` | subscriptions.manage |
| GET | `/super-admin/billing` | billing.read |
| POST | `/super-admin/billing` | billing.manage |
| PATCH | `/super-admin/billing/:id` | billing.manage |
| POST | `/super-admin/billing/:id/status` | billing.manage |
| GET | `/super-admin/promos` | promos.manage |
| POST | `/super-admin/promos` | promos.manage |
| PATCH | `/super-admin/promos/:id` | promos.manage |
| GET | `/super-admin/promos/:id/redemptions` | promos.manage |
| POST | `/super-admin/promos/:id/redeem` | promos.manage |
| GET | `/super-admin/contracts` | contracts.read |
| POST | `/super-admin/contracts` | contracts.manage |
| PATCH | `/super-admin/contracts/:id` | contracts.manage |
| GET | `/super-admin/contracts/:id/file` | contracts.read |
| GET | `/super-admin/notifications` | notifications.read |
| POST | `/super-admin/notifications` | notifications.send |
| PATCH | `/super-admin/notifications/:id` | notifications.send |
| DELETE | `/super-admin/notifications/:id` | notifications.send |
| POST | `/super-admin/notifications/:id/preview` | notifications.read |
| POST | `/super-admin/notifications/:id/send` | notifications.send |
| POST | `/super-admin/notifications/:id/cancel` | notifications.send |
| GET | `/super-admin/notifications/:id/deliveries` | notifications.read |
| POST | `/super-admin/notifications/:id/retry` | notifications.send |
| GET | `/super-admin/support/tickets` | support.read |
| GET | `/super-admin/support/admins` | support.read |
| GET | `/super-admin/support/tickets/:id` | support.read |
| POST | `/super-admin/support/tickets/:id/messages` | support.manage |
| PATCH | `/super-admin/support/tickets/:id` | support.manage |
| GET | `/super-admin/support/attachments/:fileId` | support.read |
| GET | `/support/contacts` | kompaniya sessiyasi yoki ochiq |
| GET | `/support/tickets` | kompaniya sessiyasi yoki ochiq |
| GET | `/support/tickets/:id` | kompaniya sessiyasi yoki ochiq |
| POST | `/support/tickets` | kompaniya sessiyasi yoki ochiq |
| POST | `/support/tickets/:id/messages` | kompaniya sessiyasi yoki ochiq |
| POST | `/support/tickets/:id/close` | kompaniya sessiyasi yoki ochiq |
| GET | `/support/attachments/:fileId` | kompaniya sessiyasi yoki ochiq |
| GET | `/super-admin/companies` | companies.read |
| POST | `/super-admin/companies` | companies.create |
| GET | `/super-admin/companies/:id` | companies.read |
| PATCH | `/super-admin/companies/:id` | companies.manage |
| POST | `/super-admin/companies/:id/status` | companies.manage |
| POST | `/super-admin/companies/:id/archive` | companies.archive |
| POST | `/super-admin/companies/:id/restore` | companies.archive |
| GET | `/super-admin/companies/:id/leaders` | companies.read, users.read |
| GET | `/super-admin/companies/:id/employees` | companies.read |
| GET | `/super-admin/companies/:id/branches` | companies.read |
| GET | `/super-admin/companies/:id/modules` | companies.read |
| PATCH | `/super-admin/companies/:id/modules/:key` | modules.manage |
| POST | `/super-admin/companies/:id/modules/preset` | modules.manage |
| GET | `/super-admin/companies/:id/activity` | companies.read |
| GET | `/super-admin/companies/:id/timeline` | companies.read |
| GET | `/super-admin/companies/:id/devices` | companies.read |
| GET | `/super-admin/companies/:id/integrations` | integrations.read, companies.read |
| GET | `/super-admin/companies/:id/health` | companies.read |
| GET | `/super-admin/companies/:id/resources` | companies.read |
| POST | `/super-admin/companies/:id/preview` | companies.preview |
| POST | `/super-admin/companies/:id/support-access` | companies.support |
| GET | `/super-admin/preview-sessions` | companies.read |
| POST | `/super-admin/preview-sessions/:id/approve` | admins.manage |
| POST | `/super-admin/preview-sessions/:id/link` | companies.support |
| POST | `/super-admin/preview-sessions/:id/end` | companies.preview |
| POST | `/super-admin/companies/:id/reset-owner-password` | users.manage |
| POST | `/super-admin/demo-companies` | companies.create |
| POST | `/super-admin/companies/:id/demo/cleanup` | companies.create |
| GET | `/super-admin/onboarding` | companies.read |
| GET | `/super-admin/me` | (any admin) |
| GET | `/super-admin/overview` | dashboard.read |
| GET | `/super-admin/analytics` | analytics.read |
| GET | `/super-admin/usage` | analytics.read |
| GET | `/super-admin/activities` | dashboard.read |
| GET | `/super-admin/audit-logs` | audit.read |
| GET | `/super-admin/settings` | settings.read |
| PUT | `/super-admin/settings` | settings.manage |
| GET | `/super-admin/flags` | flags.manage |
| POST | `/super-admin/flags` | flags.manage |
| PATCH | `/super-admin/flags/:id` | flags.manage |
| POST | `/super-admin/flags/:id/rollback` | flags.manage |
| DELETE | `/super-admin/flags/:id` | flags.manage |
| GET | `/super-admin/modules` | companies.read |
| PATCH | `/super-admin/modules/:key` | modules.manage |
| GET | `/super-admin/languages` | settings.read |
| POST | `/super-admin/translations` | settings.manage |
| DELETE | `/super-admin/translations/:id` | settings.manage |
| GET | `/super-admin/integrations` | integrations.read |
| GET | `/super-admin/api-keys` | integrations.read |
| POST | `/super-admin/companies/:id/api-keys` | integrations.manage |
| POST | `/super-admin/api-keys/:id/revoke` | integrations.manage |
| POST | `/super-admin/api-keys/:id/rotate` | integrations.manage |
| GET | `/super-admin/webhooks` | integrations.read |
| POST | `/super-admin/companies/:id/webhooks` | integrations.manage |
| PATCH | `/super-admin/webhooks/:id` | integrations.manage |
| POST | `/super-admin/webhooks/:id/rotate-secret` | integrations.manage |
| POST | `/super-admin/webhooks/:id/test` | integrations.manage |
| DELETE | `/super-admin/webhooks/:id` | integrations.manage |
| GET | `/super-admin/webhooks/:id/deliveries` | integrations.read |
| POST | `/super-admin/webhook-deliveries/:id/retry` | integrations.manage |
| GET | `/i18n/overrides` | kompaniya sessiyasi yoki ochiq |
| POST | `/i18n/missing` | kompaniya sessiyasi yoki ochiq |
| GET | `/super-admin/monitoring` | monitoring.read |
| GET | `/super-admin/incidents` | monitoring.read |
| POST | `/super-admin/incidents/:id/ack` | incidents.manage |
| POST | `/super-admin/incidents/:id/resolve` | incidents.manage |
| POST | `/super-admin/incidents/evaluate` | incidents.manage |
| GET | `/super-admin/errors` | monitoring.read |
| GET | `/super-admin/errors/:fingerprint` | monitoring.read |
| PATCH | `/super-admin/errors/:fingerprint` | incidents.manage |
| GET | `/super-admin/backups` | backups.read |
| POST | `/super-admin/backups` | backups.manage |
| POST | `/super-admin/backups/:id/verify` | backups.read |
| GET | `/super-admin/backups/:id/download` | backups.manage |
| GET | `/super-admin/jobs` | monitoring.read |
| POST | `/super-admin/jobs/:id/retry` | jobs.manage |
| POST | `/super-admin/jobs/:id/cancel` | jobs.manage |
| GET | `/super-admin/security/overview` | security.read |
| GET | `/super-admin/security/events` | security.read |
| GET | `/super-admin/resources` | monitoring.read |
| GET | `/super-admin/exports` | audit.export |
| POST | `/super-admin/exports` | audit.export |
| GET | `/super-admin/exports/:id/download` | audit.export |
| GET | `/super-admin/users` | users.read |
| GET | `/super-admin/users/:id` | users.read |
| PATCH | `/super-admin/users/:id` | users.manage |
| POST | `/super-admin/users/:id/block` | users.manage |
| POST | `/super-admin/users/:id/unblock` | users.manage |
| POST | `/super-admin/users/:id/revoke-sessions` | sessions.manage |
| PUT | `/super-admin/users/:id/companies` | users.manage |
| POST | `/super-admin/companies/:id/leaders` | users.manage |
| POST | `/super-admin/companies/:id/owner` | users.manage |
| GET | `/super-admin/sessions` | users.read |
| POST | `/super-admin/sessions/:id/revoke` | sessions.manage |
| GET | `/super-admin/admins` | admins.manage |
| GET | `/super-admin/admin-roles` | (any admin) |
| POST | `/super-admin/admins` | admins.manage |
| PATCH | `/super-admin/admins/:id` | admins.manage |
| POST | `/super-admin/admins/:id/block` | admins.manage |
| POST | `/super-admin/admins/:id/unblock` | admins.manage |
| POST | `/super-admin/reauth` | (any admin) |
| GET | `/v1/employees`, `/v1/branches`, `/v1/attendance` | API kalit doirasi (`employees.read`, `branches.read`, `attendance.read`) |
| POST | `/auth/preview/exit`, `/auth/switch-company` | panel sessiyasi |

## Testlar

- `tests/platform-lib.test.ts` — obuna holatlari, muddat ogohlantirishlari, promo, feature flag, sog‘liq bahosi, onboarding, RBAC, `maskSecrets`, SSRF, modul siyosati.
- `tests/platform-api.test.ts` — haqiqiy marshrutlar: 403 (rahbar, Analyst, bloklangan admin), ko‘rish rejimi (faqat o‘qish, soxta token), API kalit (xesh, doira, kompaniya ajratilishi), murojaat izolyatsiyasi va ichki izoh, «To‘langan» dalilsiz emas, promo ikki marta emas, audit.
