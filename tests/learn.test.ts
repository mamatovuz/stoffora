import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "../lib/types";

/* Bilimlar bazasi (auditoriya), kurs testi (ball serverda, javoblar sizmaydi), QR badge. */

let dir: string;
let base: string;
let close: () => void;
let store: typeof import("../lib/store");
let panel = { role: "HR_ADMIN", userId: "hr", companyId: "c1" };
let worker = "a";

async function call(method: string, url: string, body?: unknown) {
  const res = await fetch(base + url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "staffora-learn-"));
  process.env.SQLITE_PATH = path.join(dir, "test.sqlite");
  vi.resetModules();
  store = await import("../lib/store");
  const learn = await import("../server/learn");
  await store.updateDb((db: Database) => {
    db.companies.push({ id: "c1", name: "Test", status: "ACTIVE" } as Database["companies"][number], { id: "c2", name: "Boshqa", status: "ACTIVE" } as Database["companies"][number]);
    const branch = (id: string) => ({ id, companyId: "c1", name: id.toUpperCase(), status: "ACTIVE" }) as Database["branches"][number];
    db.branches.push(branch("b1"), branch("b2"));
    const emp = (id: string, branchId: string) => ({ id, companyId: "c1", firstName: id.toUpperCase(), lastName: "T", status: "ACTIVE", branchId, employeeNo: id }) as unknown as Database["employees"][number];
    db.employees.push(emp("a", "b1"), emp("b", "b2"));
  });
  const app = express();
  app.use(express.json());
  app.use("/api", (req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: panel.userId, companyId: panel.companyId, name: "HR", email: "x@t", role: panel.role };
    (req as any).employeeSession = { employeeId: worker, companyId: "c1" };
    next();
  });
  app.use("/api", learn.createLearnRouter());
  app.use("/api", learn.createMiniLearnRouter());
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => res.status(error.status || (error.name === "ZodError" ? 400 : 500)).json({ message: error.message }));
  const server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
afterAll(() => {
  close?.();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("bilimlar bazasi", () => {
  it("auditoriya: b1 filiali maqolasini b2 xodimi ko‘rmaydi; qidiruv; ko‘rishlar soni", async () => {
    await call("POST", "/api/kb", { title: "Kassa yo‘riqnomasi", body: "Kassani 9:00 da oching.", category: "Kassa", target: { type: "BRANCHES", ids: ["b1"] } });
    await call("POST", "/api/kb", { title: "Ta’til tartibi", body: "21 kun ta’til.", category: "HR" });
    worker = "b";
    expect((await call("GET", "/api/mini/kb")).body.map((a: any) => a.title)).toEqual(["Ta’til tartibi"]);
    worker = "a";
    const found = (await call("GET", "/api/mini/kb?q=kassa")).body;
    expect(found).toHaveLength(1);
    await call("GET", `/api/mini/kb/${found[0].id}`);
    expect((await call("GET", "/api/kb")).body.find((a: any) => a.id === found[0].id).views).toBe(1);
    panel = { role: "FINANCE", userId: "f", companyId: "c1" };
    expect((await call("POST", "/api/kb", { title: "x x x", body: "yyyyy" })).status).toBe(403);
    panel = { role: "HR_ADMIN", userId: "hr", companyId: "c1" };
  });
});

describe("kurs va test", () => {
  let id = "";
  it("kurs yaratiladi, xodimga to‘g‘ri javoblar yuborilmaydi", async () => {
    const r = await call("POST", "/api/courses", {
      title: "Xavfsizlik",
      lessons: [{ title: "Kirish", body: "Qoidalar…" }],
      questions: [
        { q: "Yong‘inda nima qilasiz?", options: ["Qochaman", "112 ga qo‘ng‘iroq"], correct: 1 },
        { q: "Favqulodda chiqish qayerda?", options: ["Old", "Orqa", "Yo‘q"], correct: 1 },
      ],
      passPercent: 100,
    });
    expect(r.status).toBe(201);
    id = r.body.id;
    const c = (await call("GET", `/api/mini/courses/${id}`)).body;
    expect(c.questions[0]).not.toHaveProperty("correct");
    expect(c.status).toBe("NEW");
    expect((await call("POST", "/api/courses", { title: "Xato", questions: [{ q: "Savol?", options: ["a", "b"], correct: 5 }] })).status).toBe(422);
  });
  it("ball serverda; yiqilsa xato savollar raqami; o‘tsa — PASSED; natijalarda ko‘rinadi", async () => {
    const fail = (await call("POST", `/api/mini/courses/${id}/attempt`, { answers: [1, 0] })).body;
    expect(fail).toMatchObject({ score: 50, passed: false, wrong: [2] });
    const ok = (await call("POST", `/api/mini/courses/${id}/attempt`, { answers: [1, 1] })).body;
    expect(ok).toMatchObject({ score: 100, passed: true });
    expect((await call("GET", "/api/mini/courses")).body[0].status).toBe("PASSED");
    const results = (await call("GET", `/api/courses/${id}/results`)).body;
    expect(results.find((r: any) => r.employeeId === "a")).toMatchObject({ status: "PASSED", best: 100, attempts: 2 });
    expect(results.find((r: any) => r.employeeId === "b").status).toBe("NEW");
    expect((await call("POST", `/api/mini/courses/${id}/attempt`, { answers: [1] })).status).toBe(422);
  });
});

describe("QR badge", () => {
  it("xodim QR oladi → rahbar tekshiradi; boshqa kompaniya — rad; soxta — rad", async () => {
    const badge = (await call("GET", "/api/mini/badge")).body;
    expect(badge.qr).toMatch(/^data:image\/png;base64,/);
    const token = `staffora-badge:${badge.token}`;
    const ok = await call("GET", `/api/badge/verify?token=${encodeURIComponent(token)}`);
    expect(ok.body).toMatchObject({ valid: true, employee: { name: "A T", branch: "B1" } });
    panel = { role: "HR_ADMIN", userId: "x", companyId: "c2" };
    expect((await call("GET", `/api/badge/verify?token=${encodeURIComponent(token)}`)).status).toBe(403);
    panel = { role: "HR_ADMIN", userId: "hr", companyId: "c1" };
    expect((await call("GET", "/api/badge/verify?token=abc.def.ghi")).status).toBe(422);
    await store.updateDb((db) => void (db.employees.find((e) => e.id === "a")!.status = "DISMISSED" as never));
    expect((await call("GET", `/api/badge/verify?token=${encodeURIComponent(token)}`)).body.valid).toBe(false);
  });
});
