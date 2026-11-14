import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { readDb, updateDb } from "../lib/store";
import type { Lead } from "../lib/types";
import { sendTelegramMessage } from "./telegram";
import { ensurePlans } from "./platform/shared";

/*
 * Ochiq sayt (landing) va panel domenini ajratish.
 *
 *   LANDING_URL=https://staffora.uz      → bu domen Next.js landing exportini ko‘rsatadi;
 *   APP_URL=https://app.staffora.uz      → panel, Mini App, ID karta havolalari shu domenda.
 *
 * LANDING_URL berilmasa — hammasi bitta domenda. Berilsa — host bo‘yicha landing va panel
 * ajratiladi. /api va /health har ikkala domenda ham shu Express backendga tushadi.
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
  let landing = "";
  if (enabled) {
    const parsed = new URL(landingUrl);
    parsed.hostname = bare;
    landing = parsed.origin;
  }
  return {
    app: appOrigin,
    landing,
    landingHosts: enabled ? [bare, `www.${bare}`] : [],
  };
}

export type LandingRequestTarget = "APP" | "API" | "LANDING" | "CANONICAL_REDIRECT";

/** Host va path bo‘yicha request qaysi frontend/backendga tegishli ekanini aniqlaydi. */
export function landingRequestTarget(
  config: ReturnType<typeof siteConfig>,
  hostname: string,
  pathname: string,
): LandingRequestTarget {
  const host = hostname.toLowerCase();
  if (!config.landingHosts.length || !config.landingHosts.includes(host)) return "APP";
  if (host === config.landingHosts[1]) return "CANONICAL_REDIRECT";
  if (pathname === "/health" || pathname === "/api" || pathname.startsWith("/api/")) return "API";
  return "LANDING";
}

/**
 * Next.js `output: export` natijasini landing hostida beradi.
 * Middleware body parser va panel static handleridan oldin ulanadi, shuning uchun landing
 * assetlari Vite ilovasiga tushmaydi; /api va /health esa mavjud Express oqimida qoladi.
 */
export function createLandingStaticMiddleware(config: ReturnType<typeof siteConfig>, directory: string) {
  const serve = express.static(directory, {
    index: "index.html",
    redirect: true,
    setHeaders: (res, file) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
      res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
      res.setHeader(
        "Cache-Control",
        file.includes(`${path.sep}_next${path.sep}static${path.sep}`)
          ? "public, max-age=31536000, immutable"
          : file.endsWith(".html")
            ? "no-cache"
            : "public, max-age=3600",
      );
    },
  });
  return (req: Request, res: Response, next: NextFunction) => {
    const target = landingRequestTarget(config, req.hostname || "", req.path);
    if (target === "APP" || target === "API") return next();
    if (target === "CANONICAL_REDIRECT")
      return res.redirect(308, `${config.landing}${req.originalUrl}`);
    if (!existsSync(path.join(directory, "index.html")))
      return res.status(503).type("text/plain; charset=utf-8").send("Landing build topilmadi.");
    serve(req, res, () => {
      const notFound = path.join(directory, "404.html");
      if (existsSync(notFound)) return res.status(404).sendFile(notFound);
      res.status(404).type("text/plain; charset=utf-8").send("Sahifa topilmadi.");
    });
  };
}

const publicPageMeta: Record<string, { title: string; description: string }> = {
  "/privacy": {
    title: "Maxfiylik siyosati — Staffora",
    description: "Staffora platformasida shaxsga doir ma’lumotlarni yig‘ish, ishlatish, saqlash va himoya qilish tartibi.",
  },
  "/terms": {
    title: "Foydalanish shartlari — Staffora",
    description: "Staffora platformasidan foydalanish qoidalari, foydalanuvchi rollari, obuna, javobgarlik va akkaunt shartlari.",
  },
  "/support": {
    title: "Yordam markazi — Staffora",
    description: "Staffora bo‘yicha tezkor javoblar, akkaunt va davomat yo‘riqnomalari hamda yordam xizmatiga murojaat formasi.",
  },
};

const htmlAttr = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** index.html ichiga sayt sozlamasi va route SEO'si (CSP’ga mos JSON blok) qo‘shiladi. */
export function indexWithConfig(file: string, config: ReturnType<typeof siteConfig>, pathname = "") {
  const html = readFileSync(file, "utf8");
  const json = JSON.stringify({ app: config.app, landing: config.landing, landingHosts: config.landingHosts }).replace(/</g, "\\u003c");
  const meta = publicPageMeta[pathname];
  let output = html;
  if (meta) {
    const title = htmlAttr(meta.title);
    const description = htmlAttr(meta.description);
    output = output
      .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
      .replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/>/i, `<meta name="description" content="${description}" />`)
      .replace(/<meta\s+property="og:title"\s+content="[^"]*"\s*\/>/i, `<meta property="og:title" content="${title}" />`)
      .replace(/<meta\s+property="og:description"\s+content="[^"]*"\s*\/>/i, `<meta property="og:description" content="${description}" />`);
    if (/^https:\/\//i.test(config.app)) {
      const url = htmlAttr(`${config.app.replace(/\/+$/, "")}${pathname}`);
      output = output.replace("</head>", `<link rel="canonical" href="${url}" /><meta property="og:url" content="${url}" /></head>`);
    }
  }
  return output.replace("</head>", `<script id="staffora-site" type="application/json">${json}</script></head>`);
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
  router.get(
    "/public/plans",
    route(async (_req, res) => {
      let db = await readDb();
      if (!db.subscriptionPlans.length) {
        await updateDb((draft) => ensurePlans(draft));
        db = await readDb();
      }
      const plans = db.subscriptionPlans
        .filter((plan) => plan.status === "ACTIVE")
        .sort((a, b) => {
          if (a.key === "free") return -1;
          if (b.key === "free") return 1;
          if (a.price === null) return 1;
          if (b.price === null) return -1;
          return a.price - b.price;
        })
        .map((plan) => ({
          key: plan.key,
          name: plan.name,
          description: plan.description || "",
          price: plan.price,
          currency: plan.currency,
          period: plan.period,
          limits: plan.limits,
          modules: plan.modules,
          trialDays: plan.trialDays,
        }));
      res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
      res.json(plans);
    }),
  );
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
