import { describe, expect, it } from "vitest";
import { attendanceStreak, biometricNeedsFace, breakMinutes, deviceFlags, isDeepLinkParam, parseDeepLink, streakBadge, type StreakDay } from "../lib/mini";

describe("Mini App: chuqur havolalar", () => {
  it("bot tugmasidagi go= qiymatini bo‘limga aylantiradi", () => {
    expect(parseDeepLink("leave")).toEqual({ tab: "leave", view: "leave", id: undefined });
    expect(parseDeepLink("leave_3f2a9c1e-1111-2222-3333-444455556666")).toEqual({ tab: "leave", view: "leave", id: "3f2a9c1e-1111-2222-3333-444455556666" });
    expect(parseDeepLink("go_payslip_2026-09")).toEqual({ tab: "profile", section: "payslips", id: "2026-09" });
    expect(parseDeepLink("checkin")).toEqual({ tab: "home", action: "checkin" });
    expect(parseDeepLink("manager_requests")).toEqual({ tab: "manager", view: "requests" });
    expect(parseDeepLink("manager")).toEqual({ tab: "manager", view: "desk" });
    expect(parseDeepLink("schedule")).toEqual({ tab: "history", view: "schedule" });
  });

  it("noma’lum yoki xavfli qiymatlarni rad etadi", () => {
    expect(parseDeepLink("")).toBeNull();
    expect(parseDeepLink(undefined)).toBeNull();
    expect(parseDeepLink("hack")).toBeNull();
    // ID faqat xavfsiz belgilar — aks holda e’tiborsiz qoldiriladi
    expect(parseDeepLink("leave_<script>")).toEqual({ tab: "leave", view: "leave", id: undefined });
    // Oy formati noto‘g‘ri bo‘lsa — oy tanlanmaydi
    expect(parseDeepLink("payslip_2026")).toEqual({ tab: "profile", section: "payslips", id: undefined });
  });

  it("taklif kodini bo‘lim havolasidan ajratadi", () => {
    expect(isDeepLinkParam("go_leave")).toBe(true);
    expect(isDeepLinkParam("AbCdEf0123456789xyz")).toBe(false);
    expect(isDeepLinkParam(undefined)).toBe(false);
  });
});

describe("Mini App: vaqtida kelish seriyasi", () => {
  const day = (date: string, checkIn?: string, late = 0, workday = true): StreakDay => ({ date, workday, checkIn, lateMinutes: late });

  it("ketma-ket vaqtida kelgan ish kunlarini sanaydi, dam olish kunlari uzmaydi", () => {
    const days = [
      day("2026-09-24", "09:00", 12),
      day("2026-09-25", "08:55"),
      day("2026-09-26", undefined, 0, false),
      day("2026-09-27", undefined, 0, false),
      day("2026-09-28", "08:59"),
      day("2026-09-29", "09:00"),
    ];
    expect(attendanceStreak(days, "2026-09-29")).toEqual({ current: 3, best: 3 });
  });

  it("bugun hali kelinmagan bo‘lsa seriya uzilmaydi, kecha kelmagan bo‘lsa uziladi", () => {
    const days = [day("2026-09-28", "08:50"), day("2026-09-29", "08:58"), day("2026-09-30")];
    expect(attendanceStreak(days, "2026-09-30").current).toBe(2);
    const missed = [day("2026-09-28", "08:50"), day("2026-09-29"), day("2026-09-30", "08:40")];
    expect(attendanceStreak(missed, "2026-09-30")).toEqual({ current: 1, best: 1 });
  });

  it("nishonlar seriya uzunligiga qarab", () => {
    expect(streakBadge(3)).toBeNull();
    expect(streakBadge(5)?.emoji).toBe("👍");
    expect(streakBadge(22)?.emoji).toBe("🔥");
    expect(streakBadge(75)?.emoji).toBe("🏆");
  });
});

describe("Mini App: qurilma belgilari", () => {
  it("qimirlamagan sensor (emulyator) va kompyuterdan belgilashni belgilaydi", () => {
    expect(deviceFlags({ motion: { samples: 40, spread: 0 } })).toEqual(["DEVICE_STILL"]);
    expect(deviceFlags({ motion: { samples: 40, spread: 0.02 } })).toEqual([]);
    // Juda kam o‘lchov — xulosa chiqarilmaydi
    expect(deviceFlags({ motion: { samples: 3, spread: 0 } })).toEqual([]);
    expect(deviceFlags({ platform: "tdesktop" })).toEqual(["DESKTOP"]);
    expect(deviceFlags({ platform: "android" })).toEqual([]);
    expect(deviceFlags({})).toEqual([]);
  });
});

describe("Mini App: biometriya siyosati", () => {
  const now = Date.parse("2026-10-01T09:00:00Z");
  it("har N-belgida yuz talab qiladi", () => {
    const fresh = new Date(now - 3_600_000).toISOString();
    expect(biometricNeedsFace({ uses: 0, lastFaceAt: fresh }, 5, now)).toBe(false);
    expect(biometricNeedsFace({ uses: 3, lastFaceAt: fresh }, 5, now)).toBe(false);
    expect(biometricNeedsFace({ uses: 4, lastFaceAt: fresh }, 5, now)).toBe(true);
    expect(biometricNeedsFace({ uses: 1, lastFaceAt: fresh }, 2, now)).toBe(true);
  });
  it("7 kundan beri yuz tekshirilmagan bo‘lsa — majburiy", () => {
    expect(biometricNeedsFace({ uses: 0, lastFaceAt: new Date(now - 8 * 86_400_000).toISOString() }, 5, now)).toBe(true);
  });
  it("noto‘g‘ri sozlamani xavfsiz chegaraga keltiradi", () => {
    const fresh = new Date(now).toISOString();
    // 1 → 2 ga ko‘tariladi (har safar yuz emas, lekin har ikkinchisida)
    expect(biometricNeedsFace({ uses: 0, lastFaceAt: fresh }, 1, now)).toBe(false);
    expect(biometricNeedsFace({ uses: 1, lastFaceAt: fresh }, 1, now)).toBe(true);
  });
});

describe("Mini App: tanaffus", () => {
  it("tugagan va davom etayotgan tanaffuslarni qo‘shadi", () => {
    expect(breakMinutes([{ start: "13:00", end: "13:40" }, { start: "16:00" }], "16:15")).toBe(55);
    expect(breakMinutes(undefined, "12:00")).toBe(0);
  });
});
