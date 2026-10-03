import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { audit, documentFiles, readDb, updateDb } from "../lib/store";
import { can } from "../lib/permissions";
import type { DocumentType, EmployeeDocument } from "../lib/types";
import type { AuthedRequest, EmployeeSession } from "./auth";
import { auditDocumentAccess } from "./engage";

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

/** Fayllar joriy bazada (SQLite yoki PostgreSQL) — document_files jadvali. */
const files = () => documentFiles();

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
  await (await files()).putFile(doc.id, companyId, mime, buffer, doc.createdAt);
  await updateDb((db) => {
    db.documents.push(doc);
    db.auditLogs.unshift(audit(companyId, uploadedBy, `Hujjat yuklandi: ${doc.title}`, "employee", employeeId));
  });
  return doc;
}

/** O‘chirilgan xodim/hujjatlardan qolgan fayllarni tozalaydi. */
export async function cleanupDocumentFiles() {
  const db = await readDb();
  // Hali tasdiqlanmagan anketalardagi pasport rasmlari ham saqlanadi.
  const { opsPhotoIds } = await import("./ops");
  const { markPhotoIds } = await import("./history");
  const alive = new Set([...db.documents.map((d) => d.id), ...opsPhotoIds(db), ...markPhotoIds(db), ...db.registrations.flatMap((r) => [r.data.idDocument, r.data.selfie]).filter((id): id is string => Boolean(id))]);
  const conn = await files();
  let removed = 0;
  for (const id of await conn.fileIds())
    if (!alive.has(id)) {
      await conn.deleteFile(id);
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

  /** Muddati tugayotgan (30 kun) va o‘tgan hujjatlar — HR, direktor, filial rahbari (o‘z filiali). */
  router.get(
    "/documents/expiring",
    permit("employees.view"),
    route(async (req, res) => {
      const tenant = tenantOf(req);
      const db = await readDb();
      const scope = req.session!.role === "BRANCH_MANAGER" ? db.users.find((u) => u.id === req.session!.userId)?.branchIds || [] : null;
      const rows = db.documents
        .filter((d) => d.companyId === tenant && d.expiresAt)
        .map((d) => ({ d, status: documentStatus(d), employee: db.employees.find((e) => e.id === d.employeeId && e.status === "ACTIVE") }))
        .filter(({ status, employee }) => status !== "OK" && employee && (!scope || scope.includes(employee.branchId)))
        .sort((a, b) => (a.d.expiresAt || "").localeCompare(b.d.expiresAt || ""))
        .slice(0, 200)
        .map(({ d, status, employee }) => ({
          id: d.id,
          title: d.title,
          type: d.type,
          expiresAt: d.expiresAt,
          status,
          employeeId: employee!.id,
          employeeName: `${employee!.firstName} ${employee!.lastName}`.trim(),
          photoDataUrl: employee!.photoDataUrl,
          branchName: db.branches.find((b) => b.id === employee!.branchId)?.name || "",
        }));
      res.json(rows);
    }),
  );

  router.get(
    "/employees/:id/documents",
    permit("employees.view"),
    route(async (req, res) => {
      const tenant = tenantOf(req);
      const db = await readDb();
      // Filial rahbari — faqat o‘z filiali xodimlarining hujjatlari.
      const employee = db.employees.find((e) => e.id === req.params.id && e.companyId === tenant);
      const scope = req.session!.role === "BRANCH_MANAGER" ? db.users.find((u) => u.id === req.session!.userId)?.branchIds || [] : null;
      if (!employee || (scope && !scope.includes(employee.branchId))) throw httpError("Xodim topilmadi.", 404);
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
      const owner = doc && db.employees.find((e) => e.id === doc.employeeId);
      const scope = req.session!.role === "BRANCH_MANAGER" ? db.users.find((u) => u.id === req.session!.userId)?.branchIds || [] : null;
      if (!doc || (scope && !scope.includes(owner?.branchId || ""))) throw httpError("Hujjat topilmadi.", 404);
      const row = await (await files()).getFile(doc.id);
      if (!row) throw httpError("Fayl topilmadi.", 404);
      // Kim, qachon ko‘rdi — auditga (shaxsiy hujjatlarga kirish nazorati).
      await updateDb((next) => auditDocumentAccess(next, { companyId: tenant, actor: req.session!.name, documentId: doc.id, employeeId: doc.employeeId, title: doc.title, via: "panel" }));
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
      await (await files()).deleteFile(String(req.params.id));
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
  return (await files()).getFile(id);
}
