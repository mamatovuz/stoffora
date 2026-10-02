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
type Job = { id: number; photo: string; resolve: (face: ServerFace | null) => void; reject: (error: Error) => void; timer?: NodeJS.Timeout };

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
  worker.postMessage({ id: job.id, photo: job.photo });
}

/** Kadrdan bitta yuzni topib, 128 o‘lchamli deskriptorini qaytaradi (yuz bo‘lmasa — null). */
export function describeFace(jpegBase64: string): Promise<ServerFace | null> {
  if (queue.length >= MAX_QUEUE)
    return Promise.reject(Object.assign(new Error("Server band — bir soniyadan keyin qayta urinib ko‘ring."), { status: 503, code: "FACE_BUSY" }));
  return new Promise((resolve, reject) => {
    queue.push({ id: ++seq, photo: jpegBase64, resolve, reject });
    pump();
  });
}
