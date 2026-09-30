import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { Role } from "../lib/types";

export interface Session {
  userId: string;
  companyId?: string;
  name: string;
  email: string;
  role: Role;
  photoDataUrl?: string;
}
export interface EmployeeSession {
  employeeId: string;
  companyId: string;
  telegramId: string;
  kind: "employee";
}
export interface AuthedRequest extends Request {
  session?: Session;
}
const secret =
  process.env.SESSION_SECRET || "staffora-local-session-secret-change-me";
const employeeSecret = process.env.JWT_SECRET || `${secret}-employee`;

export function signSession(session: Session) {
  return jwt.sign(session, secret, { expiresIn: "8h", issuer: "staffora" });
}
export function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  const token = req.cookies?.staffora_session;
  if (!token)
    return res
      .status(401)
      .json({ message: "Sessiya topilmadi. Qayta kiring." });
  try {
    req.session = jwt.verify(token, secret, { issuer: "staffora" }) as Session;
    next();
  } catch {
    return res
      .status(401)
      .json({ message: "Sessiya muddati tugagan. Qayta kiring." });
  }
}
export function requireRole(...roles: Role[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) =>
    roles.includes(req.session!.role)
      ? next()
      : res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });
}
export function signEmployeeSession(session: EmployeeSession) {
  return jwt.sign(session, employeeSecret, {
    expiresIn: "24h",
    issuer: "staffora-mini-app",
  });
}
export function requireEmployee(
  req: AuthedRequest & { employeeSession?: EmployeeSession },
  res: Response,
  next: NextFunction,
) {
  const bearer = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : undefined;
  const token = bearer || req.cookies?.staffora_employee_session;
  if (!token)
    return res.status(401).json({
      message: "Telegram sessiyasi topilmadi. Mini App’ni bot orqali oching.",
    });
  try {
    req.employeeSession = jwt.verify(token, employeeSecret, {
      issuer: "staffora-mini-app",
    }) as EmployeeSession;
    next();
  } catch {
    return res.status(401).json({
      message: "Telegram sessiyasi tugagan. Mini App’ni qayta oching.",
    });
  }
}
