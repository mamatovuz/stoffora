import { describe, expect, it } from "vitest";
import { emptyDatabase } from "../lib/seed";
import type { Attendance, Employee, Schedule } from "../lib/types";
import { payrollCsvRows, t13Rows, toCsv } from "../server/tabel";
import { advanceLimit, advanceWindowMessage } from "../server/advances";
import { advanceWindow, normalizePayrollSettings } from "../lib/payroll";

function setup() {
  const db = emptyDatabase();
  db.companies.push({ id: "c1", name: "Test", plan: "Standard", status: "ACTIVE", createdAt: "" } as never);
  const schedule: Schedule = {
    id: "s1", companyId: "c1", name: "5/2", type: "FIXED", graceMinutes: 5, overtimeEnabled: true,
    days: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, enabled: day >= 1 && day <= 5, start: "09:00", end: "18:00", breakMinutes: 60 })),
  };
  db.schedules.push(schedule);
  const employee: Employee = {
    id: "e1", companyId: "c1", employeeNo: "EMP-0001", firstName: "Ali", lastName: "Valiyev", phone: "", email: "", departmentId: "d", positionId: "p",
    branchId: "b", scheduleId: "s1", employmentType: "FULL_TIME", startDate: "2026-09-01", baseSalary: 4_400_000, currency: "UZS",
    telegramConnected: false, deviceStatus: "PENDING", status: "ACTIVE", createdAt: "", updatedAt: "",
  };
  db.employees.push(employee);
  const record = (date: string, patch: Partial<Attendance> = {}): Attendance => ({
    id: `a-${date}`, companyId: "c1", employeeId: "e1", branchId: "b", date, scheduledStart: "09:00", scheduledEnd: "18:00",
    checkIn: "09:00", checkOut: "18:00", lateMinutes: 0, earlyLeaveMinutes: 0, workedMinutes: 480, overtimeMinutes: 0,
    status: "PRESENT", verification: ["FACE"], updatedAt: "", ...patch,
  });
  // 1-sentabr seshanba: keldi; 2-sentabr chorshanba: kelmadi; 3–4: ta’til; 5-sentabr shanba (dam) — ishladi
  db.attendance.push(record("2026-09-01"), record("2026-09-05", { workedMinutes: 300 }));
  db.leaveRequests.push({ id: "l1", companyId: "c1", employeeId: "e1", type: "SICK", startDate: "2026-09-03", endDate: "2026-09-04", reason: "", status: "APPROVED", createdAt: "" } as never);
  return { db, employee };
}

describe("T-13 tabel", () => {
  it("kun belgilari va soatlar", () => {
    const { db } = setup();
    const [row] = t13Rows(db, "c1", "2026-09", "2026-09-08");
    expect(row.days.slice(0, 7).map((d) => d.code)).toEqual(["Я", "НН", "Б", "Б", "РВ", "В", "НН"]);
    expect(row.days[0].hours).toBe(8);
    expect(row.days[4].hours).toBe(5);
    expect(row.total).toEqual({ days: 2, hours: 13 });
    expect(row.counts["НН"]).toBe(2);
    // Kelajakdagi kunlar bo‘sh
    expect(row.days[10].code).toBe("");
    expect(row.days).toHaveLength(30);
  });
});

describe("1C fayllari", () => {
  it("CSV: BOM, «;» ajratgich, qo‘shtirnoq qochirish", () => {
    const csv = toCsv([["a;b", 'x"y', 5]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"a;b";"x""y";5');
  });
  it("ish haqi qatori", () => {
    const { db } = setup();
    const rows = payrollCsvRows(db, "c1", "2026-09");
    expect(rows[0][0]).toBe("Tabel raqami");
    expect(rows[1][0]).toBe("EMP-0001");
    expect(rows[1][4]).toBe(4_400_000);
    expect(rows[1]).toHaveLength(rows[0].length);
  });
});

describe("avans chegarasi", () => {
  it("oylik foizi − berilgan − kutilayotgan; yopilgan oyda 0", () => {
    const { db, employee } = setup();
    expect(advanceLimit(db, employee, "2026-09")).toMatchObject({ enabled: true, percent: 50, max: 2_200_000, available: 2_200_000 });
    db.payrollAdjustments.push({ id: "x", companyId: "c1", employeeId: "e1", month: "2026-09", type: "ADVANCE", amount: 500_000, createdBy: "", createdAt: "" });
    db.advanceRequests.push({ id: "r", companyId: "c1", employeeId: "e1", month: "2026-09", amount: 300_000, status: "PENDING", createdAt: "", updatedAt: "" });
    expect(advanceLimit(db, employee, "2026-09").available).toBe(1_400_000);
    db.companies[0].payroll = { latePenaltyMode: "NONE", latePenaltyPerMinute: 0, freeLateMinutesPerMonth: 0, monthlyHours: 176, overtimePay: false, advanceMaxPercent: 20 };
    expect(advanceLimit(db, employee, "2026-09").max).toBe(880_000);
    db.payrollPeriods.push({ id: "p", companyId: "c1", month: "2026-09", closedAt: "", closedBy: "", lines: [], total: 0 });
    expect(advanceLimit(db, employee, "2026-09")).toMatchObject({ enabled: false, available: 0 });
  });
});

describe("avans oynasi (oyning N–M kunlari)", () => {
  it("standart — oy davomida ochiq", () => {
    expect(advanceWindow(undefined, "2026-10-15")).toMatchObject({ always: true, open: true });
    expect(advanceWindow({ advanceWindowFrom: 1, advanceWindowTo: 31 }, "2026-02-28")).toMatchObject({ always: true, open: true });
  });
  it("oynadan oldin, ichida va keyin", () => {
    const w = { advanceWindowFrom: 10, advanceWindowTo: 20 };
    expect(advanceWindow(w, "2026-10-09")).toMatchObject({ open: false, opensOn: "2026-10-10", text: "har oyning 10–20-kunlari" });
    expect(advanceWindow(w, "2026-10-10")).toMatchObject({ open: true, closesOn: "2026-10-20" });
    expect(advanceWindow(w, "2026-10-20")).toMatchObject({ open: true });
    expect(advanceWindow(w, "2026-10-21")).toMatchObject({ open: false, opensOn: "2026-11-10" });
    expect(advanceWindow(w, "2026-12-25")).toMatchObject({ open: false, opensOn: "2027-01-10" });
  });
  it("qisqa oy: 30–31 fevralda oyning oxirgi kuniga suriladi", () => {
    const w = { advanceWindowFrom: 30, advanceWindowTo: 31 };
    expect(advanceWindow(w, "2026-02-27")).toMatchObject({ open: false, opensOn: "2026-02-28" });
    expect(advanceWindow(w, "2026-02-28")).toMatchObject({ open: true, closesOn: "2026-02-28" });
    expect(advanceWindow(w, "2026-01-31")).toMatchObject({ open: true });
    expect(advanceWindow(w, "2026-03-01")).toMatchObject({ open: false, opensOn: "2026-03-30" });
  });
  it("sozlama normalizatsiyasi: chegaralar 1–31, teskari kiritilsa almashtiriladi", () => {
    expect(normalizePayrollSettings({ advanceWindowFrom: 25, advanceWindowTo: 5 })).toMatchObject({ advanceWindowFrom: 5, advanceWindowTo: 25 });
    expect(normalizePayrollSettings({ advanceWindowFrom: 0, advanceWindowTo: 99 })).toMatchObject({ advanceWindowFrom: 1, advanceWindowTo: 31 });
    expect(normalizePayrollSettings({})).toMatchObject({ advanceWindowFrom: 1, advanceWindowTo: 31 });
  });
  it("limit oyna holatini qaytaradi va xabar tushunarli", () => {
    const { db, employee } = setup();
    db.companies[0].payroll = { latePenaltyMode: "NONE", latePenaltyPerMinute: 0, freeLateMinutesPerMonth: 0, monthlyHours: 176, overtimePay: false, advanceWindowFrom: 10, advanceWindowTo: 20 };
    const limit = advanceLimit(db, employee, "2026-09", "2026-09-25");
    expect(limit.window).toMatchObject({ open: false, opensOn: "2026-10-10" });
    // Oyna yopiq bo‘lsa ham summa chegarasi ko‘rinib turadi (xodim qancha so‘rashi mumkinligini biladi).
    expect(limit.available).toBe(2_200_000);
    expect(advanceWindowMessage(limit.window)).toBe("Avans so‘rovlari har oyning 10–20-kunlari qabul qilinadi. Keyingi imkoniyat: 10-oktabr 2026.");
    expect(advanceLimit(db, employee, "2026-09", "2026-09-12").window.open).toBe(true);
  });
});
