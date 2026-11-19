import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://staffora.uz").replace(/\/+$/, "");

/*
 * next.config: trailingSlash: true — sahifalar /features/ ko‘rinishida beriladi.
 * Sitemap’dagi URL aynan shu (yo‘naltirishsiz) manzil bo‘lishi kerak, aks holda
 * qidiruv tizimi har birida redirect ko‘radi va indekslash sekinlashadi.
 */
const url = (path: string) => `${base}${path ? `${path}/` : "/"}`;
const shot = (name: string) => `${base}/screenshots/${name}.png`;

const pages: { path: string; priority: number; changeFrequency: "weekly" | "monthly" | "yearly"; images?: string[] }[] = [
  { path: "", priority: 1, changeFrequency: "weekly", images: [shot("dashboard"), shot("attendance"), shot("payroll"), shot("ai")] },
  { path: "/features", priority: 0.9, changeFrequency: "monthly", images: [shot("employees"), shot("calendar"), shot("reports"), shot("map")] },
  { path: "/pricing", priority: 0.9, changeFrequency: "weekly" },
  { path: "/about", priority: 0.7, changeFrequency: "monthly" },
  { path: "/contact", priority: 0.7, changeFrequency: "monthly" },
  { path: "/support", priority: 0.6, changeFrequency: "monthly" },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return pages.map(({ path, priority, changeFrequency, images }) => ({
    url: url(path),
    lastModified,
    changeFrequency,
    priority,
    ...(images ? { images } : {}),
  }));
}
