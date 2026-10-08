# Staffora mobil ilovasi (iOS / Android)

React Native + TypeScript + Expo (SDK 57, expo-router). Telegram Mini App’ning **o‘sha** backend va
**o‘sha** xodimlar bazasidan foydalanadi — alohida server yoki ikkinchi xodimlar bazasi yo‘q.
Mini App va uning Telegram orqali kirishi o‘zgarmagan.

## Bo‘limlar

| Bosqich | Ekranlar |
| --- | --- |
| 1. Bosh sahifa | Holat, soat, «Ishga keldim/ketdim», Face ID (qotirilgan ramka, server tekshiruvi, xarita, QR), natija, statistika, oylik kartasi, tezkor bo‘limlar, kechikish ogohlantirishi, bildirishnomalar + push |
| 2. Tarix | Davomat kalendari, ish grafigi (oy bo‘yicha), statistika (seriya, soatlar, reyting) |
| 3. So‘rovlar | Ta’til (hujjat rasmi bilan), smena almashish, dam kunini ko‘chirish, qo‘shimcha ish izohi |
| 4. Profil | Ma’lumotlar, filial (xaritada), grafik, oylik va avans (karta/naqd), hisob varaqalar, hujjatlar, HR’ga savol, spravka, taklif/shikoyat (anonim), tug‘ilgan kunlar, xavfsizlik |
| 5. Rahbar | Bugungi holat (filtr, qidiruv), so‘rovlarni tasdiqlash (ta’til, smena, dam kuni, avans, qo‘shimcha ish), filiallar xaritasi, xulosa, tezkor e’lon |

## Sozlash

```bash
cd mobile
npm install
cp .env.example .env          # EXPO_PUBLIC_API_URL=https://<domeningiz>/api
npx expo-doctor
```

Push uchun EAS loyihasi kerak: `npx eas-cli@latest init` → `app.json` → `extra.eas.projectId` to‘ladi.
iOS push uchun APNs kaliti va Android uchun FCM — EAS’da (`eas credentials`) sozlanadi; ilovada push kaliti saqlanmaydi.

### Build (EAS)

```bash
npx eas-cli@latest build --profile development --platform android   # dev build (Expo Go emas)
npx eas-cli@latest build --profile preview --platform android       # sinov uchun APK
npx eas-cli@latest build --profile production --platform ios        # App Store (Apple Developer hisobi kerak)
```

`eas.json`dagi `EXPO_PUBLIC_API_URL` qiymatlarini o‘z serveringiz manziliga almashtiring.
Kamera, joylashuv, push va biometriya native modullar — **Expo Go’da emas, development build’da** sinang.

## Xavfsizlik modeli

- **Faollashtirish:** xodim Mini App’dan (Telegram orqali tasdiqlangan) yoki HR’dan bir martalik kod oladi
  (8 belgi, 15 daqiqa / HR — 72 soat, serverda faqat xeshi, ≤5 urinish, IP bo‘yicha limit). Telefon raqamini yozish yetarli emas.
- **Qurilma kaliti:** telefonda ECDSA P-256 kalit yaratiladi; maxfiy kalit Keychain/Keystore’da
  (`expo-secure-store`, «faqat shu qurilma», zaxiraga tushmaydi) — serverga faqat ochiq kalit boradi.
  Faollashtirish va har bir sessiya yangilanishi server bergan bir martalik challenge’ni imzolash bilan.
  *Halol izoh:* imzo dastur xotirasida bajariladi (Secure Enclave’dagi chiqarib bo‘lmaydigan kalit emas).
- **Bir xodim — bitta ishonchli telefon; bitta telefon — bitta xodim** (server tekshiradi).
  Yangi telefon → Mini App’dan kod → yangi telefonda kiritiladi → darhol kiradi (HR so‘rovi yo‘q); eski telefon, uning sessiyalari, push tokenlari va rahbar sessiyalari bekor. Telefonda boshqa xodim kirgan bo‘lsa — u shu telefondan chiqariladi.
- **Sessiya:** 15 daqiqalik access token (xotirada) + almashinuvchi refresh token (Keychain/Keystore’da).
  Eski refresh token qayta kelsa — sessiya yopiladi. Chiqish (logout) qurilma bog‘lanishini **o‘chirmaydi**.
- **Davomat:** Face ID qarori serverda (kadrlar serverda tahlil qilinadi, ilova natijani «yaratib» bera olmaydi);
  hudud (geofence) serverda hisoblanadi; Android soxta GPS belgisi HR uchun bayroq bo‘ladi.
  Muvaffaqiyat faqat server tasdig‘idan keyin ko‘rsatiladi. Fon joylashuvi so‘ralmaydi.
- Tokenlar, kodlar va kalitlar log qilinmaydi; IMEI/MAC ishlatilmaydi. Hech qanday tizim «buzib bo‘lmaydigan» emas —
  bu choralar xavfni sezilarli kamaytiradi, HR esa audit jurnalida hamma amallarni ko‘radi.
