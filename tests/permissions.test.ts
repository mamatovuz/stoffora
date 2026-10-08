import { describe, expect, it } from "vitest";
import { can, canOpenPage, homePage, pagePermissions } from "../lib/permissions";
import * as mobile from "../mobile/src/lib/permissions";

describe("rollar va sahifalar", () => {
  it("Moliya faqat moliya bo‘limlarini ko‘radi (xodimlar, davomat hisobotlari — yo‘q)", () => {
    for (const page of ["/finance", "/payroll", "/advances", "/fines", "/rewards", "/notifications", "/settings"]) expect(canOpenPage("FINANCE", page), page).toBe(true);
    for (const page of ["/reports", "/dashboard", "/employees", "/employees/abc", "/attendance", "/leave", "/branches", "/users", "/audit", "/registrations", "/announcements"])
      expect(canOpenPage("FINANCE", page), page).toBe(false);
    expect(homePage("FINANCE")).toBe("/workspace");
    expect(can("FINANCE", "payroll.edit")).toBe(true);
    expect(can("FINANCE", "employees.view")).toBe(false);
    expect(can("FINANCE", "settings.manage")).toBe(false);
  });

  it("Filial rahbari: moliya va sozlamalar yo‘q", () => {
    expect(canOpenPage("BRANCH_MANAGER", "/attendance")).toBe(true);
    expect(canOpenPage("BRANCH_MANAGER", "/payroll")).toBe(false);
    expect(canOpenPage("BRANCH_MANAGER", "/users")).toBe(false);
    expect(homePage("BRANCH_MANAGER")).toBe("/dashboard");
    expect(homePage("COMPANY_OWNER")).toBe("/dashboard");
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

  it("mobil ilovadagi ruxsatlar nusxasi saytdagi bilan bir xil", () => {
    const roles = ["COMPANY_OWNER", "HR_ADMIN", "HR_MANAGER", "FINANCE", "IT_ADMIN", "BRANCH_MANAGER", "EMPLOYEE"] as const;
    const perms = ["dashboard.view", "employees.view", "employees.edit", "employees.create", "attendance.view", "attendance.edit", "branches.edit", "org.view", "leave.view", "leave.approve", "reports.view", "announcements.create", "audit.view", "settings.manage", "registrations.approve", "payroll.view", "payroll.edit", "devices.manage"];
    for (const role of roles) {
      for (const p of perms) expect(mobile.canWeb(role, p), `${role} ${p}`).toBe(can(role, p));
      for (const path of Object.keys(mobile.WEB_PAGE_PERMS)) {
        expect(mobile.WEB_PAGE_PERMS[path], path).toEqual(pagePermissions[path]);
        expect(mobile.canOpenPage(role, path), `${role} ${path}`).toBe(canOpenPage(role, path));
      }
    }
  });
});
