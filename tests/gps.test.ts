import { describe, expect, it } from "vitest";
import { gpsFlags } from "../lib/gps";

const base = { latitude: 41.311, longitude: 69.279, accuracy: 18, positionAge: 2000, distance: 40, radius: 150, at: Date.UTC(2026, 8, 30, 4, 0) };

describe("soxta GPS belgilari", () => {
  it("oddiy holatda belgi yo‘q", () => {
    expect(gpsFlags(base, [{ latitude: 41.3111234, longitude: 69.2791234, at: base.at - 86_400_000 }])).toEqual([]);
  });
  it("g‘ayritabiiy aniqlik (0–2 m) va eski joylashuv", () => {
    expect(gpsFlags({ ...base, accuracy: 0 }, [])).toContain("GPS_ACCURACY");
    expect(gpsFlags({ ...base, positionAge: 10 * 60_000 }, [])).toContain("GPS_STALE");
  });
  it("aynan bir xil koordinata va imkonsiz sakrash", () => {
    expect(gpsFlags(base, [{ latitude: 41.311, longitude: 69.279, at: base.at - 3 * 86_400_000 }])).toContain("GPS_EXACT_REPEAT");
    // 1 soat oldin Samarqandda (≈270 km) bo‘lgan
    expect(gpsFlags(base, [{ latitude: 39.654, longitude: 66.975, at: base.at - 3_600_000 }])).toContain("GPS_TELEPORT");
  });
  it("faqat aniqlik hisobiga hudud ichida", () => {
    expect(gpsFlags({ ...base, distance: 170 }, [])).toContain("GPS_EDGE");
  });
});
