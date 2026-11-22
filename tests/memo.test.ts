import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/* Rahbar paneli keshi: bir xil so‘rov qayta hisoblanmaydi, ma’lumot o‘zgarsa — darhol yangisi. */
const dir = mkdtempSync(path.join(tmpdir(), "staffora-memo-"));
process.env.SQLITE_PATH = path.join(dir, "test.sqlite");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("memo", () => {
  it("yozuvdan keyin qayta hisoblaydi, kalit bo‘yicha ajratadi", async () => {
    const store = await import("../lib/store");
    const { memo } = await import("../server/memo");
    await store.readDb();
    let runs = 0;
    const compute = () => ++runs;
    expect(memo("t", ["c1"], compute)).toBe(1);
    expect(memo("t", ["c1"], compute)).toBe(1);
    expect(memo("t", ["c2"], compute)).toBe(2);
    await store.updateDb((db) => {
      db.departments.push({ id: "d1", companyId: "c1", name: "X" });
    });
    expect(memo("t", ["c1"], compute)).toBe(3);
  });
});
