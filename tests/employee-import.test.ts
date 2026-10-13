import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { createSeed } from "../lib/seed";
import type { Database } from "../lib/types";
import { checkImport, normalizePhone, parseDate } from "../server/employee-import";

async function db() {
  const d = (await createSeed()) as Database;
  d.companies.push({ id: "c1", name: "A", slug: "a", ownerName: "O", plan: "B", status: "ACTIVE", timezone: "Asia/Tashkent", createdAt: "" });
  d.branches.push({ id: "b1", companyId: "c1", name: "Bosh ofis", address: "", latitude: 41, longitude: 69, radiusMeters: 100, manager: "", status: "ACTIVE" } as Database["branches"][number]);
  d.departments.push({ id: "d1", companyId: "c1", name: "Savdo" });
  d.positions.push({ id: "p1", companyId: "c1", name: "Sotuvchi" });
  d.schedules.push({ id: "s1", companyId: "c1", name: "5/2", type: "FIXED", graceMinutes: 5, overtimeEnabled: false, days: [] });
  d.employees.push({ id: "e0", companyId: "c1", employeeNo: "EMP-0001", firstName: "Bor", lastName: "Xodim", phone: "+998 90 111 22 33", email: "", departmentId: "d1", positionId: "p1", branchId: "b1", scheduleId: "s1", employmentType: "FULL_TIME", startDate: "2026-01-01", baseSalary: 1, currency: "UZS", telegramConnected: false, deviceStatus: "PENDING", status: "ACTIVE", createdAt: "", updatedAt: "" });
  return d;
}

async function file(rows: (string | number | Date)[][]) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Xodimlar");
  sheet.addRow(["Familiya*", "Ism*", "Telefon*", "Filial*", "Bo‘lim*", "Lavozim*", "Ish grafigi*", "Ishga kirgan sana*", "Oylik (so‘m)"]);
  for (const r of rows) sheet.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("Excel’dan xodim import", () => {
  it("telefon va sanani tushunadi", () => {
    expect(normalizePhone("901234567")).toBe("+998 90 123 45 67");
    expect(normalizePhone("+998 (90) 123-45-67")).toBe("+998 90 123 45 67");
    expect(normalizePhone("12345")).toBeUndefined();
    expect(parseDate("01.10.2026")).toBe("2026-10-01");
    expect(parseDate("2026-10-01")).toBe("2026-10-01");
    expect(parseDate("31.02.2026")).toBeUndefined();
  });

  it("to‘g‘ri qatorlar o‘tadi, xatolilari sababi bilan ko‘rsatiladi", async () => {
    const rows = await checkImport(
      await db(),
      "c1",
      await file([
        ["Karimov", "Jasur", "901234567", "Bosh ofis", "savdo", "Sotuvchi", "5/2", new Date(Date.UTC(2026, 9, 1)), "5 000 000"],
        ["Aliyeva", "Nodira", "+998 90 111 22 33", "Bosh ofis", "Savdo", "Kassir", "5/2", "01.10.2026", 4000000],
        ["Toshev", "Bek", "93 555 66 77", "Yo‘q filial", "Savdo", "Sotuvchi", "5/2", "45.10.2026", ""],
        [],
      ]),
      true,
    );
    expect(rows).toHaveLength(3); // bo‘sh qator o‘tkazib yuboriladi
    expect(rows[0].errors).toEqual([]);
    expect(rows[0].employee).toMatchObject({ phone: "+998 90 123 45 67", departmentId: "d1", startDate: "2026-10-01", baseSalary: 5_000_000 });
    expect(rows[1].errors).toContain("Bu telefon bilan xodim allaqachon bor");
    expect(rows[1].warnings.join()).toContain("Yangi lavozim yaratiladi: «Kassir»");
    expect(rows[2].errors.join(" | ")).toMatch(/Filial topilmadi.*Sana noto‘g‘ri/);
    expect(rows[2].employee).toBeUndefined();
  });

  it("yangi lavozim yaratish o‘chirilsa — xato", async () => {
    const rows = await checkImport(await db(), "c1", await file([["Karimov", "Jasur", "901234567", "Bosh ofis", "Savdo", "Kassir", "5/2", "01.10.2026", 1]]), false);
    expect(rows[0].errors).toContain("Lavozim topilmadi: «Kassir»");
  });
});
