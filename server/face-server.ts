import { createRequire } from "node:module";
import path from "node:path";
import { existsSync } from "node:fs";

/*
 * Server tomonida yuz deskriptori (native mobil ilova uchun).
 *
 * Mini App deskriptorni brauzerda hisoblaydi. Native ilova esa faqat JPEG kadr yuboradi —
 * deskriptorni server o‘zi hisoblaydi (mijoz soxta vektor yubora olmaydi). Mini App’dagi
 * bilan bir xil modellar (face-api: TinyFaceDetector + 68 nuqta + ResNet deskriptor), TF.js WASM.
 * Modellar birinchi so‘rovda bir marta yuklanadi.
 */

type FaceApi = typeof import("@vladmandic/face-api");
type Tf = typeof import("@tensorflow/tfjs");

const require = createRequire(import.meta.url);
let ready: Promise<{ faceapi: FaceApi; tf: Tf }> | null = null;

function modelDir() {
  const candidates = [
    path.join(process.cwd(), "public", "face-models"),
    path.join(process.cwd(), "dist", "face-models"),
    path.join(process.cwd(), "node_modules", "@vladmandic", "face-api", "model"),
  ];
  const found = candidates.find((dir) => existsSync(path.join(dir, "tiny_face_detector_model-weights_manifest.json")));
  if (!found) throw new Error("Face ID modellari topilmadi (public/face-models).");
  return found;
}

async function init() {
  // face-api’ning Node/WASM varianti: @tensorflow/tfjs + wasm backend.
  const faceapi = require("@vladmandic/face-api/dist/face-api.node-wasm.js") as FaceApi;
  const tf = faceapi.tf as unknown as Tf & { setBackend: (name: string) => Promise<boolean>; ready: () => Promise<void> };
  const wasm = require("@tensorflow/tfjs-backend-wasm") as { setWasmPaths: (prefix: string) => void };
  wasm.setWasmPaths(`${path.dirname(require.resolve("@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm"))}${path.sep}`);
  await tf.setBackend("wasm");
  await tf.ready();
  const dir = modelDir();
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromDisk(dir),
    faceapi.nets.faceLandmark68TinyNet.loadFromDisk(dir),
    faceapi.nets.faceRecognitionNet.loadFromDisk(dir),
  ]);
  return { faceapi, tf };
}

export function faceEngine() {
  if (!ready)
    ready = init().catch((reason) => {
      ready = null;
      throw reason;
    });
  return ready;
}

export type ServerFace = {
  descriptor: number[];
  /** Yuz qutisi (kadr o‘lchamiga nisbatan 0–1) — ilovada ramka chizish uchun. */
  box: { x: number; y: number; width: number; height: number };
  score: number;
  /** Bosh burilishi (yaw) va egilishi — «to‘g‘ri qarang» tekshiruvi uchun. */
  yaw: number;
  roll: number;
  /** Yuz sohasining yorqinligi (0–255). */
  light: number;
};

/** data:image/jpeg;base64,… yoki toza base64 → JPEG piksellar. */
function decode(jpegBase64: string) {
  const jpeg = require("jpeg-js") as { decode: (data: Buffer, opts: object) => { width: number; height: number; data: Uint8Array } };
  const raw = Buffer.from(jpegBase64.replace(/^data:image\/\w+;base64,/, ""), "base64");
  if (raw.length > 1_500_000) throw Object.assign(new Error("Rasm juda katta."), { status: 413 });
  return jpeg.decode(raw, { useTArray: true, formatAsRGBA: false, maxMemoryUsageInMB: 64 });
}

/** Kadrdan bitta yuzni topib, 128 o‘lchamli deskriptorini qaytaradi (yuz bo‘lmasa — null). */
export async function describeFace(jpegBase64: string): Promise<ServerFace | null> {
  const { faceapi, tf } = await faceEngine();
  const image = decode(jpegBase64);
  const tensor = tf.tensor3d(image.data, [image.height, image.width, 3], "int32");
  try {
    const result = await faceapi
      .detectSingleFace(tensor as never, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.45 }))
      .withFaceLandmarks(true)
      .withFaceDescriptor();
    if (!result) return null;
    const box = result.detection.box;
    const p = result.landmarks.positions;
    const avg = (from: number, to: number) => {
      const slice = p.slice(from, to + 1);
      return { x: slice.reduce((s, q) => s + q.x, 0) / slice.length, y: slice.reduce((s, q) => s + q.y, 0) / slice.length };
    };
    const left = avg(36, 41);
    const right = avg(42, 47);
    const eye = Math.hypot(right.x - left.x, right.y - left.y) || 1;
    const yaw = (p[30].x - (left.x + right.x) / 2) / eye;
    const roll = Math.atan2(right.y - left.y, right.x - left.x);
    // Yuz sohasi yorqinligi (har 4-piksel — tez).
    let sum = 0;
    let n = 0;
    const x0 = Math.max(0, Math.floor(box.x));
    const y0 = Math.max(0, Math.floor(box.y));
    const x1 = Math.min(image.width, Math.floor(box.x + box.width));
    const y1 = Math.min(image.height, Math.floor(box.y + box.height));
    for (let y = y0; y < y1; y += 4)
      for (let x = x0; x < x1; x += 4) {
        const i = (y * image.width + x) * 3;
        sum += 0.299 * image.data[i] + 0.587 * image.data[i + 1] + 0.114 * image.data[i + 2];
        n += 1;
      }
    return {
      descriptor: Array.from(result.descriptor),
      box: { x: box.x / image.width, y: box.y / image.height, width: box.width / image.width, height: box.height / image.height },
      score: result.detection.score,
      yaw,
      roll,
      light: n ? sum / n : 0,
    };
  } finally {
    tensor.dispose();
  }
}
