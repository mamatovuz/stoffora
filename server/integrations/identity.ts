import { readDb } from "../../lib/store";
import type { Employee } from "../../lib/types";
import { linkEmployeeById } from "../telegram";
import { BotApiError } from "./client";
import { clientFor, mappingByExternal } from "./model";
import { logIntegration } from "./sqlstore";

/*
 * Xodimlar boti orqali ochilgan Mini App.
 *
 * Telegram qoidasi: bot START bosmagan odamga yoza olmaydi. Xodimlar esa faqat
 * xodimlar botini (Gulnora HR bot) ishlatgan. Shuning uchun Staffora Mini App'i
 * shu botning o‘ziga "Direct Link Mini App" sifatida ulanadi
 * (https://t.me/<bot>/<nomi>) — xodim havolani bosadi va Staffora darhol ochiladi,
 * ikkinchi botda START kerak emas.
 *
 * Bunday initData xodimlar boti tokeni bilan imzolangan. Uni bot serveri o‘zi
 * tekshiradi (POST /integration/telegram/verify) — Staffora bot tokenini bilmaydi
 * va frontend yuborgan telegram_id ga ishonmaydi.
 */

export interface EmployeeBotIdentity {
  id: number;
  username?: string;
  first_name?: string;
  companyId: string;
  employee: Employee;
}

type VerifyResponse = {
  verified: boolean;
  telegram_user: { id: number; username?: string; first_name?: string };
  is_employee: boolean;
  employee?: { id: number } | null;
};

/** initData ni ulangan xodimlar boti(lar)i orqali tekshiradi va Staffora xodimini topadi. */
export async function verifyViaEmployeeBot(initData: string): Promise<EmployeeBotIdentity | null> {
  if (!initData || !initData.includes("hash=")) return null;
  const db = await readDb();
  // Faqat "bir bosishda kirish" yoqilgan (Mini App havolasi kiritilgan) integratsiyalar.
  const candidates = db.integrations.filter((i) => i.status !== "DISCONNECTED" && i.settings.miniAppLink);
  for (const integration of candidates) {
    try {
      const { data } = await clientFor(integration).request<VerifyResponse>("POST", "/integration/telegram/verify", {
        body: { init_data: initData },
      });
      if (!data?.verified || !data.telegram_user?.id) continue;
      const telegramId = String(data.telegram_user.id);
      const byMapping = data.employee?.id ? mappingByExternal(db, integration.id, "employee", data.employee.id) : undefined;
      const employee =
        (byMapping && db.employees.find((e) => e.id === byMapping.localId && e.companyId === integration.companyId)) ||
        db.employees.find((e) => e.companyId === integration.companyId && e.telegramId === telegramId && e.status === "ACTIVE");
      if (!employee || employee.status !== "ACTIVE") {
        await logIntegration(integration, "warn", "miniapp.login", `Mini App: Telegram ${telegramId} Staffora xodimiga topilmadi`);
        return null;
      }
      const linked = await linkEmployeeById(employee.id, integration.companyId, data.telegram_user, "xodimlar boti Mini App");
      if (!linked) return null;
      return { ...data.telegram_user, companyId: integration.companyId, employee: linked };
    } catch (error) {
      // 401 — bu bot imzolamagan (boshqa bot yoki soxta) — keyingisini sinaymiz.
      if (error instanceof BotApiError && (error.status === 401 || error.status === 422)) continue;
      await logIntegration(integration, "warn", "miniapp.verify", `Mini App tekshiruvi bajarilmadi: ${(error as Error).message}`);
    }
  }
  return null;
}
