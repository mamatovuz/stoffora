# Staffora — 30 soniyalik promo video

Remotion (React + TypeScript) loyihasi. 1080×1920, 30 fps, 900 kadr, H.264 + AAC.

## Tayyor fayl

`out/staffora-promo.mp4`

## Buyruqlar

```bash
npm install                 # bir marta
npm run studio              # Remotion Studio'da kadrma-kadr ko‘rish
npm run audio               # musiqa + SFX + ovozni qayta yig‘ish → public/audio/mix.wav
npm run render              # yakuniy MP4 → out/staffora-promo.mp4
node scripts/stills.mjs 137 300 650   # tanlangan kadrlarni PNG qilib tekshirish
python scripts/verify_sync.py         # ovoz MP4 ichida rejalashtirilgan joydami
```

## Tuzilishi

- `src/data/timeline.json` — yagona vaqt manbai. Har bir ibora va so‘z qaysi kadrda
  aytilishi (ovozdan olingan), sahna cue'lari va SFX nuqtalari shu yerda. Vizual qism ham,
  `scripts/build_audio.py` ham shu faylni o‘qiydi.
- `public/audio/voiceover.wav` — tayyor o‘zbekcha ovoz (18-kadrdan, 0,6 s dan boshlanadi).
- `src/lib/layout.ts` — «kamera» va kartalar xoreografiyasi: oyna, kartalar, telefon holatlari.
- `src/components/` — kartalar (KPI, davomat halqasi, xodimlar, grafik, faollik), panel
  oynasi, telefon, logo, sarlavha tizimi.
- `src/scenes/` — ochilish (jadval → logo), brend lockup, yakuniy kadr.
- `src/data.ts` — demo ma’lumotlar: 128 xodim, 6 nafari ta’tilda, 9 nafari kechikkan,
  5 nafari kelmagan. Barcha raqamlar shundan hisoblanadi, shuning uchun kartalar o‘zaro mos.

Ovoz almashtirilsa: yangi faylni `public/audio/voiceover.wav` ga qo‘ying,
`python scripts/transcribe.py public/audio/voiceover.wav medium` bilan so‘z vaqtlarini oling,
`timeline.json` dagi `phrases` kadrlarini yangilang, keyin `npm run audio` va `npm run render`.
