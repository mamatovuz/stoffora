import { describe, expect, it } from "vitest";
import { attendanceKpi, calculatePayroll } from "../lib/payroll";

const day = (late = 0, worked = 480, overtime = 0) => ({
  checkIn: "09:00",
  lateMinutes: late,
  workedMinutes: worked,
  overtimeMinutes: overtime,
});

describe("ish haqi va kechikish jarimasi", () => {
  it("kechikish bo‘lmasa to‘liq oylik", () => {
    const r = calculatePayroll(5_000_000, [day(), day()], { overtimePay: false });
    expect(r.deduction).toBe(0);
    expect(r.net).toBe(5_000_000);
  });

  it("har daqiqa uchun belgilangan summa", () => {
    const r = calculatePayroll(5_000_000, [day(10), day(15), day(0)], {
      latePenaltyMode: "PER_MINUTE",
      latePenaltyPerMinute: 2000,
    });
    expect(r.lateMinutes).toBe(25);
    expect(r.lateDays).toBe(2);
    expect(r.deduction).toBe(50_000);
    expect(r.net).toBe(4_950_000);
    expect(r.explanation).toContain("25 daqiqa");
    expect(r.explanation).toContain("50 000 so‘m");
  });

  it("soatlik stavka bo‘yicha (oylik / 176)", () => {
    const r = calculatePayroll(1_760_000, [day(60)], { overtimePay: false });
    // soatlik stavka 10 000, 60 daqiqa = 10 000
    expect(r.deduction).toBe(10_000);
    expect(r.net).toBe(1_750_000);
  });

  it("oylik bepul daqiqalar hisobga olinadi", () => {
    const r = calculatePayroll(3_000_000, [day(10), day(5)], {
      latePenaltyMode: "PER_MINUTE",
      latePenaltyPerMinute: 1000,
      freeLateMinutesPerMonth: 12,
    });
    expect(r.chargeableLateMinutes).toBe(3);
    expect(r.deduction).toBe(3000);
  });

  it("ushlanma oylikdan oshmaydi va manfiy bo‘lmaydi", () => {
    const r = calculatePayroll(100_000, [day(500)], {
      latePenaltyMode: "PER_MINUTE",
      latePenaltyPerMinute: 10_000,
    });
    expect(r.deduction).toBe(100_000);
    expect(r.net).toBe(0);
  });

  it("jarima o‘chirilgan bo‘lsa ushlanmaydi", () => {
    const r = calculatePayroll(2_000_000, [day(30)], { latePenaltyMode: "NONE" });
    expect(r.deduction).toBe(0);
  });

  it("kelmagan kunlar (checkIn yo‘q) hisobga olinmaydi", () => {
    const r = calculatePayroll(2_000_000, [{ lateMinutes: 40, workedMinutes: 0, overtimeMinutes: 0 }], {
      latePenaltyMode: "PER_MINUTE",
      latePenaltyPerMinute: 1000,
    });
    expect(r.deduction).toBe(0);
  });

  it("KPI ball", () => {
    expect(attendanceKpi({ expectedDays: 20, presentDays: 20, lateDays: 0 }).score).toBe(100);
    const k = attendanceKpi({ expectedDays: 20, presentDays: 18, lateDays: 3 });
    expect(k.attendance).toBe(90);
    expect(k.punctuality).toBe(83);
  });
});
