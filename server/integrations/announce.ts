import { readDb, updateDb } from "../../lib/store";
import type { AnnouncementTarget, Database, Employee } from "../../lib/types";
import { BotApiError } from "./client";
import { activeIntegration, clientFor, mappingByLocal, SOURCE_KEY } from "./model";
import { logIntegration } from "./sqlstore";

/*
 * E’lonlar: kanallar (Staffora, Staffora Telegram boti, Xodimlar boti) va
 * auditoriya (hamma / filiallar / bo‘limlar / lavozimlar / aniq xodimlar).
 */

/** Auditoriya bo‘yicha Staffora xodimlari. */
export function targetEmployees(db: Database, companyId: string, target: AnnouncementTarget): Employee[] {
  const ids = new Set(target.ids);
  return db.employees.filter((e) => {
    if (e.companyId !== companyId || e.status !== "ACTIVE") return false;
    if (target.type === "ALL") return true;
    if (target.type === "BRANCHES") return ids.has(e.branchId);
    if (target.type === "DEPARTMENTS") return ids.has(e.departmentId);
    if (target.type === "POSITIONS") return ids.has(e.positionId);
    return ids.has(e.id);
  });
}

export function targetLabel(db: Database, companyId: string, target: AnnouncementTarget) {
  if (target.type === "ALL") return "Barcha xodimlar";
  const names = (rows: { id: string; companyId: string; name?: string; firstName?: string; lastName?: string }[]) =>
    rows
      .filter((r) => r.companyId === companyId && target.ids.includes(r.id))
      .map((r) => r.name || `${r.firstName} ${r.lastName}`)
      .slice(0, 4);
  const list =
    target.type === "BRANCHES"
      ? names(db.branches)
      : target.type === "DEPARTMENTS"
        ? names(db.departments)
        : target.type === "POSITIONS"
          ? names(db.positions)
          : names(db.employees);
  const more = target.ids.length > list.length ? ` va yana ${target.ids.length - list.length}` : "";
  const kind = { BRANCHES: "Filial", DEPARTMENTS: "Bo‘lim", POSITIONS: "Lavozim", EMPLOYEES: "Xodim" }[target.type];
  return `${kind}: ${list.join(", ")}${more}`;
}

/** Staffora auditoriyasini bot qabul qiluvchilariga o‘giradi (bog‘lanmaganlar sanab o‘tiladi). */
export function botRecipients(db: Database, integrationId: string, companyId: string, target: AnnouncementTarget) {
  if (target.type === "ALL") return { recipients: { send_to_all: true }, skipped: 0 };
  const entity = ({ BRANCHES: "branch", DEPARTMENTS: "department", POSITIONS: "position", EMPLOYEES: "employee" } as const)[target.type];
  const mapped: number[] = [];
  let skipped = 0;
  for (const id of target.ids) {
    const m = mappingByLocal(db, integrationId, entity, id);
    if (m) mapped.push(Number(m.externalId));
    else skipped += 1;
  }
  // Filial/bo‘lim/lavozim bot'da bo‘lmasa — o‘sha auditoriyadagi bog‘langan xodimlarga to‘g‘ridan-to‘g‘ri.
  if (entity !== "employee" && skipped) {
    const employees = targetEmployees(db, companyId, target)
      .map((e) => mappingByLocal(db, integrationId, "employee", e.id))
      .filter(Boolean)
      .map((m) => Number(m!.externalId));
    return { recipients: { employee_ids: [...new Set(employees)] }, skipped };
  }
  const key = { branch: "branch_ids", department: "department_ids", position: "position_ids", employee: "employee_ids" }[entity];
  return { recipients: { [key]: mapped }, skipped };
}

/** E’lonni xodimlar boti orqali yuboradi va hisobotni yangilaydi. */
export async function enqueueAnnouncementToBot(announcementId: string) {
  const db = await readDb();
  const announcement = db.announcements.find((a) => a.id === announcementId);
  if (!announcement) return;
  const integration = activeIntegration(db, announcement.companyId);
  const target = announcement.target || { type: "ALL", ids: [] };
  if (!integration) {
    await updateDb((next) => {
      const row = next.announcements.find((a) => a.id === announcementId);
      if (row) row.report = { ...(row.report || {}), bot: { integrationId: "", status: "FAILED", recipients: 0, sent: 0, failed: 0, acknowledged: 0, skipped: 0, error: "Xodimlar boti ulanmagan" } };
    });
    return;
  }
  const { recipients, skipped } = botRecipients(db, integration.id, integration.companyId, target);
  const empty = "employee_ids" in recipients && !(recipients.employee_ids as number[]).length;
  try {
    if (empty) throw new BotApiError("Bot'da mos qabul qiluvchi yo‘q (xodimlar bog‘lanmagan).", 422, "no_recipients");
    const { data } = await clientFor(integration).request<{ id: number; status: string; stats?: { recipients: number; sent: number; failed: number; acknowledged: number } }>(
      "POST",
      "/announcements",
      {
        body: { title: announcement.title.slice(0, 200), message: announcement.message.slice(0, 3500), recipients, require_ack: false, source: SOURCE_KEY },
        idempotencyKey: `announcement:${announcement.id}`,
      },
    );
    await updateDb((next) => {
      const row = next.announcements.find((a) => a.id === announcementId);
      if (row)
        row.report = {
          ...(row.report || {}),
          bot: {
            integrationId: integration.id,
            externalId: String(data.id),
            status: "QUEUED",
            recipients: data.stats?.recipients || 0,
            sent: data.stats?.sent || 0,
            failed: data.stats?.failed || 0,
            acknowledged: data.stats?.acknowledged || 0,
            skipped,
            checkedAt: new Date().toISOString(),
          },
        };
    });
    await logIntegration(integration, "info", "announcement", `E’lon bot'ga yuborildi: «${announcement.title}»`, { remoteId: data.id, skipped });
  } catch (error) {
    const message = (error as Error).message;
    await updateDb((next) => {
      const row = next.announcements.find((a) => a.id === announcementId);
      if (row)
        row.report = { ...(row.report || {}), bot: { integrationId: integration.id, status: "FAILED", recipients: 0, sent: 0, failed: 0, acknowledged: 0, skipped, error: message } };
    });
    await logIntegration(integration, "error", "announcement", `E’lon bot'ga yuborilmadi: ${message}`);
  }
}
