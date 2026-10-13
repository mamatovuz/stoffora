import { describe, expect, it } from "vitest";
import { apiModule, disabledModules, miniModule, MODULE_PRESETS, MODULES, pageEnabled, presetState, settingsTabModule } from "../lib/modules";
import { canOpenPage, homePage } from "../lib/permissions";
import { botProfileFromRemote, employeeFromRemote, salaryFromRemote } from "../server/integrations/transform";

describe("modullar", () => {
  it("API yo‘li eng uzun mos prefiks bo‘yicha modulga tegishli", () => {
    expect(apiModule("/reports/digest")).toBe("reportDigest");
    expect(apiModule("/reports/attendance")).toBe("reports");
    expect(apiModule("/leave/123")).toBe("leave");
    expect(apiModule("/leave-balances")).toBe("leave");
    expect(apiModule("/company/bot/test")).toBe("telegramBot");
    expect(apiModule("/company")).toBeUndefined();
    expect(apiModule("/employees/1")).toBeUndefined();
    expect(apiModule("/integrations/abc/sync")).toBe("integrations");
    expect(miniModule("/mini/leave")).toBe("leave");
    expect(miniModule("/mini/home")).toBeUndefined();
    expect(settingsTabModule("integrations")).toBe("integrations");
    expect(settingsTabModule("profile")).toBeUndefined();
  });

  it("faqat false bo‘lganlar o‘chirilgan hisoblanadi", () => {
    expect(disabledModules({ modules: { leave: false, fines: true } })).toEqual(["leave"]);
    expect(disabledModules({})).toEqual([]);
  });

  it("o‘chirilgan modul sahifasi ochilmaydi, asosiy sahifalar doim ochiq", () => {
    expect(pageEnabled(["leave"], "/leave")).toBe(false);
    expect(pageEnabled(["leave"], "/employees")).toBe(true);
    expect(canOpenPage("COMPANY_OWNER", "/payroll", ["payroll"])).toBe(false);
    expect(canOpenPage("COMPANY_OWNER", "/payroll", [])).toBe(true);
    expect(homePage("FINANCE", ["workspace", "finance"])).toBe("/payroll");
  });

  it("tayyor to‘plamlar barcha modullarni qamraydi", () => {
    for (const preset of MODULE_PRESETS) expect(Object.keys(presetState(preset))).toHaveLength(MODULES.length);
    expect(Object.values(presetState(MODULE_PRESETS[0])).every(Boolean)).toBe(true);
  });
});

describe("bot xodim ma’lumoti (API 2026-10)", () => {
  it("maosh: amount ustun, matn zaxira, is_set=false — yo‘q", () => {
    expect(salaryFromRemote({ id: 1, salary: { amount: 4_000_000, monthly_salary: "4 mln", is_set: true } })).toBe(4_000_000);
    expect(salaryFromRemote({ id: 1, salary: { monthly_salary: "800 ming" } })).toBe(800_000);
    expect(salaryFromRemote({ id: 1, monthly_salary: 3_000_000 })).toBe(3_000_000);
    expect(salaryFromRemote({ id: 1, salary: { amount: 0, is_set: false } })).toBeUndefined();
  });

  it("ism qismlari alohida kelsa — o‘shalar ishlatiladi; jins o‘giriladi", () => {
    const fields = employeeFromRemote({ id: 1, full_name: "Abdullayeva Gulnora Akmal qizi", first_name: "Gulnora", last_name: "Abdullayeva", middle_name: "Akmal qizi", gender: "female" });
    expect(fields).toMatchObject({ firstName: "Gulnora", lastName: "Abdullayeva", middleName: "Akmal qizi", gender: "FEMALE" });
  });

  it("anketadagi maosh savollari botSalary ga ajratiladi", () => {
    const profile = botProfileFromRemote({
      id: 7,
      telegram_name: "Gulya",
      questionnaire: { city: "Andijon", expected_salary: "5 mln", languages: ["uz", "ru"], empty: "" },
      salary: { amount: 4_500_000, is_set: true, source: "probation", current_month: { final_amount: 4_200_000 } },
    });
    expect(profile.questionnaire).toEqual({ city: "Andijon", languages: ["uz", "ru"] });
    expect(profile.botSalary).toMatchObject({ amount: 4_500_000, source: "probation", questionnaire: { expected_salary: "5 mln" } });
    expect(profile.telegramName).toBe("Gulya");
  });
});
