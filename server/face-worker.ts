import { parentPort } from "node:worker_threads";
import { computeFace, warmUp } from "./face-engine";

/* Alohida oqim: yuz deskriptorini hisoblaydi — asosiy server (sayt, Mini App, API) bloklanmaydi. */
parentPort?.on("message", (job: { id: number; photo: string; warm?: boolean }) => {
  (job.warm ? warmUp().then(() => null) : computeFace(job.photo))
    .then((face) => parentPort?.postMessage({ id: job.id, face }))
    .catch((error: Error & { status?: number }) => parentPort?.postMessage({ id: job.id, error: error.message, status: error.status }));
});
