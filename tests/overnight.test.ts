import { describe, expect, it } from "vitest";
import { calculateAttendance } from "../lib/attendance";
import { breakMinutes } from "../lib/mini";
import { minutesSinceCheckIn, shiftDateAt } from "../lib/schedule";
import { clockOnShiftDay, isOvernight, shiftMinutes } from "../lib/shift-time";
import type { Database } from "../lib/types";

/* Kechasi tugaydigan smenalar: tugash < boshlanish => tugash ertasi kuni. */

const CASES = [
  { start: "09:00", end: "18:00", minutes: 540, overnight: false },
  { start: "14:00", end: "00:00", minutes: 600, overnight: true },
  { start: "18:00", end: "02:00", minutes: 480, overnight: true },
  { start: "22:00", end: "06:00", minutes: 480, overnight: true },
  { start: "23:30", end: "00:30", minutes: 60, overnight: true },
];

describe("smena davomiyligi", () => {
  for (const c of CASES)
    it(`${c.start} → ${c.end} = ${c.minutes} daqiqa`, () => {
      expect(shiftMinutes(c.start, c.end)).toBe(c.minutes);
      expect(isOvernight(c.start, c.end)).toBe(c.overnight);
    });
  it("yarim tundan keyingi vaqt ish kunining davomi", () => {
    expect(clockOnShiftDay("01:30", "22:00", "06:00")).toBe(25 * 60 + 30);
    expect(clockOnShiftDay("21:00", "22:00", "06:00")).toBe(21 * 60);
    expect(clockOnShiftDay("08:00", "09:00", "18:00")).toBe(8 * 60);
  });
});

describe("davomat — kechki smenalar", () => {
  const calc = (start: string, end: string, checkIn: string, checkOut?: string, grace = 0) =>
    calculateAttendance({ scheduledStart: start, scheduledEnd: end, checkIn, checkOut, graceMinutes: grace });

  for (const c of CASES)
    it(`${c.start} → ${c.end}: o‘z vaqtida keldi-ketdi`, () => {
      expect(calc(c.start, c.end, c.start, c.end)).toMatchObject({
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        overtimeMinutes: 0,
        workedMinutes: c.minutes,
        status: "CHECKED_OUT",
      });
    });

  it("14:00 → 00:00: kechikish, erta ketish, qo‘shimcha ish", () => {
    expect(calc("14:00", "00:00", "14:20", "00:00").lateMinutes).toBe(20);
    expect(calc("14:00", "00:00", "14:00", "23:40")).toMatchObject({ earlyLeaveMinutes: 20, overtimeMinutes: 0, workedMinutes: 580 });
    expect(calc("14:00", "00:00", "14:00", "00:45")).toMatchObject({ earlyLeaveMinutes: 0, overtimeMinutes: 45, workedMinutes: 645 });
  });
  it("22:00 → 06:00: yarim tundan keyin kelsa — kechikish", () => {
    expect(calc("22:00", "06:00", "00:30").lateMinutes).toBe(150);
    expect(calc("22:00", "06:00", "21:50", "06:10")).toMatchObject({ lateMinutes: 0, overtimeMinutes: 10, workedMinutes: 500 });
    expect(calc("22:00", "06:00", "22:00", "05:00").earlyLeaveMinutes).toBe(60);
  });
  it("18:00 → 02:00 va 23:30 → 00:30", () => {
    expect(calc("18:00", "02:00", "18:05", "01:30", 10)).toMatchObject({ lateMinutes: 0, earlyLeaveMinutes: 30, workedMinutes: 445 });
    expect(calc("23:30", "00:30", "23:45", "00:30")).toMatchObject({ lateMinutes: 15, earlyLeaveMinutes: 0, workedMinutes: 45 });
  });
  it("kunduzgi grafik avvalgidek", () => {
    expect(calc("09:00", "18:00", "09:12", "18:30", 5)).toMatchObject({ lateMinutes: 12, earlyLeaveMinutes: 0, overtimeMinutes: 30, workedMinutes: 558 });
    expect(calc("09:00", "18:00", "08:50", "17:00")).toMatchObject({ lateMinutes: 0, earlyLeaveMinutes: 60, workedMinutes: 490 });
  });
  it("tanaffus yarim tundan o‘tsa ham", () => {
    expect(breakMinutes([{ start: "23:50", end: "00:10" }], "00:10")).toBe(20);
  });
});

describe("ish kuni (sana) — smena boshlangan kunga", () => {
  const MON = "2026-10-05";
  const TUE = "2026-10-06";
  const db = (start: string, end: string, attendance: Partial<Database["attendance"][number]>[] = []) =>
    ({
      schedules: [{ id: "s", companyId: "c", name: "x", type: "FIXED", graceMinutes: 0, overtimeEnabled: true, days: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, enabled: true, start, end, breakMinutes: 0 })) }],
      scheduleOverrides: [],
      attendance: attendance.map((a, i) => ({ id: `a${i}`, employeeId: "e", scheduledStart: start, scheduledEnd: end, ...a })),
    }) as unknown as Database;
  const employee = { id: "e", scheduleId: "s" };

  it("Dushanba 14:00 kelgan, Seshanba 00:05 dagi ketish — Dushanba", () => {
    const d = db("14:00", "00:00", [{ date: MON, checkIn: "14:00" }]);
    expect(shiftDateAt(d, employee, TUE, "00:05")).toBe(MON);
    expect(minutesSinceCheckIn(d.attendance[0], TUE, "00:05")).toBe(605);
    // Ertasi kungi smenaga kelish — Seshanba.
    expect(shiftDateAt(d, employee, TUE, "13:55")).toBe(TUE);
  });
  it("22:00 → 06:00: kelmagan xodim 01:00 da kelsa — Dushanba smenasi", () => {
    expect(shiftDateAt(db("22:00", "06:00"), employee, TUE, "01:00")).toBe(MON);
    expect(shiftDateAt(db("22:00", "06:00"), employee, TUE, "07:00")).toBe(TUE);
  });
  it("ketgan bo‘lsa yoki kunduzgi grafik — bugun", () => {
    expect(shiftDateAt(db("14:00", "00:00", [{ date: MON, checkIn: "14:00", checkOut: "00:00" }]), employee, TUE, "00:10")).toBe(TUE);
    expect(shiftDateAt(db("09:00", "18:00", [{ date: MON, checkIn: "09:00" }]), employee, TUE, "08:55")).toBe(TUE);
    expect(shiftDateAt(db("09:00", "18:00"), employee, TUE, "00:30")).toBe(TUE);
  });
});
