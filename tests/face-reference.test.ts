import { describe, expect, it, vi } from "vitest";
import { emptyDatabase } from "../lib/seed";
import type { Employee } from "../lib/types";

const vec = (seed: number) => Array.from({ length: 128 }, (_, i) => Math.sin(seed * 31 + i) * 0.1);
let next: { descriptor: number[]; yaw: number } | null = null;
vi.mock("../server/face-server", () => ({ describeFace: async () => next }));
const { applyPanelReference, referenceFromPhoto } = await import("../server/face-reference");

const employee = (id: string) => ({ id, companyId: "c1", firstName: id, lastName: "T", status: "ACTIVE" }) as unknown as Employee;

describe("saytdagi rasm — Face ID namunasi", () => {
  it("JPEG bo‘lmasa yoki yuz topilmasa — rad", async () => {
    await expect(referenceFromPhoto("data:image/png;base64,AAAA")).rejects.toThrow(/JPEG/);
    next = null;
    await expect(referenceFromPhoto("data:image/jpeg;base64,AAAA")).rejects.toThrow(/yuz aniq topilmadi/);
    next = { descriptor: vec(1), yaw: 0.6 };
    await expect(referenceFromPhoto("data:image/jpeg;base64,AAAA")).rejects.toThrow(/burilgan/);
    next = { descriptor: vec(1), yaw: 0.02 };
    expect(await referenceFromPhoto("data:image/jpeg;base64,AAAA")).toHaveLength(128);
  });

  it("profil shu rasm bilan almashadi, rasm manbai PANEL; boshqa xodimning yuzi — rad", () => {
    const db = emptyDatabase();
    const a = employee("a");
    const b = employee("b");
    db.employees.push(a, b);
    db.faceProfiles.push({ companyId: "c1", employeeId: "a", descriptor: vec(9), enrolledAt: "", updatedAt: "" });
    applyPanelReference(db, a, "data:image/jpeg;base64,AAAA", vec(1), "HR");
    expect(db.faceProfiles.filter((p) => p.employeeId === "a")).toHaveLength(1);
    expect(db.faceProfiles[0]).toMatchObject({ source: "PANEL", descriptor: vec(1) });
    expect(a).toMatchObject({ photoSource: "PANEL", photoDataUrl: "data:image/jpeg;base64,AAAA" });
    expect(a.faceEnrolledAt).toBeTruthy();
    expect(() => applyPanelReference(db, b, "data:image/jpeg;base64,BBBB", vec(1), "HR")).toThrow(/boshqa xodimga/);
  });
});
