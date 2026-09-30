import { describe, expect, it } from "vitest";
import { countedRecords, countingStartDate, isPracticeDay } from "../lib/counting";
import { calculatePayroll } from "../lib/payroll";
import {
  attendanceFromRemote,
  isoToTashkent,
  parseBirthDate,
  parseRestDays,
  parseWorkHours,
  splitFullName,
} from "../server/integrations/transform";
import { normalizeBaseUrl } from "../server/integrations/client";
import { decryptSecret, encryptSecret, keyHint, redact } from "../server/integrations/secrets";

describe("hisoblash boshlanish sanasi (mashq davri)", () => {
  const company = { attendanceCounting: { startDate: "2026-10-15" } };
  const rows = [
    { date: "2026-10-10", checkIn: "09:40", lateMinutes: 40, workedMinutes: 480, overtimeMinutes: 0 },
    { date: "2026-10-14", checkIn: "10:00", lateMinutes: 60, workedMinutes: 420, overtimeMinutes: 0 },
    { date: "2026-10-16", checkIn: "09:10", lateMinutes: 10, workedMinutes: 480, overtimeMinutes: 0 },
  ];

  it("sanadan oldingi kunlar mashq — kechikish oylikdan ushlanmaydi", () => {
    const counted = countedRecords(rows, company);
    expect(counted.map((r) => r.date)).toEqual(["2026-10-16"]);
    const pay = calculatePayroll(1_760_000, counted, { latePenaltyMode: "HOURLY", monthlyHours: 176 });
    // Faqat 10 daqiqa (16-oktabr) hisoblanadi: 1 760 000 / 176 = 10 000 so‘m/soat → 1 667 so‘m
    expect(pay.lateMinutes).toBe(10);
    expect(pay.deduction).toBe(1667);
    const all = calculatePayroll(1_760_000, rows, { latePenaltyMode: "HOURLY", monthlyHours: 176 });
    expect(all.deduction).toBeGreaterThan(pay.deduction);
  });

  it("xodimning o‘z sanasi kompaniyanikidan keyin bo‘lsa — kechrog‘i olinadi", () => {
    expect(countingStartDate(company, { countingStartDate: "2026-11-01" })).toBe("2026-11-01");
    expect(countingStartDate(company, { countingStartDate: "2026-09-01" })).toBe("2026-10-15");
    expect(isPracticeDay("2026-10-20", company, { countingStartDate: "2026-11-01" })).toBe(true);
  });

  it("sana belgilanmagan bo‘lsa hamma kun hisoblanadi", () => {
    expect(countingStartDate(undefined, undefined)).toBeUndefined();
    expect(isPracticeDay("2020-01-01", {}, {})).toBe(false);
    expect(countedRecords(rows, {})).toHaveLength(3);
  });
});

describe("bot ma’lumotini o‘girish", () => {
  it("ish vaqti va dam olish kunlari", () => {
    expect(parseWorkHours("08:00 - 17:00")).toEqual({ start: "08:00", end: "17:00" });
    expect(parseWorkHours("08:00 – 24:00")).toEqual({ start: "08:00", end: "23:59" });
    expect(parseWorkHours("8.30—18.00")).toEqual({ start: "08:30", end: "18:00" });
    expect(parseWorkHours("kelishilgan")).toBeUndefined();
    expect(parseRestDays("Yakshanba")).toEqual([0]);
    expect(parseRestDays("Shanba, Yakshanba").sort()).toEqual([0, 6]);
    expect(parseRestDays(null)).toEqual([]);
  });

  it("ism (bot tartibi «Familiya Ism»), tug‘ilgan sana, vaqt", () => {
    expect(splitFullName("Mamatov Ozodbek Olimovich")).toEqual({ lastName: "Mamatov", firstName: "Ozodbek", middleName: "Olimovich" });
    expect(splitFullName("Ozodbek ")).toEqual({ firstName: "Ozodbek", lastName: "" });
    expect(parseBirthDate("30.04.1995")).toBe("1995-04-30");
    expect(parseBirthDate("1995-04-30")).toBe("1995-04-30");
    expect(parseBirthDate("noto‘g‘ri")).toBeUndefined();
    expect(isoToTashkent("2026-09-19T02:26:15+05:00")).toEqual({ date: "2026-09-19", clock: "02:26" });
    expect(isoToTashkent("2026-09-18T20:30:00Z")).toEqual({ date: "2026-09-19", clock: "01:30" });
  });

  it("davomat yozuvi — kechikish, ishlagan vaqt, tasdiqlash usuli", () => {
    const row = attendanceFromRemote(
      { id: 19, date: "2026-09-18", check_in: "2026-09-18T15:24:47+05:00", check_out: "2026-09-18T15:24:53+05:00", worked_seconds: 6, late_seconds: 26687, early_leave_seconds: 30846, verification_method: null, location: { check_in: { latitude: 40.76, longitude: 72.73, distance_m: 4019 } } },
      { start: "08:00", end: "17:00" },
    )!;
    expect(row).toMatchObject({ date: "2026-09-18", checkIn: "15:24", checkOut: "15:24", lateMinutes: 445, earlyLeaveMinutes: 514, workedMinutes: 0, status: "LATE", verification: ["TELEGRAM"], distanceMeters: 4019 });
    expect(attendanceFromRemote({ id: 1, date: "2026-09-18", check_in: null }, undefined)).toBeUndefined();
  });

  it("API manzili /api/v1 ga keltiriladi", () => {
    expect(normalizeBaseUrl("gulnora.up.railway.app/")).toBe("https://gulnora.up.railway.app/api/v1");
    expect(normalizeBaseUrl("https://x.test/api/v1/")).toBe("https://x.test/api/v1");
    expect(normalizeBaseUrl("https://x.test/api")).toBe("https://x.test/api/v1");
    expect(normalizeBaseUrl("http://127.0.0.1:8090")).toBe("http://127.0.0.1:8090/api/v1");
  });
});

describe("maxfiy kalitlar", () => {
  it("AES-GCM: shifrlash/ochish, har safar boshqa natija, buzilgan matn rad etiladi", () => {
    const key = "gfk_abcdef123_secretpartsecretpart";
    const a = encryptSecret(key);
    const b = encryptSecret(key);
    expect(a).not.toBe(b);
    expect(a).not.toContain("secretpart");
    expect(decryptSecret(a)).toBe(key);
    const tampered = a.slice(0, -2) + (a.endsWith("A") ? "BB" : "AA");
    expect(() => decryptSecret(tampered)).toThrow();
    expect(keyHint(key)).toBe("gfk_abcdef…");
  });

  it("jurnal matnlaridan kalitlar olib tashlanadi", () => {
    expect(redact("xato: gfk_abc_def123 va whsec_zzz")).toBe("xato: gfk_*** va whsec_***");
  });
});
