import { describe, expect, it } from "vitest";
import { dayPlan, workingDaysInMonth } from "../lib/schedule";
import { matchPassPercent, matchPercent } from "../lib/face";
import { parseDeepLink } from "../lib/mini";
import { payrollRows } from "../server/reports";
import { emptyDatabase } from "../lib/seed";
import type { Attendance, Database, Schedule } from "../lib/types";

/** Kompaniya har kuni ishlaydi (dushanba–yakshanba), 09:00–18:00. */
const everyDay: Schedule = {
  id: "s1",
  companyId: "c1",
  name: "Har kuni",
  type: "FIXED",
  graceMinutes: 5,
  overtimeEnabled: true,
  days: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, enabled: true, start: "09:00", end: "18:00", breakMinutes: 0 })),
};

describe("shaxsiy dam olish kuni", () => {
  const db = { schedules: [everyDay], scheduleOverrides: [] as Database["scheduleOverrides"] };
  const friday = "2026-09-04";
  const saturday = "2026-09-05";

  it("grafik har kuni ishlasa ham, xodimning dam kuni — ishlamaydi", () => {
    const employee = { id: "e1", scheduleId: "s1", restDays: [5] };
    expect(dayPlan(db, employee, friday)).toMatchObject({ enabled: false, personalRest: true });
    expect(dayPlan(db, employee, saturday).enabled).toBe(true);
    // Sentyabr 2026: 30 kun, 4 ta juma → 26 ish kuni.
    expect(workingDaysInMonth(db, employee, "2026-09")).toBe(26);
    expect(workingDaysInMonth(db, { id: "e2", scheduleId: "s1" }, "2026-09")).toBe(30);
  });

  it("ko‘chirish (bir martalik): juma — ish kuni, shanba — dam; keyingi hafta odatdagidek", () => {
    const local = { schedules: [everyDay], scheduleOverrides: [] as Database["scheduleOverrides"] };
    const employee = { id: "e1", scheduleId: "s1", restDays: [5] };
    local.scheduleOverrides.push(
      { id: "o1", companyId: "c1", employeeId: "e1", date: friday, working: true, start: "09:00", end: "18:00", reason: "Dam kuni ko‘chirildi", dayOffMoveId: "m1" },
      { id: "o2", companyId: "c1", employeeId: "e1", date: saturday, working: false, reason: "Dam olish", dayOffMoveId: "m1" },
    );
    expect(dayPlan(local, employee, friday)).toMatchObject({ enabled: true, overridden: true });
    expect(dayPlan(local, employee, saturday)).toMatchObject({ enabled: false, overridden: true });
    // Keyingi juma yana dam olish kuni.
    expect(dayPlan(local, employee, "2026-09-11").enabled).toBe(false);
    expect(dayPlan(local, employee, "2026-09-12").enabled).toBe(true);
  });
});

describe("kompensatsiya: kelmagan kunni dam kunida ishlab qoplash", () => {
  function setup(compensation: boolean | undefined) {
    const db = emptyDatabase();
    db.companies.push({
      id: "c1",
      name: "Test",
      slug: "t",
      ownerName: "O",
      plan: "B",
      status: "ACTIVE",
      timezone: "Asia/Tashkent",
      createdAt: "2026-01-01T00:00:00Z",
      payroll: { latePenaltyMode: "NONE", latePenaltyPerMinute: 0, freeLateMinutesPerMonth: 0, monthlyHours: 176, overtimePay: true, absencePenalty: "DAILY", absenceCompensation: compensation },
    });
    db.schedules.push(everyDay);
    db.employees.push({
      id: "e1", companyId: "c1", employeeNo: "1", firstName: "A", lastName: "B", phone: "", email: "", departmentId: "d", positionId: "p", branchId: "b", scheduleId: "s1",
      employmentType: "FULL_TIME", startDate: "2026-08-01", baseSalary: 2_600_000, currency: "UZS", telegramConnected: false, deviceStatus: "PENDING", status: "ACTIVE",
      restDays: [5], createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-01T00:00:00Z",
    });
    const record = (date: string, extra: Partial<Attendance> = {}): Attendance => ({
      id: `a-${date}`, companyId: "c1", employeeId: "e1", branchId: "b", date, scheduledStart: "09:00", scheduledEnd: "18:00", checkIn: "09:00", checkOut: "18:00",
      lateMinutes: 0, earlyLeaveMinutes: 0, workedMinutes: 540, overtimeMinutes: 0, status: "CHECKED_OUT", verification: ["FACE"], updatedAt: "2026-08-31T00:00:00Z", ...extra,
    });
    // Avgust 2026: har kuni keladi, faqat seshanba 11-avgust kelmagan; juma 14-avgust (dam kuni) ishlagan.
    for (let d = 1; d <= 31; d += 1) {
      const date = `2026-08-${String(d).padStart(2, "0")}`;
      const weekday = new Date(`${date}T12:00:00+05:00`).getDay();
      if (date === "2026-08-11") continue;
      if (weekday === 5 && date !== "2026-08-14") continue;
      db.attendance.push(record(date, weekday === 5 ? { overtimeMinutes: 540 } : {}));
    }
    return db;
  }

  it("dam kunida ishlagani kelmagan kunni qoplaydi — ushlanma yo‘q, qo‘shimcha ish to‘lanmaydi", () => {
    const [row] = payrollRows(setup(undefined), "c1", "2026-08");
    expect(row.absentTotal).toBe(1);
    expect(row.compensatedDays).toBe(1);
    expect(row.compensatedDates).toEqual(["2026-08-14"]);
    expect(row.absenceDeduction).toBe(0);
    expect(row.overtimeAmount).toBe(0);
    expect(row.explanation).toContain("qoplandi");
  });

  it("sozlama o‘chirilsa — ushlanma olinadi, dam kunidagi ish qo‘shimcha ish sifatida to‘lanadi", () => {
    const [row] = payrollRows(setup(false), "c1", "2026-08");
    expect(row.compensatedDays).toBe(0);
    expect(row.absenceDeduction).toBeGreaterThan(0);
    expect(row.overtimeAmount).toBeGreaterThan(0);
  });
});

describe("Face ID moslik foizi", () => {
  it("chegara masofasi (0,4) = 75%; chegaradan oshganda foiz tez tushadi", () => {
    expect(matchPercent(0.4, 0.4)).toBe(75);
    expect(matchPassPercent(0.4)).toBe(75);
    expect(matchPercent(0.2, 0.4)).toBe(88);
    expect(matchPercent(0, 0.4)).toBe(100);
    // Begona odam (masofa 0,45) — avval «71%» ko‘rinardi, endi aniq past.
    expect(matchPercent(0.45, 0.4)).toBe(56);
    expect(matchPercent(0.6, 0.4)).toBe(0);
  });
  it("bot xabaridagi «dam kuni» havolasi", () => {
    expect(parseDeepLink("dayoff")).toEqual({ tab: "leave", view: "dayoff", id: undefined });
  });
});
