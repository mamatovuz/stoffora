import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database, Employee } from "../lib/types";

/*
 * Ilovaga kirish: Mini App’da login + parol o‘rnatish (/mini/account), mobil ilovada login bilan kirish
 * (/mobile/auth/login — xodim va direktor rejimi, qulf, Telegram 2FA), direktorning mobil logini (/auth/mobile-login).
 * Haqiqiy routerlar + vaqtinchalik SQLite; telefon kaliti Node’da (P-256).
 */

let dir: string;
let base: string;
let close: () => void;
let store: typeof import("../lib/store");
let mobile: typeof import("../server/mobile");
let auth: typeof import("../server/auth");
const telegram: { to: string; text: string }[] = [];

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
async function login(p: Phone, loginText: string, password: string, code?: string) {
  const { body: ch } = await call("POST", "/api/mobile/activation/challenge", { publicKey: p.raw });
  return call("POST", "/api/mobile/auth/login", {
    login: loginText,
    password,
    publicKey: p.raw,
    nonce: ch.nonce,
    signature: signAs(p, `staffora:login:${ch.nonce}:${loginText.trim().toLowerCase()}`),
    platform: "ios",
    model: "iPhone",
    ...(code ? { code } : {}),
  });
}
async function refresh(p: Phone, deviceId: string, sessionId: string, refreshToken: string) {
  const { body: ch } = await call("POST", "/api/mobile/auth/challenge", { deviceId });
  return call("POST", "/api/mobile/auth/refresh", { sessionId, refreshToken, nonce: ch.nonce, signature: signAs(p, `staffora:refresh:${ch.nonce}:${sessionId}`) });
}

const employee = (id: string, firstName: string, lastName: string): Employee =>
  ({ id, companyId: "c1", firstName, lastName, status: "ACTIVE", branchId: "b1", telegramId: `dev-${id}` }) as unknown as Employee;
const miniToken = (employeeId: string) => auth.signEmployeeSession({ employeeId, companyId: "c1", telegramId: `dev-${employeeId}`, kind: "employee" });
const panelToken = () => auth.signSession({ sid: "ps-owner", userId: "u1", companyId: "c1", name: "Direktor", email: "boss@firma.uz", role: "COMPANY_OWNER" });

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "staffora-account-"));
  process.env.SQLITE_PATH = path.join(dir, "test.sqlite");
  process.env.MOBILE_PUSH = "false";
  process.env.MOBILE_LOGIN_RATE_LIMIT = "1000";
  process.env.MOBILE_CHALLENGE_RATE_LIMIT = "1000";
  process.env.MOBILE_LOGIN_GLOBAL_MAX_FAILURES = "12";
  process.env.MINI_ACCOUNT_RATE_LIMIT = "1000";
  vi.resetModules();
  vi.doMock("../server/telegram", async (original) => ({
    ...(await original<typeof import("../server/telegram")>()),
    sendTelegramMessage: async (to: string, text: string) => {
      telegram.push({ to, text });
      return true;
    },
  }));
  store = await import("../lib/store");
  mobile = await import("../server/mobile");
  auth = await import("../server/auth");
  const account = await import("../server/staff-account");
  const ownerHash = await bcrypt.hash("Direktor2026", 4);
  await store.updateDb((db: Database) => {
    db.companies.push({ id: "c1", name: "Test MChJ", status: "ACTIVE" } as Database["companies"][number]);
    db.employees.push(employee("a", "Ali", "Valiyev"), employee("b", "Bobur", "Qosimov"));
    db.users.push({ id: "u1", companyId: "c1", name: "Direktor Karimov", email: "boss@firma.uz", passwordHash: ownerHash, role: "COMPANY_OWNER" } as Database["users"][number]);
    // Ali — lavozimi orqali HR (xodimga bog‘langan panel hisobi): ilovada «Rahbar» bo‘limi.
    db.users.push({ id: "u2", companyId: "c1", name: "Ali Valiyev", email: "ali.hr@firma.uz", passwordHash: "", role: "HR_MANAGER", autoRole: true, employeeId: "a" } as Database["users"][number]);
    const now = new Date().toISOString();
    db.panelSessions.push({ id: "ps-owner", userId: "u1", userAgent: "test", ip: "", createdAt: now, lastSeenAt: now });
  });
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api", mobile.createMobilePublicRouter());
  app.use("/api/mini", auth.requireEmployee);
  app.use("/api", account.createMiniAccountRouter());
  app.use("/api", auth.requireAuth);
  app.get("/api/panel/ping", (req, res) => res.json({ userId: (req as any).session.userId, role: (req as any).session.role }));
  app.use("/api", account.createPanelMobileLoginRouter());
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => res.status(error.status || (error.name === "ZodError" ? 400 : 500)).json({ code: error.code, message: error.message }));
  const server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
afterAll(() => {
  close?.();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows */
  }
});

describe("Mini App: ilovaga kirish logini va paroli", () => {
  it("login tanlanadi (bir marta), parol o‘rnatiladi; xesh xodimda yo‘q", async () => {
    const token = miniToken("a");
    const first = await call("GET", "/api/mini/account", undefined, token);
    expect(first.body).toEqual({ login: null, suggested: "ali.valiyev@staffora.uz", hasPassword: false });
    expect((await call("POST", "/api/mini/account", { login: "ali@gmail.com", password: "Valiyev2026" }, token)).body.code).toBe("LOGIN_INVALID");
    expect((await call("POST", "/api/mini/account", { login: "ali.valiyev", password: "qisqa1" }, token)).body.code).toBe("PASSWORD_WEAK");
    const ok = await call("POST", "/api/mini/account", { login: "Ali.Valiyev", password: "Valiyev2026" }, token);
    expect(ok).toEqual({ status: 200, body: { ok: true, login: "ali.valiyev@staffora.uz" } });
    const db = await store.readDb();
    const credential = db.staffCredentials.find((c) => c.employeeId === "a")!;
    expect(await bcrypt.compare("Valiyev2026", credential.passwordHash)).toBe(true);
    expect(db.employees.find((e) => e.id === "a")?.login).toBe("ali.valiyev@staffora.uz");
    expect(JSON.stringify(db.employees)).not.toContain(credential.passwordHash);
    expect((await call("GET", "/api/mini/account", undefined, token)).body).toEqual({ login: "ali.valiyev@staffora.uz", suggested: "ali.valiyev@staffora.uz", hasPassword: true });
    // Login o‘zgarmaydi; boshqa xodim band loginni ololmaydi.
    expect((await call("POST", "/api/mini/account", { login: "boshqa", password: "Valiyev2026" }, token)).body.code).toBe("LOGIN_FIXED");
    expect((await call("POST", "/api/mini/account", { login: "ali.valiyev@staffora.uz", password: "Bobur2026" }, miniToken("b"))).body.code).toBe("LOGIN_TAKEN");
    // Telegram’dan (parolni unutdim) — joriy parolsiz almashtiriladi.
    expect((await call("POST", "/api/mini/account", { password: "Valiyev2027" }, token)).status).toBe(200);
  });
});

describe("mobil ilova: login + parol bilan kirish", () => {
  const phoneX = phone();
  const phoneY = phone();
  let session: Record<string, any>;

  it("noto‘g‘ri parol — LOGIN_FAILED; to‘g‘ri — xodim sessiyasi", async () => {
    const wrong = await login(phoneX, "ali.valiyev", "Valiyev2026");
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe("LOGIN_FAILED");
    expect(wrong.body.message).toBe("Login yoki parol noto‘g‘ri.");
    expect((await login(phoneX, "hech.kim", "Valiyev2027")).body.code).toBe("LOGIN_FAILED");
    expect((await login(phoneX, "x@gmail.com", "Valiyev2027")).body.code).toBe("LOGIN_FAILED");
    expect((await login(phoneX, "ali valiyev", "Valiyev2027")).body.code).toBe("LOGIN_INVALID");
    const res = await login(phoneX, "ali.valiyev@staffora.uz", "Valiyev2027");
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ mode: "employee", employee: { id: "a", firstName: "Ali", companyId: "c1" } });
    expect(res.body.accessToken && res.body.refreshToken && res.body.sessionId && res.body.deviceId).toBeTruthy();
    session = res.body;
    const db = await store.readDb();
    expect(db.mobileDevices.filter((d) => d.employeeId === "a" && d.status === "ACTIVE")).toHaveLength(1);
  });

  it("imzo boshqa kalit bilan — rad", async () => {
    const other = phone();
    const { body: ch } = await call("POST", "/api/mobile/activation/challenge", { publicKey: phoneX.raw });
    const res = await call("POST", "/api/mobile/auth/login", { login: "ali.valiyev", password: "Valiyev2027", publicKey: phoneX.raw, nonce: ch.nonce, signature: signAs(other, `staffora:login:${ch.nonce}:ali.valiyev`), platform: "ios" });
    expect(res.body.code).toBe("SIGNATURE");
  });

  it("mobil ilovadan parolni almashtirish — joriy parol bilan; refresh rejimni qaytaradi", async () => {
    // Ali rahbar ham: boshqa telefondan /mobile/manager/session bilan ochilgan panel sessiyasi parol almashsa yopiladi.
    const now = new Date().toISOString();
    await store.updateDb((db) => {
      db.panelSessions.push(
        { id: "pm-other", userId: "u2", userAgent: "Staffora mobil ilova · eski-telefon · Android", ip: "", createdAt: now, lastSeenAt: now },
        { id: "pm-current", userId: "u2", userAgent: `Staffora mobil ilova · ${session.deviceId} · iPhone`, ip: "", createdAt: now, lastSeenAt: now },
        { id: "pm-web", userId: "u2", userAgent: "Mozilla/5.0 Chrome", ip: "", createdAt: now, lastSeenAt: now },
      );
    });
    expect((await call("GET", "/api/mini/account", undefined, session.accessToken)).body.hasPassword).toBe(true);
    expect((await call("POST", "/api/mini/account", { password: "Yangi2026parol" }, session.accessToken)).body.code).toBe("PASSWORD_WRONG");
    expect((await call("POST", "/api/mini/account", { password: "Yangi2026parol", currentPassword: "noto‘g‘ri1" }, session.accessToken)).body.code).toBe("PASSWORD_WRONG");
    expect((await call("POST", "/api/mini/account", { password: "Yangi2026parol", currentPassword: "Valiyev2027" }, session.accessToken)).status).toBe(200);
    const panels = (await store.readDb()).panelSessions;
    expect(panels.find((s) => s.id === "pm-other")?.revokedAt).toBeTruthy();
    expect(panels.find((s) => s.id === "pm-current")?.revokedAt).toBeUndefined();
    expect(panels.find((s) => s.id === "pm-web")?.revokedAt).toBeUndefined();
    expect((await login(phone(), "ali.valiyev", "Valiyev2027")).body.code).toBe("LOGIN_FAILED");
    const next = await refresh(phoneX, session.deviceId, session.sessionId, session.refreshToken);
    expect(next.status).toBe(200);
    expect(next.body).toMatchObject({ mode: "employee", employee: { id: "a" } });
  });

  it("yangi telefondan kirish eski telefonni o‘chiradi (bitta xodim — bitta telefon)", async () => {
    const res = await login(phoneY, "ali.valiyev", "Yangi2026parol");
    expect(res.status).toBe(201);
    const db = await store.readDb();
    const active = db.mobileDevices.filter((d) => d.employeeId === "a" && d.status === "ACTIVE");
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(res.body.deviceId);
    expect(db.mobileDevices.find((d) => d.id === session.deviceId)?.status).toBe("REVOKED");
  });

  it("qulf: bitta telefondan 8 xato — o‘sha telefon; umumiy chegara — begona telefonlar; hisobning faol telefoni o‘tadi", async () => {
    const p = phone();
    for (let i = 0; i < mobile.LOGIN_MAX_FAILURES; i += 1) expect((await login(p, "ali.valiyev", `Xato${i}parol`)).body.code).toBe("LOGIN_FAILED");
    const locked = await login(p, "ali.valiyev", "Yangi2026parol");
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe("LOGIN_LOCKED");
    // Boshqa telefon bu qulfga tushmaydi — lekin login bo‘yicha umumiy chegara (testda 12) to‘lsa, begona telefonlar kutadi.
    const q = phone();
    for (let i = 0; i < 4; i += 1) expect((await login(q, "ali.valiyev", `Boshqa${i}xato`)).body.code).toBe("LOGIN_FAILED");
    expect((await login(phone(), "ali.valiyev", "Yangi2026parol")).body.code).toBe("LOGIN_LOCKED");
    // Egasining hozir faol telefoni — begona odam ataylab qulflab qo‘ya olmaydi.
    expect((await login(phoneY, "ali.valiyev", "Yangi2026parol")).status).toBe(201);
    mobile.resetLoginGuards();
    expect((await login(p, "ali.valiyev", "Yangi2026parol")).status).toBe(201);
  });
});

describe("direktor: mobil ilova logini va rahbar rejimi", () => {
  const phoneD = phone();

  it("panelda login bir marta o‘rnatiladi", async () => {
    const token = panelToken();
    expect((await call("GET", "/api/auth/mobile-login", undefined, token)).body).toEqual({ login: null, suggested: "direktor.karimov@staffora.uz" });
    expect((await call("POST", "/api/auth/mobile-login", { login: "ali.valiyev@staffora.uz" }, token)).body.code).toBe("LOGIN_TAKEN");
    expect((await call("POST", "/api/auth/mobile-login", { login: "boss@gmail.com" }, token)).body.code).toBe("LOGIN_INVALID");
    expect((await call("POST", "/api/auth/mobile-login", { login: "direktor@staffora.uz" }, token)).body).toEqual({ login: "direktor@staffora.uz" });
    expect((await call("POST", "/api/auth/mobile-login", { login: "boshqa@staffora.uz" }, token)).body.code).toBe("LOGIN_FIXED");
    expect((await call("GET", "/api/auth/mobile-login", undefined, token)).body.login).toBe("direktor@staffora.uz");
  });

  it("login + panel paroli → rahbar sessiyasi (panel API’lari), refresh va chiqish", async () => {
    expect((await login(phoneD, "direktor", "Noto‘g‘ri2026")).body.code).toBe("LOGIN_FAILED");
    const res = await login(phoneD, "direktor", "Direktor2026");
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ mode: "manager", user: { id: "u1", role: "COMPANY_OWNER", branchIds: [] }, company: { id: "c1", name: "Test MChJ" } });
    expect((await call("GET", "/api/panel/ping", undefined, res.body.accessToken)).body).toEqual({ userId: "u1", role: "COMPANY_OWNER" });
    let db = await store.readDb();
    const device = db.mobileDevices.find((d) => d.id === res.body.deviceId)!;
    expect(device).toMatchObject({ employeeId: "", userId: "u1", status: "ACTIVE" });
    // Rahbar tokeni xodim API’siga yaramaydi.
    expect((await call("GET", "/api/mini/account", undefined, res.body.accessToken)).status).toBe(401);

    const next = await refresh(phoneD, res.body.deviceId, res.body.sessionId, res.body.refreshToken);
    expect(next.status).toBe(200);
    expect(next.body).toMatchObject({ mode: "manager", user: { id: "u1" }, company: { id: "c1" } });
    expect((await call("GET", "/api/panel/ping", undefined, next.body.accessToken)).status).toBe(200);
    db = await store.readDb();
    // Bitta mobil sessiya — bitta panel sessiyasi (refresh yangisini ochmaydi).
    expect(db.panelSessions.filter((s) => s.userAgent.includes(res.body.deviceId))).toHaveLength(1);

    expect((await call("POST", "/api/mobile/auth/logout", { sessionId: next.body.sessionId, refreshToken: next.body.refreshToken })).status).toBe(200);
    expect((await call("GET", "/api/panel/ping", undefined, next.body.accessToken)).status).toBe(401);
  });

  it("to‘g‘ri parol rad etilmaydi: panel emaili, oxiridagi bo‘sh joy, bog‘langan xodim paroli", async () => {
    const p = phone();
    // Panel emaili (staffora.uz emas) + panel paroli → rahbar sessiyasi.
    const byEmail = await login(p, "Boss@Firma.uz", "Direktor2026");
    expect(byEmail.status).toBe(201);
    expect(byEmail.body).toMatchObject({ mode: "manager", user: { id: "u1" } });
    // Klaviatura qo‘shgan bo‘sh joy.
    expect((await login(phone(), "direktor", "Direktor2026 ")).status).toBe(201);
    // Begona email / noto‘g‘ri parol — baribir rad.
    expect((await login(phone(), "boss@firma.uz", "Valiyev2027")).body.code).toBe("LOGIN_FAILED");
    expect((await login(phone(), "nobody@firma.uz", "Direktor2026")).body.code).toBe("LOGIN_FAILED");

    // Direktor xodim sifatida ham ro‘yxatdan o‘tgan (Bobur, Mini App paroli boshqa): ikkala parol ham ishlaydi.
    await store.updateDb((db) => {
      db.users.find((u) => u.id === "u1")!.employeeId = "b";
    });
    const set = await call("POST", "/api/mini/account", { login: "bobur.q", password: "Bobur2026x" }, miniToken("b"));
    expect(set.status).toBe(200);
    const panelPassword = await login(phone(), "bobur.q", "Direktor2026");
    expect(panelPassword.status).toBe(201);
    expect(panelPassword.body).toMatchObject({ mode: "employee", employee: { id: "b" } });
    const employeePassword = await login(phone(), "direktor", "Bobur2026x");
    expect(employeePassword.status).toBe(201);
    expect(employeePassword.body).toMatchObject({ mode: "employee", employee: { id: "b" } });
    // Boshqa xodimning paroli direktor loginiga yaramaydi.
    expect((await login(phone(), "direktor", "Valiyev2027")).body.code).toBe("LOGIN_FAILED");
    await store.updateDb((db) => {
      delete db.users.find((u) => u.id === "u1")!.employeeId;
    });
  });

  it("bloklangan direktor kira olmaydi; Telegram 2FA yoqilgan bo‘lsa — 5 xonali kod", async () => {
    await store.updateDb((db) => {
      const user = db.users.find((u) => u.id === "u1")!;
      user.blockedAt = new Date().toISOString();
    });
    expect((await login(phoneD, "direktor", "Direktor2026")).body.code).toBe("ACCOUNT_BLOCKED");
    // 2FA yoqilgan, lekin Telegram ulanmagan — kodsiz o‘tkazib yuborilmaydi.
    await store.updateDb((db) => {
      const user = db.users.find((u) => u.id === "u1")!;
      Object.assign(user, { blockedAt: undefined, twoFactorEnabled: true });
    });
    expect((await login(phoneD, "direktor", "Direktor2026")).body.code).toBe("TWO_FACTOR_UNAVAILABLE");
    await store.updateDb((db) => {
      const user = db.users.find((u) => u.id === "u1")!;
      Object.assign(user, { telegramId: "777001" });
    });
    const challenge = await login(phoneD, "direktor", "Direktor2026");
    expect(challenge.status).toBe(200);
    expect(challenge.body.requires2fa).toBe(true);
    const code = /<code>(\d{5})<\/code>/.exec(telegram.at(-1)?.text || "")?.[1];
    expect(telegram.at(-1)?.to).toBe("777001");
    expect(code).toMatch(/^\d{5}$/);
    expect((await login(phoneD, "direktor", "Direktor2026", code === "00000" ? "11111" : "00000")).body.code).toBe("CODE_INVALID");
    const res = await login(phoneD, "direktor", "Direktor2026", code);
    expect(res.status).toBe(201);
    expect(res.body.mode).toBe("manager");
  });

  it("2FA: foydalanuvchi bo‘yicha 10 ta noto‘g‘ri kod — 15 daqiqa qulf", async () => {
    for (let round = 0; round < 2; round += 1) {
      expect((await login(phoneD, "direktor", "Direktor2026")).body.requires2fa).toBe(true);
      const code = /<code>(\d{5})<\/code>/.exec(telegram.at(-1)?.text || "")![1];
      const wrong = code === "00000" ? "11111" : "00000";
      for (let i = 0; i < 5; i += 1) {
        expect((await login(phoneD, "direktor", "Direktor2026", wrong)).body.code).toBe("CODE_INVALID");
      }
    }
    const locked = await login(phoneD, "direktor", "Direktor2026");
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe("CODE_LOCKED");
    mobile.resetLoginGuards();
  });
});
