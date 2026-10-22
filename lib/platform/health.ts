/*
 * Kompaniya «sog‘liq» bahosi (0–100) — kompaniyaning platformadan foydalanishi va texnik holati.
 * Xodimlarning shaxsiy ishini baholash yoki jazolash uchun EMAS.
 *
 * Formula (jami 100):
 *   Faollik      30 — oxirgi 7 kundagi davomat qaydlari / (faol xodim × ish kunlari) (1 ga cheklanadi).
 *   Barqarorlik  20 — 20 × (1 − min(1, xato ulushi / 5%)); so‘rov bo‘lmasa — 10 (neytral).
 *   Integratsiya 10 — bot ishlayapti yoki ishlatilmaydi: 5; Telegram’ga ulangan xodimlar ulushi × 5.
 *   Modullar     10 — tarifdagi modullardan hozir ishlayotganlari ulushi × 10.
 *   Sozlash      20 — onboarding foizi × 20.
 *   Incidentlar  10 — 10 − 3 × ochiq incident − 3 × nosoz webhook (0 dan kam emas).
 */

export type HealthInput = {
  activeEmployees: number;
  attendance7d: number;
  workdays7d?: number;
  requests7d: number;
  errors7d: number;
  bot: "NONE" | "RUNNING" | "ERROR" | "STOPPED";
  telegramLinked: number;
  modulesAvailable: number;
  modulesExpected: number;
  onboardingPercent: number;
  openIncidents: number;
  failingWebhooks: number;
};

export type HealthComponents = { activity: number; reliability: number; integrations: number; modules: number; setup: number; incidents: number };

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));

export function healthScore(input: HealthInput): { score: number; components: HealthComponents; grade: "GOOD" | "FAIR" | "POOR" } {
  const workdays = input.workdays7d ?? 6;
  const expected = input.activeEmployees * workdays;
  const activity = expected > 0 ? 30 * clamp(input.attendance7d / expected) : 0;
  const reliability = input.requests7d > 0 ? 20 * (1 - clamp(input.errors7d / input.requests7d / 0.05)) : 10;
  const botPart = input.bot === "RUNNING" || input.bot === "NONE" ? 5 : input.bot === "STOPPED" ? 2 : 0;
  const linked = input.activeEmployees > 0 ? 5 * clamp(input.telegramLinked / input.activeEmployees) : 0;
  const modules = input.modulesExpected > 0 ? 10 * clamp(input.modulesAvailable / input.modulesExpected) : 10;
  const setup = 20 * clamp(input.onboardingPercent / 100);
  const incidents = Math.max(0, 10 - 3 * input.openIncidents - 3 * input.failingWebhooks);
  const components: HealthComponents = {
    activity: Math.round(activity),
    reliability: Math.round(reliability),
    integrations: Math.round(botPart + linked),
    modules: Math.round(modules),
    setup: Math.round(setup),
    incidents: Math.round(incidents),
  };
  const score = Math.round(Object.values(components).reduce((s, v) => s + v, 0));
  return { score, components, grade: score >= 75 ? "GOOD" : score >= 50 ? "FAIR" : "POOR" };
}
