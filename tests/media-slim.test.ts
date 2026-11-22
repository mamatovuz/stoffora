import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Request, Response } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Employee } from "../lib/types";

/*
 * Rasmlar JSON’da base64 bo‘lib ketmasin — hatto javob obyektida `employeeNo`/`role` bo‘lmasa ham
 * (ma’lumotnoma, /trends, mukofotlar…). Ilgari bunday javoblar 300 xodimda ~12 MB edi.
 */
const dir = mkdtempSync(path.join(tmpdir(), "staffora-media-"));
process.env.SQLITE_PATH = path.join(dir, "test.sqlite");
const photo = `data:image/jpeg;base64,${Buffer.alloc(3000, 7).toString("base64")}`;
const userPhoto = `data:image/jpeg;base64,${Buffer.alloc(3000, 9).toString("base64")}`;

let slimPhotos: typeof import("../server/media").slimPhotos;
beforeAll(async () => {
  const store = await import("../lib/store");
  await store.updateDb((db) => {
    db.employees.push({ id: "e1", companyId: "c1", employeeNo: "1", firstName: "A", lastName: "B", photoDataUrl: photo } as Employee);
    db.users.push({ id: "u1", companyId: "c1", name: "U", email: "u@x.uz", passwordHash: "", role: "HR_ADMIN", photoDataUrl: userPhoto });
  });
  ({ slimPhotos } = await import("../server/media"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function send(body: unknown) {
  let out: unknown;
  const res = { json: (value: unknown) => (out = value) } as unknown as Response;
  slimPhotos({} as Request, res, () => undefined);
  res.json(body);
  return out as Record<string, unknown>;
}

describe("slimPhotos", () => {
  it("yig‘ma obyektdagi xodim va panel foydalanuvchisi rasmi URL’ga almashadi", () => {
    const out = send({
      rows: [{ id: "e1", name: "A B", photoDataUrl: photo }],
      award: { id: "award-1", employeeName: "A B", photoDataUrl: photo },
      inbox: [{ id: "req-1", photoDataUrl: userPhoto }],
    }) as { rows: { photoDataUrl: string }[]; award: { photoDataUrl: string }; inbox: { photoDataUrl: string }[] };
    expect(out.rows[0].photoDataUrl).toMatch(/^\/api\/media\/employee\/e1\.jpg\?v=/);
    // Obyekt ID si boshqa (mukofot ID si) — egasi rasmning o‘zi bo‘yicha topiladi.
    expect(out.award.photoDataUrl).toMatch(/^\/api\/media\/employee\/e1\.jpg\?v=/);
    expect(out.inbox[0].photoDataUrl).toMatch(/^\/api\/media\/user\/u1\.jpg\?v=/);
  });
  it("boshqa nomdagi maydon (tabel: employee.photo) ham URL’ga almashadi, selfi esa yo‘q", () => {
    const selfie = `data:image/jpeg;base64,${Buffer.alloc(600, 3).toString("base64")}`;
    const out = send({ rows: [{ employee: { id: "e1", name: "A B", photo } }], marks: [{ photo: selfie }] }) as {
      rows: { employee: { photo: string } }[];
      marks: { photo: string }[];
    };
    expect(out.rows[0].employee.photo).toMatch(/^\/api\/media\/employee\/e1\.jpg\?v=/);
    expect(out.marks[0].photo).toBe(selfie);
  });
  it("bazada yo‘q rasm o‘zgarmaydi", () => {
    const other = `data:image/jpeg;base64,${Buffer.alloc(30, 1).toString("base64")}`;
    expect(send({ id: "x", photoDataUrl: other }).photoDataUrl).toBe(other);
  });
});
