import { describe, expect, it } from "vitest";
import { assertFaceDescriptor, faceDistance } from "../lib/face";

describe("face descriptor", () => {
  it("bir xil descriptor uchun masofa nol", () => {
    const descriptor = Array.from({ length: 128 }, (_, index) => index / 1000);
    expect(faceDistance(descriptor, descriptor)).toBe(0);
  });

  it("farqli descriptorlarni ajratadi", () => {
    const reference = Array(128).fill(0);
    const candidate = Array(128).fill(0.1);
    expect(faceDistance(reference, candidate)).toBeGreaterThan(1);
  });

  it("noto‘g‘ri uzunlikni rad etadi", () => {
    expect(() => assertFaceDescriptor([0.1, 0.2])).toThrow(
      "Yuz biometrik vektori yaroqsiz",
    );
  });
});
