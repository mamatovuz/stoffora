import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { readDb, updateDb } from "../lib/store";
import type { Lead } from "../lib/types";
import { sendTelegramMessage } from "./telegram";

/*
 * Ochiq sayt (landing) va panel domenini ajratish.
 *
 *   LANDING_URL=https://staffora.uz      → bu domen (va www.) faqat landing sahifani ochadi;
 *   APP_URL=https://app.staffora.uz      → panel, Mini App, ID karta havolalari shu domenda.
 *
 * LANDING_URL berilmasa — hammasi avvalgidek bitta domenda (landing /landing manzilida ko‘rinadi).
 * Landing domenida boshqa manzil ochilsa (masalan /login) — panel domeniga yo‘naltiriladi.
 */

const hostOf = (url?: string) => {
  try {
    return url ? new URL(url).hostname.toLowerCase() : "";
  } catch {
    return "";
  }
};

export function siteConfig(appOrigin: string) {
  const landingUrl = (process.env.LANDING_URL || "").trim().replace(/\/+$/, "");
  const host = hostOf(landingUrl);
  // Panel bilan bir xil domen bo‘lsa — ajratish yo‘q.
  const enabled = Boolean(host) && host !== hostOf(appOrigin);
  const bare = host.replace(/^www\./, "");
  return {
    app: appOrigin,
    landing: enabled ? landingUrl : "",
    landingHosts: enabled ? [bare, `www.${bare}`] : [],
  };
}

/** Landing domenida faqat «/», statik fayllar va ochiq API; qolgani panel domeniga. */
export function landingHostGuard(config: ReturnType<typeof siteConfig>) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!config.landingHosts.length || !config.landingHosts.includes((req.hostname || "").toLowerCase())) return next();
    const p = req.path;
    if (p === "/" || p.startsWith("/api/public/") || p.startsWith("/assets/") || /^\/[\w.-]+\.(svg|png|ico|txt|webmanifest|xml|js)$/.test(p)) return next();
    if (p.startsWith("/api/")) return res.status(404).json({ message: "API panel domenida." });
    res.redirect(301, `${config.app}${req.originalUrl}`);
  };
}

/** index.html ichiga sayt sozlamasi (CSP’ga mos: bajarilmaydigan JSON blok). */
export function indexWithConfig(file: string, config: ReturnType<typeof siteConfig>) {
  const html = readFileSync(file, "utf8");
  const json = JSON.stringify({ app: config.app, landing: config.landing, landingHosts: config.landingHosts }).replace(/</g, "\\u003c");
  return html.replace("</head>", `<script id="staffora-site" type="application/json">${json}</script></head>`);
}

/* ======================================================= demo arizalar === */
type Handler = (req: Request, res: Response) => Promise<unknown>;
const route = (handler: Handler) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next);

const leadSchema = z.object({
  name: z.string().trim().min(2, "Ismingizni yozing.").max(80),
  company: z.string().trim().min(2, "Kompaniya nomini yozing.").max(120),
  phone: z
    .string()
    .trim()
    .max(30)
    .refine((v) => v.replace(/\D/g, "").length >= 9, "Telefon raqamini to‘liq yozing."),
  employees: z.string().trim().max(20).optional(),
  message: z.string().trim().max(1000).optional(),
  // Botlar uchun tuzoq: odam ko‘rmaydigan maydon to‘ldirilsa — ariza saqlanmaydi.
  website: z.string().max(200).optional(),
});

export function createPublicLeadRouter() {
  const router = Router();
  router.post(
    "/public/lead",
    route(async (req, res) => {
      const input = leadSchema.parse(req.body);
      if (input.website) return res.status(201).json({ ok: true });
      const lead: Lead = {
        id: randomUUID(),
        name: input.name,
        company: input.company,
        phone: input.phone,
        employees: input.employees || undefined,
        message: input.message || undefined,
        status: "NEW",
        createdAt: new Date().toISOString(),
      };
      await updateDb((db) => {
        db.leads.unshift(lead);
        if (db.leads.length > 2000) db.leads = db.leads.slice(0, 2000);
      });
      // Ixtiyoriy: yangi ariza haqida Telegram’ga xabar (LEADS_TELEGRAM_CHAT_ID — guruh yoki shaxsiy chat).
      const chat = process.env.LEADS_TELEGRAM_CHAT_ID?.trim();
      if (chat) {
        const text = [
          "🆕 <b>Saytdan demo so‘rovi</b>",
          `👤 ${escape(lead.name)}`,
          `🏢 ${escape(lead.company)}${lead.employees ? ` · ${escape(lead.employees)} xodim` : ""}`,
          `📞 ${escape(lead.phone)}`,
          lead.message ? `💬 ${escape(lead.message)}` : "",
        ]
          .filter(Boolean)
          .join("\n");
        void sendTelegramMessage(chat, text).catch(() => false);
      }
      res.status(201).json({ ok: true });
    }),
  );
  return router;
}

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Super admin: saytdan kelgan arizalar. */
export function createLeadAdminRouter(requireSuperAdmin: (req: Request, res: Response, next: NextFunction) => void) {
  const router = Router();
  router.get(
    "/admin/leads",
    requireSuperAdmin,
    route(async (_req, res) => {
      const db = await readDb();
      res.json(db.leads.slice(0, 300));
    }),
  );
  router.patch(
    "/admin/leads/:id",
    requireSuperAdmin,
    route(async (req, res) => {
      const { status } = z.object({ status: z.enum(["NEW", "CONTACTED", "CLOSED"]) }).parse(req.body);
      const lead = await updateDb((db) => {
        const row = db.leads.find((l) => l.id === req.params.id);
        if (!row) throw Object.assign(new Error("Ariza topilmadi."), { status: 404 });
        row.status = status;
        return row;
      });
      res.json(lead);
    }),
  );
  return router;
}
