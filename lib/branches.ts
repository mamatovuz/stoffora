import { haversineDistance } from "./attendance";
import type { Branch, Database, Employee } from "./types";

/*
 * Qaysi filiallarda xodim keldi-ketdi qila oladi.
 * Odatda — faqat o‘z filiali. Lavozimda «istalgan filialdan» yoqilgan bo‘lsa (masalan, HR
 * har xil filiallarga boradi) — o‘z filiali + lavozimda tanlangan filiallar (tanlanmagan
 * bo‘lsa — kompaniyaning barcha faol filiallari). Qaysi filial ekanini server joylashuv yoki
 * QR bo‘yicha aniqlaydi — mijoz yuborgan filialga ishonilmaydi.
 */
export function allowedBranches(db: Pick<Database, "branches" | "positions">, employee: Pick<Employee, "companyId" | "branchId" | "positionId">): Branch[] {
  const active = db.branches.filter((b) => b.companyId === employee.companyId && b.status === "ACTIVE");
  const home = active.find((b) => b.id === employee.branchId);
  const position = db.positions.find((p) => p.id === employee.positionId && p.companyId === employee.companyId);
  if (!position?.anyBranch) return home ? [home] : [];
  const extra = position.branchIds?.length ? active.filter((b) => position.branchIds!.includes(b.id)) : active;
  return [...(home ? [home] : []), ...extra.filter((b) => b.id !== home?.id)];
}

/** Joylashuv bo‘yicha eng mos filial: hududi ichida (aniqlik hisobga olingan) va eng yaqini. */
export function branchAt(branches: Branch[], latitude: number, longitude: number, allowance = 0) {
  const ranked = branches
    .map((branch) => {
      const distance = haversineDistance(branch.latitude, branch.longitude, latitude, longitude);
      return { branch, distance, outside: distance - allowance - branch.radiusMeters };
    })
    .sort((a, b) => a.outside - b.outside);
  return { inside: ranked.find((r) => r.outside <= 0) || null, nearest: ranked[0] || null };
}
