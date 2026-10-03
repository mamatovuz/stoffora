import { describe, expect, it } from "vitest";
import { adaptProfile, matchFace, verifyIdentity } from "../lib/face";

/* Face ID qarori: qattiq chegara, bir nechta kadr, 1:N (boshqa xodimlar), profil siljimasligi. */

// Sintetik 128 o‘lchamli vektorlar: «odam» — tasodifiy markaz, kadrlar — kichik shovqin.
const rng = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647 - 0.5;
};
const person = (seed: number) => {
  const r = rng(seed);
  return Array.from({ length: 128 }, () => r() * 0.2);
};
const jitter = (base: number[], size: number, seed: number) => {
  const r = rng(seed);
  const noise = Array.from({ length: 128 }, () => r());
  const norm = Math.sqrt(noise.reduce((s, v) => s + v * v, 0));
  return base.map((v, i) => v + (noise[i] / norm) * size);
};
const profileOf = (id: string, center: number[]) => ({ employeeId: id, descriptor: center, samples: [jitter(center, 0.15, 11), jitter(center, 0.15, 12), jitter(center, 0.15, 13)] });

describe("Face ID — kim ekanini aniqlash", () => {
  const a = person(1);
  const me = profileOf("me", a);

  it("o‘zi (masofa ~0,25) — qabul", () => {
    const r = verifyIdentity(me, [jitter(a, 0.25, 21), jitter(a, 0.25, 22), jitter(a, 0.25, 23)]);
    expect(r.matched).toBe(true);
    expect(r.percent).toBeGreaterThanOrEqual(75);
  });

  it("begona o‘xshash odam (masofa ~0,45, ilgari «71%») — rad", () => {
    const r = verifyIdentity(me, [jitter(a, 0.45, 31), jitter(a, 0.45, 32), jitter(a, 0.45, 33)]);
    expect(r.matched).toBe(false);
    expect(r.reason).toBe("MISMATCH");
    expect(r.percent).toBeLessThan(75);
  });

  it("bitta tasodifiy o‘xshash kadr yetmaydi — ko‘pchilik kadr mos bo‘lishi kerak", () => {
    const r = verifyIdentity(me, [jitter(a, 0.2, 41), jitter(a, 0.5, 42), jitter(a, 0.5, 43)]);
    expect(r.matched).toBe(false);
  });

  it("1:N — yuz boshqa xodimga yaqinroq bo‘lsa (hamkasb o‘rniga belgi) — LOOKALIKE", () => {
    const b = jitter(a, 0.3, 51); // hamkasb — o‘xshash yuz
    const colleague = profileOf("colleague", b);
    // Kadrdagi yuz — hamkasbning o‘zi, lekin «me» chegarasiga ham kirib qoladi.
    const frames = [jitter(b, 0.12, 52), jitter(b, 0.12, 53), jitter(b, 0.12, 54)];
    expect(verifyIdentity(me, frames).matched).toBe(true); // 1:N bo‘lmasa — xato qabul qilinardi
    const r = verifyIdentity(me, frames, [colleague]);
    expect(r.matched).toBe(false);
    expect(r.reason).toBe("LOOKALIKE");
    expect(r.lookalikeEmployeeId).toBe("colleague");
    // Hamkasbning o‘zi — qabul.
    expect(verifyIdentity(colleague, frames, [me]).matched).toBe(true);
  });

  it("profil siljimaydi: markazdan uzoq moslashuvchan namuna e’tiborga olinmaydi va qo‘shilmaydi", () => {
    const drifted = { ...me, adaptiveSamples: [jitter(a, 0.45, 61)] };
    const impostor = jitter(a, 0.44, 61);
    expect(matchFace(drifted, impostor).matched).toBe(false);
    const p = { ...me, adaptiveSamples: [] as number[][] };
    expect(adaptProfile(p, jitter(a, 0.36, 71), { distance: 0.36 })).toBe(false);
    expect(p.adaptiveSamples).toHaveLength(0);
  });
});
