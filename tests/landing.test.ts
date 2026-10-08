import { afterEach, describe, expect, it } from "vitest";
import type { Request, Response } from "express";
import { landingHostGuard, siteConfig } from "../server/landing";

const call = (config: ReturnType<typeof siteConfig>, hostname: string, url: string) => {
  let redirected = "";
  let status = 0;
  let passed = false;
  const req = { hostname, path: url.split("?")[0], originalUrl: url } as Request;
  const res = {
    redirect: (_code: number, to: string) => void (redirected = to),
    status: (code: number) => ((status = code), { json: () => undefined }),
  } as unknown as Response;
  landingHostGuard(config)(req, res, () => void (passed = true));
  return { redirected, status, passed };
};

describe("landing va panel domenlari", () => {
  afterEach(() => {
    delete process.env.LANDING_URL;
  });

  it("LANDING_URL yo‘q — ajratish yo‘q", () => {
    const config = siteConfig("https://app.staffora.uz");
    expect(config.landingHosts).toEqual([]);
    expect(call(config, "staffora.uz", "/login").passed).toBe(true);
  });

  it("asosiy domen: ochiq API o‘tadi, qolgani (shu jumladan «/») app domeniga", () => {
    process.env.LANDING_URL = "https://staffora.uz";
    const config = siteConfig("https://app.staffora.uz");
    expect(config.landingHosts).toEqual(["staffora.uz", "www.staffora.uz"]);
    expect(call(config, "staffora.uz", "/").redirected).toBe("https://app.staffora.uz/");
    expect(call(config, "www.staffora.uz", "/assets/index.js").redirected).toBe("https://app.staffora.uz/assets/index.js");
    expect(call(config, "staffora.uz", "/api/public/lead").passed).toBe(true);
    expect(call(config, "staffora.uz", "/login?x=1").redirected).toBe("https://app.staffora.uz/login?x=1");
    expect(call(config, "staffora.uz", "/mini-app").redirected).toBe("https://app.staffora.uz/mini-app");
    expect(call(config, "staffora.uz", "/api/auth/me").status).toBe(404);
    // Panel domeni — hech narsa o‘zgarmaydi.
    expect(call(config, "app.staffora.uz", "/login").passed).toBe(true);
  });

  it("landing va panel bir xil domen bo‘lsa — ajratilmaydi", () => {
    process.env.LANDING_URL = "https://staffora.uz";
    expect(siteConfig("https://staffora.uz").landingHosts).toEqual([]);
  });
});
