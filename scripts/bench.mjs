// Ketma-ket (shovqinsiz) o‘lchov: node scripts/bench.mjs [url]
const base = process.argv[2] || "http://localhost:4000";
const login = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "load@test.uz", password: "Parol12345!" }),
});
const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
const headers = { cookie, "accept-encoding": "gzip", "content-type": "application/json" };

async function timeIt(label, fn, runs = 30) {
  const times = [];
  for (let i = 0; i < runs; i += 1) {
    const t = performance.now();
    await fn(i);
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const avg = times.reduce((s, x) => s + x, 0) / times.length;
  console.log(`${label.padEnd(30)} o‘rtacha ${avg.toFixed(1).padStart(7)} ms | p95 ${times[Math.floor(runs * 0.95)].toFixed(1).padStart(7)} ms`);
}
for (const path of ["/api/auth/me", "/api/dashboard", "/api/employees?limit=50", "/api/attendance/day", "/api/payroll"])
  await timeIt(path, async () => {
    const r = await fetch(base + path, { headers });
    await r.arrayBuffer();
    if (!r.ok) throw new Error(`${path} ${r.status}`);
  });

// Yozish: 100 ta parallel davomat yozuvi (masalan, soat 9:00 dagi to‘lqin)
const employees = (await (await fetch(`${base}/api/employees?limit=200`, { headers })).json()).items;
const date = "2026-10-01"; // kelajak sana taqiqlangan bo‘lsa, bugunni ishlatamiz
const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
const targets = employees.slice(0, 100);
const t = performance.now();
const results = await Promise.all(
  targets.map((e) =>
    fetch(`${base}/api/attendance`, {
      method: "POST",
      headers,
      body: JSON.stringify({ employeeId: e.id, date: today > date ? date : today, checkIn: "08:59" }),
    }).then((r) => r.status),
  ),
);
const ok = results.filter((s) => s === 201).length;
const dup = results.filter((s) => s === 409).length;
console.log(`100 ta parallel yozish: ${(performance.now() - t).toFixed(0)} ms | 201: ${ok}, 409 (allaqachon bor): ${dup}, boshqa: ${100 - ok - dup}`);
