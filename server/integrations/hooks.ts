import { readDb } from "../../lib/store";
import type { Attendance, Database, Employee } from "../../lib/types";
import { sendTelegramMessage } from "../telegram";
import { activeIntegration, mappingByLocal, newId, SOURCE_KEY } from "./model";
import { enqueueOutbox, logIntegration, upsertDelivery } from "./sqlstore";
import { tashkentToIso } from "./transform";

/*
 * Staffora ichidagi hodisalardan integratsiyaga ulanish nuqtalari.
 * Hammasi "yubor va unut": xato bo‘lsa Staffora amali buzilmaydi,
 * faqat navbat qayta urinadi va jurnalga yoziladi.
 */

/** Mini App'da qayd etilgan keldi-ketdini xodimlar botiga yuborish uchun navbatga qo‘yadi. */
export function onStafforaAttendance(companyId: string, attendance: Attendance, action: "CHECK_IN" | "CHECK_OUT") {
  void (async () => {
    const db = await readDb();
    const integration = activeIntegration(db, companyId);
    if (!integration || !integration.settings.pushAttendance) return;
    if (!["EXPORT", "TWO_WAY"].includes(integration.settings.syncModes.attendance)) return;
    const mapping = mappingByLocal(db, integration.id, "employee", attendance.employeeId);
    if (!mapping) return;
    const clock = action === "CHECK_IN" ? attendance.checkIn : attendance.checkOut;
    if (!clock) return;
    const branchMap = mappingByLocal(db, integration.id, "branch", attendance.branchId);
    const hasLocation = typeof attendance.latitude === "number" && typeof attendance.longitude === "number";
    await enqueueOutbox(
      integration,
      action === "CHECK_IN" ? "attendance.check_in" : "attendance.check_out",
      {
        attendanceId: attendance.id,
        body: {
          employee_id: Number(mapping.externalId),
          timestamp: tashkentToIso(attendance.date, clock),
          ...(branchMap && action === "CHECK_IN" ? { branch_id: Number(branchMap.externalId) } : {}),
          ...(hasLocation ? { location: { latitude: attendance.latitude, longitude: attendance.longitude } } : {}),
          verification_method: attendance.verification.includes("FACE") ? "face" : "gps",
          device: "Staffora Mini App",
          source: SOURCE_KEY,
          // Staffora GPS ni o‘zi tekshirgan — botda qayta rad etilmasin.
          enforce_geofence: false,
          ...(action === "CHECK_IN" ? { external_id: attendance.id } : {}),
        },
      },
      `att:${attendance.id}:${action}`,
    );
  })().catch((error) => console.error("Davomatni botga navbatlashda xato", error));
}

export type RoutingCategory = "attendance" | "leave" | "announcements" | "system" | "payroll" | "hr";

/**
 * Xodimga xabar yuborish — sozlamadagi yo‘nalish bo‘yicha:
 *   telegram — Staffora boti (xodim ulangan bo‘lsa)
 *   bot      — xodimlar boti (Staffora'ga hali ulanmagan bo‘lsa ham yetadi)
 * "staffora" (ichki bildirishnoma) chaqiruvchi tomonidan yoziladi.
 * Qaytaradi: qaysi kanallar orqali yuborildi.
 */
export async function notifyEmployee(
  db: Database,
  employee: Employee,
  category: RoutingCategory,
  text: string,
  options: { title?: string; openButton?: boolean } = {},
) {
  const integration = activeIntegration(db, employee.companyId);
  const channels = integration?.settings.routing[category] || ["staffora", "telegram"];
  const used: string[] = [];
  const connected = Boolean(employee.telegramConnected && employee.telegramId && !employee.telegramId.startsWith("dev"));
  if (channels.includes("telegram") && connected) {
    const ok = await sendTelegramMessage(employee.telegramId!, text, { openButton: options.openButton }).catch(() => false);
    if (ok) used.push("telegram");
  }
  const wantBot = channels.includes("bot") || (channels.includes("telegram") && !used.includes("telegram"));
  if (integration && wantBot) {
    const mapping = mappingByLocal(db, integration.id, "employee", employee.id);
    if (mapping) {
      const deliveryId = newId();
      await upsertDelivery({
        id: deliveryId,
        companyId: employee.companyId,
        integrationId: integration.id,
        kind: "NOTIFY",
        refId: category,
        employeeId: employee.id,
        channel: "bot",
        status: "QUEUED",
      });
      await enqueueOutbox(
        integration,
        "notification.send",
        {
          deliveryId,
          kind: "NOTIFY",
          refId: category,
          employeeId: employee.id,
          body: {
            employee_id: Number(mapping.externalId),
            title: options.title,
            message: text.slice(0, 3500),
            type: `staffora_${category}`,
            source: SOURCE_KEY,
          },
        },
        `notify:${deliveryId}`,
      ).catch((error) => logIntegration(integration, "warn", "notify", (error as Error).message));
      used.push("bot");
    }
  }
  return used;
}
