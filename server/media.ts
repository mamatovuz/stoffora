import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { readDb } from "../lib/store";

/*
 * Rasmlar (xodim va panel foydalanuvchisi) JSON javoblarida base64 ko‘rinishida
 * yuborilmaydi — o‘rniga imzolangan va versiyalangan URL beriladi:
 *   /api/media/employee/<id>.jpg?v=<versiya>&s=<imzo>
 * Brauzer rasmni bir marta yuklab, uzoq muddat keshlaydi. Imzo URL’ni taxmin
 * qilishni imkonsiz qiladi, shuning uchun <img> cookie/tokensiz ham ishlaydi
 * (Telegram Mini App ichida ham).
 */

const secret = () =>
  process.env.SESSION_SECRET || "staffora-local-session-secret-change-me";
type Kind = "employee" | "user";

const versionCache = new Map<string, { photo: string; version: string }>();
function photoVersion(key: string, photo: string) {
  const cached = versionCache.get(key);
  if (cached && cached.photo === photo) return cached.version;
  const version = createHash("sha1").update(photo).digest("hex").slice(0, 12);
  versionCache.set(key, { photo, version });
  return version;
}
const sign = (kind: Kind, id: string, version: string) =>
  createHmac("sha256", secret()).update(`${kind}:${id}:${version}`).digest("hex").slice(0, 24);

export function mediaUrl(kind: Kind, id: string, photo: string) {
  const version = photoVersion(`${kind}:${id}`, photo);
  return `/api/media/${kind}/${id}.jpg?v=${version}&s=${sign(kind, id, version)}`;
}

/** Javobdagi obyektlarni aylanib, base64 rasmlarni URL bilan almashtiradi (asl obyektlar o‘zgarmaydi). */
function transform(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    let copy: unknown[] | undefined;
    for (let i = 0; i < value.length; i += 1) {
      const next = transform(value[i], depth + 1);
      if (next !== value[i]) {
        copy ||= value.slice();
        copy[i] = next;
      }
    }
    return copy || value;
  }
  const source = value as Record<string, unknown>;
  let copy: Record<string, unknown> | undefined;
  for (const key of Object.keys(source)) {
    const field = source[key];
    let next = field;
    if (key === "photoDataUrl" && typeof field === "string" && field.startsWith("data:image")) {
      const id = (source.id ?? source.userId) as string | undefined;
      const kind: Kind | undefined =
        typeof source.employeeNo === "string" ? "employee" : "role" in source ? "user" : undefined;
      if (id && kind) next = mediaUrl(kind, id, field);
    } else if (field && typeof field === "object") next = transform(field, depth + 1);
    if (next !== field) {
      copy ||= { ...source };
      copy[key] = next;
    }
  }
  return copy || value;
}

/** Barcha /api javoblarida rasmlarni URL’ga almashtiradigan middleware. */
export function slimPhotos(_req: Request, res: Response, next: NextFunction) {
  const json = res.json.bind(res);
  res.json = (body: unknown) => json(transform(body));
  next();
}

const decoded = new Map<string, { version: string; type: string; buffer: Buffer }>();
export async function serveMedia(req: Request, res: Response) {
  const kind = req.params.kind as Kind;
  const id = String(req.params.file || "").replace(/\.jpg$/, "");
  const version = String(req.query.v || "");
  const signature = String(req.query.s || "");
  if ((kind !== "employee" && kind !== "user") || !id || !version || signature.length !== 24)
    return res.status(404).end();
  const expected = Buffer.from(sign(kind, id, version));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received))
    return res.status(403).end();

  const db = await readDb();
  const owner = kind === "employee" ? db.employees.find((e) => e.id === id) : db.users.find((u) => u.id === id);
  const photo = owner?.photoDataUrl;
  if (!photo) return res.status(404).end();
  const key = `${kind}:${id}`;
  let entry = decoded.get(key);
  const current = photoVersion(key, photo);
  if (!entry || entry.version !== current) {
    const match = /^data:(image\/[a-z+]+);base64,(.*)$/s.exec(photo);
    if (!match) return res.status(404).end();
    entry = { version: current, type: match[1], buffer: Buffer.from(match[2], "base64") };
    decoded.set(key, entry);
    if (decoded.size > 5000) decoded.delete(decoded.keys().next().value as string);
  }
  res.setHeader("Content-Type", entry.type);
  // Versiya URL’da — o‘zgarsa URL ham o‘zgaradi, shuning uchun uzoq kesh xavfsiz.
  res.setHeader(
    "Cache-Control",
    current === version ? "public, max-age=31536000, immutable" : "private, max-age=60",
  );
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  return res.end(entry.buffer);
}
