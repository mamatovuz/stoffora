import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { translate } from "../mobile/src/lib/i18n-dict";
import { syncedDict } from "../scripts/sync-mobile-i18n";

/*
 * Mobil ilova rus tili: lug‘at Mini App bilan bir xil (ko‘chirilgan qism eskirmagan), ilovaga xos
 * so‘zlar, shablonli matnlar va bo‘laklab tarjima.
 */

const ru = (text: string) => translate(text, "ru");

describe("mobil ilova — rus tili", () => {
  it("o‘zbekchada matn o‘zgarmaydi", () => {
    expect(translate("Ishga keldim", "uz")).toBe("Ishga keldim");
  });

  it("Mini App lug‘ati va ilovaga xos so‘zlar", () => {
    expect(ru("Ishga keldim")).toBe("Я пришёл");
    expect(ru("Bosh sahifa")).toBe("Главная");
    expect(ru("Mening oyim")).toBe("Мой месяц");
    expect(ru("Telefonda saqlash")).toBe("Сохранить в телефоне");
    expect(ru("  Saqlash ")).toBe("  Сохранить ");
  });

  it("shablonlar: son va qiymat o‘rnida qoladi", () => {
    expect(ru("3 kishi hali kelmadi")).toBe("3 чел. ещё не пришли");
    expect(ru("Noto‘g‘ri PIN · 2 ta urinish qoldi")).toBe("Неверный PIN · осталось попыток: 2");
    expect(ru("500 000 so‘m so‘rovini bekor qilasizmi?")).toBe("Отменить запрос 500 000 сум?");
    expect(ru("Ish boshlanishidan 15 daqiqa oldin eslatamiz.")).toBe("Напомним за 15 мин до начала работы.");
  });

  it("bo‘laklab: ajratuvchilar va ismlar saqlanadi", () => {
    expect(ru("Rekord: 12 kun · keyingi nishongacha 8 kun")).toBe("Рекорд: 12 дн. · до следующего значка 8 дн.");
    expect(ru("Ali Valiyev · 15 daq kech")).toBe("Ali Valiyev · опоздание 15 мин");
    expect(ru("12/22 ish kuni")).toBe("12/22 раб. дн.");
    expect(ru("Ali Valiyev")).toBe("Ali Valiyev");
  });

  it("Mini App lug‘ati bilan sinxron (scripts/sync-mobile-i18n.ts)", () => {
    const dict = readFileSync("mobile/src/lib/i18n-dict.ts", "utf8").replace(/\r\n/g, "\n");
    const source = readFileSync("src/i18n.ts", "utf8");
    expect(syncedDict(source, dict)).toBe(dict);
  });
});
