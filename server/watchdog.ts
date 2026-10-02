import { Worker } from "node:worker_threads";

/*
 * Nazoratchi (watchdog): asosiy oqim har 2 soniyada «tirikman» signali beradi. Alohida oqim
 * WATCHDOG_TIMEOUT_MS (standart 45 s) davomida signal olmasa — server qotib qolgan deb
 * jarayonni to‘xtatadi; Railway (restartPolicy: ALWAYS) uni darhol yangisi bilan almashtiradi.
 * Ma’lumotlar SQLite’da (diskda) — qayta ishga tushganda hech narsa yo‘qolmaydi.
 */
export function startWatchdog() {
  if (process.env.WATCHDOG === "false" || process.env.NODE_ENV !== "production") return;
  const timeout = Number(process.env.WATCHDOG_TIMEOUT_MS) || 45_000;
  const shared = new Int32Array(new SharedArrayBuffer(4));
  const code = `
    const { workerData } = require("node:worker_threads");
    const beat = workerData.beat;
    let last = Atomics.load(beat, 0), seen = Date.now();
    setInterval(() => {
      const now = Atomics.load(beat, 0);
      if (now !== last) { last = now; seen = Date.now(); return; }
      if (Date.now() - seen > workerData.timeout) {
        console.error("[watchdog] Asosiy oqim " + Math.round((Date.now() - seen) / 1000) + " s javob bermadi — server qayta ishga tushiriladi.");
        process.kill(process.pid, "SIGKILL");
      }
    }, 2000);`;
  const worker = new Worker(code, { eval: true, workerData: { beat: shared, timeout } });
  worker.unref();
  setInterval(() => Atomics.add(shared, 0, 1), 2000).unref();
}
