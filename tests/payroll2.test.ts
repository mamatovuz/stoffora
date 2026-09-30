import { describe, expect, it } from "vitest";
import { calculatePayroll } from "../lib/payroll";
import { dayPlan, workingDaysInMonth } from "../lib/schedule";
import type { Schedule } from "../lib/types";

const present = (late = 0, overtime = 0, approved?: boolean) => ({ checkIn: "09:00", lateMinutes: late, workedMinutes: 480, overtimeMinutes: overtime, overtimeApproved: approved });

describe("ish haqi 2.0", () => {
  it("kelmagan kun ushlanmasi: kunlik stavka = oylik / ish kunlari", () => {
    const r = calculatePayroll(2_600_000, [present()], { latePenaltyMode: "NONE", absencePenalty: "DAILY" }, { absentDays: 2, workingDays: 26 });
    expect(r.dailyRate).toBe(100_000);
    expect(r.absenceDeduction).toBe(200_000);
    expect(r.net).toBe(2_400_000);
    // Sozlama o‘chiq bo‘lsa — ushlanma yo‘q
    expect(calculatePayroll(2_600_000, [present()], { latePenaltyMode: "NONE" }, { absentDays: 2, workingDays: 26 }).absenceDeduction).toBe(0);
  });

  it("avans, bonus, jarima: qo‘lga = hisoblangan − avans", () => {
    const r = calculatePayroll(5_000_000, [present()], { latePenaltyMode: "NONE" }, { bonus: 500_000, fine: 100_000, advance: 1_000_000 });
    expect(r.gross).toBe(5_400_000);
    expect(r.net).toBe(4_400_000);
    expect(r.explanation).toContain("avans");
    // Avans hisoblangandan ko‘p bo‘lsa ham manfiy emas
    expect(calculatePayroll(1_000_000, [], { latePenaltyMode: "NONE" }, { advance: 3_000_000 }).net).toBe(0);
  });

  it("qo‘shimcha ish faqat tasdiqlangani to‘lanadi (sozlama yoqilgan bo‘lsa)", () => {
    const records = [present(0, 120, true), present(0, 60), present(0, 30, false)];
    const r = calculatePayroll(1_760_000, records, { latePenaltyMode: "NONE", overtimePay: true, overtimeRequiresApproval: true, monthlyHours: 176 });
    expect(r.overtimeMinutes).toBe(120);
    expect(r.pendingOvertimeMinutes).toBe(60);
    expect(r.overtimeAmount).toBe(20_000);
    const all = calculatePayroll(1_760_000, records, { latePenaltyMode: "NONE", overtimePay: true, monthlyHours: 176 });
    expect(all.overtimeMinutes).toBe(210);
  });

  it("grafik o‘zgarishi (smena almashish) kun rejasini almashtiradi", () => {
    const schedule: Schedule = {
      id: "s1", companyId: "c1", name: "5/2", type: "FIXED", graceMinutes: 5, overtimeEnabled: true,
      days: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, enabled: day >= 1 && day <= 5, start: "09:00", end: "18:00", breakMinutes: 60 })),
    };
    const db = { schedules: [schedule], scheduleOverrides: [] as { id: string; companyId: string; employeeId: string; date: string; working: boolean; start?: string; end?: string; reason: string }[] };
    const employee = { id: "e1", scheduleId: "s1" };
    expect(dayPlan(db, employee, "2026-09-07").enabled).toBe(true); // dushanba
    expect(dayPlan(db, employee, "2026-09-06").enabled).toBe(false); // yakshanba
    db.scheduleOverrides.push({ id: "o1", companyId: "c1", employeeId: "e1", date: "2026-09-06", working: true, start: "10:00", end: "16:00", reason: "Almashish" });
    db.scheduleOverrides.push({ id: "o2", companyId: "c1", employeeId: "e1", date: "2026-09-07", working: false, reason: "Almashish" });
    expect(dayPlan(db, employee, "2026-09-06")).toMatchObject({ enabled: true, start: "10:00", end: "16:00", overridden: true });
    expect(dayPlan(db, employee, "2026-09-07").enabled).toBe(false);
    expect(workingDaysInMonth(db, employee, "2026-09")).toBe(22);
  });
});
