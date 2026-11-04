import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import cookieParser from "cookie-parser";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "../lib/types";

let dir = "",
  base = "",
  corporateCookie = "";
let close: () => void;
let store: typeof import("../lib/store");
const sessions = {
  c1: {
    userId: "u1",
    companyId: "c1",
    name: "Owner One",
    email: "one@test.local",
    role: "COMPANY_OWNER",
  },
  sa: {
    userId: "sa",
    name: "Super",
    email: "sa@test.local",
    role: "SUPER_ADMIN",
  },
} as const;
async function call(
  method: string,
  url: string,
  body?: unknown,
  as: keyof typeof sessions = "c1",
  cookie = "",
) {
  const res = await fetch(base + url, {
    method,
    headers: {
      "x-test-user": as,
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: res.status,
    body: (await res.json().catch(() => ({}))) as any,
    cookie: res.headers.get("set-cookie")?.split(";")[0] || "",
  };
}
const get = (url: string, as: keyof typeof sessions = "c1", cookie = "") =>
  call("GET", url, undefined, as, cookie);
const post = (
  url: string,
  body: unknown,
  as: keyof typeof sessions = "c1",
  cookie = "",
) => call("POST", url, body, as, cookie);
const put = (url: string, body: unknown) => call("PUT", url, body);

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "staffora-corp-ai-"));
  process.env.SQLITE_PATH = path.join(dir, "test.sqlite");
  process.env.INTEGRATION_SECRET = "qa-secret-32-characters-minimum-value";
  process.env.CORPORATE_SESSION_SECRET =
    "qa-corporate-session-secret-32-characters";
  vi.resetModules();
  store = await import("../lib/store");
  const { createCorporateRouter } = await import("../server/corporate/routes");
  const {
    createCorporateAdminRouter,
    createCorporatePublicRouter,
    requireCorporateAuth,
  } = await import("../server/corporate/auth");
  const { createAiRouter } = await import("../server/ai/routes");
  const now = new Date().toISOString();
  await store.updateDb((db: Database) => {
    db.companies.push({
      id: "c1",
      name: "Alfa",
      slug: "alfa",
      status: "ACTIVE",
      plan: "Pro",
      timezone: "Asia/Tashkent",
      createdAt: now,
    } as Database["companies"][number]);
    db.users.push(
      {
        id: "u1",
        companyId: "c1",
        name: "Owner One",
        email: "one@test.local",
        role: "COMPANY_OWNER",
        passwordHash: "x",
        createdAt: now,
      } as Database["users"][number],
      {
        id: "sa",
        name: "Super",
        email: "sa@test.local",
        role: "SUPER_ADMIN",
        passwordHash: "x",
        createdAt: now,
      } as Database["users"][number],
    );
    db.schedules.push({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "c1",
      name: "Asosiy",
      days: [{ day: 1, start: "09:00", end: "18:00" }],
      graceMinutes: 10,
    } as Database["schedules"][number]);
    db.branches.push({
      id: "b1",
      companyId: "c1",
      name: "Markaz",
      address: "Toshkent",
      latitude: 41.31,
      longitude: 69.28,
      radiusMeters: 150,
      manager: "",
      status: "ACTIVE",
      scheduleId: "11111111-1111-4111-8111-111111111111",
    } as Database["branches"][number]);
    db.employees.push({
      id: "e1",
      companyId: "c1",
      branchId: "b1",
      firstName: "Ali",
      lastName: "Valiyev",
      status: "ACTIVE",
      employeeNo: "001",
      phone: "+998900000001",
      startDate: "2026-01-01",
    } as Database["employees"][number]);
  });
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api", createCorporatePublicRouter());
  app.use(
    "/api",
    (req: Request, res: Response, next: NextFunction) =>
      /^\/corporate(?:\/|$)/.test(req.path)
        ? requireCorporateAuth(req as any, res, next)
        : next(),
    createCorporateRouter(),
  );
  app.use("/api", (req: Request, _res: Response, next: NextFunction) => {
    const key = String(
      req.headers["x-test-user"] || "c1",
    ) as keyof typeof sessions;
    (req as any).session = { ...sessions[key] };
    next();
  });
  app.use("/api", createCorporateAdminRouter());
  app.use("/api", createAiRouter());
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) =>
    res
      .status(error?.status || (error?.name === "ZodError" ? 400 : 500))
      .json({ message: error?.message }),
  );
  const server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
  const created = await post(
    "/api/super-admin/corporate/accounts",
    {
      companyId: "c1",
      firstName: "Ozodbek",
      lastName: "Mamatov",
      login: "founder.ozodbek",
      password: "StrongPass-2026",
      role: "FOUNDER",
      shareBps: 4000,
    },
    "sa",
  );
  expect(created.status).toBe(201);
});
afterAll(() => {
  close?.();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("Corporate portal", () => {
  it("roziliksiz kirishni bloklaydi, rozilikdan keyin alohida sessiya beradi", async () => {
    expect(
      (
        await post("/api/corporate-auth/login", {
          login: "founder.ozodbek",
          password: "StrongPass-2026",
          acceptedTerms: false,
          termsVersion: "2026-11-04",
        })
      ).status,
    ).toBe(400);
    const login = await post("/api/corporate-auth/login", {
      login: "founder.ozodbek",
      password: "StrongPass-2026",
      acceptedTerms: true,
      termsVersion: "2026-11-04",
    });
    corporateCookie = login.cookie;
    expect(login.status).toBe(200);
    expect(corporateCookie).toContain("staffora_corporate=");
    expect(
      (await get("/api/corporate-auth/me", "c1", corporateCookie)).body
        .participant,
    ).toMatchObject({ role: "FOUNDER", shareBps: 4000 });
  });
  it("Super Admin ulushlarini va reserve qoldig‘ini hisoblaydi", async () => {
    expect(
      (
        await post(
          "/api/super-admin/corporate/accounts",
          {
            companyId: "c1",
            firstName: "Ali",
            lastName: "Investor",
            login: "investor.ali",
            password: "InvestorPass-2026",
            role: "INVESTOR",
            shareBps: 3500,
          },
          "sa",
        )
      ).status,
    ).toBe(201);
    const economic = await get(
      "/api/corporate/economic-interests",
      "c1",
      corporateCookie,
    );
    expect(
      economic.body.versions.at(-1).allocations.map((x: any) => x.shareBps),
    ).toEqual([4000, 3500, 2500]);
  });
  it("corporate API sessiyasiz yopiq va ledger doim teng", async () => {
    expect((await get("/api/corporate/transactions")).status).toBe(401);
    const created = await post(
      "/api/corporate/transactions",
      {
        type: "INCOME",
        category: "Savdo",
        amountMinor: 12500000,
        currency: "UZS",
        description: "Test daromad",
        idempotencyKey: "qa-income-0001",
      },
      "c1",
      corporateCookie,
    );
    expect(created.status).toBe(201);
    const detail = await get(
      `/api/corporate/transactions/${created.body.id}`,
      "c1",
      corporateCookie,
    );
    const sum = (side: string) =>
      detail.body.ledger
        .filter((x: any) => x.side === side)
        .reduce((s: number, x: any) => s + x.amountMinor, 0);
    expect(sum("DEBIT")).toBe(sum("CREDIT"));
  });
});

describe("Staffora AI token vault", () => {
  it("providerni avtomatik aniqlaydi, tokenlarni shifrlab zaxirada saqlaydi", async () => {
    const first = await post("/api/ai/settings/tokens", {
      token: "gsk_test_super_secret_key_123456",
      label: "Asosiy",
    });
    const second = await post("/api/ai/settings/tokens", {
      token: "sk-test_backup_openai_key_123456",
      label: "Zaxira",
    });
    expect(first.status).toBe(201);
    expect(second.body.credentials).toHaveLength(2);
    expect(
      (
        await put("/api/ai/settings", {
          enabled: true,
          responseLanguage: "uz",
          voiceEnabled: false,
        })
      ).status,
    ).toBe(200);
    const db = await store.readDb();
    expect(db.aiConfigs[0].credentials?.[0].keyEnc).not.toContain(
      "gsk_test_super_secret_key_123456",
    );
  });
  it("read action providerga chiqmasdan ishlaydi", async () => {
    const chat = await post("/api/ai/chat", {
      message: "Bugungi davomatni ko‘rsat",
    });
    expect(chat.status).toBe(200);
    expect(chat.body.action.name).toBe("get_attendance_summary");
    expect(chat.body.message.text).toContain("Jami xodimlar: 1");
  });
  it("write action tasdiqlanmaguncha bajarilmaydi", async () => {
    const prepared = await post("/api/ai/actions/execute", {
      name: "create_branch",
      payload: {
        name: "Yunusobod",
        address: "Toshkent Yunusobod",
        latitude: 41.36,
        longitude: 69.29,
        radiusMeters: 150,
        scheduleId: "11111111-1111-4111-8111-111111111111",
        manager: "",
      },
      idempotencyKey: "qa-action-0001",
    });
    expect(prepared.status).toBe(202);
    expect(
      (await store.readDb()).branches.some((x) => x.name === "Yunusobod"),
    ).toBe(false);
    expect(
      (
        await post(`/api/ai/actions/${prepared.body.id}/confirm`, {
          confirmationToken: prepared.body.confirmationToken,
        })
      ).status,
    ).toBe(200);
  });
  it("Super Admin javobida maxfiy token yo‘q", async () => {
    const result = await get("/api/super-admin/ai/overview", "sa");
    expect(result.status).toBe(200);
    expect(JSON.stringify(result.body)).not.toContain(
      "gsk_test_super_secret_key_123456",
    );
  });
});
