import { describe, expect, it } from "vitest";
import { FILE_LINK_PATH, signFileLink, verifyFileLink } from "../server/auth";

/* Mini App / ilova hisobot havolasi: faqat hisobot yo‘llari, 5 daqiqa, imzo buzilsa — rad. */
describe("imzolangan hisobot havolasi", () => {
  it("faqat hisobot va bank fayllariga ruxsat", () => {
    for (const ok of ["/reports/attendance.xlsx?from=2026-10-01&to=2026-10-08", "/reports/t13.xlsx?month=2026-10", "/reports/employees.xlsx", "/payroll/2026-10/bank.csv"]) expect(FILE_LINK_PATH.test(ok), ok).toBe(true);
    for (const bad of ["/employees", "/users", "/reports/../users", "/payroll/2026-10/workflow", "/auth/me", "//evil.com/x.xlsx", "/reports/x.xlsx#a"]) expect(FILE_LINK_PATH.test(bad), bad).toBe(false);
  });
  it("imzolangan havola tekshiriladi, soxtasi rad etiladi", () => {
    const token = signFileLink("/reports/employees.xlsx", "session-token");
    expect(verifyFileLink(token)).toMatchObject({ p: "/reports/employees.xlsx", s: "session-token" });
    expect(verifyFileLink(`${token.slice(0, -2)}xx`)).toBeUndefined();
    expect(verifyFileLink("garbage")).toBeUndefined();
  });
});
