// Oddiy yuklama sinovi: node scripts/load-test.mjs [url=http://localhost:4000] [soniya=10] [ulanishlar=20]
import autocannon from "autocannon";

const base = process.argv[2] || "http://localhost:4000";
const duration = Number(process.argv[3] || 10);
const connections = Number(process.argv[4] || 20);

const login = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "load@test.uz", password: "Parol12345!" }),
});
const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
if (!cookie) throw new Error(`Login bo‘lmadi: ${login.status}`);

// Sinov davomida serverning "qotish" darajasini o‘lchash: /health javob vaqti.
let maxHealth = 0;
const probe = setInterval(async () => {
  const t = performance.now();
  try {
    await fetch(`${base}/health`);
  } catch {}
  maxHealth = Math.max(maxHealth, performance.now() - t);
}, 200);

for (const path of ["/api/auth/me", "/api/dashboard", "/api/employees?limit=50", "/api/attendance/day"]) {
  maxHealth = 0;
  const result = await autocannon({
    url: base + path,
    connections,
    duration,
    headers: { cookie, "accept-encoding": "gzip" },
  });
  console.log(
    `${path.padEnd(26)} ${String(Math.round(result.requests.average)).padStart(6)} req/s | ` +
      `p50 ${result.latency.p50} ms | p99 ${result.latency.p99} ms | ` +
      `xato ${result.errors + result.non2xx} | ` +
      `javob ${Math.round(result.throughput.average / Math.max(1, result.requests.average) / 1024)} KB | ` +
      `/health max ${Math.round(maxHealth)} ms`,
  );
}
clearInterval(probe);
