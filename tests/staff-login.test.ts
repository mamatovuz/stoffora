import { describe, expect, it } from "vitest";
import { checkLoginInput, passwordProblem, suggestLoginLocal } from "../lib/staff-login";
import { isLoginTaken, loginOwner, revokeUserSessions, suggestFreeLogin } from "../lib/staff-credentials";
import { calculatePayroll, lateCoverage, normalizePayrollSettings } from "../lib/payroll";
import { calculateTypedPay } from "../lib/pay-types";
import type { Database } from "../lib/types";

/*
 * Ilovaga kirish logini (ozodbek@staffora.uz) va parol qoidalari; «kechikishni ishlab yopish»
 * va «qo‘shimcha ish to‘lanmaydi» sozlamalari ish haqiga ta’siri.
 */

describe("login va parol qoidalari", () => {
  it("checkLoginInput: nom, katta harf yoki to‘liq manzil; boshqa domen — rad", () => {
    expect(checkLoginInput("ozodbek")).toEqual({ ok: true, local: "ozodbek", login: "ozodbek@staffora.uz" });
    expect(checkLoginInput(" Ozodbek ")).toMatchObject({ ok: true, login: "ozodbek@staffora.uz" });
    expect(checkLoginInput("ozodbek@staffora.uz")).toMatchObject({ ok: true, login: "ozodbek@staffora.uz" });
    expect(checkLoginInput("ozodbek.mamatov")).toMatchObject({ ok: true, login: "ozodbek.mamatov@staffora.uz" });
    const other = checkLoginInput("x@gmail.com");
    expect(other.ok).toBe(false);
    expect(!other.ok && other.error).toContain("@staffora.uz avtomatik");
    for (const bad of ["", "oz", "ozod bek", "1ozodbek", "ozodbek.", "ozod..bek", "озодбек", "a".repeat(31)]) expect(checkLoginInput(bad).ok).toBe(false);
  });

  it("suggestLoginLocal: ism-familiyadan lotin harflari", () => {
    expect(suggestLoginLocal("Ozodbek", "Mamatov")).toBe("ozodbek.mamatov");
    expect(suggestLoginLocal("Ulug‘bek", "Jo‘rayev")).toBe("ulugbek.jorayev");
    expect(suggestLoginLocal("Шахзода", "Қодирова")).toBe("shaxzoda.qodirova");
    expect(suggestLoginLocal("", "")).toBe("xodim");
  });

  it("passwordProblem: 8–72 belgi, harf va raqam, bo‘sh joysiz", () => {
    expect(passwordProblem("Valiyev2026")).toBeNull();
    expect(passwordProblem("qisqa1")).toContain("kamida 8");
    expect(passwordProblem("faqatharflar")).toContain("harf va bitta raqam");
    expect(passwordProblem("12345678")).toContain("harf va bitta raqam");
    expect(passwordProblem("bo‘sh joy 2026")).toContain("bo‘sh joy");
    expect(passwordProblem(`a1${"x".repeat(71)}`)).toContain("72");
    // bcrypt 72 BAYTni hisobga oladi: 38 belgi, lekin 74 bayt (kirill — 2 bayt) — rad.
    expect(passwordProblem(`${"ё".repeat(36)}a1`)).toContain("juda uzun");
    expect(passwordProblem(`${"ё".repeat(35)}a1`)).toBeNull();
  });

  it("login barcha kompaniyalar bo‘yicha noyob: xodim, panel foydalanuvchisi, kutilayotgan anketa", () => {
    const db = {
      staffCredentials: [{ id: "s1", companyId: "c1", employeeId: "e1", login: "ali.valiyev@staffora.uz", passwordHash: "x", createdAt: "", updatedAt: "" }],
      employees: [],
      users: [
        { id: "u1", companyId: "c2", email: "boss@firma.uz", mobileLogin: "direktor@staffora.uz" },
        { id: "u2", companyId: "c2", email: "hr@staffora.uz" },
      ],
      registrations: [
        { id: "r1", status: "PENDING", updatedAt: "2020-01-01T00:00:00.000Z", data: { appLogin: "vali@staffora.uz" } },
        { id: "r2", status: "REJECTED", updatedAt: new Date().toISOString(), data: { appLogin: "eski@staffora.uz" } },
        { id: "r3", status: "DRAFT", updatedAt: new Date().toISOString(), data: { appLogin: "yangi@staffora.uz" } },
        // 24 soatdan eski tugallanmagan anketa loginni endi band qilmaydi.
        { id: "r4", status: "DRAFT", updatedAt: new Date(Date.now() - 25 * 3_600_000).toISOString(), data: { appLogin: "tashlangan@staffora.uz" } },
      ],
    } as unknown as Database;
    expect(loginOwner(db, "ALI.VALIYEV@staffora.uz")).toBe("credential");
    expect(loginOwner(db, "direktor@staffora.uz")).toBe("user");
    expect(loginOwner(db, "hr@staffora.uz")).toBe("user"); // panel emaili bilan to‘qnashmaydi
    expect(loginOwner(db, "vali@staffora.uz")).toBe("registration");
    expect(isLoginTaken(db, "eski@staffora.uz")).toBe(false); // rad etilgan anketa band qilmaydi
    expect(isLoginTaken(db, "yangi@staffora.uz")).toBe(true);
    expect(isLoginTaken(db, "tashlangan@staffora.uz")).toBe(false);
    // O‘zi (o‘sha xodim / o‘sha anketa / o‘sha foydalanuvchi) — band emas.
    expect(isLoginTaken(db, "ali.valiyev@staffora.uz", { employeeId: "e1" })).toBe(false);
    expect(isLoginTaken(db, "vali@staffora.uz", { requestId: "r1" })).toBe(false);
    expect(isLoginTaken(db, "direktor@staffora.uz", { userId: "u1" })).toBe(false);
    expect(suggestFreeLogin(db, "Ali", "Valiyev")).toBe("ali.valiyev2@staffora.uz");
    expect(suggestFreeLogin(db, "Ali", "Valiyev", { employeeId: "e1" })).toBe("ali.valiyev@staffora.uz");
    expect(suggestFreeLogin(db, "Al", "")).toBe("al.xodim@staffora.uz");
  });

  it("parol almashganda: boshqa panel sessiyalari va rahbar rejimidagi mobil sessiyalar yopiladi, joriysi qoladi", () => {
    const db = {
      panelSessions: [
        { id: "p-now", userId: "u1" },
        { id: "p-old", userId: "u1" },
        { id: "p-mob", userId: "u1" },
        { id: "p-other", userId: "u2" },
      ],
      mobileSessions: [
        { id: "m1", employeeId: "", userId: "u1", panelSessionId: "p-mob" },
        { id: "m2", employeeId: "", userId: "u1", panelSessionId: "p-now" },
        { id: "m3", employeeId: "e1", userId: undefined },
      ],
    } as unknown as Database;
    expect(revokeUserSessions(db, "u1", "p-now")).toBe(3);
    const revoked = (rows: { id: string; revokedAt?: string }[]) => rows.filter((r) => r.revokedAt).map((r) => r.id).sort();
    expect(revoked(db.panelSessions)).toEqual(["p-mob", "p-old"]);
    expect(revoked(db.mobileSessions)).toEqual(["m1"]);
  });
});

describe("kechikishni ishlab yopish va qo‘shimcha ish to‘lovi", () => {
  const day = (late: number, overtime: number, extra: Record<string, unknown> = {}) => ({
    checkIn: "09:30",
    checkOut: "18:30",
    lateMinutes: late,
    workedMinutes: 480,
    overtimeMinutes: overtime,
    ...extra,
  });

  it("lateCoverage: covered = min(kechikish, qo‘shimcha ish), faqat yoqilganda va chiqishdan keyin", () => {
    expect(lateCoverage(day(30, 30), { lateOffset: true })).toEqual({ covered: 30, late: 0, overtime: 0 });
    expect(lateCoverage(day(30, 50), { lateOffset: true })).toEqual({ covered: 30, late: 0, overtime: 20 });
    expect(lateCoverage(day(45, 20), { lateOffset: true })).toEqual({ covered: 20, late: 25, overtime: 0 });
    expect(lateCoverage(day(30, 30), { lateOffset: false })).toEqual({ covered: 0, late: 30, overtime: 30 });
    expect(lateCoverage(day(30, 30, { checkOut: undefined }), { lateOffset: true }).covered).toBe(0);
    expect(normalizePayrollSettings({}).lateOffset).toBe(false);
    expect(normalizePayrollSettings({ lateOffset: true }).lateOffset).toBe(true);
  });

  it("30 daqiqa kechikib, 30 daqiqa ko‘p ishlasa — ushlanma ham, qo‘shimcha ish to‘lovi ham yo‘q", () => {
    const settings = { latePenaltyMode: "PER_MINUTE" as const, latePenaltyPerMinute: 1000, overtimePay: true, lateOffset: true, monthlyHours: 176 };
    const r = calculatePayroll(1_760_000, [day(30, 30)], settings);
    expect(r).toMatchObject({ deduction: 0, overtimeAmount: 0, overtimeMinutes: 0, lateMinutes: 0, lateDays: 0, chargeableLateMinutes: 0, lateCoveredMinutes: 30, net: 1_760_000 });
    expect(r.explanation).toContain("kechikish ishlab yopildi");
    // Sozlama o‘chiq — avvalgidek: 30 daqiqa ushlanma va 30 daqiqa qo‘shimcha ish.
    const off = calculatePayroll(1_760_000, [day(30, 30)], { ...settings, lateOffset: false });
    expect(off).toMatchObject({ deduction: 30_000, overtimeAmount: 5_000, lateMinutes: 30 });
    // Qisman: 45 kech, 20 qolgan → 25 daqiqa ushlanadi.
    expect(calculatePayroll(1_760_000, [day(45, 20)], settings)).toMatchObject({ deduction: 25_000, overtimeAmount: 0, lateMinutes: 25 });
  });

  it("qo‘shimcha ish to‘lanmasa — to‘lov ham, tasdiq kutilayotgani ham yo‘q (daqiqalar tarixda qoladi)", () => {
    const r = calculatePayroll(1_760_000, [day(0, 120)], { latePenaltyMode: "NONE", overtimePay: false, overtimeRequiresApproval: true, monthlyHours: 176 });
    expect(r.overtimeAmount).toBe(0);
    expect(r.pendingOvertimeMinutes).toBe(0);
    expect(r.net).toBe(1_760_000);
  });

  it("kunlik ish haqida ham yopilgan kechikish ushlanmaydi va qo‘shimcha ish emas", () => {
    const input = { payType: "DAILY" as const, rate: 200_000, records: [{ ...day(30, 30), date: "2026-11-02" }], today: "2026-11-20", workingDays: 22 };
    const on = calculateTypedPay(input, { latePenaltyMode: "PER_MINUTE", latePenaltyPerMinute: 1000, overtimePay: true, lateOffset: true });
    expect(on).toMatchObject({ deduction: 0, overtimeAmount: 0, lateMinutes: 0, lateCoveredMinutes: 30, net: 200_000 });
    const off = calculateTypedPay(input, { latePenaltyMode: "PER_MINUTE", latePenaltyPerMinute: 1000, overtimePay: true, lateOffset: false });
    expect(off.deduction).toBe(30_000);
    expect(off.overtimeAmount).toBeGreaterThan(0);
  });
});
