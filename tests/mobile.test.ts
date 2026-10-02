import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database, Employee } from "../lib/types";

/*
 * Native ilova: faollashtirish, «bitta xodim — bitta qurilma», almashtirish, sessiya rotatsiyasi.
 * Haqiqiy routerlar + vaqtinchalik SQLite; telefon kaliti Node’da (P-256) yaratiladi.
 */

let dir: string;
let base: string;
let close: () => void;
let store: typeof import("../lib/store");
let mobile: typeof import("../server/mobile");
let auth: typeof import("../server/auth");
let panelRole: "HR_MANAGER" | "FINANCE" = "HR_MANAGER";
let panelCompany = "c1";

type Phone = { raw: string; key: KeyObject };
function phone(): Phone {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]).toString("base64");
  return { raw, key: privateKey };
}
const signAs = (p: Phone, message: string) => sign("sha256", Buffer.from(message), { key: p.key, dsaEncoding: "ieee-p1363" }).toString("base64");

async function call(method: string, url: string, body?: unknown, token?: string) {
  const res = await fetch(base + url, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
}

async function activate(p: Phone, code: string, signer: Phone = p) {
  const { body: ch } = await call("POST", "/api/mobile/activation/challenge", { publicKey: p.raw });
  return call("POST", "/api/mobile/activate", {
    code,
    publicKey: p.raw,
    nonce: ch.nonce,
    signature: signAs(signer, `staffora:activate:${ch.nonce}:${code.replace(/-/g, "").toUpperCase()}`),
    platform: "android",
    model: "Test",
  });
}
async function refresh(p: Phone, deviceId: string, sessionId: string, refreshToken: string) {
  const { body: ch } = await call("POST", "/api/mobile/auth/challenge", { deviceId });
  return call("POST", "/api/mobile/auth/refresh", { sessionId, refreshToken, nonce: ch.nonce, signature: signAs(p, `staffora:refresh:${ch.nonce}:${sessionId}`) });
}
async function newCode(employeeId: string) {
  return store.updateDb((db) => mobile.createActivationCode(db, db.employees.find((e) => e.id === employeeId)!, "HR", "Test HR").code);
}

const employee = (id: string, companyId = "c1"): Employee =>
  ({ id, companyId, firstName: id.toUpperCase(), lastName: "Test", status: "ACTIVE", branchId: "b1", telegramId: `dev-${id}` }) as unknown as Employee;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "staffora-mobile-"));
  process.env.SQLITE_PATH = path.join(dir, "test.sqlite");
  process.env.MOBILE_PUSH = "false";
  process.env.MOBILE_ACTIVATION_RATE_LIMIT = "1000";
  vi.resetModules();
  store = await import("../lib/store");
  mobile = await import("../server/mobile");
  auth = await import("../server/auth");
  await store.updateDb((db: Database) => {
    db.companies.push({ id: "c1", name: "Test", status: "ACTIVE" } as Database["companies"][number], { id: "c2", name: "Boshqa", status: "ACTIVE" } as Database["companies"][number]);
    db.employees.push(employee("a"), employee("b"), employee("x2", "c2"));
  });
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api", mobile.createMobilePublicRouter());
  app.use("/api", mobile.createMobileRouter());
  // Mini App (Telegram sessiyasi) — haqiqiy requireEmployee orqali.
  app.use("/api/mini", auth.requireEmployee);
  app.use("/api", mobile.createMiniMobileRouter());
  app.get("/api/mini/ping", (req, res) => res.json({ ok: true, employeeId: (req as any).employeeSession.employeeId }));
  // Panel sessiyasi (test uchun soddalashtirilgan).
  app.use("/api", (req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: "u1", companyId: panelCompany, name: "HR", email: "hr@t", role: panelRole };
    next();
  });
  app.use("/api", mobile.createMobileAdminRouter());
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => res.status(error.status || (error.name === "ZodError" ? 400 : 500)).json({ code: error.code, message: error.message }));
  const server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
afterAll(() => {
  close?.();
  // Windows’da SQLite fayli ochiq qolishi mumkin — vaqtinchalik papka keyin tozalanadi.
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("mobil ilova: faollashtirish va ishonchli qurilma", () => {
  const phoneX = phone();
  const phoneY = phone();
  let session: Record<string, any>;

  it("Telegram Mini App avvalgidek ishlaydi va kod oladi", async () => {
    const token = auth.signEmployeeSession({ employeeId: "a", companyId: "c1", telegramId: "dev-a", kind: "employee" });
    expect((await call("GET", "/api/mini/ping", undefined, token)).body.employeeId).toBe("a");
    const res = await call("POST", "/api/mini/mobile/activation-code", {}, token);
    expect(res.status).toBe(200);
    expect(res.body.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(res.body.link).toContain("staffora://activate?code=");
    const db = await store.readDb();
    const row = db.mobileActivationCodes.find((c) => c.employeeId === "a" && !c.revokedAt)!;
    // Kod bazada faqat xesh ko‘rinishida.
    expect(row.codeHash).not.toContain(res.body.code.replace("-", ""));
    expect(JSON.stringify(db.mobileActivationCodes)).not.toContain(res.body.code);
  });

  it("noto‘g‘ri, muddati o‘tgan va imzosiz kod rad etiladi", async () => {
    expect((await activate(phoneX, "ABCD-EFGH")).body.code).toBe("CODE_INVALID");
    const code = await newCode("a");
    await store.updateDb((db) => {
      for (const c of db.mobileActivationCodes) if (c.employeeId === "a" && !c.revokedAt) c.expiresAt = "2000-01-01T00:00:00.000Z";
    });
    expect((await activate(phoneX, code)).body.code).toBe("CODE_EXPIRED");
    const fresh = await newCode("a");
    // Boshqa kalit bilan imzolangan — rad (kalit egaligi isbotlanmagan).
    expect((await activate(phoneX, fresh, phoneY)).body.code).toBe("SIGNATURE");
  });

  it("A xodim X telefonni bog‘laydi; kod qayta ishlamaydi", async () => {
    const code = await newCode("a");
    const res = await activate(phoneX, code);
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTruthy();
    session = res.body;
    expect((await activate(phoneX, code)).body.code).toBe("CODE_USED");
    const me = await call("GET", "/api/mobile/me", undefined, session.accessToken);
    expect(me.body.device.status).toBe("ACTIVE");
    // Mobil access token mavjud /mini/* yo‘llarida ham ishlaydi.
    expect((await call("GET", "/api/mini/ping", undefined, session.accessToken)).body.employeeId).toBe("a");
  });

  it("B xodim X telefonni bog‘lay olmaydi", async () => {
    const res = await activate(phoneX, await newCode("b"));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("DEVICE_BOUND_OTHER");
  });

  it("A xodim Y telefonni jimgina faollashtira olmaydi — HR tasdig‘i kerak", async () => {
    const res = await activate(phoneY, await newCode("a"));
    expect(res.status).toBe(202);
    expect(res.body.status).toBe("PENDING");
    const db = await store.readDb();
    expect(db.mobileDevices.filter((d) => d.employeeId === "a" && d.status === "ACTIVE")).toHaveLength(1);
    session.requestId = res.body.requestId;
  });

  it("refresh rotatsiyasi; eski refresh qayta ishlatilsa sessiya yopiladi", async () => {
    const first = await refresh(phoneX, session.deviceId, session.sessionId, session.refreshToken);
    expect(first.status).toBe(200);
    expect(first.body.refreshToken).not.toBe(session.refreshToken);
    // Imzo boshqa kalit bilan — rad.
    const { body: ch } = await call("POST", "/api/mobile/auth/challenge", { deviceId: session.deviceId });
    const bad = await call("POST", "/api/mobile/auth/refresh", {
      sessionId: session.sessionId,
      refreshToken: first.body.refreshToken,
      nonce: ch.nonce,
      signature: signAs(phoneY, `staffora:refresh:${ch.nonce}:${session.sessionId}`),
    });
    expect(bad.body.code).toBe("SIGNATURE");
    const reused = await refresh(phoneX, session.deviceId, session.sessionId, session.refreshToken);
    expect(reused.body.code).toBe("SESSION_REUSED");
    expect((await call("GET", "/api/mobile/me", undefined, first.body.accessToken)).status).toBe(401);
  });

  it("logout qurilmani uzmaydi: B baribir X’ni ololmaydi, A qayta kira oladi", async () => {
    const login = await activate(phoneX, await newCode("a"));
    expect(login.status).toBe(201);
    expect((await call("POST", "/api/mobile/auth/logout", { sessionId: login.body.sessionId, refreshToken: login.body.refreshToken })).status).toBe(200);
    expect((await call("GET", "/api/mobile/me", undefined, login.body.accessToken)).status).toBe(401);
    const db = await store.readDb();
    expect(db.mobileDevices.find((d) => d.id === login.body.deviceId)!.status).toBe("ACTIVE");
    expect((await activate(phoneX, await newCode("b"))).body.code).toBe("DEVICE_BOUND_OTHER");
    session = { ...session, ...(await activate(phoneX, await newCode("a"))).body };
  });

  it("push token ro‘yxatdan o‘tadi va aylanadi", async () => {
    const t1 = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]";
    const t2 = "ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]";
    expect((await call("POST", "/api/mobile/push-token", { token: t1, platform: "android" }, session.accessToken)).status).toBe(200);
    expect((await call("POST", "/api/mobile/push-token", { token: t2, platform: "android" }, session.accessToken)).status).toBe(200);
    const db = await store.readDb();
    const rows = db.mobilePushTokens.filter((t) => t.employeeId === "a");
    expect(rows.find((t) => t.token === t1)!.active).toBe(false);
    expect(rows.find((t) => t.token === t2)!.active).toBe(true);
    // Telegram tokeni bilan mobil yo‘llarga kirib bo‘lmaydi.
    const tg = auth.signEmployeeSession({ employeeId: "a", companyId: "c1", telegramId: "dev-a", kind: "employee" });
    expect((await call("POST", "/api/mobile/push-token", { token: t1, platform: "android" }, tg)).status).toBe(403);
  });

  it("RBAC va tenant: moliya va boshqa kompaniya almashtirishni tasdiqlay olmaydi", async () => {
    panelRole = "FINANCE";
    expect((await call("POST", `/api/mobile/device-requests/${session.requestId}/decide`, { approve: true })).status).toBe(403);
    panelRole = "HR_MANAGER";
    panelCompany = "c2";
    expect((await call("POST", `/api/mobile/device-requests/${session.requestId}/decide`, { approve: true })).status).toBe(404);
    expect((await call("GET", "/api/employees/a/mobile-devices")).status).toBe(404);
    panelCompany = "c1";
  });

  it("HR almashtirishni tasdiqlaydi: eski X va uning sessiyalari bekor, Y ishlaydi", async () => {
    expect((await call("POST", `/api/mobile/device-requests/${session.requestId}/decide`, { approve: true })).status).toBe(200);
    expect((await call("GET", "/api/mobile/me", undefined, session.accessToken)).body.code).toBe("DEVICE_REVOKED");
    expect((await refresh(phoneX, session.deviceId, session.sessionId, session.refreshToken)).status).toBeGreaterThanOrEqual(400);
    const { body: ch } = await call("POST", "/api/mobile/activation/challenge", { publicKey: phoneY.raw });
    const status = await call("POST", "/api/mobile/activation/status", {
      requestId: session.requestId,
      publicKey: phoneY.raw,
      nonce: ch.nonce,
      signature: signAs(phoneY, `staffora:status:${ch.nonce}:${session.requestId}`),
    });
    expect(status.body.status).toBe("APPROVED");
    expect((await call("GET", "/api/mobile/me", undefined, status.body.accessToken)).body.device.status).toBe("ACTIVE");
    const db = await store.readDb();
    expect(db.mobileDevices.filter((d) => d.employeeId === "a" && d.status === "ACTIVE")).toHaveLength(1);
    expect(db.mobilePushTokens.filter((t) => t.employeeId === "a" && t.active)).toHaveLength(0);
    expect(db.auditLogs.some((l) => l.action.includes("almashtirish tasdiqlandi"))).toBe(true);
    session = status.body;
  });

  it("HR bekor qilgan qurilma bloklanadi; challenge ham berilmaydi", async () => {
    expect((await call("POST", `/api/mobile-devices/${session.deviceId}/revoke`, { reason: "Yo‘qolgan" })).status).toBe(200);
    expect((await call("GET", "/api/mini/ping", undefined, session.accessToken)).status).toBe(401);
    expect((await call("POST", "/api/mobile/auth/challenge", { deviceId: session.deviceId })).body.code).toBe("DEVICE_REVOKED");
  });

  it("muddati o‘tgan / soxta access token rad etiladi", async () => {
    const forged = jwt.sign({ employeeId: "a", companyId: "c1", kind: "employee", msid: session.sessionId, mdid: session.deviceId }, "wrong-secret", { issuer: "staffora-mini-app" });
    expect((await call("GET", "/api/mobile/me", undefined, forged)).status).toBe(401);
  });
});

describe("mobil ilova: rahbar rejimi", () => {
  it("faqat bog‘langan panel hisobi bo‘lsa rahbar sessiyasi beriladi; telefon bekor qilinsa — yopiladi", async () => {
    await store.updateDb((db) => {
      db.employees.push({ ...employee("m"), telegramId: "777000" } as Employee);
      db.users.push({ id: "u-m", companyId: "c1", name: "Rahbar", email: "m@t", role: "BRANCH_MANAGER", telegramId: "777000", branchIds: ["b1"] } as unknown as Database["users"][number]);
    });
    const phoneM = phone();
    const login = await activate(phoneM, await newCode("m"));
    expect(login.status).toBe(201);
    expect((await call("GET", "/api/mobile/manager/check", undefined, login.body.accessToken)).body.allowed).toBe(true);
    const mgr = await call("POST", "/api/mobile/manager/session", {}, login.body.accessToken);
    expect(mgr.status).toBe(200);
    expect(mgr.body.user.role).toBe("BRANCH_MANAGER");
    const decoded = jwt.decode(mgr.body.token) as { sid: string };
    // Oddiy xodim (rahbar emas) — rad.
    const other = await activate(phone(), await newCode("b"));
    expect((await call("GET", "/api/mobile/manager/check", undefined, other.body.accessToken)).body.allowed).toBe(false);
    expect((await call("POST", "/api/mobile/manager/session", {}, other.body.accessToken)).status).toBe(403);
    // Telegram tokeni bilan — rad (faqat ishonchli telefon).
    const tg = auth.signEmployeeSession({ employeeId: "m", companyId: "c1", telegramId: "777000", kind: "employee" });
    expect((await call("POST", "/api/mobile/manager/session", {}, tg)).status).toBe(403);
    // HR telefonni bekor qiladi — rahbar panel sessiyasi ham yopiladi.
    panelRole = "HR_MANAGER";
    panelCompany = "c1";
    expect((await call("POST", `/api/mobile-devices/${login.body.deviceId}/revoke`, {})).status).toBe(200);
    const db = await store.readDb();
    expect(db.panelSessions.find((s) => s.id === decoded.sid)?.revokedAt).toBeTruthy();
  });
});

describe("mobil ilova: push dispetcheri", () => {
  it("yangi bildirishnoma bir marta push bo‘ladi; DeviceNotRegistered token o‘chiriladi", async () => {
    const push = await import("../server/push");
    await store.updateDb((db) => {
      db.employees.push(employee("p"));
    });
    const phoneP = phone();
    const login = await activate(phoneP, await newCode("p"));
    expect(login.status).toBe(201);
    const token = "ExponentPushToken[pppppppppppppppppppppp]";
    expect((await call("POST", "/api/mobile/push-token", { token, platform: "android" }, login.body.accessToken)).status).toBe(200);
    await store.updateDb((db) => {
      db.notifications.unshift({ id: "n-push", companyId: "c1", employeeId: "p", title: "Ta’til tasdiqlandi", body: "<b>Dam oling</b>", type: "LEAVE", read: false, createdAt: new Date().toISOString() });
    });
    const realFetch = globalThis.fetch;
    const sent: { to: string; title: string; body: string; data: Record<string, string> }[][] = [];
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ data: [{ status: "error", details: { error: "DeviceNotRegistered" } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      await push.dispatchPendingPushes();
      await push.dispatchPendingPushes();
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toMatchObject({ to: token, title: "Ta’til tasdiqlandi", body: "Dam oling", data: { go: "leave", notificationId: "n-push" } });
    const db = await store.readDb();
    expect(db.notifications.find((n) => n.id === "n-push")?.pushedAt).toBeTruthy();
    expect(db.mobilePushTokens.find((t) => t.token === token)?.active).toBe(false);
  });
});
