# Staffora dizayn tizimi (app.staffora.uz)

TimePay24’dan ilhomlangan korporativ HRM uslubi, Staffora brendi bilan. Tokenlar va umumiy komponent
uslublari — `src/design.css` (styles.css dan keyin yuklanadigan oxirgi qatlam). Sahifalar alohida rang,
radius yoki soya yozmaydi — shu tokenlardan foydalanadi.

## Tokenlar

| Guruh | Token | Qiymat (yorug‘) | Vazifasi |
|---|---|---|---|
| Brend | `--brand` / `--brand-600` | #2563EB / #1D4ED8 | asosiy tugma, faol menyu, havola |
| | `--brand-50` / `--brand-100` / `--brand-soft` | #EFF6FF / #DBEAFE / #BFD3FB | faol fon, ko‘k karta, chegara |
| Sirt | `--bg` / `--surface` / `--surface-2` | #F7F8FA / #FFFFFF / #F9FAFB | sahifa, karta, jadval sarlavhasi |
| Matn | `--ink` / `--ink-2` / `--muted` / `--faint` | #172033 / #334155 / #64748B / #94A3B8 | asosiy → ikkinchi darajali |
| Chegara | `--line` / `--line-2` | #E5E7EB / #F1F3F6 | karta / jadval qatori |
| Holat | `--green` `--amber` `--red` `--teal` (+ `-bg`, `-line`, `-solid`) | #16A36A / #F59E0B / #EF4444 / #0EA5A4 | ishda · kech · kelmagan · ma’lumot |
| Radius | `--r-xs` … `--r-lg` | 6 / 8 / 10 / 12 px | teg → tugma → maydon → karta |
| Soya | `--shadow-card` / `--shadow-pop` | juda yengil / ochiluvchi menyu | faqat kerak joyda |
| Harakat | `--spring` | cubic-bezier(.2,.8,.2,1) | barcha o‘tishlar |

Tungi rejim — `html[data-theme="dark"]` da qayta belgilangan (styles.css), holat ranglari bir xil ma’noda.

## Tipografiya
Geist Variable (Inter’ga yaqin, o‘zbek lotin belgilari: O‘, G‘, Sh, Ch). Sahifa sarlavhasi 21px/700,
bo‘lim 15.5px/680, jadval sarlavhasi 12px/600, jadval matni 13.5px, ikkinchi darajali 11.5–12.5px.
Raqamlar — `font-variant-numeric: tabular-nums`.

## Komponentlar (sinf prefikslari)
- `tn-*` — yuqori gorizontal menyu (7 bo‘lim, ochiluvchi ro‘yxat, ≤1080px — chapdan chiquvchi panel).
- `tp-*` — sahifa sarlavhasi, statistik kartalar (`tp-stat blue|green|amber|red|teal`), karta, jadval,
  filtr paneli, holat belgisi (`tp-badge`), teg (`tp-tag`), sahifalash, faoliyat lentasi.
- `pm-*` — ish haqi moduli (tablar, progress, ogohlantirishlar, stavka turi tanlash).
- `cp-*` — Corporate (investor) portali.
- `sai-*` / `md` — Staffora AI chat va xavfsiz Markdown.
- `as-*` — Staffora AI sozlamalari (bosqichlar, provayder kartalari, kalitlar ro‘yxati).

## Qoidalar
- Holat — kichik rangli belgi yoki teg; katta rangli blok faqat statistik kartada.
- Bitta sahifada bitta asosiy (ko‘k) tugma; xavfli amal — tasdiqlash oynasi bilan.
- Animatsiya faqat `transform`/`opacity`, `prefers-reduced-motion` hurmat qilinadi.
- Mobil: 375px’da gorizontal aylantirish yo‘q; jadvallar `table-wrap` ichida suriladi.
