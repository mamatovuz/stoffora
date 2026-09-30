import { describe, expect, it } from "vitest";
import { alignDepartment, assertEmployeeCapacity, employeeLimitError, purgeEmployees } from "../lib/limits";
import { scrubSensitive } from "../lib/store";
import { emptyDatabase } from "../lib/seed";
import type { Database, Employee } from "../lib/types";

function employee(id: string, patch: Partial<Employee> = {}): Employee {
  return {
    id, companyId: "c1", employeeNo: id, firstName: "A", lastName: "B", phone: "", email: "", departmentId: "d0", positionId: "p1",
    branchId: "b1", scheduleId: "s1", employmentType: "FULL_TIME", startDate: "2026-01-01", baseSalary: 1_000_000, currency: "UZS",
    telegramConnected: false, deviceStatus: "PENDING", status: "ACTIVE", createdAt: "", updatedAt: "", ...patch,
  };
}

function db(): Database {
  const d = emptyDatabase();
  d.companies.push({ id: "c1", name: "Gulnora Farm", slug: "g", ownerName: "O", plan: "B", status: "ACTIVE", timezone: "Asia/Tashkent", createdAt: "", employeeLimit: 3 });
  d.departments.push({ id: "d0", companyId: "c1", name: "Umumiy" }, { id: "d1", companyId: "c1", name: "Savdo" });
  d.positions.push({ id: "p1", companyId: "c1", name: "Farmatsevt", departmentId: "d1" });
  return d;
}

describe("tarif chegarasi", () => {
  it("faol xodimlar chegaradan oshmaydi, ishdan bo‘shaganlar hisobga kirmaydi", () => {
    const d = db();
    d.employees.push(employee("e1"), employee("e2"), employee("e3", { status: "DISMISSED" }));
    expect(employeeLimitError(d, "c1")).toBeUndefined();
    d.employees.push(employee("e4"));
    const error = employeeLimitError(d, "c1");
    expect(error).toContain("ko‘pi bilan 3 ta");
    expect(error).toContain("@mamatov_ads");
    expect(() => assertEmployeeCapacity(d, "c1")).toThrow("@mamatov_ads");
    d.companies[0].limitContact = "@boshqa";
    expect(employeeLimitError(d, "c1")).toContain("@boshqa");
    d.companies[0].employeeLimit = undefined;
    expect(employeeLimitError(d, "c1")).toBeUndefined();
  });
});

describe("bo‘lim lavozimga ergashadi", () => {
  it("lavozim bo‘limga biriktirilgan bo‘lsa xodim bo‘limi to‘g‘rilanadi", () => {
    const d = db();
    const e = employee("e1");
    expect(alignDepartment(d, e)).toBe(true);
    expect(e.departmentId).toBe("d1");
    expect(alignDepartment(d, e)).toBe(false);
  });
});

describe("butunlay o‘chirish", () => {
  it("xodimdan hech narsa qolmaydi — yuz ma’lumoti va rasmlar ham", () => {
    const d = db();
    d.employees.push(employee("e1", { photoDataUrl: "data:image/jpeg;base64,AAA" }), employee("e2"));
    d.attendance.push({ id: "a1", companyId: "c1", employeeId: "e1", branchId: "b1", date: "2026-09-01", scheduledStart: "09:00", scheduledEnd: "18:00", checkIn: "09:00", lateMinutes: 0, earlyLeaveMinutes: 0, workedMinutes: 0, overtimeMinutes: 0, status: "WORKING", verification: ["FACE"], updatedAt: "" });
    d.faceProfiles.push({ companyId: "c1", employeeId: "e1", descriptor: Array(128).fill(0.1), samples: [Array(128).fill(0.1)], enrolledAt: "", updatedAt: "" });
    d.photoQueue.push({ id: "q1", companyId: "c1", employeeId: "e1", chatId: "-100", photoDataUrl: "data:image/jpeg;base64,BBB", caption: "", createdAt: "", attempts: 0 });
    d.leaveRequests.push({ id: "l1", companyId: "c1", employeeId: "e1", type: "SICK", startDate: "2026-09-02", endDate: "2026-09-02", reason: "", status: "PENDING", createdAt: "" });
    d.notifications.push({ id: "n1", companyId: "c1", employeeId: "e1", title: "x", body: "y", type: "LEAVE", read: false, createdAt: "" });
    const removed = purgeEmployees(d, "c1", new Set(["e1"]));
    expect(removed).toBe(1);
    expect(d.employees.map((e) => e.id)).toEqual(["e2"]);
    expect(d.attendance).toHaveLength(0);
    expect(d.faceProfiles).toHaveLength(0);
    expect(d.photoQueue).toHaveLength(0);
    expect(d.leaveRequests).toHaveLength(0);
    expect(d.notifications).toHaveLength(0);
  });

  it("audit yozuvlarida rasm va yuz vektori saqlanmaydi", () => {
    const clean = scrubSensitive({ firstName: "A", photoDataUrl: "data:...", nested: { descriptor: [1, 2], samples: [[1]], keep: 1 } });
    expect(clean).toEqual({ firstName: "A", nested: { keep: 1 } });
  });
});
