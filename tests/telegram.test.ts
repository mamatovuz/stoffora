import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyTelegramInitData } from "../server/telegram";

function signedInitData(token: string, authDate: number, userId = 123456) {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: "AAHdF6IQAAAAAN0XohDhrOrc",
    user: JSON.stringify({
      id: userId,
      first_name: "Ali",
      username: "ali_test",
    }),
  });
  const check = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}

describe("Telegram Mini App initData", () => {
  const token = "123456:TEST_BOT_TOKEN";
  it("haqiqiy Telegram imzosini qabul qiladi", () => {
    const data = signedInitData(token, Math.floor(Date.now() / 1000));
    expect(verifyTelegramInitData(data, token).id).toBe(123456);
  });
  it("o‘zgartirilgan ma’lumotni rad etadi", () => {
    const data = signedInitData(token, Math.floor(Date.now() / 1000)).replace(
      "ali_test",
      "hacker",
    );
    expect(() => verifyTelegramInitData(data, token)).toThrow(
      "Telegram imzosi yaroqsiz",
    );
  });
  it("eski sessiyani rad etadi", () => {
    const data = signedInitData(token, Math.floor(Date.now() / 1000) - 2 * 86400);
    expect(() => verifyTelegramInitData(data, token)).toThrow(
      "Telegram sessiyasi eskirgan",
    );
  });
});
