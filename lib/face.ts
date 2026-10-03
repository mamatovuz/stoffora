export const FACE_DESCRIPTOR_SIZE = 128;
export const FACE_ENROLL_MIN_SAMPLES = 3;
export const FACE_ENROLL_MAX_SAMPLES = 8;

export function assertFaceDescriptor(descriptor: number[]) {
  if (
    descriptor.length !== FACE_DESCRIPTOR_SIZE ||
    descriptor.some((value) => !Number.isFinite(value) || Math.abs(value) > 10)
  )
    throw Object.assign(new Error("Yuz biometrik vektori yaroqsiz."), {
      status: 400,
    });
}

export function faceDistance(reference: number[], candidate: number[]) {
  assertFaceDescriptor(reference);
  assertFaceDescriptor(candidate);
  return Math.sqrt(
    reference.reduce(
      (sum, value, index) => sum + (value - candidate[index]) ** 2,
      0,
    ),
  );
}

/** Moslikdan o‘tish foizi — chegara masofasi har doim shu foizga to‘g‘ri keladi. */
export const FACE_PASS_PERCENT = 75;
/**
 * Moslik foizi (ekranda ko‘rsatiladi). Chegara masofasi = 75%; chegaradan pastda 75–100%,
 * chegaradan oshgach foiz TEZ tushadi (begona odam «71%» ko‘rinib, chalg‘itmasin).
 */
export function matchPercent(distance: number, threshold = faceMatchThreshold()) {
  const value = distance <= threshold ? 100 - (distance / threshold) * 25 : 75 - ((distance - threshold) / 0.2) * 75;
  return Math.max(0, Math.min(100, Math.round(value)));
}
export const matchPassPercent = (_threshold = faceMatchThreshold()) => FACE_PASS_PERCENT;

/**
 * Masofa chegarasi (face-api ResNet deskriptori). 0,4 — bir odam uchun odatiy 0,25–0,38,
 * o‘xshash begona odamlar 0,4–0,55 oralig‘ida. FACE_MATCH_THRESHOLD bilan o‘zgartirish mumkin.
 */
export function faceMatchThreshold() {
  // Brauzerda (Mini App) process yo‘q — standart chegara.
  const configured = Number((typeof process !== "undefined" ? process.env?.FACE_MATCH_THRESHOLD : undefined) || 0.4);
  return Number.isFinite(configured) && configured >= 0.3 && configured <= 0.6
    ? configured
    : 0.4;
}
/** Moslashuvchan namuna markazdan shu masofadan uzoq bo‘lsa — e’tiborga olinmaydi (profil siljimaydi). */
export const ADAPTIVE_MAX_FROM_CENTER = 0.32;

export function meanDescriptor(samples: number[][]) {
  if (!samples.length)
    throw Object.assign(new Error("Yuz namunalari topilmadi."), {
      status: 400,
    });
  samples.forEach(assertFaceDescriptor);
  return Array.from(
    { length: FACE_DESCRIPTOR_SIZE },
    (_, index) =>
      samples.reduce((sum, sample) => sum + sample[index], 0) / samples.length,
  );
}

/**
 * Ro‘yxatdan o‘tish namunalari bir odamga tegishli va barqaror ekanini tekshiradi.
 * Namunalar orasidagi masofa katta bo‘lsa — kadrda boshqa odam yoki sifatsiz tasvir.
 */
export function assertConsistentSamples(
  samples: number[][],
  threshold = faceMatchThreshold(),
) {
  if (
    samples.length < FACE_ENROLL_MIN_SAMPLES ||
    samples.length > FACE_ENROLL_MAX_SAMPLES
  )
    throw Object.assign(
      new Error(
        `Face ID uchun ${FACE_ENROLL_MIN_SAMPLES}–${FACE_ENROLL_MAX_SAMPLES} ta namuna kerak.`,
      ),
      { status: 400 },
    );
  samples.forEach(assertFaceDescriptor);
  const center = meanDescriptor(samples);
  const worst = Math.max(...samples.map((item) => faceDistance(center, item)));
  if (worst > threshold)
    throw Object.assign(
      new Error(
        "Yuz namunalari bir-biriga mos kelmadi. Yorug‘ joyda, kameraga to‘g‘ri qarab qayta urinib ko‘ring.",
      ),
      { status: 422 },
    );
  const duplicates = samples.some((item, index) =>
    samples.some(
      (other, otherIndex) =>
        otherIndex > index && faceDistance(item, other) < 0.0005,
    ),
  );
  if (duplicates)
    throw Object.assign(
      new Error("Namunalar jonli kameradan olinmaganga o‘xshaydi."),
      { status: 422 },
    );
  return center;
}

/**
 * Profil bilan solishtirish: markaziy deskriptor va eng yaqin ikki namunaning
 * o‘rtachasini birga hisobga oladi. Bitta tasodifiy o‘xshash namuna yetarli emas.
 */
export function matchFace(
  profile: { descriptor: number[]; samples?: number[][]; adaptiveSamples?: number[][] },
  candidate: number[],
  threshold = faceMatchThreshold(),
) {
  assertFaceDescriptor(candidate);
  const centerDistance = faceDistance(profile.descriptor, candidate);
  // Ro‘yxatdan o‘tishdagi namunalar + oxirgi ishonchli tekshiruvlar (vaqt o‘tishi bilan o‘zgarishga moslashadi).
  // Moslashuvchan namunalar faqat ro‘yxatdagi markazga yaqin bo‘lsa (ilgari xato qo‘shilganlari ham chetlanadi).
  const adaptive = (profile.adaptiveSamples || []).filter((s) => s.length === FACE_DESCRIPTOR_SIZE && faceDistance(profile.descriptor, s) <= ADAPTIVE_MAX_FROM_CENTER);
  const sampleDistances = [...(profile.samples || []), ...adaptive]
    .map((sample) => faceDistance(sample, candidate))
    .sort((a, b) => a - b);
  const nearest = sampleDistances.length
    ? sampleDistances
        .slice(0, 2)
        .reduce((sum, value, _, list) => sum + value / list.length, 0)
    : centerDistance;
  const distance = Math.min(centerDistance, (centerDistance + nearest) / 2);
  return {
    matched: distance <= threshold && centerDistance <= threshold + 0.04,
    distance,
    centerDistance,
    score: matchPercent(distance, threshold),
  };
}

export const ADAPTIVE_SAMPLES_MAX = 6;

/**
 * Ishonchli moslikdan keyin profilni yangilaydi: yangi yuz namunasi moslashuvchan
 * ro‘yxatga qo‘shiladi (eng eskisi chiqadi). Faqat aniq mos kelganda (chegaradan
 * ancha past) va mavjud namunalardan farq qilsa — profil boshqa odamga «siljib» ketmaydi,
 * chunki markaziy (ro‘yxatdagi) deskriptor o‘zgarmaydi va baribir tekshiriladi.
 */
export function adaptProfile(
  profile: { adaptiveSamples?: number[][] },
  candidate: number[],
  match: { distance: number },
  threshold = faceMatchThreshold(),
) {
  // Faqat juda aniq moslik va ro‘yxatdagi markazga yaqin bo‘lsa — boshqa odam profilga «kirib qolmaydi».
  if (match.distance > threshold * 0.7) return false;
  if ("descriptor" in profile && Array.isArray((profile as { descriptor?: number[] }).descriptor)) {
    if (faceDistance((profile as { descriptor: number[] }).descriptor, candidate) > ADAPTIVE_MAX_FROM_CENTER * 0.9) return false;
  }
  const pool = profile.adaptiveSamples || [];
  if (pool.some((sample) => faceDistance(sample, candidate) < 0.06)) return false;
  profile.adaptiveSamples = [...pool, candidate].slice(-ADAPTIVE_SAMPLES_MAX);
  return true;
}

/**
 * Jonlilik: bosh burilgan kadr to‘g‘ri kadrdan sezilarli farq qilishi kerak.
 * Bir xil rasm yoki ekrandagi surat ko‘rsatilsa ikki deskriptor deyarli bir xil chiqadi.
 */
export function assertPoseVariation(front: number[], turned: number[]) {
  if (faceDistance(front, turned) < 0.03)
    throw Object.assign(new Error("Bosh burilmadi — jonli tekshiruv o‘tmadi. Boshingizni ko‘rsatilgan tomonga buring."), { status: 422 });
}

/**
 * Kundalik Face ID kadridan profil rasmini yangilash kerakmi:
 * faqat yuz aniq mos kelganda (chegaradan ancha past) va kadr avvalgisidan sezilarli
 * sifatliroq bo‘lsa — yoki joriy rasm 30 kundan eski bo‘lib, yangisi yetarlicha sifatli bo‘lsa.
 */
export function shouldRefreshPhoto(input: {
  distance: number;
  quality?: number;
  currentQuality?: number;
  photoUpdatedAt?: string;
  threshold?: number;
  now?: number;
}) {
  const threshold = input.threshold ?? faceMatchThreshold();
  if (input.quality === undefined || !Number.isFinite(input.quality) || input.quality < 0.35) return false;
  if (input.distance > threshold * 0.75) return false;
  const current = input.currentQuality ?? 0;
  if (input.quality >= current + 0.05) return true;
  const age = (input.now ?? Date.now()) - (input.photoUpdatedAt ? Date.parse(input.photoUpdatedAt) : 0);
  return age > 30 * 86_400_000 && input.quality >= current * 0.9;
}

/** Aynan bir xil deskriptor qayta yuborilsa — bu yozib olingan so‘rov (replay). */
export function isReplayedDescriptor(
  previous: number[] | undefined,
  candidate: number[],
) {
  if (!previous || previous.length !== FACE_DESCRIPTOR_SIZE) return false;
  return faceDistance(previous, candidate) < 0.0005;
}

type FaceProfileLike = { employeeId: string; descriptor: number[]; samples?: number[][]; adaptiveSamples?: number[][] };
export type IdentityResult = {
  matched: boolean;
  distance: number;
  percent: number;
  /** MISMATCH — profilga mos emas; UNSTABLE — kadrlar bir-biriga zid; LOOKALIKE — boshqa xodimga ko‘proq/teng o‘xshaydi. */
  reason?: "MISMATCH" | "UNSTABLE" | "LOOKALIKE";
  /** LOOKALIKE bo‘lsa — kimga o‘xshadi (audit uchun, xodimga ko‘rsatilmaydi). */
  lookalikeEmployeeId?: string;
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Yakuniy Face ID qarori (server):
 *  1) bir nechta kadr — mediana chegaradan past, eng yomon kadr ham chegaraga yaqin bo‘lishi shart;
 *  2) 1:N tekshiruv — kompaniyadagi boshqa xodimlar profillari bilan solishtiriladi. Yuz boshqa xodimga
 *     o‘zinikidan yaqinroq (yoki deyarli teng) bo‘lsa — RAD (hamkasb o‘rniga belgilashning oldini oladi).
 */
export function verifyIdentity(profile: FaceProfileLike, candidates: number[][], others: FaceProfileLike[] = [], threshold = faceMatchThreshold()): IdentityResult {
  if (!candidates.length) throw Object.assign(new Error("Yuz namunalari topilmadi."), { status: 400 });
  const matches = candidates.map((c) => matchFace(profile, c, threshold));
  const distance = median(matches.map((m) => m.distance));
  const worst = Math.max(...matches.map((m) => m.distance));
  const percent = matchPercent(distance, threshold);
  if (distance > threshold || matches.filter((m) => m.matched).length < Math.ceil(candidates.length / 2)) return { matched: false, distance, percent, reason: "MISMATCH" };
  if (worst > threshold + 0.08) return { matched: false, distance, percent, reason: "UNSTABLE" };
  let closest: { id: string; distance: number } | null = null;
  for (const other of others) {
    if (other.employeeId === profile.employeeId || other.descriptor?.length !== FACE_DESCRIPTOR_SIZE) continue;
    const d = median(candidates.map((c) => matchFace(other, c, threshold).distance));
    if (!closest || d < closest.distance) closest = { id: other.employeeId, distance: d };
  }
  // Boshqa xodimga ham chegaradan o‘tadigan darajada o‘xshash va farq juda kichik — ishonchli emas.
  if (closest && closest.distance <= threshold + 0.03 && closest.distance < distance + 0.06)
    return { matched: false, distance, percent: Math.min(percent, FACE_PASS_PERCENT - 1), reason: "LOOKALIKE", lookalikeEmployeeId: closest.id };
  return { matched: true, distance, percent };
}
