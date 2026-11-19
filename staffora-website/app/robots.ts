import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://staffora.uz").replace(/\/+$/, "");

export default function robots(): MetadataRoute.Robots {
  return {
    // JS/CSS (_next) ochiq qoladi — Google sahifani to‘liq render qila olishi kerak.
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/404/", "/_not-found/"] },
    sitemap: `${base}/sitemap.xml`,
    // Yandex uchun asosiy domen (O‘zbekistonda keng ishlatiladi).
    host: base,
  };
}
