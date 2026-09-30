import { describe, expect, it } from "vitest";
import { emptyDatabase } from "../lib/seed";
import type { Employee } from "../lib/types";
import { upcomingCelebrations } from "../server/hr-worker";
import { documentStatus } from "../server/documents";

function employee(id: string, patch: Partial<Employee>): Employee {
  return {
    id, companyId: "c1", employeeNo: id, firstName: "Ali", lastName: id, phone: "", email: "", departmentId: "d", positionId: "p",
    branchId: "b", scheduleId: "s", employmentType: "FULL_TIME", startDate: "2020-01-01", baseSalary: 0, currency: "UZS",
    telegramConnected: false, deviceStatus: "PENDING", status: "ACTIVE", createdAt: "", updatedAt: "", ...patch,
  };
}

describe("tug‘ilgan kun va yubileylar", () => {
  it("bugungi va yaqin kunlar, yil almashuvi bilan", () => {
    const db = emptyDatabase();
    db.employees.push(
      employee("e1", { birthDate: "1995-09-30" }),
      employee("e2", { birthDate: "1990-10-05", startDate: "2025-09-30" }),
      employee("e3", { birthDate: "1990-01-03" }),
      employee("e4", { birthDate: "1990-09-30", status: "DISMISSED" }),
      employee("e5", { startDate: "2026-09-30" }), // bugun ishga kirgan — yubiley emas
    );
    const list = upcomingCelebrations(db, "c1", 14, "2026-09-30");
    expect(list.map((c) => `${c.employeeId}:${c.kind}:${c.daysLeft}:${c.years}`)).toEqual([
      "e1:BIRTHDAY:0:31",
      "e2:ANNIVERSARY:0:1",
      "e2:BIRTHDAY:5:36",
    ]);
    // Dekabr oxirida yanvar tug‘ilgan kunlari ko‘rinadi
    expect(upcomingCelebrations(db, "c1", 14, "2026-12-25").map((c) => c.employeeId)).toContain("e3");
  });
});

describe("hujjat muddati", () => {
  it("muddati o‘tgan, yaqin va yetarli", () => {
    expect(documentStatus({ expiresAt: "2026-09-29" }, "2026-09-30")).toBe("EXPIRED");
    expect(documentStatus({ expiresAt: "2026-10-20" }, "2026-09-30")).toBe("SOON");
    expect(documentStatus({ expiresAt: "2027-09-30" }, "2026-09-30")).toBe("OK");
    expect(documentStatus({}, "2026-09-30")).toBe("OK");
  });
});
