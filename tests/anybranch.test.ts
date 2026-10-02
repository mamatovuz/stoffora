import { describe, expect, it } from "vitest";
import { allowedBranches, branchAt } from "../lib/branches";
import type { Branch, Position } from "../lib/types";

const branch = (id: string, lat: number, lng: number, extra: Partial<Branch> = {}): Branch => ({
  id,
  companyId: "c1",
  name: id,
  address: "",
  latitude: lat,
  longitude: lng,
  radiusMeters: 100,
  manager: "",
  status: "ACTIVE",
  scheduleId: "s1",
  ...extra,
});
// Bosh ofis (Toshkent) va Qo‘rg‘ontepa filiali; boshqa kompaniya filiali ham bor.
const head = branch("head", 41.3111, 69.2797);
const kurgan = branch("kurgan", 40.7333, 72.7631);
const closed = branch("closed", 41.0, 70.0, { status: "INACTIVE" });
const foreign = branch("foreign", 41.3112, 69.2798, { companyId: "c2" });
const pos = (extra: Partial<Position>): Position => ({ id: "p1", companyId: "c1", name: "HR", departmentId: "d1", ...extra });
const db = (position: Position) => ({ branches: [head, kurgan, closed, foreign], positions: [position] });
const hr = { companyId: "c1", branchId: "head", positionId: "p1" };

describe("lavozim: istalgan filialdan keldi-ketdi", () => {
  it("odatiy lavozim — faqat o‘z filiali", () => {
    expect(allowedBranches(db(pos({})), hr).map((b) => b.id)).toEqual(["head"]);
  });
  it("«istalgan filial» — barcha faol filiallar (boshqa kompaniya va yopilgan filial yo‘q)", () => {
    expect(allowedBranches(db(pos({ anyBranch: true })), hr).map((b) => b.id)).toEqual(["head", "kurgan"]);
  });
  it("tanlangan filiallar bilan cheklash — o‘z filiali baribir qoladi", () => {
    const list = allowedBranches(db(pos({ anyBranch: true, branchIds: ["kurgan", "foreign"] })), hr).map((b) => b.id);
    expect(list).toEqual(["head", "kurgan"]);
  });
  it("joylashuv bo‘yicha filial: Qo‘rg‘ontepada — Qo‘rg‘ontepa, hech qayerda emas — inside null", () => {
    const list = allowedBranches(db(pos({ anyBranch: true })), hr);
    expect(branchAt(list, 40.73335, 72.76312).inside?.branch.id).toBe("kurgan");
    expect(branchAt(list, 41.31112, 69.27972).inside?.branch.id).toBe("head");
    const nowhere = branchAt(list, 40.0, 71.0);
    expect(nowhere.inside).toBeNull();
    expect(nowhere.nearest).not.toBeNull();
  });
  it("odatiy xodim boshqa filial hududida bo‘lsa ham qabul qilinmaydi", () => {
    const list = allowedBranches(db(pos({})), hr);
    expect(branchAt(list, 40.73335, 72.76312).inside).toBeNull();
  });
});
