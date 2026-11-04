import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";
import { readDb, updateDb } from "../../lib/store";
import type {
  CorporateParticipant,
  CorporateRole,
} from "../../lib/corporate/types";
import type { AuthedRequest, Session } from "../auth";

const secret =
  process.env.CORPORATE_SESSION_SECRET ||
  `${process.env.SESSION_SECRET || "staffora-local"}-corporate`;
const COOKIE = "staffora_corporate";
export const CORPORATE_TERMS_VERSION = "2026-11-04";
export const CORPORATE_TERMS = {
  version: CORPORATE_TERMS_VERSION,
  title: "Staffora Corporate portalidan foydalanish shartlari",
  sections: [
    {
      title: "1. Portalning vazifasi",
      text: "Corporate portal ichki boshqaruv, iqtisodiy manfaatlar, kelishuvlar va hisobotlarni yuritish vositasidir. Tizimdagi rol yoki foiz rasmiy yuridik egalikni o‘z-o‘zidan tasdiqlamaydi.",
    },
    {
      title: "2. Maxfiylik",
      text: "Login va parol shaxsiy hisoblanadi. Foydalanuvchi ularni uchinchi shaxsga bermasligi, portalda ko‘rilgan moliyaviy va korporativ ma’lumotlarni vakolatsiz tarqatmasligi shart.",
    },
    {
      title: "3. Elektron rozilik",
      text: "Checkboxni belgilab kirish orqali foydalanuvchi ushbu versiyadagi shartlarni o‘qiganini va qabul qilganini tasdiqlaydi. Rozilik vaqti audit uchun saqlanadi.",
    },
    {
      title: "4. Qarorlar va hujjatlar",
      text: "Yuqori xavfli amallar tasdiqlash oqimidan o‘tadi. Rasmiy huquqiy natija faqat tegishli imzolangan hujjatlar va amaldagi qonunchilik asosida yuzaga keladi.",
    },
    {
      title: "5. Xavfsizlik",
      text: "Shubhali kirish yoki login ma’lumotlari oshkor bo‘lsa, foydalanuvchi darhol Super Admin bilan bog‘lanishi kerak.",
    },
  ],
};

type CorporateJwt = {
  kind: "corporate";
  participantId: string;
  companyId: string;
};

export function requireCorporateAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  const token =
    req.cookies?.[COOKIE] ||
    (req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : undefined);
  if (!token)
    return res
      .status(401)
      .json({
        code: "CORPORATE_LOGIN_REQUIRED",
        message: "Corporate portalga qayta kiring.",
      });
  try {
    const payload = jwt.verify(token, secret, {
      issuer: "staffora-corporate",
    }) as CorporateJwt;
    if (payload.kind !== "corporate") throw new Error("invalid");
    void readDb()
      .then((db) => {
        const participant = db.corporateParticipants.find(
          (x) =>
            x.id === payload.participantId &&
            x.companyId === payload.companyId &&
            x.status === "ACTIVE" &&
            x.passwordHash,
        );
        if (!participant)
          return res
            .status(401)
            .json({
              code: "CORPORATE_ACCOUNT_DISABLED",
              message: "Corporate hisob faol emas.",
            });
        req.session = {
          userId: participant.id,
          companyId: participant.companyId,
          name: participant.name,
          email:
            participant.email ||
            participant.login ||
            "corporate@staffora.local",
          role: "COMPANY_OWNER",
        };
        next();
      })
      .catch(next);
  } catch {
    return res
      .status(401)
      .json({
        code: "CORPORATE_SESSION_EXPIRED",
        message: "Corporate sessiya tugagan. Qayta kiring.",
      });
  }
}

export function createCorporatePublicRouter() {
  const router = Router();
  router.get("/corporate-auth/terms", (_req, res) => res.json(CORPORATE_TERMS));
  router.post(
    "/corporate-auth/login",
    asyncRoute(async (req, res) => {
      const input = z
        .object({
          login: z.string().trim().min(3).max(120),
          password: z.string().min(6).max(200),
          acceptedTerms: z.literal(true),
          termsVersion: z.literal(CORPORATE_TERMS_VERSION),
        })
        .parse(req.body);
      const db = await readDb();
      const participant = db.corporateParticipants.find(
        (x) =>
          x.login?.toLowerCase() === input.login.toLowerCase() &&
          x.status === "ACTIVE" &&
          x.passwordHash,
      );
      if (
        !participant ||
        !(await bcrypt.compare(input.password, participant.passwordHash!))
      )
        throw Object.assign(new Error("Login yoki parol noto‘g‘ri."), {
          status: 401,
        });
      await updateDb((next) => {
        const row = next.corporateParticipants.find(
          (x) => x.id === participant.id,
        );
        if (row) {
          row.termsAcceptedAt = new Date().toISOString();
          row.termsVersion = CORPORATE_TERMS_VERSION;
          row.lastLoginAt = new Date().toISOString();
        }
      });
      const token = jwt.sign(
        {
          kind: "corporate",
          participantId: participant.id,
          companyId: participant.companyId,
        } satisfies CorporateJwt,
        secret,
        { expiresIn: "12h", issuer: "staffora-corporate" },
      );
      res.cookie(COOKIE, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 12 * 3600_000,
        path: "/",
      });
      res.json({ ok: true, redirect: "/corporate-portal" });
    }),
  );
  router.get(
    "/corporate-auth/me",
    requireCorporateAuth,
    asyncRoute(async (req, res) => {
      const db = await readDb();
      const participant = db.corporateParticipants.find(
        (x) => x.id === req.session!.userId,
      )!;
      const company = db.companies.find((x) => x.id === participant.companyId);
      res.json({
        participant: safeParticipant(participant),
        company: company ? { id: company.id, name: company.name } : null,
      });
    }),
  );
  router.post("/corporate-auth/logout", (_req, res) => {
    res.clearCookie(COOKIE, { path: "/" });
    res.json({ ok: true });
  });
  return router;
}

const roles = ["FOUNDER", "CO_FOUNDER", "CEO", "INVESTOR"] as const;
const accountSchema = z.object({
  companyId: z.string().min(1),
  firstName: z.string().trim().min(2).max(60),
  lastName: z.string().trim().min(2).max(60),
  login: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .regex(/^[a-zA-Z0-9._@-]+$/),
  password: z.string().min(8).max(200),
  role: z.enum(roles),
  shareBps: z.number().int().min(0).max(10000),
});

export function createCorporateAdminRouter() {
  const router = Router();
  router.use("/super-admin/corporate", (req: AuthedRequest, res, next) =>
    req.session?.role === "SUPER_ADMIN"
      ? next()
      : res.status(403).json({ message: "Super Admin ruxsati kerak." }),
  );
  router.get(
    "/super-admin/corporate/accounts",
    asyncRoute(async (_req, res) => {
      const db = await readDb();
      res.json({
        companies: db.companies
          .filter((x) => !x.archive)
          .map((x) => ({ id: x.id, name: x.name })),
        accounts: db.corporateParticipants
          .filter((x) => x.login)
          .map((x) => ({
            ...safeParticipant(x),
            companyName:
              db.companies.find((c) => c.id === x.companyId)?.name ||
              "Noma’lum",
          })),
      });
    }),
  );
  router.post(
    "/super-admin/corporate/accounts",
    asyncRoute(async (req: AuthedRequest, res) => {
      const input = accountSchema.parse(req.body);
      const passwordHash = await bcrypt.hash(input.password, 12);
      const row = await updateDb((db) => {
        if (!db.companies.some((x) => x.id === input.companyId))
          throw Object.assign(new Error("Kompaniya topilmadi."), {
            status: 404,
          });
        if (
          db.corporateParticipants.some(
            (x) => x.login?.toLowerCase() === input.login.toLowerCase(),
          )
        )
          throw Object.assign(new Error("Bu login band."), { status: 409 });
        if (
          input.role === "FOUNDER" &&
          db.corporateParticipants.some(
            (x) =>
              x.companyId === input.companyId &&
              x.role === "FOUNDER" &&
              x.status === "ACTIVE",
          )
        )
          throw Object.assign(
            new Error("Bu kompaniyada Founder allaqachon mavjud."),
            { status: 409 },
          );
        ensureShare(db.corporateParticipants, input.companyId, input.shareBps);
        const item: CorporateParticipant = {
          id: randomUUID(),
          companyId: input.companyId,
          name: `${input.firstName} ${input.lastName}`,
          firstName: input.firstName,
          lastName: input.lastName,
          login: input.login.toLowerCase(),
          passwordHash,
          shareBps: input.shareBps,
          role: input.role as CorporateRole,
          status: "ACTIVE",
          joinedAt: new Date().toISOString(),
        };
        db.corporateParticipants.push(item);
        rebuildEconomic(db, input.companyId, req.session!.name);
        return item;
      });
      res.status(201).json(safeParticipant(row));
    }),
  );
  router.patch(
    "/super-admin/corporate/accounts/:id",
    asyncRoute(async (req: AuthedRequest, res) => {
      const input = accountSchema
        .omit({ companyId: true, password: true })
        .partial()
        .extend({
          password: z.string().min(8).max(200).optional(),
          status: z.enum(["ACTIVE", "DISABLED"]).optional(),
        })
        .parse(req.body);
      const hash = input.password
        ? await bcrypt.hash(input.password, 12)
        : undefined;
      const row = await updateDb((db) => {
        const item = db.corporateParticipants.find(
          (x) => x.id === req.params.id && x.login,
        );
        if (!item)
          throw Object.assign(new Error("Corporate hisob topilmadi."), {
            status: 404,
          });
        if (
          input.login &&
          db.corporateParticipants.some(
            (x) =>
              x.id !== item.id &&
              x.login?.toLowerCase() === input.login!.toLowerCase(),
          )
        )
          throw Object.assign(new Error("Bu login band."), { status: 409 });
        if (input.shareBps !== undefined)
          ensureShare(
            db.corporateParticipants.filter((x) => x.id !== item.id),
            item.companyId,
            input.shareBps,
          );
        Object.assign(item, input, {
          ...(hash ? { passwordHash: hash } : {}),
          ...(input.firstName || input.lastName
            ? {
                name: `${input.firstName || item.firstName} ${input.lastName || item.lastName}`,
              }
            : {}),
        });
        if (input.login) item.login = input.login.toLowerCase();
        rebuildEconomic(db, item.companyId, req.session!.name);
        return item;
      });
      res.json(safeParticipant(row));
    }),
  );
  return router;
}

function ensureShare(
  rows: CorporateParticipant[],
  companyId: string,
  incoming: number,
) {
  const total =
    rows
      .filter((x) => x.companyId === companyId && x.status === "ACTIVE")
      .reduce((s, x) => s + (x.shareBps || 0), 0) + incoming;
  if (total > 10000)
    throw Object.assign(
      new Error(
        `Ulushlar yig‘indisi 100% dan oshmasligi kerak. Hozir ${(total / 100).toFixed(2)}%.`,
      ),
      { status: 422 },
    );
}
function rebuildEconomic(
  db: Awaited<ReturnType<typeof readDb>>,
  companyId: string,
  actor: string,
) {
  const people = db.corporateParticipants.filter(
    (x) =>
      x.companyId === companyId &&
      x.status === "ACTIVE" &&
      (x.shareBps || 0) > 0,
  );
  const used = people.reduce((s, x) => s + (x.shareBps || 0), 0);
  for (const old of db.economicInterestVersions.filter(
    (x) => x.companyId === companyId && x.status === "DRAFT",
  ))
    old.status = "SUPERSEDED";
  db.economicInterestVersions.push({
    id: randomUUID(),
    companyId,
    version:
      Math.max(
        0,
        ...db.economicInterestVersions
          .filter((x) => x.companyId === companyId)
          .map((x) => x.version),
      ) + 1,
    title: "Super Admin tomonidan belgilangan iqtisodiy manfaat",
    status: "DRAFT",
    allocations: [
      ...people.map((x) => ({
        id: randomUUID(),
        participantId: x.id,
        subject: x.name,
        kind: "PARTICIPANT" as const,
        shareBps: x.shareBps || 0,
      })),
      ...(used < 10000
        ? [
            {
              id: randomUUID(),
              subject: "Staffora Development Reserve",
              kind: "RESERVE" as const,
              shareBps: 10000 - used,
            },
          ]
        : []),
    ],
    createdAt: new Date().toISOString(),
    createdBy: actor,
  });
}
function safeParticipant(row: CorporateParticipant) {
  const { passwordHash: _password, ...safe } = row;
  return safe;
}
const asyncRoute =
  (
    handler: (req: AuthedRequest, res: Response) => Promise<unknown> | unknown,
  ) =>
  (req: AuthedRequest, res: Response, next: NextFunction) =>
    Promise.resolve(handler(req, res)).catch(next);
