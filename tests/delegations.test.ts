import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "../lib/types";

/* Vakolat: faqat tasdiqlash yo‘llarida beruvchi roli; muddat, bekor qilish, audit. */

let dir: string;
let base: string;
let close: () => void;
let store: typeof import("../lib/store");
let panel = { userId: "owner", role: "COMPANY_OWNER", name: "Direktor" };
const today = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

async function call(method: string, url: string, body?: unknown) {
  const res = await fetch(base + url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "staffora-deleg-"));
  process.env.SQLITE_PATH = path.join(dir, "test.sqlite");
  vi.resetModules();
  store = await import("../lib/store");
  const delegations = await import("../server/delegations");
  const wf = await import("../server/payroll-workflow");
  await store.updateDb((db: Database) => {
    db.companies.push({ id: "c1", name: "Test", status: "ACTIVE" } as Database["companies"][number]);
    db.users.push(
      { id: "owner", companyId: "c1", name: "Direktor", role: "COMPANY_OWNER" } as unknown as Database["users"][number],
      { id: "hr", companyId: "c1", name: "HR Ali", role: "HR_ADMIN" } as unknown as Database["users"][number],
    );
    db.payrollWorkflows.push({ id: "w1", companyId: "c1", month: "2026-09", stage: "FINANCE_CHECKED", history: [] });
  });
  const app = express();
  app.use(express.json());
  app.use("/api", (req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: panel.userId, companyId: "c1", name: panel.name, email: "x@t", role: panel.role };
    next();
  });
  app.use("/api", delegations.delegationMiddleware());
  app.use("/api", delegations.createDelegationRouter());
  app.use("/api", wf.createPayrollWorkflowRouter());
  app.get("/api/settings-probe", (req, res) => res.json({ role: (req as any).session.role }));
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

describe("vakolat", () => {
  it("vakolatsiz HR direktor tasdig‘ini bera olmaydi", async () => {
    panel = { userId: "hr", role: "HR_ADMIN", name: "HR Ali" };
    expect((await call("POST", "/api/payroll/2026-09/workflow", { action: "approve" })).status).toBe(403);
  });
  it("direktor vakolat beradi → HR tasdiqlaydi (auditda «vakolat»), boshqa yo‘llarda roli o‘zgarmaydi", async () => {
    panel = { userId: "owner", role: "COMPANY_OWNER", name: "Direktor" };
    expect((await call("POST", "/api/delegations", { toUserId: "hr", startDate: today(), endDate: today(), reason: "ta’til" })).status).toBe(201);
    panel = { userId: "hr", role: "HR_ADMIN", name: "HR Ali" };
    const r = await call("POST", "/api/payroll/2026-09/workflow", { action: "approve" });
    expect(r.body.stage).toBe("APPROVED");
    expect(r.body.history.at(-1).by).toBe("HR Ali (vakolat: Direktor)");
    expect((await call("GET", "/api/settings-probe")).body.role).toBe("HR_ADMIN");
  });
  it("bekor qilingach vakolat ishlamaydi", async () => {
    panel = { userId: "owner", role: "COMPANY_OWNER", name: "Direktor" };
    const list = (await call("GET", "/api/delegations")).body;
    await call("POST", `/api/delegations/${list.mine[0].id}/revoke`, {});
    await store.updateDb((db) => void db.payrollWorkflows.push({ id: "w2", companyId: "c1", month: "2026-08", stage: "FINANCE_CHECKED", history: [] }));
    panel = { userId: "hr", role: "HR_ADMIN", name: "HR Ali" };
    expect((await call("POST", "/api/payroll/2026-08/workflow", { action: "approve" })).status).toBe(403);
  });
});
