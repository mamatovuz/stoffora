import { describe, expect, it } from "vitest";
import { cardBrand, cardError, formatCard, holderError, luhnValid, maskCard, normalizeHolder } from "../lib/card";
import { detectTrends, type TrendDay } from "../lib/trends";
import { adaptProfile, assertPoseVariation, matchFace, shouldRefreshPhoto, ADAPTIVE_SAMPLES_MAX } from "../lib/face";

describe("avans kartasi", () => {
  it("Luhn, tur va yashirish", () => {
    expect(luhnValid("4111 1111 1111 1111")).toBe(true);
    expect(luhnValid("4111 1111 1111 1112")).toBe(false);
    expect(cardError("4111111111111111")).toBeNull();
    expect(cardError("8600 1234")).toMatch(/16 ta/);
    expect(cardError("4111111111111112")).toMatch(/noto‘g‘ri/);
    expect(cardBrand("8600 0000 0000 0000")).toBe("UZCARD");
    expect(cardBrand("9860 1201 0000 0000")).toBe("HUMO");
    expect(cardBrand("5500 0000 0000 0004")).toBe("MASTERCARD");
    expect(maskCard("8600123412341234")).toBe("8600 •••• •••• 1234");
    expect(formatCard("8600abc1234123412345678")).toBe("8600 1234 1234 1234 567");
  });
  it("qabul qiluvchi ism-familiyasi", () => {
    expect(holderError("Ali")).not.toBeNull();
    expect(holderError("Alijon")).toMatch(/Ism va familiya/);
    expect(holderError("Ali Valiyev")).toBeNull();
    expect(holderError("O‘g‘iloy Rahimova")).toBeNull();
    expect(holderError("Али Валиев")).toBeNull();
    expect(holderError("Ali 123")).toMatch(/harflar/);
    expect(normalizeHolder("  ali   valiyev ")).toBe("ALI VALIYEV");
  });
});

describe("muammoli trendlar", () => {
  const today = "2026-10-01";
  const day = (date: string, extra: Partial<TrendDay> = {}): TrendDay => ({ date, workday: true, checkIn: "09:00", lateMinutes: 0, ...extra });
  const back = (n: number) => new Date(Date.parse(today) - n * 86_400_000).toISOString().slice(0, 10);

  it("bir hafta kunida takroriy kechikishni topadi", () => {
    // 2026-09-07, 14, 21, 28 — dushanbalar
    const days = ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"].map((d) => day(d, { lateMinutes: 12 }));
    const alerts = detectTrends(days, today);
    expect(alerts[0].kind).toBe("WEEKDAY_LATE");
    expect(alerts[0].text).toContain("dushanba");
    expect(alerts[0].text).toContain("4 marta");
  });

  it("kechikish ko‘payishi, kelmaslik va shubhali belgilar", () => {
    const days = [
      day(back(20)),
      day(back(10), { lateMinutes: 5 }),
      day(back(9), { lateMinutes: 7 }),
      day(back(8), { lateMinutes: 9 }),
      day(back(5), { checkIn: undefined }),
      day(back(4), { checkIn: undefined }),
      day(back(3), { flagged: true }),
      day(back(2), { flagged: true }),
    ];
    const kinds = detectTrends(days, today).map((a) => a.kind);
    expect(kinds).toContain("LATE_RISING");
    expect(kinds).toContain("ABSENCES");
    expect(kinds).toContain("FLAGS");
  });

  it("intizomli xodimda trend yo‘q; dam olish kunlari kelmaslik hisoblanmaydi", () => {
    const days = Array.from({ length: 20 }, (_, i) => day(back(i + 1), i % 7 >= 5 ? { workday: false, checkIn: undefined } : {}));
    expect(detectTrends(days, today)).toEqual([]);
  });
});

describe("Face ID aniqligi", () => {
  const base = Array.from({ length: 128 }, (_, i) => Math.sin(i) * 0.1);
  const shift = (vector: number[], delta: number) => vector.map((v, i) => v + (i % 2 ? delta : -delta));

  it("moslashuvchan namunalar faqat ishonchli moslikda qo‘shiladi va 6 tadan oshmaydi", () => {
    const profile: { descriptor: number[]; samples?: number[][]; adaptiveSamples?: number[][] } = { descriptor: base };
    const close = shift(base, 0.01);
    expect(adaptProfile(profile, close, { distance: 0.2 }, 0.5)).toBe(true);
    // Deyarli bir xil namuna — qo‘shilmaydi
    expect(adaptProfile(profile, close, { distance: 0.2 }, 0.5)).toBe(false);
    // Chegaraga yaqin moslik — ishonchsiz, qo‘shilmaydi
    expect(adaptProfile(profile, shift(base, 0.03), { distance: 0.45 }, 0.5)).toBe(false);
    for (let i = 1; i <= 10; i += 1) adaptProfile(profile, shift(base, 0.01 + i * 0.01), { distance: 0.1 }, 0.5);
    expect(profile.adaptiveSamples!.length).toBeLessThanOrEqual(ADAPTIVE_SAMPLES_MAX);
  });

  it("moslashuv markaziy deskriptorni chetlab o‘tishga yo‘l qo‘ymaydi", () => {
    const stranger = shift(base, 0.08); // markazdan uzoq
    const profile = { descriptor: base, adaptiveSamples: [stranger] };
    // Moslashuvchan namunaga yaqin bo‘lsa ham, markazdan uzoq bo‘lgani uchun rad etiladi.
    expect(matchFace(profile, stranger, 0.5).matched).toBe(false);
  });

  it("bosh burilmagan (bir xil) kadrni rad etadi", () => {
    expect(() => assertPoseVariation(base, shift(base, 0.0005))).toThrow(/burilmadi/);
    expect(() => assertPoseVariation(base, shift(base, 0.01))).not.toThrow();
  });
});

describe("profil rasmini yangilash", () => {
  const now = Date.parse("2026-10-01T09:00:00Z");
  it("aniq moslik va sifatliroq kadrda yangilanadi", () => {
    expect(shouldRefreshPhoto({ distance: 0.2, quality: 0.7, currentQuality: 0.5, threshold: 0.5, now })).toBe(true);
    // Sifati noma’lum eski rasm (birinchi noqulay kadr) — darhol almashadi
    expect(shouldRefreshPhoto({ distance: 0.2, quality: 0.5, threshold: 0.5, now })).toBe(true);
  });
  it("shubhali moslik, past sifat yoki deyarli bir xil sifatda yangilanmaydi", () => {
    expect(shouldRefreshPhoto({ distance: 0.45, quality: 0.9, currentQuality: 0.1, threshold: 0.5, now })).toBe(false);
    expect(shouldRefreshPhoto({ distance: 0.1, quality: 0.2, threshold: 0.5, now })).toBe(false);
    expect(shouldRefreshPhoto({ distance: 0.1, quality: 0.62, currentQuality: 0.6, photoUpdatedAt: "2026-09-25T00:00:00Z", threshold: 0.5, now })).toBe(false);
    expect(shouldRefreshPhoto({ distance: 0.1, threshold: 0.5, now })).toBe(false);
  });
  it("30 kundan eski rasm o‘xshash sifatli kadr bilan yangilanadi", () => {
    expect(shouldRefreshPhoto({ distance: 0.1, quality: 0.58, currentQuality: 0.6, photoUpdatedAt: "2026-08-01T00:00:00Z", threshold: 0.5, now })).toBe(true);
  });
});
