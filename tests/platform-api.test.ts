import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "../lib/types";

/*
 * Super Admin Control Center — server xavfsizligi (haqiqiy marshrutlar, vaqtinchalik SQLite):
 * RBAC (403), ko‘rish rejimi (faqat o‘qish serverda bloklanadi), API kalit doirasi va kompaniyalar ajratilishi,
 * murojaatlar izolyatsiyasi, «To‘langan» dalilsiz emas, promo ikki marta ishlatilmaydi, audit yoziladi (maxfiy qiymatsiz).
 */

let dir: string;
let base: string;
let close: () => void;
let store: typeof import("../lib/store");
let auth: typeof import("../server/auth");

type Session = { userId: string; companyId?: string; name: string; email: string; role: string };
const SESSIONS: Record<string, Session> = {
  owner: { userId: "sa", name: "Platform Owner", email: "sa@staffora.test", role: "SUPER_ADMIN" },
  analyst: { userId: "an", name: "Analyst", email: "an@staffora.test", role: "SUPER_ADMIN" },
  blocked: { userId: "bl", name: "Blocked", email: "bl@staffora.test", role: "SUPER_ADMIN" },
  c1: { userId: "o1", companyId: "c1", name: "Owner One", email: "o1@c1.test", role: "COMPANY_OWNER" },
  c2: { userId: "o2", companyId: "c2", name: "Owner Two", email: "o2@c2.test", role: "COMPANY_OWNER" },
};

async function call(method: string, url: string, opts: { as?: keyof typeof SESSIONS; body?: unknown; bearer?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.as) headers["x-test-user"] = opts.as;
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(base + url, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}
const get = (url: string, opts?: Parameters<typeof call>[2]) => call("GET", url, opts);
const post = (url: string, body: unknown, opts?: Parameters<typeof call>[2]) => call("POST", url, { ...opts, body });

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "staffora-platform-"));
  process.env.SQLITE_PATH = path.join(dir, "test.sqlite");
  vi.resetModules();
  store = await import("../lib/store");
  auth = await import("../server/auth");
  const platform = await import("../server/platform");
  const comms = await import("../server/platform/routes-comms");
  const integrations = await import("../server/platform/integrations-api");
  const now = new Date().toISOString();
  await store.updateDb((db: Database) => {
    const company = (id: string, name: string) => ({ id, name, slug: id, status: "ACTIVE", plan: "Pro", timezone: "Asia/Tashkent", createdAt: now }) as unknown as Database["companies"][number];
    db.companies.push(company("c1", "Alfa"), company("c2", "Beta"));
    const user = (id: string, role: string, extra: object = {}) => ({ id, name: id.toUpperCase(), email: `${id}@t.test`, role, passwordHash: "x", createdAt: now, ...extra }) as unknown as Database["users"][number];
    db.users.push(
      user("sa", "SUPER_ADMIN"),
      user("an", "SUPER_ADMIN", { platformRole: "ANALYST" }),
      user("bl", "SUPER_ADMIN", { platformRole: "ADMIN", blockedAt: now }),
      user("o1", "COMPANY_OWNER", { companyId: "c1" }),
      user("o2", "COMPANY_OWNER", { companyId: "c2" }),
    );
    const emp = (id: string, companyId: string) => ({ id, companyId, firstName: id, lastName: "Test", status: "ACTIVE", employeeNo: id, phone: "+998900000000", startDate: "2026-01-01" }) as unknown as Database["employees"][number];
    db.employees.push(emp("e1", "c1"), emp("e2", "c1"), emp("x1", "c2"));
  });

  const app = express();
  app.use(express.json({ limit: "3mb" }));
  app.use("/api", integrations.createPublicApiRouter());
  // Test sessiyasi (x-test-user) yoki haqiqiy requireAuth (ko‘rish tokeni Bearer orqali).
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    const who = req.headers["x-test-user"];
    if (typeof who === "string" && SESSIONS[who]) {
      (req as any).session = { ...SESSIONS[who] };
      return next();
    }
    return auth.requireAuth(req as any, res, next);
  });
  app.use("/api", auth.previewGuard());
  app.get("/api/whoami", (req: Request, res: Response) => res.json((req as any).session));
  app.use("/api", comms.createCompanySupportRouter());
  app.use("/api", platform.createPlatformRouter([]));
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = error?.status || (error?.name === "ZodError" ? 400 : 500);
    res.status(status).json({ code: error?.code, message: error?.message });
  });
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

describe("RBAC — server tomonda", () => {
  it("kompaniya rahbari super admin API’siga kira olmaydi", async () => {
    const res = await get("/api/super-admin/companies", { as: "c1" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PLATFORM_ONLY");
  });
  it("bloklangan administrator rad etiladi", async () => {
    expect((await get("/api/super-admin/me", { as: "blocked" })).status).toBe(403);
  });
  it("Analyst o‘qiydi, lekin o‘zgartira olmaydi", async () => {
    const me = await get("/api/super-admin/me", { as: "analyst" });
    expect(me.status).toBe(200);
    expect(me.body.permissions).toContain("analytics.read");
    expect(me.body.permissions).not.toContain("plans.manage");
    const denied = await post("/api/super-admin/billing", { companyId: "c1", periodStart: "2026-10-01", periodEnd: "2026-10-31", amount: 1 }, { as: "analyst" });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("PLATFORM_FORBIDDEN");
    expect((await get("/api/super-admin/audit-logs", { as: "analyst" })).status).toBe(403);
  });
  it("rolsiz eski super admin — Owner (orqaga moslik)", async () => {
    const me = await get("/api/super-admin/me", { as: "owner" });
    expect(me.body.user.role).toBe("OWNER");
  });
});

describe("ko‘rish rejimi (preview)", () => {
  const future = () => new Date(Date.now() + 30 * 60_000).toISOString();
  it("faqat o‘qish: GET ishlaydi, har qanday yozish 403", async () => {
    await store.updateDb((db: Database) => {
      db.previewSessions.push({ id: "pv1", companyId: "c1", adminId: "sa", adminName: "SA", mode: "READ_ONLY", status: "ACTIVE", createdAt: new Date().toISOString(), expiresAt: future() } as unknown as Database["previewSessions"][number]);
    });
    const token = auth.signPreviewToken({ previewId: "pv1", adminId: "sa", companyId: "c1", mode: "READ_ONLY", ttlSeconds: 600 });
    const me = await get("/api/whoami", { bearer: token });
    expect(me.status).toBe(200);
    expect(me.body.companyId).toBe("c1");
    expect(me.body.role).toBe("COMPANY_OWNER");
    expect(me.body.preview.mode).toBe("READ_ONLY");
    const write = await post("/api/support/tickets", { subject: "Test", text: "Salom dunyo" }, { bearer: token });
    expect(write.status).toBe(403);
    expect(write.body.code).toBe("READ_ONLY_PREVIEW");
    // Ko‘rish sessiyasi super admin API’siga kirish huquqini bermaydi.
    expect((await get("/api/super-admin/companies", { bearer: token })).status).toBe(403);
  });
  it("tugatilgan yoki boshqa kompaniyaga soxtalashtirilgan token ishlamaydi", async () => {
    const forged = auth.signPreviewToken({ previewId: "pv1", adminId: "sa", companyId: "c2", mode: "READ_ONLY", ttlSeconds: 600 });
    expect((await get("/api/whoami", { bearer: forged })).body.code).toBe("PREVIEW_ENDED");
    const upgraded = auth.signPreviewToken({ previewId: "pv1", adminId: "sa", companyId: "c1", mode: "SUPPORT", ttlSeconds: 600 });
    expect((await get("/api/whoami", { bearer: upgraded })).status).toBe(401);
    await store.updateDb((db: Database) => {
      const row = db.previewSessions.find((p) => p.id === "pv1")!;
      row.status = "ENDED";
    });
    const token = auth.signPreviewToken({ previewId: "pv1", adminId: "sa", companyId: "c1", mode: "READ_ONLY", ttlSeconds: 600 });
    const res = await get("/api/whoami", { bearer: token });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("PREVIEW_ENDED");
  });
});

describe("API kalitlar", () => {
  let raw = "";
  it("kalit bir marta ko‘rsatiladi, bazada faqat xesh", async () => {
    const res = await post("/api/super-admin/companies/c1/api-keys", { name: "ERP", scopes: ["employees.read"] }, { as: "owner" });
    expect(res.status).toBe(201);
    raw = res.body.key;
    expect(raw).toMatch(/^stf_/);
    const db = await store.readDb();
    expect(JSON.stringify(db.apiKeys)).not.toContain(raw);
    const list = await get("/api/super-admin/api-keys", { as: "owner" });
    expect(JSON.stringify(list.body)).not.toContain(raw);
  });
  it("faqat o‘z kompaniyasi va faqat berilgan doira", async () => {
    const res = await fetch(`${base}/api/v1/employees`, { headers: { authorization: `Bearer ${raw}` } });
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.data.map((e: any) => e.id).sort()).toEqual(["e1", "e2"]);
    const branches = await fetch(`${base}/api/v1/branches`, { headers: { authorization: `Bearer ${raw}` } });
    expect(branches.status).toBe(403);
    const bad = await fetch(`${base}/api/v1/employees`, { headers: { authorization: `Bearer ${raw.slice(0, -3)}abc` } });
    expect(bad.status).toBe(401);
  });
});

describe("murojaatlar (support) izolyatsiyasi", () => {
  let ticketId = "";
  it("kompaniya faqat o‘z murojaatini ko‘radi", async () => {
    const created = await post("/api/support/tickets", { subject: "Davomat", text: "Bot javob bermayapti" }, { as: "c1" });
    expect(created.status).toBe(201);
    ticketId = created.body.id;
    expect((await get(`/api/support/tickets/${ticketId}`, { as: "c2" })).status).toBe(404);
    expect((await get("/api/support/tickets", { as: "c2" })).body).toEqual([]);
    expect((await post(`/api/support/tickets/${ticketId}/messages`, { text: "begona" }, { as: "c2" })).status).toBe(404);
  });
  it("ichki izoh kompaniyaga ko‘rinmaydi", async () => {
    await post(`/api/super-admin/support/tickets/${ticketId}/messages`, { text: "Ichki: bot tokeni eskirgan", internal: true }, { as: "owner" });
    await post(`/api/super-admin/support/tickets/${ticketId}/messages`, { text: "Tekshiryapmiz" }, { as: "owner" });
    const view = await get(`/api/support/tickets/${ticketId}`, { as: "c1" });
    const texts = view.body.messages.map((m: any) => m.text);
    expect(texts).toContain("Tekshiryapmiz");
    expect(texts.join(" ")).not.toContain("Ichki:");
  });
});

describe("hisob-kitob va promo", () => {
  let billId = "";
  it("«To‘langan» faqat to‘lov dalili bilan", async () => {
    const bill = await post("/api/super-admin/billing", { companyId: "c1", periodStart: "2026-10-01", periodEnd: "2026-10-31", amount: 1_000_000 }, { as: "owner" });
    expect(bill.status).toBe(201);
    billId = bill.body.id;
    const noProof = await post(`/api/super-admin/billing/${billId}/status`, { status: "PAID" }, { as: "owner" });
    expect(noProof.status).toBe(400);
    expect(noProof.body.code).toBe("PAYMENT_PROOF_REQUIRED");
    expect((await store.readDb()).billingRecords.find((r) => r.id === billId)?.status).toBe("DRAFT");
  });
  it("promo kod bir kompaniyada ikki marta ishlatilmaydi", async () => {
    const promo = await post("/api/super-admin/promos", { code: "start10", kind: "PERCENT", value: 10 }, { as: "owner" });
    expect(promo.status).toBe(201);
    expect(promo.body.code).toBe("START10");
    const first = await post(`/api/super-admin/promos/${promo.body.id}/redeem`, { companyId: "c1", billingRecordId: billId }, { as: "owner" });
    expect(first.status).toBe(200);
    const bill2 = await post("/api/super-admin/billing", { companyId: "c1", periodStart: "2026-11-01", periodEnd: "2026-11-30", amount: 1_000_000 }, { as: "owner" });
    const second = await post(`/api/super-admin/promos/${promo.body.id}/redeem`, { companyId: "c1", billingRecordId: bill2.body.id }, { as: "owner" });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("PROMO_INVALID");
    const db = await store.readDb();
    expect(db.promoRedemptions.filter((r) => r.promoId === promo.body.id)).toHaveLength(1);
    expect(db.billingRecords.find((r) => r.id === billId)?.discount).toBe(100_000);
  });
  it("qoralama to‘g‘ridan-to‘g‘ri «To‘langan» bo‘lmaydi; chiqarilgandan keyin — dalil bilan", async () => {
    expect((await post(`/api/super-admin/billing/${billId}/status`, { status: "PAID", paymentReference: "TX-2026-001" }, { as: "owner" })).status).toBe(409);
    expect((await post(`/api/super-admin/billing/${billId}/status`, { status: "ISSUED" }, { as: "owner" })).status).toBe(200);
    const paid = await post(`/api/super-admin/billing/${billId}/status`, { status: "PAID", paymentReference: "TX-2026-001" }, { as: "owner" });
    expect(paid.status).toBe(200);
    expect(paid.body.status).toBe("PAID");
  });
});

describe("audit", () => {
  it("amallar yoziladi, API kalit qiymati yozilmaydi", async () => {
    const res = await get("/api/super-admin/audit-logs?pageSize=100", { as: "owner" });
    expect(res.status).toBe(200);
    const actions = res.body.rows.map((r: any) => r.action);
    for (const a of ["apikey.create", "billing.create", "promo.redeem"]) expect(actions).toContain(a);
    expect(JSON.stringify(res.body)).not.toMatch(/stf_[0-9a-f]{12}_[A-Za-z0-9_-]{20,}/);
    const keyRow = res.body.rows.find((r: any) => r.action === "apikey.create");
    expect(keyRow.actorName).toBe("SA");
    expect(keyRow.privileged).toBe(true);
  });
});
