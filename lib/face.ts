export const FACE_DESCRIPTOR_SIZE = 128;

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

export function faceMatchThreshold() {
  const configured = Number(process.env.FACE_MATCH_THRESHOLD || 0.5);
  return Number.isFinite(configured) && configured >= 0.3 && configured <= 0.8
    ? configured
    : 0.5;
}
