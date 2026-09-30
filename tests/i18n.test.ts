import { describe, expect, it } from "vitest";
import { translate } from "../src/i18n";

describe("rus tili", () => {
  it("lug‘at, bo‘shliqlar saqlanadi", () => {
    expect(translate("Asosiy", "ru")).toBe("Главная");
    expect(translate(" Ishga keldim ", "ru")).toBe(" Я пришёл ");
    expect(translate("Asosiy", "uz")).toBe("Asosiy");
  });
  it("andozalar va bo‘laklar", () => {
    expect(translate("Ishdasiz · 12 daq kech", "ru")).toBe("На работе · опоздание 12 мин");
    expect(translate("3 soat 5 daq qoldi", "ru")).toBe("осталось 3 ч 5 мин");
    expect(translate("01-sen 2026", "ru")).toBe("1 сен 2026");
    expect(translate("1 200 000 so‘m", "ru")).toBe("1 200 000 сум");
  });
  it("ismlar va noma’lum matn o‘zgarmaydi", () => {
    expect(translate("Aziza Karimova", "ru")).toBe("Aziza Karimova");
    expect(translate("Juma", "ru")).toBe("Juma");
    expect(translate("09:00–18:00", "ru")).toBe("09:00–18:00");
  });
});
