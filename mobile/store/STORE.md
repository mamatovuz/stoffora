# Staffora — Google Play va App Store’ga chiqarish

Loyiha: **expo.dev → @mamatovuz/staffora** · Paket / Bundle ID: **uz.staffora.app** · Server: `https://staffora.up.railway.app/api`

## 0. Kerakli hisoblar (faqat egasi ochadi)

| Do‘kon | Hisob | Narx |
| --- | --- | --- |
| Google Play | [Play Console](https://play.google.com/console) — dasturchi hisobi (shaxs yoki tashkilot) | bir martalik $25 |
| App Store | [Apple Developer Program](https://developer.apple.com/programs/) + App Store Connect | yiliga $99 |

> Shaxsiy Play hisobi bilan yangi ilova avval **12 ta sinovchi bilan 14 kun yopiq test**dan o‘tishi shart (Google talabi).
> Tashkilot hisobida (D-U-N-S raqami bilan) bu talab yo‘q.

## 1. Sinov APK (hoziroq)

```bash
cd mobile
eas build --platform android --profile preview      # → APK havola (expo.dev’da ham)
```

APK’ni telefonga yuklab o‘rnating (Android «Noma’lum manbalar»ga ruxsat so‘raydi).
Ishga tushirish: Mini App → Profil → «Telefon ilovasi» → kod → ilovaga kiriting.

## 2. Google Play

```bash
eas build --platform android --profile production   # → .aab (Play uchun)
eas submit --platform android --profile production  # Play Console’ga yuklaydi
```

`eas submit` birinchi marta Google Play **service account JSON** kalitini so‘raydi
(Play Console → Setup → API access → Google Cloud’da service account → «Release manager» huquqi).
Kalit faylini repoga qo‘ymang. Birinchi .aab’ni Play Console’ga qo‘lda yuklash ham mumkin (Internal testing).

Play Console’da to‘ldirish:
- **Privacy policy:** `https://staffora.up.railway.app/privacy.html`
- **Hisobni o‘chirish (Data deletion):** `https://staffora.up.railway.app/delete-account.html`
- **App access:** «Ilovaning ba’zi qismlari cheklangan» → sinov uchun ulash kodi (3-bo‘lim).
- **Ads:** reklama yo‘q. **Target audience:** 18+. **Category:** Business.
- **Data safety** — 4-bo‘lim.
- **Ruxsatlar deklaratsiyasi:** fon joylashuvi so‘ralmaydi (app.json’da bloklangan).

## 3. App Store

```bash
eas build --platform ios --profile production       # Apple hisobiga kirish so‘raladi — sertifikatlarni EAS yaratadi
eas submit --platform ios --profile production      # App Store Connect → TestFlight
```

App Store Connect’da:
- **Privacy Policy URL:** `https://staffora.up.railway.app/privacy.html`
- **Category:** Business. **Age rating:** 4+ (foydalanuvchi kontenti yo‘q). **Encryption:** faqat standart (HTTPS) — `ITSAppUsesNonExemptEncryption = NO` sozlangan.
- **App Privacy** — 4-bo‘lim.
- **Sign-in required → App Review Information** — 3-bo‘lim.

## 3a. Ko‘rib chiquvchilar uchun (App access / App Review)

Ilova faqat ish beruvchi qo‘shgan xodimlar uchun, kirish bir martalik kod bilan. Ko‘rib chiquvchiga:
1. Panelda **sinov kompaniyasi / filial / xodim** («App Review») yarating, filial radiusini kengroq qiling.
2. Xodim profili → **Telegram, Face ID, telefon** → **Taklif kodi** (72 soat amal qiladi) → kodni «Notes»ga yozing.
3. Kod muddati tugasa, ko‘rib chiquvchi so‘raganda yangisini yarating.

Notes matni (EN):
```
Staffora is an internal workforce app for employees of companies using Staffora.
Accounts are created by the employer; the app is activated with a one-time code.
Activation code (valid 72h): XXXX-XXXX
Camera is used for face verification at check-in and to scan the branch QR code.
Location is used only while checking in/out to verify the branch geofence (no background location).
```

## 4. Ma’lumotlar deklaratsiyasi (Data safety / App Privacy)

| Ma’lumot | Yig‘iladimi | Maqsad | Ulashiladimi |
| --- | --- | --- | --- |
| Ism, xodim ID (ish beruvchidan) | Ha | Ilova funksiyasi | Faqat ish beruvchi |
| Aniq joylashuv | Ha, faqat belgilash paytida | Davomat (filial hududi) | Yo‘q |
| Fotosuratlar (yuz kadri) | Ha | Davomat, shaxsni tasdiqlash | Yo‘q |
| Biometrik (yuz shabloni) | Ha | Shaxsni tasdiqlash (davomat) | Yo‘q |
| Moliyaviy (karta raqami — avans uchun) | Ha, ixtiyoriy | To‘lov (avans) | Faqat ish beruvchi moliya bo‘limi |
| Fayllar/hujjat rasmlari | Ha, ixtiyoriy | So‘rovga ilova | Faqat ish beruvchi |
| Qurilma ID (ochiq kalit), push token | Ha | Xavfsizlik, bildirishnoma | Yo‘q |
| Reklama / kuzatuv (tracking) | **Yo‘q** | — | — |

Shifrlash: HTTPS — ha. Foydalanuvchi o‘chirishni so‘ray oladi — ha (delete-account sahifasi).

## 5. Do‘kon matnlari

**Nomi:** Staffora
**Qisqa tavsif (80):** Ishga kelish-ketish Face ID bilan, ta’til va so‘rovlar, oylik — bitta ilovada.

**To‘liq tavsif (uz):**
```
Staffora — kompaniyangiz xodimlari uchun ilova.

• Ishga keldim / ketdim — Face ID, GPS va filial QR kodi bilan bir necha soniyada
• Davomat tarixi, ish grafigi va statistika
• Ta’til, kasallik, smena almashish va dam kunini ko‘chirish so‘rovlari
• Oylik real vaqtda, avans so‘rash (kartaga yoki naqd)
• Hisob varaqalar, hujjatlar va ma’lumotnomalar
• HR’ga savol, taklif va shikoyat (anonim ham mumkin)
• So‘rov javoblari, e’lonlar va eslatmalar — push xabarnoma bo‘lib
• Rahbarlar uchun: bugungi holat, so‘rovlarni tasdiqlash, filiallar xaritasi

Ilovadan foydalanish uchun ish beruvchingiz Staffora’dan foydalanishi kerak.
Telefon bir martalik kod bilan faqat sizga bog‘lanadi.
```

**Полное описание (ru):**
```
Staffora — приложение для сотрудников вашей компании.

• Приход и уход — Face ID, GPS и QR-код филиала за несколько секунд
• История посещаемости, график работы и статистика
• Заявки на отпуск, больничный, обмен сменами и перенос выходного
• Зарплата в реальном времени, запрос аванса (на карту или наличными)
• Расчётные листы, документы и справки
• Вопросы в HR, предложения и жалобы (можно анонимно)
• Ответы на заявки, объявления и напоминания — push-уведомлениями
• Для руководителей: сводка дня, согласование заявок, карта филиалов

Для работы приложения ваш работодатель должен использовать Staffora.
Телефон привязывается только к вам с помощью одноразового кода.
```

**Kalit so‘zlar (App Store, 100 belgi):** `davomat,HR,xodim,ish vaqti,tabel,face id,ta'til,oylik,attendance,staff`

## 6. Skrinshotlar

- Android: kamida 2 ta, telefon (masalan 1080×1920).
- iOS: 6.9" (1320×2868) yoki 6.7" (1290×2796) — kamida 3 ta; iPad o‘chirilgan (`supportsTablet: false`).
- Tavsiya etilgan ekranlar: Bosh sahifa, Face ID, Tarix (kalendar), So‘rovlar, Oylik, Rahbar.
- Skrinshotlarda haqiqiy xodimlarning ism/yuzlari bo‘lmasin — sinov kompaniyasidan oling.

## 7. Yangi versiya chiqarish

`app.json` → `version` ni oshiring (masalan 1.0.1). Build raqamlari EAS’da avtomatik oshadi (`autoIncrement`).
Faqat JS o‘zgarishlari uchun keyinchalik `eas update` (OTA) ham ulash mumkin.
