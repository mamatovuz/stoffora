import type { Branch, Database, Employee } from "../../lib/types";

/*
 * Staffora AI: xodimni ism, familiya, ID, xodim raqami yoki telefon bo‘yicha topish.
 * Kirill → lotin, «h/x», apostrof va o‘zbekcha qo‘shimchalar («Alini», «Valiyevning») hisobga olinadi —
 * «Ali Valiyev bormi?», «ID 001 kim?», «Валиев» kabi savollar bir xil xodimni topadi.
 */

const CYR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts", ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "i", ь: "", э: "e", ю: "yu",
  я: "ya", ў: "o", қ: "q", ғ: "g", ҳ: "x",
};

/** Solishtirish kaliti: kichik harf, lotin, apostrofsiz, h→x. */
export function nameKey(value: string) {
  return value
    .toLocaleLowerCase("uz")
    .replace(/[а-яёўқғҳ]/g, (ch) => CYR[ch] ?? ch)
    .replace(/['‘’`ʻʼ"]/g, "")
    .replace(/h/g, "x")
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim();
}

const SUFFIXES = ["larning", "larni", "lardan", "ning", "dagi", "niki", "lari", "dan", "ni", "ga", "ka", "qa", "da", "mi", "chi", "lar", "dir"].map(nameKey);
/** So‘z va qo‘shimchasiz shakllari: «alini» → ["alini", "ali"]. */
function forms(token: string) {
  const out = new Set([token]);
  for (const suffix of SUFFIXES) if (token.length - suffix.length >= 3 && token.endsWith(suffix)) out.add(token.slice(0, -suffix.length));
  return [...out];
}

/** Savoldagi umumiy so‘zlar — ism sifatida qidirilmaydi. */
const STOP = new Set(
  [
    "bugun", "bugungi", "kecha", "kechagi", "ertaga", "xodim", "xodimi", "xodimlar", "hodim", "hodimlar", "ishchi", "odam", "kishi", "kim", "kimlar", "kimni", "bor", "bormi",
    "yoq", "qaysi", "nechta", "qancha", "davomat", "davomati", "filial", "filiali", "filiallar", "ish", "ishga", "ishda", "ishdan", "vaqt", "vaqti", "grafik", "grafigi",
    "korsat", "korsating", "chiqar", "chiqaring", "top", "toping", "topib", "ber", "bering", "qidir", "qidiring", "izla", "izlang", "haqida", "malumot", "profil",
    "profili", "id", "raqam", "raqami", "raqamli", "ismli", "familiyali", "familiya", "ism", "degan", "nomli", "keldi", "keldimi", "kelmadi", "kelmagan", "kechikdi",
    "kechikdimi", "kechikkan", "kechikkanlar", "bu", "shu", "oy", "oyda", "hafta", "hisobot", "salom", "assalomu", "alaykum", "iltimos", "rahmat", "va", "yoki", "ham",
    "bilan", "uchun", "menga", "mening", "bizda", "bizning", "kompaniya", "korxona", "barcha", "hamma", "royxat", "royxati", "sonini", "soni", "qachon", "nima",
    "qanday", "holati", "holat", "telefon", "telefoni", "nomer", "nomeri", "lavozim", "lavozimi", "oylik", "oyligi", "maosh", "ketdi", "ketdimi", "keladi", "kelyapti",
  ].map(nameKey),
);

export const tokensOf = (text: string) => nameKey(text).split(/[\s-]+/).filter((t) => t.length >= 2);
/** Savoldan ism bo‘lishi mumkin bo‘lgan so‘zlar. */
export const nameTokens = (text: string) => tokensOf(text).filter((t) => !STOP.has(t) && !/^\d+$/.test(t));
/** Xuddi shu so‘zlar, lekin foydalanuvchi yozgan shaklda (javobda ko‘rsatish uchun). `only` — kalitlar filtri. */
export function queryWords(text: string, only?: string[]) {
  return text
    .split(/[\s,.;:!?()«»“”"]+/)
    .map((word) => word.trim())
    .filter((word) => {
      const key = nameKey(word).replace(/\s+/g, "");
      return key.length >= 2 && !STOP.has(key) && !/^\d+$/.test(key) && (!only || only.includes(key));
    })
    .join(" ");
}

const digits = (value: string) => value.replace(/\D/g, "");
export const fullName = (e: Pick<Employee, "firstName" | "lastName">) => `${e.firstName} ${e.lastName}`.trim();

export type EmployeeHit = { employee: Employee; score: number; exact: boolean };

/**
 * Xodimlarni qidiradi. `exact` — ID/xodim raqami/telefon to‘liq mos yoki har bir ism so‘zi mos.
 * Faol xodimlar oldinda; ishdan bo‘shaganlar oxirida.
 */
export function searchEmployees(db: Database, companyId: string, query: string, limit = 20): EmployeeHit[] {
  const raw = query.trim();
  if (!raw) return [];
  const refKey = nameKey(raw).replace(/\s+/g, "");
  const named = nameTokens(raw);
  const tokens = named.length ? named : tokensOf(raw).filter((t) => !/^\d+$/.test(t));
  const phone = digits(raw);
  const hits: EmployeeHit[] = [];
  for (const employee of db.employees) {
    if (employee.companyId !== companyId) continue;
    let score = 0;
    let exact = false;
    const no = nameKey(employee.employeeNo || "").replace(/\s+/g, "");
    if (refKey && (nameKey(employee.id) === refKey || (no && no === refKey))) {
      score = 100;
      exact = true;
    } else if (phone.length >= 7 && digits(employee.phone || "").endsWith(phone.slice(-9))) {
      score = 90;
      exact = true;
    } else if (tokens.length) {
      const parts = [employee.firstName, employee.lastName, employee.middleName || ""].map(nameKey).filter(Boolean);
      let matched = 0;
      for (const token of tokens) {
        const variants = forms(token);
        if (parts.some((p) => variants.includes(p))) {
          score += 10;
          matched += 1;
        } else if (variants.some((v) => v.length >= 3 && parts.some((p) => p.startsWith(v)))) {
          score += 6;
          matched += 1;
        }
      }
      if (!matched) continue;
      // So‘rovdagi barcha so‘zlar mos kelsa — aniq natija.
      exact = matched === tokens.length;
      if (!exact) score -= 4;
    }
    if (score <= 0) continue;
    if (employee.status !== "ACTIVE") score -= 30;
    hits.push({ employee, score, exact });
  }
  return hits.sort((a, b) => b.score - a.score || fullName(a.employee).localeCompare(fullName(b.employee))).slice(0, limit);
}

/** Matndagi aniq ism mosligi (so‘z to‘liq ism/familiyaga teng) — umumiy savollarni ism deb olmaslik uchun. */
export function nameMatches(db: Database, companyId: string, text: string) {
  const tokens = nameTokens(text);
  if (!tokens.length) return { tokens, hits: [] as EmployeeHit[] };
  const matchedTokens = tokens.filter((token) => {
    const variants = forms(token);
    return db.employees.some(
      (e) => e.companyId === companyId && [e.firstName, e.lastName, e.middleName || ""].map(nameKey).some((p) => p && variants.includes(p)),
    );
  });
  if (!matchedTokens.length) return { tokens, hits: [] as EmployeeHit[] };
  return { tokens: matchedTokens, hits: searchEmployees(db, companyId, matchedTokens.join(" ")).filter((h) => h.exact) };
}

/** Matndagi aniq ID / xodim raqami (masalan «ID 001», «#E-1001», «E-1001»). */
export function explicitReference(text: string) {
  return (
    text.match(/(?:^|[\s,.;:(])(?:id|ID|Id|raqam)(?:si|li|lik|i)?\s*[:#-]?\s*([a-zA-Z0-9_-]*\d[a-zA-Z0-9_-]*)/u)?.[1] ||
    text.match(/#([a-zA-Z0-9_-]{1,64})/)?.[1] ||
    text.match(/\b([A-Za-z]{1,3}-\d{2,})\b/)?.[1]
  );
}

/** Raqamli so‘z xodim raqamiga teng bo‘lsa (masalan «001 kim?»). */
export function numberReference(db: Database, companyId: string, text: string) {
  for (const token of text.match(/\b\d{2,12}\b/g) || []) {
    const employee = db.employees.find((e) => e.companyId === companyId && nameKey(e.employeeNo || "") === token);
    if (employee) return employee;
  }
  return undefined;
}

const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent" }).format(new Date());
const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Savoldagi sana: «kecha», «2026-11-18», «18.11.2026». Topilmasa — undefined (bugun). */
export function dateIn(text: string) {
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];
  const dmy = text.match(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  const lower = text.toLocaleLowerCase("uz");
  if (/(^|[\s,.])(kecha|вчера)/u.test(lower)) return shift(todayIso(), -1);
  if (/o['‘’`]?tgan kun|avvalgi kun|позавчера/u.test(lower)) return shift(todayIso(), -2);
  return undefined;
}

/** Savolda nomi aytilgan filial. */
export function branchIn(db: Database, companyId: string, text: string): Branch | undefined {
  const padded = ` ${tokensOf(text).join(" ")} `;
  return db.branches
    .filter((b) => b.companyId === companyId)
    .map((b) => ({ b, key: tokensOf(b.name).join(" ") }))
    .filter(({ key }) => key.length >= 3)
    .sort((a, b) => b.key.length - a.key.length)
    .find(({ key }) => [" ", "da ", "dagi ", "ning ", "ga "].some((end) => padded.includes(` ${key}${end}`)))?.b;
}

export const STATE_LABEL: Record<string, { text: string; tone: "green" | "amber" | "red" | "blue" | "gray" }> = {
  IN: { text: "Ishda", tone: "green" },
  LEFT: { text: "Ketgan", tone: "blue" },
  ABSENT: { text: "Kelmagan", tone: "red" },
  ON_LEAVE: { text: "Ta’tilda", tone: "gray" },
  DAY_OFF: { text: "Dam olish kuni", tone: "gray" },
  NOT_YET: { text: "Hali kelmagan", tone: "amber" },
  UPCOMING: { text: "Smenasi boshlanmagan", tone: "gray" },
  PRACTICE: { text: "Mashq davri", tone: "gray" },
};
