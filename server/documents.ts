import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type BetterSqlite3 from "better-sqlite3";
import { audit, readDb, sqliteConnection, updateDb } from "../lib/store";
import { can } from "../lib/permissions";
import type { DocumentType, EmployeeDocument } from "../lib/types";
import type { AuthedRequest, EmployeeSession } from "./auth";

/*
 * Xodim hujjatlari (pasport, diplom, tibbiy ma’lumotnoma, sanitariya daftarchasi…).
 * Fayllar alohida SQLite jadvalida — asosiy holatni og‘irlashtirmaydi.
 * Muddati bo‘lgan hujjatlar uchun eslatmalar hr-worker.ts da.
 */

export const DOCUMENT_TYPES: Record<DocumentType, string> = {
  PASSPORT: "Pasport / ID karta",
  DIPLOMA: "Diplom",
  MEDICAL: "Tibbiy ma’lumotnoma",
  SANITARY: "Sanitariya daftarchasi",
  CONTRACT: "Mehnat shartnomasi",
  OTHER: "Boshqa hujjat",
};

const MAX_BYTES = 1_400_000;
const ALLOWED = /^data:(image\/(jpeg|png|webp)|application\/pdf);base64,/;

let ready: BetterSqlite3.Database | undefined;
async function files() {
  if (ready) return ready;
  const db = await sqliteConnection();
  db.exec(`CREATE TABLE IF NOT EXISTS document_files (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    mime TEXT NOT NULL,
    data BLOB NOT NULL,
    created_at TEXT NOT NULL
  )`);
  ready = db;
  return db;
}

function parseDataUrl(dataUrl: string) {
  const match = /^data:([\w/.+-]+);base64,(.+)$/s.exec(dataUrl);
  if (!match || !ALLOWED.test(dataUrl)) throw Object.assign(new Error("Faqat JPG, PNG, WEBP rasm yoki PDF fayl yuklash mumkin."), { status: 400 });
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > MAX_BYTES) throw Object.assign(new Error("Fayl juda katta — 1,4 MB gacha bo‘lsin (rasmni kichraytiring)."), { status: 413 });
  return { mime: match[1], buffer };
}

export const documentInputSchema = z.object({
  type: z.enum(["PASSPORT", "DIPLOMA", "MEDICAL", "SANITARY", "CONTRACT", "OTHER"]),
  title: z.string().trim().max(120).optional(),
  expiresAt: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).optional(),
  dataUrl: z.string().min(30).max(2_000_000),
});

export async function saveDocument(companyId: string, employeeId: string, input: z.infer<typeof documentInputSchema>, uploadedBy: string) {
  const { mime, buffer } = parseDataUrl(input.dataUrl);
  const doc: EmployeeDocument = {
    id: randomUUID(),
    companyId,
    employeeId,
    type: input.type,
    title: input.title || DOCUMENT_TYPES[input.type],
    mime,
    size: buffer.length,
    expiresAt: input.expiresAt || undefined,
    uploadedBy,
    createdAt: new Date().toISOString(),
  };
  (await files()).prepare("INSERT INTO document_files (id, company_id, mime, data, created_at) VALUES (?,?,?,?,?)").run(doc.id, companyId, mime, buffer, doc.createdAt);
  await updateDb((db) => {
    db.documents.push(doc);
    db.auditLogs.unshift(audit(companyId, uploadedBy, `Hujjat yuklandi: ${doc.title}`, "employee", employeeId));
  });
  return doc;
}

/** O‘chirilgan xodim/hujjatlardan qolgan fayllarni tozalaydi. */
export async function cleanupDocumentFiles() {
  const db = await readDb();
  const alive = new Set(db.documents.map((d) => d.id));
  const conn = await files();
  const rows = conn.prepare("SELECT id FROM document_files").all() as { id: string }[];
  const del = conn.prepare("DELETE FROM document_files WHERE id = ?");
  let removed = 0;
  for (const row of rows)
    if (!alive.has(row.id)) {
      del.run(row.id);
      removed += 1;
    }
  return removed;
}

export const documentStatus = (doc: Pick<EmployeeDocument, "expiresAt">, today = new Date().toISOString().slice(0, 10)) => {
  if (!doc.expiresAt) return "OK" as const;
  if (doc.expiresAt < today) return "EXPIRED" as const;
  const days = (Date.parse(doc.expiresAt) - Date.parse(today)) / 86_400_000;
  return days <= 30 ? ("SOON" as const) : ("OK" as const);
};

type Handler = (req: AuthedRequest, res: Response) => Promise<unknown>;
const route = (handler: Handler) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(handler(req as AuthedRequest, res)).catch(next);
const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });

/** Panel: xodim hujjatlari. */
export function createDocumentRouter() {
  const router = Router();
  const permit = (permission: string) => (req: Request, res: Response, next: NextFunction) =>
    can((req as AuthedRequest).session!.role, permission) ? next() : res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });
  const tenantOf = (req: AuthedRequest) => {
    if (!req.session?.companyId) throw httpError("Kompaniya tanlanmagan.", 403);
    return req.session.companyId;
  };

  router.get(
    "/employees/:id/documents",
    permit("employees.view"),
    route(async (req, res) => {
      const tenant = tenantOf(req);
      const db = await readDb();
      const docs = db.documents
        .filter((d) => d.companyId === tenant && d.employeeId === req.params.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((d) => ({ ...d, status: documentStatus(d) }));
      res.json(docs);
    }),
  );

  router.post(
    "/employees/:id/documents",
    permit("employees.edit"),
    route(async (req, res) => {
      const tenant = tenantOf(req);
      const input = documentInputSchema.parse(req.body);
      const db = await readDb();
      if (!db.employees.some((e) => e.id === req.params.id && e.companyId === tenant)) throw httpError("Xodim topilmadi.", 404);
      res.status(201).json(await saveDocument(tenant, String(req.params.id), input, req.session!.name));
    }),
  );

  router.get(
    "/documents/:id/file",
    permit("employees.view"),
    route(async (req, res) => {
      const tenant = tenantOf(req);
      const db = await readDb();
      const doc = db.documents.find((d) => d.id === req.params.id && d.companyId === tenant);
      if (!doc) throw httpError("Hujjat topilmadi.", 404);
      const row = (await files()).prepare("SELECT mime, data FROM document_files WHERE id = ?").get(doc.id) as { mime: string; data: Buffer } | undefined;
      if (!row) throw httpError("Fayl topilmadi.", 404);
      res.setHeader("Content-Type", row.mime);
      res.setHeader("Cache-Control", "private, max-age=300");
      res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(doc.title)}${row.mime === "application/pdf" ? ".pdf" : ".jpg"}"`);
      res.send(row.data);
    }),
  );

  router.delete(
    "/documents/:id",
    permit("employees.edit"),
    route(async (req, res) => {
      const tenant = tenantOf(req);
      await updateDb((db) => {
        const doc = db.documents.find((d) => d.id === req.params.id && d.companyId === tenant);
        if (!doc) throw httpError("Hujjat topilmadi.", 404);
        db.documents = db.documents.filter((d) => d.id !== doc.id);
        db.auditLogs.unshift(audit(tenant, req.session!.name, `Hujjat o‘chirildi: ${doc.title}`, "employee", doc.employeeId));
      });
      (await files()).prepare("DELETE FROM document_files WHERE id = ?").run(String(req.params.id));
      res.json({ ok: true });
    }),
  );

  return router;
}

/** Mini App: xodim o‘z hujjatlarini ko‘radi va yuklaydi. */
export function createMiniDocumentRouter() {
  const router = Router();
  const session = (req: Request) => (req as unknown as { employeeSession?: EmployeeSession }).employeeSession!;
  router.get(
    "/mini/documents",
    route(async (req, res) => {
      const auth = session(req);
      const db = await readDb();
      res.json(
        db.documents
          .filter((d) => d.companyId === auth.companyId && d.employeeId === auth.employeeId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((d) => ({ id: d.id, type: d.type, title: d.title, expiresAt: d.expiresAt, createdAt: d.createdAt, status: documentStatus(d) })),
      );
    }),
  );
  router.post(
    "/mini/documents",
    rateLimit({ windowMs: 60_000, limit: 10, keyGenerator: (req) => `doc:${session(req)?.employeeId || req.ip}` }),
    route(async (req, res) => {
      const auth = session(req);
      const input = documentInputSchema.parse(req.body);
      const db = await readDb();
      const employee = db.employees.find((e) => e.id === auth.employeeId && e.companyId === auth.companyId && e.status === "ACTIVE");
      if (!employee) throw httpError("Xodim topilmadi.", 404);
      const doc = await saveDocument(auth.companyId, employee.id, input, `${employee.firstName} ${employee.lastName} (Mini App)`);
      await updateDb((next) =>
        void next.notifications.unshift({
          id: randomUUID(),
          companyId: auth.companyId,
          title: "Yangi hujjat",
          body: `${employee.firstName} ${employee.lastName} «${doc.title}» yukladi.`,
          type: "DOCUMENT",
          read: false,
          createdAt: doc.createdAt,
        }),
      );
      res.status(201).json({ id: doc.id, title: doc.title, status: documentStatus(doc) });
    }),
  );
  return router;
}

/** Hujjat fayli (Mini App’dan yuklab olish uchun). */
export async function readDocumentFile(id: string) {
  return (await files()).prepare("SELECT mime, data FROM document_files WHERE id = ?").get(id) as { mime: string; data: Buffer } | undefined;
}
