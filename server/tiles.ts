import { Router } from "express";
import { rateLimit } from "express-rate-limit";

/*
 * Xarita plitkalari (OpenStreetMap) server orqali: ilova va Mini App plitkalarni o‘z serverimizdan
 * oladi — mobil tarmoqda OSM sekin/bloklangan bo‘lsa ham xarita chiqadi, takroriy so‘rovlar keshdan.
 * Manba: MAP_TILE_UPSTREAM (standart — tile.openstreetmap.org). OSM foydalanish qoidasiga ko‘ra
 * aniq User-Agent yuboriladi va plitkalar keshlanadi.
 */

const UPSTREAM = process.env.MAP_TILE_UPSTREAM || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const AGENT = `Staffora/1.0 (${process.env.APP_URL || "staffora"})`;
const MAX_CACHE = 3000;
const cache = new Map<string, { body: Buffer; type: string; at: number }>();
const inflight = new Map<string, Promise<{ body: Buffer; type: string } | null>>();
const TTL_MS = 7 * 86_400_000;

async function fetchTile(key: string, url: string) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) {
    // LRU: oxirgi ishlatilgan oxiriga.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  let job = inflight.get(key);
  if (!job) {
    job = (async () => {
      try {
        const response = await fetch(url, { headers: { "user-agent": AGENT, accept: "image/png,image/*" }, signal: AbortSignal.timeout(10_000) });
        if (!response.ok) return hit || null;
        const body = Buffer.from(await response.arrayBuffer());
        const value = { body, type: response.headers.get("content-type") || "image/png", at: Date.now() };
        cache.set(key, value);
        if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
        return value;
      } catch {
        return hit || null;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, job);
  }
  return job;
}

export function createTileRouter() {
  const router = Router();
  router.get(
    "/tiles/:z/:x/:y.png",
    rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false }),
    (req, res, next) => {
      const z = Number(req.params.z);
      const x = Number(req.params.x);
      const y = Number(req.params.y);
      const max = 2 ** z;
      if (![z, x, y].every(Number.isInteger) || z < 0 || z > 19 || x < 0 || y < 0 || x >= max || y >= max) return res.status(400).end();
      const key = `${z}/${x}/${y}`;
      const url = UPSTREAM.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
      fetchTile(key, url)
        .then((tile) => {
          if (!tile) return res.status(502).end();
          res.set("content-type", tile.type);
          res.set("cache-control", "public, max-age=604800, immutable");
          res.send(tile.body);
        })
        .catch(next);
    },
  );
  return router;
}
