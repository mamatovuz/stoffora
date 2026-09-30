import { randomBytes } from "node:crypto";
import { audit, readDb, updateDb } from "../../lib/store";
import { countingStartDate } from "../../lib/counting";
import type { Database, Employee, Integration, TelegramInvite } from "../../lib/types";
import { telegramBotUsername } from "../telegram";
import { mappingByLocal, newId } from "./model";
import { enqueueOutbox, logIntegration, upsertDelivery } from "./sqlstore";
import { processOutbox } from "./worker";

/*
 * Xodimni Staffora'ga ulash.
 *
 * Har bir xodimga shaxsiy, tasodifiy, muddatli, bir martalik havola yaratiladi:
 *   https://t.me/<StafforaBot>?start=<kod>
 * Havola xodimlar boti (Gulnora HR bot) orqali POST /notifications bilan
 * yuboriladi. Xodim havolani bosadi → Staffora boti ochiladi → «START» →
 * /start <kod> → profil avtomatik ulanadi (server/telegram.ts).
 *
 * Qo‘shimcha: import qilingan xodimning Telegram ID si botdan kelgan bo‘lsa,
 * havolasiz /start ham uni tanib ulaydi (Telegram from.id — soxtalashtirib bo‘lmaydi).
 */

export function inviteCode() {
  // 24 bayt → 32 belgili base64url; Telegram start parametri chegarasi 64 belgi.
  return randomBytes(24).toString("base64url");
}

export function inviteLink(code: string) {
  const username = telegramBotUsername();
  return username ? `https://t.me/${username}?start=${code}` : undefined;
}

/** Xodim uchun yangi taklif yaratadi, eski ishlatilmaganlarini bekor qiladi. */
export function issueInvite(
  db: Database,
  employee: Employee,
  options: { ttlHours: number; by: string; channel: "MANUAL" | "BOT" },
): TelegramInvite {
  const now = new Date().toISOString();
  for (const invite of db.telegramInvites)
    if (invite.employeeId === employee.id && invite.companyId === employee.companyId && !invite.usedAt && !invite.revokedAt)
      invite.revokedAt = now;
  const invite: TelegramInvite = {
    id: newId(),
    companyId: employee.companyId,
    employeeId: employee.id,
    code: inviteCode(),
    expiresAt: new Date(Date.now() + options.ttlHours * 3600_000).toISOString(),
    oneTime: true,
    createdBy: options.by,
    channel: options.channel,
  };
  // Juda eski yozuvlarni tozalaymiz.
  const cutoff = Date.now() - 30 * 86_400_000;
  db.telegramInvites = db.telegramInvites.filter((item) => new Date(item.expiresAt).getTime() > cutoff);
  db.telegramInvites.push(invite);
  return invite;
}

export function revokeInvites(db: Database, companyId: string, employeeId: string) {
  const now = new Date().toISOString();
  let count = 0;
  for (const invite of db.telegramInvites)
    if (invite.companyId === companyId && invite.employeeId === employeeId && !invite.usedAt && !invite.revokedAt) {
      invite.revokedAt = now;
      count += 1;
    }
  return count;
}

const ddmmyyyy = (value: string) => value.split("-").reverse().join(".");

export function accessMessage(companyName: string, employee: Employee, link: string, ttlHours: number, practiceUntil?: string) {
  const ttl = ttlHours % 24 === 0 ? `${ttlHours / 24} kun` : `${ttlHours} soat`;
  return [
    `Assalomu alaykum, ${employee.firstName}!`,
    "",
    `${companyName} keldi-ketdini endi Staffora ilovasi orqali qayd etadi.`,
    "",
    `👉 Staffora'ga kirish: ${link}`,
    "",
    "Havolani bosing — Staffora boti ochiladi. «START» tugmasini bosing, profilingiz avtomatik ulanadi.",
    practiceUntil
      ? `\n🧪 ${ddmmyyyy(practiceUntil)} gacha mashq davri: bemalol sinab ko‘ring, kechikish va ushlanmalar hisoblanmaydi.`
      : "",
    `🔒 Havola faqat siz uchun, ${ttl} amal qiladi. Uni hech kimga bermang.`,
  ]
    .filter((line, index, all) => !(line === "" && all[index - 1] === ""))
    .join("\n");
}

export type AccessCandidate = {
  employee: Employee;
  remoteId?: number;
  reason?: string;
};

/** Kimga yuborish mumkinligini tekshiradi. */
export function accessCandidates(db: Database, integration: Integration, employeeIds: string[] | "ALL", onlyNotConnected: boolean) {
  const rows = db.employees.filter(
    (e) => e.companyId === integration.companyId && e.status === "ACTIVE" && (employeeIds === "ALL" || employeeIds.includes(e.id)),
  );
  return rows.map<AccessCandidate>((employee) => {
    const mapping = mappingByLocal(db, integration.id, "employee", employee.id);
    if (!mapping) return { employee, reason: "Xodim botda topilmadi (bog‘lanmagan)" };
    if (onlyNotConnected && employee.telegramConnected) return { employee, reason: "Allaqachon ulangan" };
    return { employee, remoteId: Number(mapping.externalId) };
  });
}

/**
 * Tanlangan xodimlarga havolani bot orqali yuboradi (fon ishi, progress bilan).
 * Har bir xabar navbat (outbox) orqali ketadi: Idempotency-Key, retry, 429.
 */
export async function runAccessSendJob(jobId: string, employeeIds: string[] | "ALL", onlyNotConnected: boolean) {
  const db0 = await readDb();
  const job = db0.syncJobs.find((j) => j.id === jobId);
  const integration = job ? db0.integrations.find((i) => i.id === job.integrationId && i.companyId === job.companyId) : undefined;
  if (!job || !integration) return;
  if (!telegramBotUsername()) {
    await updateDb((db) => {
      const j = db.syncJobs.find((x) => x.id === jobId);
      if (j) {
        j.status = "FAILED";
        j.errors = [{ entity: "access", message: "Staffora Telegram boti ishga tushmagan — havola yaratib bo‘lmaydi." }];
        j.finishedAt = new Date().toISOString();
      }
    });
    return;
  }
  const candidates = accessCandidates(db0, integration, employeeIds, onlyNotConnected);
  const counter = { total: candidates.length, created: 0, updated: 0, linked: 0, skipped: 0, failed: 0 };
  const errors: { entity: string; externalId?: string; message: string }[] = [];
  await updateDb((db) => {
    const j = db.syncJobs.find((x) => x.id === jobId);
    if (j) {
      j.status = "RUNNING";
      j.startedAt = new Date().toISOString();
      j.phase = "Havolalar yuborilmoqda";
      j.counters = { access: { ...counter } };
    }
  });
  const company = db0.companies.find((c) => c.id === integration.companyId);
  let index = 0;
  for (const candidate of candidates) {
    index += 1;
    const deliveryId = newId();
    if (!candidate.remoteId) {
      counter.skipped += 1;
      await upsertDelivery({
        id: deliveryId,
        companyId: integration.companyId,
        integrationId: integration.id,
        kind: "ACCESS",
        refId: jobId,
        employeeId: candidate.employee.id,
        channel: "bot",
        status: "SKIPPED",
        error: candidate.reason,
      });
      if (errors.length < 200) errors.push({ entity: "access", externalId: candidate.employee.employeeNo, message: `${candidate.employee.firstName} ${candidate.employee.lastName}: ${candidate.reason}` });
    } else {
      const invite = await updateDb((db) => {
        const employee = db.employees.find((e) => e.id === candidate.employee.id && e.companyId === integration.companyId);
        if (!employee) return undefined;
        const value = issueInvite(db, employee, { ttlHours: integration.settings.inviteTtlHours, by: job.createdBy, channel: "BOT" });
        value.sentAt = new Date().toISOString();
        db.auditLogs.unshift(audit(integration.companyId, job.createdBy, "Staffora'ga kirish havolasi bot orqali yuborildi", "employee", employee.id));
        return value;
      });
      const link = invite ? inviteLink(invite.code) : undefined;
      if (!invite || !link) {
        counter.failed += 1;
        continue;
      }
      const practice = countingStartDate(company, candidate.employee);
      const message = accessMessage(company?.name || "Kompaniya", candidate.employee, link, integration.settings.inviteTtlHours, practice && practice > new Date().toISOString().slice(0, 10) ? practice : undefined);
      await upsertDelivery({
        id: deliveryId,
        companyId: integration.companyId,
        integrationId: integration.id,
        kind: "ACCESS",
        refId: jobId,
        employeeId: candidate.employee.id,
        channel: "bot",
        status: "QUEUED",
      });
      await enqueueOutbox(
        integration,
        "notification.send",
        {
          deliveryId,
          kind: "ACCESS",
          refId: jobId,
          employeeId: candidate.employee.id,
          body: {
            employee_id: candidate.remoteId,
            title: "Staffora'ga ulaning",
            message,
            type: "staffora_access",
            source: "staffora",
          },
        },
        `access:${invite.id}`,
      );
      counter.created += 1;
      // Botning limiti (daqiqasiga 120) uchun navbatni darhol, lekin bosqichma-bosqich bo‘shatamiz.
      if (index % 5 === 0) await processOutbox(10).catch(() => undefined);
    }
    if (index % 10 === 0 || index === candidates.length)
      await updateDb((db) => {
        const j = db.syncJobs.find((x) => x.id === jobId);
        if (j) {
          j.counters = { access: { ...counter } };
          j.progress = Math.round((index / Math.max(1, candidates.length)) * 100);
        }
      });
  }
  await processOutbox(25).catch(() => undefined);
  await updateDb((db) => {
    const j = db.syncJobs.find((x) => x.id === jobId);
    if (j) {
      j.status = counter.failed ? "PARTIAL" : "DONE";
      j.progress = 100;
      j.phase = "Navbatga qo‘yildi — yetkazish holati avtomatik yangilanadi";
      j.counters = { access: { ...counter } };
      j.errors = errors;
      j.finishedAt = new Date().toISOString();
    }
  });
  await logIntegration(integration, "info", "access.send", `Kirish havolalari: ${counter.created} ta yuborildi, ${counter.skipped} ta o‘tkazib yuborildi`, counter);
}
