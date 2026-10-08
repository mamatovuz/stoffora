import { describe, expect, it } from "vitest";
import { duration } from "../lib/format";
import { normalizeClock } from "../src/components/TimeInput";
import { badgeToken } from "../server/badge";

describe("duration — daqiqani soat va daqiqaga", () => {
  it("60 dan kichik — daqiqa", () => {
    expect(duration(0)).toBe("0 daq");
    expect(duration(45)).toBe("45 daq");
  });
  it("60 dan katta — soat va daqiqa", () => {
    expect(duration(60)).toBe("1 soat");
    expect(duration(100)).toBe("1 soat 40 daq");
    expect(duration(600)).toBe("10 soat");
  });
  it("bo‘sh qiymat — 0 daq", () => {
    expect(duration(undefined)).toBe("0 daq");
  });
});

describe("normalizeClock — 24 soatlik vaqt", () => {
  it("raqamlardan SS:DD", () => {
    expect(normalizeClock("9")).toBe("09:00");
    expect(normalizeClock("930")).toBe("09:30");
    expect(normalizeClock("1400")).toBe("14:00");
    expect(normalizeClock("0000")).toBe("00:00");
    expect(normalizeClock("14:5")).toBe("14:05");
  });
  it("noto‘g‘ri vaqt — null", () => {
    expect(normalizeClock("2400")).toBeNull();
    expect(normalizeClock("12:60")).toBeNull();
    expect(normalizeClock("")).toBeNull();
  });
});

describe("badgeToken — QR matnidan token", () => {
  it("eski va yangi (havola) ko‘rinish", () => {
    expect(badgeToken("staffora-badge:abc.def.ghi")).toBe("abc.def.ghi");
    expect(badgeToken("https://app.staffora.uz/id/abc.def.ghi")).toBe("abc.def.ghi");
    expect(badgeToken("http://localhost:3000/id/abc.def.ghi?x=1")).toBe("abc.def.ghi");
  });
});
