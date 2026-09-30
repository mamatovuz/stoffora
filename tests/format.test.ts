import { describe, expect, it } from "vitest";
import { dateParts, tashkentClock, tashkentIsoDate } from "../lib/format";

const intlDate = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
const intlClock = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
const intlWeekday = (d: Date) =>
  ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tashkent", weekday: "short" }).format(d),
  );

describe("Toshkent vaqti (UTC+5 arifmetika Intl bilan bir xil)", () => {
  const instants = [
    "2026-09-30T18:59:59Z",
    "2026-09-30T19:00:00Z",
    "2026-12-31T19:30:00Z",
    "2027-01-01T00:00:00Z",
    "2026-03-29T01:00:00Z",
    "2026-10-25T01:00:00Z",
    "2028-02-29T20:15:00Z",
  ];
  for (const iso of instants)
    it(iso, () => {
      const d = new Date(iso);
      expect(tashkentIsoDate(d)).toBe(intlDate(d));
      expect(tashkentClock(d)).toBe(intlClock(d));
      expect(dateParts(d).weekday).toBe(intlWeekday(d));
    });

  it("tasodifiy 2000 ta vaqt", () => {
    for (let i = 0; i < 2000; i += 1) {
      const d = new Date(Date.UTC(2024, 0, 1) + Math.floor(Math.random() * 5 * 365 * 86_400_000));
      expect(tashkentIsoDate(d)).toBe(intlDate(d));
      expect(tashkentClock(d)).toBe(intlClock(d));
    }
  });
});
