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

/**
 * Moslik foizi (ekranda ko‘rsatiladi): chegara masofasi (standart 0,5) = 65%.
 * Shu sababli «65% dan yuqori — yashil» qoidasi chegarani o‘zgartirganda ham ma’noli qoladi.
 */
export function matchPercent(distance: number) {
  return Math.max(0, Math.min(100, Math.round(100 - distance * 70)));
}
export const matchPassPercent = (threshold = faceMatchThreshold()) => matchPercent(threshold);

export function faceMatchThreshold() {
  const configured = Number(process.env.FACE_MATCH_THRESHOLD || 0.5);
  return Number.isFinite(configured) && configured >= 0.3 && configured <= 0.8
    ? configured
    : 0.5;
}

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
  const sampleDistances = [...(profile.samples || []), ...(profile.adaptiveSamples || [])]
    .map((sample) => faceDistance(sample, candidate))
    .sort((a, b) => a - b);
  const nearest = sampleDistances.length
    ? sampleDistances
        .slice(0, 2)
        .reduce((sum, value, _, list) => sum + value / list.length, 0)
    : centerDistance;
  const distance = Math.min(centerDistance, (centerDistance + nearest) / 2);
  return {
    matched: distance <= threshold && centerDistance <= threshold + 0.08,
    distance,
    score: matchPercent(distance),
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
  if (match.distance > threshold * 0.8) return false;
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
