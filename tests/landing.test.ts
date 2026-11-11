import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import express from "express";
import path from "node:path";
import { createLandingStaticMiddleware, indexWithConfig, landingRequestTarget, siteConfig } from "../server/landing";

const target = (config: ReturnType<typeof siteConfig>, hostname: string, url: string) =>
  landingRequestTarget(config, hostname, url.split("?")[0]);

describe("landing va panel domenlari", () => {
  afterEach(() => {
    delete process.env.LANDING_URL;
  });

  it("LANDING_URL yo‘q — ajratish yo‘q", () => {
    const config = siteConfig("https://app.staffora.uz");
    expect(config.landingHosts).toEqual([]);
    expect(target(config, "staffora.uz", "/login")).toBe("APP");
  });

  it("asosiy domen landingni, app domeni panelni, API esa Express backendni tanlaydi", () => {
    process.env.LANDING_URL = "https://staffora.uz";
    const config = siteConfig("https://app.staffora.uz");
    expect(config.landingHosts).toEqual(["staffora.uz", "www.staffora.uz"]);
    expect(target(config, "staffora.uz", "/")).toBe("LANDING");
    expect(target(config, "staffora.uz", "/features/")).toBe("LANDING");
    expect(target(config, "staffora.uz", "/_next/static/app.js")).toBe("LANDING");
    expect(target(config, "staffora.uz", "/api/public/lead")).toBe("API");
    expect(target(config, "staffora.uz", "/api/public/support/tickets")).toBe("API");
    expect(target(config, "staffora.uz", "/health")).toBe("API");
    expect(target(config, "www.staffora.uz", "/features/")).toBe("CANONICAL_REDIRECT");
    expect(target(config, "app.staffora.uz", "/login")).toBe("APP");
  });

  it("landing va panel bir xil domen bo‘lsa — ajratilmaydi", () => {
    process.env.LANDING_URL = "https://staffora.uz";
    expect(siteConfig("https://staffora.uz").landingHosts).toEqual([]);
  });

  it("real middleware landing HTML beradi, API va app hostini Expressga qoldiradi", async () => {
    process.env.LANDING_URL = "https://staffora.uz";
    const directory = mkdtempSync(path.join(tmpdir(), "staffora-landing-"));
    writeFileSync(path.join(directory, "index.html"), "<h1>Staffora landing</h1>");
    writeFileSync(path.join(directory, "404.html"), "<h1>404</h1>");
    const app = express();
    app.set("trust proxy", 1);
    app.use(createLandingStaticMiddleware(siteConfig("https://app.staffora.uz"), directory));
    app.get("/api/public/ping", (_req, res) => res.json({ api: true }));
    app.get("*", (_req, res) => res.send("APP"));
    const server = app.listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const landing = await fetch(base, { headers: { "x-forwarded-host": "staffora.uz" } });
      expect(await landing.text()).toContain("Staffora landing");
      const api = await fetch(`${base}/api/public/ping`, { headers: { "x-forwarded-host": "staffora.uz" } });
      expect(await api.json()).toEqual({ api: true });
      const panel = await fetch(`${base}/login`, { headers: { "x-forwarded-host": "app.staffora.uz" } });
      expect(await panel.text()).toBe("APP");
      const www = await fetch(`${base}/features?from=www`, { headers: { "x-forwarded-host": "www.staffora.uz" }, redirect: "manual" });
      expect(www.status).toBe(308);
      expect(www.headers.get("location")).toBe("https://staffora.uz/features?from=www");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("public route dastlabki HTML'idayoq to‘g‘ri SEO metadata beradi", () => {
    const html = indexWithConfig(path.join(process.cwd(), "index.html"), siteConfig("https://hosting.example.uz"), "/privacy");
    expect(html).toContain("<title>Maxfiylik siyosati — Staffora</title>");
    expect(html).toContain('content="Staffora platformasida shaxsga doir ma’lumotlarni yig‘ish, ishlatish, saqlash va himoya qilish tartibi."');
    expect(html).toContain('rel="canonical" href="https://hosting.example.uz/privacy"');
    expect(html).not.toContain("staffora.uz/privacy");
  });
});
