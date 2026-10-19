import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import type { ServerFace } from "./face-engine";

export type { ServerFace } from "./face-engine";

/*
 * Server tomonidagi Face ID — alohida oqimda (worker_threads). Yuz hisoblash CPU’ni bir necha
 * yuz millisoniya band qiladi; asosiy oqimda bo‘lsa, ilova kadrlari kelib turganda sayt va
 * Mini App javob bermay qolardi. Navbat cheklangan: band bo‘lsa — darhol 503 (ilova qayta urinadi).
 */

const MAX_QUEUE = 4;
const JOB_TIMEOUT_MS = 20_000;
/** Bir kadr natijasi qisqa muddat eslab qolinadi: ilova jonli tekshiruvda yuborgan kadrlarni yakuniy
 *  tasdiqda qayta yuboradi — ular qayta hisoblanmaydi (tasdiq deyarli bir zumda). */
const CACHE_TTL_MS = 3 * 60_000;
const CACHE_MAX = 64;
type Job = { id: number; photo: string; warm?: boolean; resolve: (face: ServerFace | null) => void; reject: (error: Error) => void; timer?: NodeJS.Timeout };

let worker: Worker | null = null;
let current: Job | null = null;
const queue: Job[] = [];
let seq = 0;

function workerFile() {
  const built = path.join(process.cwd(), "dist-server", "face-worker.mjs");
  const fromDist = (process.argv[1] || "").includes("dist-server");
  if (fromDist && existsSync(built)) return { file: built, execArgv: [] as string[] };
  return { file: path.join(process.cwd(), "server", "face-worker.ts"), execArgv: ["--import", "tsx"] };
}

function spawn() {
  const { file, execArgv } = workerFile();
  const next = new Worker(file, { execArgv, resourceLimits: { maxOldGenerationSizeMb: 384 } });
  next.unref();
  next.on("message", (msg: { id: number; face?: ServerFace | null; error?: string; status?: number }) => {
    const job = current;
    if (!job || job.id !== msg.id) return;
    clearTimeout(job.timer);
    current = null;
    if (msg.error) job.reject(Object.assign(new Error(msg.error), { status: msg.status || 500 }));
    else job.resolve(msg.face ?? null);
    pump();
  });
  const fail = (reason: unknown) => {
    if (worker === next) worker = null;
    const job = current;
    current = null;
    if (job) {
      clearTimeout(job.timer);
      job.reject(Object.assign(new Error("Face ID hisoblashda xato. Qayta urinib ko‘ring."), { status: 503, cause: reason }));
    }
    pump();
  };
  next.on("error", fail);
  next.on("exit", (code) => code !== 0 && fail(code));
  return next;
}

function pump() {
  if (current || !queue.length) return;
  worker ||= spawn();
  const job = queue.shift()!;
  current = job;
  job.timer = setTimeout(() => {
    // Osilib qolgan hisob — oqim qayta ishga tushiriladi.
    const stuck = worker;
    worker = null;
    current = null;
    job.reject(Object.assign(new Error("Face ID javob bermadi. Qayta urinib ko‘ring."), { status: 503 }));
    void stuck?.terminate();
    pump();
  }, JOB_TIMEOUT_MS);
  worker.postMessage({ id: job.id, photo: job.photo, warm: job.warm });
}

let warmed = false;
/**
 * Face ID oqimini fonda tayyorlash (modellar yuklanadi, birinchi hisob bajariladi).
 * Mobil ilova bosh sahifani ochganda chaqiriladi — xodim «Ishga keldim»ni bosguncha tayyor bo‘ladi.
 */
export function warmFaceWorker() {
  if (warmed || current || queue.length) return;
  warmed = true;
  queue.push({ id: ++seq, photo: "", warm: true, resolve: () => undefined, reject: () => (warmed = false) });
  pump();
}

const cache = new Map<string, { at: number; face: Promise<ServerFace | null> }>();
const cacheKey = (photo: string) => createHash("sha256").update(photo.replace(/^data:image\/\w+;base64,/, "")).digest("base64url");

/** Kadrdan bitta yuzni topib, 128 o‘lchamli deskriptorini qaytaradi (yuz bo‘lmasa — null). */
export function describeFace(jpegBase64: string): Promise<ServerFace | null> {
  const key = cacheKey(jpegBase64);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.face;
  const face = compute(jpegBase64);
  cache.set(key, { at: now, face });
  face.catch(() => cache.delete(key));
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return face;
}

function compute(jpegBase64: string): Promise<ServerFace | null> {
  if (queue.length >= MAX_QUEUE)
    return Promise.reject(Object.assign(new Error("Server band — bir soniyadan keyin qayta urinib ko‘ring."), { status: 503, code: "FACE_BUSY" }));
  return new Promise((resolve, reject) => {
    queue.push({ id: ++seq, photo: jpegBase64, resolve, reject });
    pump();
  });
}
