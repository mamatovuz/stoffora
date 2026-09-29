import { describe, expect, it } from "vitest";
import {
  assertAttendanceTransition,
  assertAttendanceTimeOrder,
  assertQrNonceUsable,
  assertQrScope,
  calculateAttendance,
  haversineDistance,
  minutesBetween,
} from "../lib/attendance";

describe("attendance rules", () => {
  it("kechikishni grace perioddan keyin hisoblaydi", () => {
    expect(
      calculateAttendance({
        scheduledStart: "08:00",
        scheduledEnd: "17:00",
        checkIn: "08:05",
        graceMinutes: 5,
      }).lateMinutes,
    ).toBe(0);
    expect(
      calculateAttendance({
        scheduledStart: "08:00",
        scheduledEnd: "17:00",
        checkIn: "08:06",
        graceMinutes: 5,
      }).lateMinutes,
    ).toBe(6);
  });
  it("erta chiqish va overtime ni hisoblaydi", () => {
    expect(
      calculateAttendance({
        scheduledStart: "08:00",
        scheduledEnd: "17:00",
        checkIn: "08:00",
        checkOut: "16:45",
        graceMinutes: 5,
      }).earlyLeaveMinutes,
    ).toBe(15);
    expect(
      calculateAttendance({
        scheduledStart: "08:00",
        scheduledEnd: "17:00",
        checkIn: "08:00",
        checkOut: "17:20",
        graceMinutes: 5,
      }).overtimeMinutes,
    ).toBe(20);
  });
  it("ishlangan vaqtni hisoblaydi", () =>
    expect(minutesBetween("08:04", "17:02")).toBe(538));
  it("chiqish kirishdan oldin yoki teng bo‘lsa rad etadi", () => {
    expect(() => assertAttendanceTimeOrder("17:00", "08:00")).toThrow(
      "kirish vaqtidan keyin",
    );
    expect(() => assertAttendanceTimeOrder("08:00", "08:00")).toThrow(
      "kirish vaqtidan keyin",
    );
  });
  it("noto‘g‘ri soat qiymatini rad etadi", () => {
    expect(() => assertAttendanceTimeOrder("25:00")).toThrow("haqiqiy");
  });
});

describe("GPS radius", () => {
  const lat = 40.7821,
    lon = 72.3442;
  it("bir nuqta 0 metr", () =>
    expect(haversineDistance(lat, lon, lat, lon)).toBe(0));
  it("100 metr ichidagi nuqta qabul qilinadi", () =>
    expect(haversineDistance(lat, lon, lat + 0.0008, lon)).toBeLessThanOrEqual(
      100,
    ));
  it("100 metrdan tashqari nuqta rad etiladi", () =>
    expect(haversineDistance(lat, lon, lat + 0.001, lon)).toBeGreaterThan(100));
});

describe("attendance security state", () => {
  it("ikki marta check-in ni rad etadi", () => {
    expect(() =>
      assertAttendanceTransition("CHECK_IN", { checkIn: "08:00" }),
    ).toThrow("allaqachon ishga kelgansiz");
  });
  it("check-in siz check-out ni rad etadi", () => {
    expect(() => assertAttendanceTransition("CHECK_OUT")).toThrow(
      "Avval ishga kelishni",
    );
  });
  it("bir xodim uchun QR replay ni rad etadi", () => {
    const qr = {
      id: "qr-1",
      companyId: "company-1",
      branchId: "branch-1",
      nonce: "nonce-1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      usedEmployeeIds: ["employee-1"],
    };
    expect(() => assertQrNonceUsable(qr, "employee-1")).toThrow(
      "allaqachon ishlatgansiz",
    );
    expect(() => assertQrNonceUsable(qr, "employee-2")).not.toThrow();
  });
  it("muddati tugagan QR ni rad etadi", () => {
    const qr = {
      id: "qr-2",
      companyId: "company-1",
      branchId: "branch-1",
      nonce: "nonce-2",
      expiresAt: new Date(Date.now() - 1).toISOString(),
    };
    expect(() => assertQrNonceUsable(qr, "employee-1")).toThrow(
      "muddati tugagan",
    );
  });
  it("boshqa kompaniya QR kodini rad etadi", () => {
    expect(() =>
      assertQrScope(
        { companyId: "company-2", branchId: "branch-1" },
        { companyId: "company-1", branchId: "branch-1" },
      ),
    ).toThrow("boshqa kompaniya");
  });
});
