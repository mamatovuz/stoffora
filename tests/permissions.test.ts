import { describe, expect, it } from "vitest";
import { can, canOpenPage, homePage } from "../lib/permissions";

describe("rollar va sahifalar", () => {
  it("Moliya faqat ish haqi va hisobotlarni ko‘radi", () => {
    for (const page of ["/payroll", "/reports", "/notifications", "/settings"]) expect(canOpenPage("FINANCE", page), page).toBe(true);
    for (const page of ["/dashboard", "/employees", "/employees/abc", "/attendance", "/leave", "/branches", "/users", "/audit", "/registrations", "/announcements"])
      expect(canOpenPage("FINANCE", page), page).toBe(false);
    expect(homePage("FINANCE")).toBe("/payroll");
    expect(can("FINANCE", "payroll.edit")).toBe(true);
    expect(can("FINANCE", "employees.view")).toBe(false);
    expect(can("FINANCE", "settings.manage")).toBe(false);
  });

  it("Filial rahbari: moliya va sozlamalar yo‘q", () => {
    expect(canOpenPage("BRANCH_MANAGER", "/attendance")).toBe(true);
    expect(canOpenPage("BRANCH_MANAGER", "/payroll")).toBe(false);
    expect(canOpenPage("BRANCH_MANAGER", "/users")).toBe(false);
    expect(homePage("BRANCH_MANAGER")).toBe("/dashboard");
  });

  it("HR arizalarni ko‘radi, egasi hammasini", () => {
    expect(canOpenPage("HR_MANAGER", "/registrations")).toBe(true);
    expect(can("HR_MANAGER", "registrations.approve")).toBe(true);
    expect(canOpenPage("HR_MANAGER", "/payroll")).toBe(false);
    expect(canOpenPage("COMPANY_OWNER", "/payroll")).toBe(true);
    expect(canOpenPage("COMPANY_OWNER", "/users")).toBe(true);
  });
});
