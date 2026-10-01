import jwt from "jsonwebtoken";

/*
 * Yuz (yoki telefon biometriyasi) tasdig‘i — davomat sessiyasini ochish uchun
 * 3 daqiqalik imzolangan dalil.
 */

export type FaceProofMethod = "FACE" | "BIOMETRIC";
export type FaceProofPayload = { type: "FACE_VERIFICATION"; employeeId: string; companyId: string; method?: FaceProofMethod };

const faceSecret = () => process.env.JWT_SECRET || "staffora-local-face-secret-change-me";

export function signFaceProof(employeeId: string, companyId: string, method: FaceProofMethod = "FACE") {
  return jwt.sign({ type: "FACE_VERIFICATION", employeeId, companyId, method }, faceSecret(), { expiresIn: 180, issuer: "staffora-face" });
}

/** Dalilni tekshiradi; yaroqsiz yoki muddati o‘tgan bo‘lsa — null. */
export function verifyFaceProof(proof: string): FaceProofPayload | null {
  try {
    const payload = jwt.verify(proof, faceSecret(), { issuer: "staffora-face" }) as FaceProofPayload;
    return payload.type === "FACE_VERIFICATION" ? payload : null;
  } catch {
    return null;
  }
}
