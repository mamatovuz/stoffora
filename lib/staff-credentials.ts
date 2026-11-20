import { randomUUID } from "node:crypto";
import type { Database, Employee, StaffCredential } from "./types";
import { LOGIN_MAX, LOGIN_SUFFIX, checkLoginInput, suggestLoginLocal } from "./staff-login";

/*
 * Ilovaga kirish loginlari (ozodbek@staffora.uz) — server tomoni.
 * Login barcha kompaniyalar bo‘yicha noyob va quyidagilar bilan to‘qnashmasligi kerak:
 *   - staffCredentials.login (xodimlar),
 *   - users.mobileLogin (direktor/rahbar) va users.email (panel login),
 *   - hali tasdiqlanmagan (DRAFT/PENDING) bot anketalarida band qilingan login.
 * Parol xeshi faqat staffCredentials’da; xodimda — `login` nusxasi (ko‘rsatish uchun).
 */

export type LoginExclude = { employeeId?: string; userId?: string; requestId?: string };

/** Botdagi tugallanmagan (DRAFT) anketa loginni shuncha vaqt band qilib turadi; yuborilgani (PENDING) — qaror chiqquncha. */
export const DRAFT_LOGIN_TTL_MS = 24 * 3_600_000;

export const normalizeLogin = (login: string) => String(login || "").trim().toLowerCase();

/** Login kimda band: "credential" | "user" | "registration" yoki undefined (bo‘sh). */
export function loginOwner(db: Database, raw: string, exclude: LoginExclude = {}) {
  const login = normalizeLogin(raw);
  if (!login) return undefined;
  if ((db.staffCredentials || []).some((c) => c.login === login && !(exclude.employeeId && c.employeeId === exclude.employeeId))) return "credential" as const;
  if ((db.employees || []).some((e) => e.login && normalizeLogin(e.login) === login && e.id !== exclude.employeeId)) return "credential" as const;
  if (
    (db.users || []).some(
      (u) => u.id !== exclude.userId && ((u.mobileLogin && normalizeLogin(u.mobileLogin) === login) || normalizeLogin(u.email) === login),
    )
  )
    return "user" as const;
  const draftCutoff = new Date(Date.now() - DRAFT_LOGIN_TTL_MS).toISOString();
  if (
    (db.registrations || []).some(
      (r) =>
        r.id !== exclude.requestId &&
        (r.status === "PENDING" || (r.status === "DRAFT" && r.updatedAt > draftCutoff)) &&
        r.data.appLogin &&
        normalizeLogin(r.data.appLogin) === login,
    )
  )
    return "registration" as const;
  return undefined;
}
export const isLoginTaken = (db: Database, login: string, exclude: LoginExclude = {}) => Boolean(loginOwner(db, login, exclude));

/** Ism-familiyadan bo‘sh (band bo‘lmagan) to‘liq login: ozodbek.mamatov@…, band bo‘lsa — ozodbek.mamatov2@… */
export function suggestFreeLogin(db: Database, firstName: string, lastName = "", exclude: LoginExclude = {}) {
  let local = suggestLoginLocal(firstName, lastName);
  if (!/^[a-z]/.test(local)) local = `x${local}`;
  if (local.length < 3) local = `${local}.xodim`;
  local = local.slice(0, LOGIN_MAX).replace(/[._-]+$/, "");
  for (let n = 1; n < 1000; n += 1) {
    const tail = n === 1 ? "" : String(n);
    const candidate = `${local.slice(0, LOGIN_MAX - tail.length).replace(/[._-]+$/, "")}${tail}${LOGIN_SUFFIX}`;
    if (checkLoginInput(candidate).ok && !isLoginTaken(db, candidate, exclude)) return candidate;
  }
  return `${local.slice(0, LOGIN_MAX - 6)}${Date.now().toString().slice(-6)}${LOGIN_SUFFIX}`;
}

/** «Ali Valiyev» → ["Ali", "Valiyev"] (panel foydalanuvchisi ismi uchun). */
export function splitName(name: string): [string, string] {
  const [first = "", ...rest] = String(name || "").trim().split(/\s+/);
  return [first, rest.join(" ")];
}

export const credentialOfEmployee = (db: Database, employeeId: string) => (db.staffCredentials || []).find((c) => c.employeeId === employeeId);
export const credentialByLogin = (db: Database, login: string) => {
  const key = normalizeLogin(login);
  return (db.staffCredentials || []).find((c) => c.login === key);
};

/**
 * Xodimga login va parol xeshini yozadi (updateDb ichida). Login allaqachon bor bo‘lsa — o‘zgarmaydi,
 * faqat parol yangilanadi. Faqat hisob egasi tasdiqlagan yo‘llardan chaqiriladi (Mini App / joriy parol);
 * bot anketasi mavjud parolni HECH QACHON almashtirmaydi (registration.ts applyRegistrationLogin).
 */
export function setEmployeeCredential(db: Database, employee: Employee, login: string, passwordHash: string): StaffCredential {
  const now = new Date().toISOString();
  const existing = credentialOfEmployee(db, employee.id);
  if (existing) {
    existing.passwordHash = passwordHash;
    existing.updatedAt = now;
    employee.login = existing.login;
    return existing;
  }
  const row: StaffCredential = {
    id: randomUUID(),
    companyId: employee.companyId,
    employeeId: employee.id,
    login: normalizeLogin(login),
    passwordHash,
    createdAt: now,
    updatedAt: now,
  };
  db.staffCredentials.push(row);
  employee.login = row.login;
  employee.updatedAt = now;
  return row;
}

/**
 * Parol almashganda boshqa sessiyalar yopiladi (updateDb ichida): foydalanuvchining panel sessiyalari
 * (joriysidan tashqari) va rahbar rejimidagi mobil sessiyalari (bog‘langan panel sessiyasi bilan).
 * Qaytaradi: yopilgan sessiyalar soni.
 */
export function revokeUserSessions(db: Database, userId: string, keepPanelSessionId?: string, reason = "Parol almashtirildi") {
  const now = new Date().toISOString();
  let count = 0;
  for (const s of db.mobileSessions)
    if (!s.employeeId && s.userId === userId && !s.revokedAt && !(keepPanelSessionId && s.panelSessionId === keepPanelSessionId)) {
      Object.assign(s, { revokedAt: now, revokeReason: reason });
      count += 1;
    }
  for (const s of db.panelSessions)
    if (s.userId === userId && !s.revokedAt && s.id !== keepPanelSessionId) {
      s.revokedAt = now;
      count += 1;
    }
  return count;
}
