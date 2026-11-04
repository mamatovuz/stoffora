import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { Database } from "../../lib/types";
import type { CorporateParticipant, CorporateRole } from "../../lib/corporate/types";
import type { AuthedRequest } from "../auth";
import { updateDb } from "../../lib/store";

export type CorporateRequest = AuthedRequest & { corporate?: CorporateParticipant };

export const CORPORATE_PERMISSIONS: Record<CorporateRole, string[]> = {
  FOUNDER: ["*"],
  CO_FOUNDER: ["dashboard.read", "participants.read", "ownership.read", "economic.read", "finance.read", "distributions.read", "wallet.self", "withdrawals.self", "reserve.read", "investments.read", "agreements.read", "agreements.accept", "approvals.decide", "reports.read", "audit.read"],
  CEO: ["dashboard.read", "participants.read", "finance.read", "transactions.create", "distributions.read", "wallet.self", "withdrawals.self", "reserve.read", "reserve.create", "investments.read", "agreements.read", "agreements.accept", "approvals.decide", "reports.read"],
  INVESTOR: ["dashboard.read", "ownership.self", "economic.self", "wallet.self", "withdrawals.self", "investments.self", "agreements.read", "agreements.accept", "reports.self"],
  FINANCE_MANAGER: ["dashboard.read", "finance.read", "transactions.create", "transactions.reverse", "distributions.manage", "withdrawals.read", "reserve.read", "reserve.create", "investments.read", "reports.read"],
  CORPORATE_ADMIN: ["dashboard.read", "participants.manage", "participants.read", "agreements.manage", "agreements.read", "reports.read", "notifications.manage"],
  OBSERVER: ["dashboard.read", "reports.read"],
};

export function corporateCan(participant: CorporateParticipant, permission: string) {
  const grants = CORPORATE_PERMISSIONS[participant.role] || [];
  return grants.includes("*") || grants.includes(permission) || grants.some((g) => g.endsWith(".*") && permission.startsWith(g.slice(0, -1)));
}

export function corporatePermission(permission: string) {
  return (req: CorporateRequest, res: Response, next: NextFunction) =>
    req.corporate && corporateCan(req.corporate, permission) ? next() : res.status(403).json({ code: "CORPORATE_FORBIDDEN", message: "Bu korporativ amal uchun ruxsat yetarli emas." });
}

export function tenantOf(req: CorporateRequest) {
  if (!req.session?.companyId) throw Object.assign(new Error("Kompaniya tanlanmagan."), { status: 400 });
  return req.session.companyId;
}

export function corporateAudit(db: Database, req: CorporateRequest, input: { module: string; action: string; entityType: string; entityId: string; summary: string; approvalId?: string; result?: "SUCCESS" | "DENIED" | "FAILED" }) {
  db.corporateAuditEntries.unshift({
    id: randomUUID(),
    companyId: tenantOf(req),
    participantId: req.corporate?.id,
    actorUserId: req.session!.userId,
    actorName: req.session!.name,
    module: input.module,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    summary: input.summary,
    approvalId: input.approvalId,
    result: input.result || "SUCCESS",
    createdAt: new Date().toISOString(),
  });
  if (db.corporateAuditEntries.length > 20_000) db.corporateAuditEntries.length = 20_000;
}

/** Alohida Corporate login sessiyasini tenant va korporativ rol bilan bog‘laydi. */
export async function corporateContext(req: CorporateRequest, res: Response, next: NextFunction) {
  try {
    const tenant = req.session?.companyId;
    if (!tenant || req.session?.role === "SUPER_ADMIN") return res.status(403).json({ message: "Corporate portal kompaniya hisobiga bog‘langan." });
    let participant: CorporateParticipant | undefined;
    await updateDb((db) => {
      participant = db.corporateParticipants.find((p) => p.companyId === tenant && (p.id === req.session!.userId || p.userId === req.session!.userId) && p.status === "ACTIVE");
      if (participant) participant.lastActiveAt = new Date().toISOString();
    });
    if (!participant) return res.status(403).json({ code: "NOT_CORPORATE_PARTICIPANT", message: "Siz Corporate portal ishtirokchisi emassiz." });
    req.corporate = participant;
    next();
  } catch (error) { next(error); }
}

export const asyncCorporate = (handler: (req: CorporateRequest, res: Response) => Promise<unknown> | unknown) => (req: CorporateRequest, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next);

export function integerMinor(value: unknown, label = "Summa") {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw Object.assign(new Error(`${label} musbat butun minor unit bo‘lishi kerak.`), { status: 422 });
  return amount;
}
