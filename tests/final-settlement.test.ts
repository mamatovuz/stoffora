import { describe, expect, it } from "vitest";
import { createSeed } from "../lib/seed";
import type { Attendance, Database, Employee } from "../lib/types";
import ExcelJS from "exceljs";
import { buildAttendanceWorkbook, buildPayrollWorkbook, payrollRows } from "../server/reports";
import { finalSettlement, offboard } from "../server/people";

/*
 * Oy o‘rtasida ishdan bo‘shagan xodim: oyligi bo‘shagan kungacha bo‘lgan ish kunlariga proporsional,
 * oy oxiridagi qaydnomaga kiradi; bo‘shatishda qo‘lda to‘langan bo‘lsa — qayta to‘lanmaydi.
 * 2026-yil sentabr: dushanba–juma grafigi bo‘yicha 22 ish kuni; 1–15 sentabr oralig‘ida 11 ish kuni.
 */
async function setup() {
  const db = (await createSeed()) as Database;
  for (const key of ["assets", "payrollPeriods", "payrollAdjustments", "scheduleOverrides", "holidays", "leaveRequests", "attendance", "mobileDevices", "mobileSessions", "mobilePushTokens", "mobileActivationCodes", "biometricDevices", "advanceRequests", "attendanceCorrections", "dayOffMoves", "shiftSwaps", "deviceChangeRequests", "branchTransfers", "branches", "users", "positions"] as const)
    (db as unknown as Record<string, unknown[]>)[key] ||= [];
  db.companies.push({ id: "c1", name: "A", slug: "a", ownerName: "O", plan: "B", status: "ACTIVE", timezone: "Asia/Tashkent", createdAt: "" });
  db.schedules.push({
    id: "s1", companyId: "c1", name: "5/2", type: "FIXED", graceMinutes: 5, overtimeEnabled: false,
    days: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, enabled: day >= 1 && day <= 5, start: "09:00", end: "18:00", breakMinutes: 60 })),
  });
  const employee = (id: string, extra: Partial<Employee> = {}): Employee => ({
    id, companyId: "c1", employeeNo: id, firstName: id, lastName: "T", phone: "+998901112233", email: "", departmentId: "d", positionId: "p",
    branchId: "b", scheduleId: "s1", employmentType: "FULL_TIME", startDate: "2026-01-01", baseSalary: 2_200_000, currency: "UZS",
    telegramConnected: false, deviceStatus: "PENDING", status: "ACTIVE", createdAt: "", updatedAt: "", ...extra,
  });
  const leaver = employee("leaver", { status: "DISMISSED", dismissedAt: "2026-09-15" });
  db.employees.push(employee("stay"), leaver, employee("old", { status: "DISMISSED", dismissedAt: "2026-08-20" }));
  // Ikkalasi ham har ish kuni vaqtida kelgan
  for (const e of ["stay", "leaver"])
    for (let d = 1; d <= 30; d += 1) {
      const date = `2026-09-${String(d).padStart(2, "0")}`;
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
      if (weekday === 0 || weekday === 6 || (e === "leaver" && date > "2026-09-15")) continue;
      db.attendance.push({
        id: `${e}-${date}`, companyId: "c1", employeeId: e, branchId: "b", date, scheduledStart: "09:00", scheduledEnd: "18:00",
        checkIn: "08:55", checkOut: "18:00", lateMinutes: 0, earlyLeaveMinutes: 0, workedMinutes: 480, overtimeMinutes: 0, status: "CHECKED_OUT", verification: ["MANUAL"], updatedAt: "",
      } as Attendance);
    }
  db.companies[0].payroll = { latePenaltyMode: "NONE" } as Database["companies"][number]["payroll"];
  return { db, leaver };
}

describe("ishdan bo‘shatishda yakuniy hisob-kitob", () => {
  it("oy o‘rtasida bo‘shagan xodim qaydnomaga proporsional oylik bilan kiradi", async () => {
    const { db } = await setup();
    const rows = payrollRows(db, "c1", "2026-09");
    expect(rows.map((r) => r.employee.id).sort()).toEqual(["leaver", "stay"]); // avgustda ketgan kirmaydi
    const stay = rows.find((r) => r.employee.id === "stay")!;
    const leaver = rows.find((r) => r.employee.id === "leaver")!;
    expect(stay.net).toBe(2_200_000);
    expect(leaver.leaver).toMatchObject({ plannedDays: 11, monthWorkingDays: 22 });
    expect(leaver.base).toBe(1_100_000);
    expect(leaver.net).toBe(1_100_000);
    expect(leaver.explanation).toContain("Ishdan bo‘shagan: 15.09.2026");
  });

  it("bo‘shatishda qo‘lda to‘langan summa oy oxirida qayta to‘lanmaydi", async () => {
    const { db, leaver } = await setup();
    expect(finalSettlement(db, leaver, "2026-09-15").net).toBe(1_100_000);
    const result = offboard(db, leaver, "2026-09-15", "HR", { settlement: { mode: "PAID_NOW" } });
    expect(result.done.join(" ")).toContain("qo‘lda to‘landi");
    expect(leaver.finalSettlement).toMatchObject({ mode: "PAID_NOW", paid: 1_100_000, computed: 1_100_000 });
    const row = payrollRows(db, "c1", "2026-09").find((r) => r.employee.id === "leaver")!;
    expect(row.net).toBe(0);
    expect(row.leaver?.paidAtDismissal).toBe(1_100_000);
    expect(row.explanation).toContain("qo‘lda to‘langan");
  });

  it("oy oxirida to‘lash tanlansa — summa qaydnomada qoladi; aktivlar qaytarib olinadi", async () => {
    const { db, leaver } = await setup();
    db.assets.push({ id: "a1", companyId: "c1", name: "Noutbuk", category: "LAPTOP", quantity: 1, status: "ISSUED", employeeId: "leaver", history: [], createdAt: "" });
    const result = offboard(db, leaver, "2026-09-15", "HR", { settlement: { mode: "MONTH_END" }, assets: [{ id: "a1", action: "return" }] });
    expect(result.unreturnedAssets).toEqual([]);
    expect(db.assets[0]).toMatchObject({ status: "IN_STOCK", employeeId: undefined });
    expect(payrollRows(db, "c1", "2026-09").find((r) => r.employee.id === "leaver")!.net).toBe(1_100_000);
  });

  it("yopilgan oyda qo‘lda to‘lov yozilmaydi", async () => {
    const { db, leaver } = await setup();
    db.payrollPeriods.push({ id: "p", companyId: "c1", month: "2026-09", closedAt: "", closedBy: "", lines: [], total: 0 });
    expect(() => offboard(db, leaver, "2026-09-15", "HR", { settlement: { mode: "PAID_NOW" } })).toThrow("yopilgan");
  });

  it("ish haqi qaydnomasi va davomat Excel’i to‘g‘ri yoziladi", async () => {
    const { db, leaver } = await setup();
    offboard(db, leaver, "2026-09-15", "HR", { settlement: { mode: "PAID_NOW", paid: 1_000_000 } });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await buildPayrollWorkbook(db, "c1", "2026-09").xlsx.writeBuffer()) as ArrayBuffer);
    const sheet = book.worksheets[0];
    expect(sheet.name).toBe("Ish haqi qaydnomasi");
    const values = sheet.getSheetValues().flat().map(String);
    expect(values.some((v) => v.includes("(bo‘shagan)"))).toBe(true);
    expect(values).toContain("Bo‘shatishda to‘langan");
    expect(values.some((v) => v.includes("Tuzdi (hisobchi)"))).toBe(true);
    const att = new ExcelJS.Workbook();
    await att.xlsx.load((await buildAttendanceWorkbook(db, "c1", { from: "2026-09-01", to: "2026-09-30" }).xlsx.writeBuffer()) as ArrayBuffer);
    expect(att.worksheets.map((w) => w.name)).toEqual(["Xulosa", "Batafsil", "Tabel"]);
  });
});
