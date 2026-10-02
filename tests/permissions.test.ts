import { describe, expect, it } from "vitest";
import { can, canOpenPage, homePage } from "../lib/permissions";

describe("rollar va sahifalar", () => {
  it("Moliya faqat moliya bo‘limlarini ko‘radi (xodimlar, davomat hisobotlari — yo‘q)", () => {
    for (const page of ["/finance", "/payroll", "/advances", "/fines", "/rewards", "/notifications", "/settings"]) expect(canOpenPage("FINANCE", page), page).toBe(true);
    for (const page of ["/reports", "/dashboard", "/employees", "/employees/abc", "/attendance", "/leave", "/branches", "/users", "/audit", "/registrations", "/announcements"])
      expect(canOpenPage("FINANCE", page), page).toBe(false);
    expect(homePage("FINANCE")).toBe("/finance");
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
    // HR bitta («HR menejer» = HR), lekin moliya bo‘limini ko‘rmaydi; jarima yozadi.
    for (const page of ["/payroll", "/advances", "/rewards", "/finance"]) expect(canOpenPage("HR_MANAGER", page), page).toBe(false);
    expect(canOpenPage("HR_ADMIN", "/fines")).toBe(true);
    expect(canOpenPage("HR_ADMIN", "/reports")).toBe(true);
    expect(canOpenPage("FINANCE", "/registrations")).toBe(false);
    expect(canOpenPage("COMPANY_OWNER", "/payroll")).toBe(true);
    expect(canOpenPage("COMPANY_OWNER", "/users")).toBe(true);
  });
});
