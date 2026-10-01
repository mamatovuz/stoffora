import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Building2, LocateFixed, Minus, Plus } from "lucide-react";

/*
 * Yengil xarita (kutubxonasiz): OpenStreetMap asosidagi CARTO plitkalari, Web Mercator.
 * Surish (barmoq/sichqoncha), kattalashtirish (tugmalar, ikki barmoq, g‘ildirak, ikki marta bosish),
 * radius doiralari va avatar-pinlar. Plitkalar yuklanmasa — to‘r fonida ishlashda davom etadi.
 */

export type MapPoint = {
  id: string;
  lat: number;
  lng: number;
  kind: "person" | "branch";
  label: string;
  initials?: string;
  photo?: string;
  tone: "ok" | "warn" | "bad" | "info" | "muted";
  /** Pin ustidagi kichik yozuv (masalan, filialda «12/15»). */
  badge?: string;
  /** GPS aniqligi (m) — tanlanganda doira bo‘lib ko‘rinadi. */
  accuracy?: number;
};
export type MapCircle = { id: string; lat: number; lng: number; radius: number; tone?: "accent" | "warn" };

const TILE = 256;
const MIN_ZOOM = 3;
const MAX_ZOOM = 19;
const clampZoom = (z: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

function project(lat: number, lng: number, z: number) {
  const size = TILE * 2 ** z;
  const sin = Math.min(0.9999, Math.max(-0.9999, Math.sin((lat * Math.PI) / 180)));
  return { x: ((lng + 180) / 360) * size, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size };
}
function unproject(x: number, y: number, z: number) {
  const size = TILE * 2 ** z;
  const lng = (x / size) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / size;
  return { lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lng };
}
const metersPerPixel = (lat: number, z: number) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;

/**
 * Xarita mavzusi ilovaning haqiqiy fon rangiga qarab tanlanadi (Telegram mavzusi, foydalanuvchi
 * tanlovi). Tizim mavzusiga qaralmaydi — aks holda yorug‘ ilovada qorong‘i xarita chiqardi.
 */
function isDark() {
  const root = document.documentElement;
  if (root.dataset.miniTheme === "dark") return true;
  if (root.dataset.miniTheme === "light") return false;
  const bg = getComputedStyle(document.querySelector(".mini") || document.body).backgroundColor;
  const [r, g, b] = (bg.match(/\d+(\.\d+)?/g) || ["255", "255", "255"]).map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.45;
}
/**
 * Plitka manbai: standart — OpenStreetMap (kalitsiz, atributsiya bilan). Ko‘p foydalanuvchili
 * ishlab chiqarishda o‘z xizmatingizni ulang: VITE_MAP_TILE_URL="https://…/{z}/{x}/{y}.png?key=…"
 * (serverda MAP_TILE_ORIGIN ham berilsin — CSP ruxsati uchun). Tungi mavzu CSS filtri bilan.
 */
const TILE_TEMPLATE = (import.meta.env.VITE_MAP_TILE_URL as string | undefined) || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = (import.meta.env.VITE_MAP_ATTRIBUTION as string | undefined) || "© OpenStreetMap";
const tileUrl = (z: number, x: number, y: number) => TILE_TEMPLATE.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));

/** Barcha nuqta va doiralarni sig‘diradigan zoom va markaz. */
function fitView(points: { lat: number; lng: number; radius?: number }[], width: number, height: number) {
  if (!points.length) return { zoom: 12, center: { lat: 41.3111, lng: 69.2797 } };
  let best = MIN_ZOOM;
  for (let z = 18; z >= MIN_ZOOM; z -= 1) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      const { x, y } = project(p.lat, p.lng, z);
      const r = (p.radius || 0) / metersPerPixel(p.lat, z);
      minX = Math.min(minX, x - r);
      maxX = Math.max(maxX, x + r);
      minY = Math.min(minY, y - r);
      maxY = Math.max(maxY, y + r);
    }
    if (maxX - minX <= width - 70 && maxY - minY <= height - 90) {
      best = z;
      const center = unproject((minX + maxX) / 2, (minY + maxY) / 2, z);
      return { zoom: best, center };
    }
  }
  const p = points[0];
  return { zoom: best, center: { lat: p.lat, lng: p.lng } };
}

export function TileMap({
  points,
  circles = [],
  selectedId,
  onPick,
  fitKey,
  height = 360,
  children,
}: {
  points: MapPoint[];
  circles?: MapCircle[];
  selectedId?: string | null;
  onPick?: (point: MapPoint | null) => void;
  /** O‘zgarganda xarita hammasini sig‘diradigan holatga qaytadi. */
  fitKey: string;
  height?: number;
  children?: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);
  const [zoom, setZoom] = useState(15);
  const [center, setCenter] = useState({ lat: 41.3111, lng: 69.2797 });
  const [failed, setFailed] = useState(false);
  const [dark, setDark] = useState(isDark);
  const drag = useRef<{ x: number; y: number; center: { x: number; y: number }; moved: boolean } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<number | null>(null);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(200, Math.round(entry.contentRect.width))));
    observer.observe(element);
    // Mavzu o‘zgarishi (ilova sozlamasi yoki Telegram) — CSS yangilangach qayta o‘lchaymiz.
    const onTheme = () => window.setTimeout(() => setDark(isDark()), 50);
    window.addEventListener("staffora:mini-theme", onTheme);
    window.Telegram?.WebApp?.onEvent?.("themeChanged", onTheme);
    return () => {
      observer.disconnect();
      window.removeEventListener("staffora:mini-theme", onTheme);
      window.Telegram?.WebApp?.offEvent?.("themeChanged", onTheme);
    };
  }, []);

  const fitTargets = useMemo(
    () => [...points.map((p) => ({ lat: p.lat, lng: p.lng })), ...circles.map((c) => ({ lat: c.lat, lng: c.lng, radius: c.radius * 1.15 }))],
    [points, circles],
  );
  const fit = useCallback(() => {
    const view = fitView(fitTargets, width, height);
    setZoom(view.zoom);
    setCenter(view.center);
  }, [fitTargets, width, height]);
  // Filial yoki filtr o‘zgarganda — hammasini ko‘rsatamiz (har 60 soniyalik yangilanishda emas).
  useEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, width]);

  const c = project(center.lat, center.lng, zoom);
  const origin = { x: c.x - width / 2, y: c.y - height / 2 };
  const toScreen = (lat: number, lng: number) => {
    const p = project(lat, lng, zoom);
    return { x: p.x - origin.x, y: p.y - origin.y };
  };

  // Ko‘rinadigan plitkalar.
  const tiles = useMemo(() => {
    const count = 2 ** zoom;
    const list: { key: string; left: number; top: number; src: string }[] = [];
    const x0 = Math.floor(origin.x / TILE);
    const y0 = Math.floor(origin.y / TILE);
    const x1 = Math.floor((origin.x + width) / TILE);
    const y1 = Math.floor((origin.y + height) / TILE);
    for (let ty = y0; ty <= y1; ty += 1) {
      if (ty < 0 || ty >= count) continue;
      for (let tx = x0; tx <= x1; tx += 1) {
        const wrapped = ((tx % count) + count) % count;
        list.push({ key: `${zoom}/${tx}/${ty}`, left: tx * TILE - origin.x, top: ty * TILE - origin.y, src: tileUrl(zoom, wrapped, ty) });
      }
    }
    return list;
  }, [zoom, origin.x, origin.y, width, height]);

  const zoomTo = (next: number, anchor?: { x: number; y: number }) => {
    const target = clampZoom(next);
    if (target === zoom) return;
    if (anchor) {
      // Barmoq/sichqoncha ostidagi nuqta joyida qoladi.
      const world = { x: origin.x + anchor.x, y: origin.y + anchor.y };
      const geo = unproject(world.x, world.y, zoom);
      const p = project(geo.lat, geo.lng, target);
      setCenter(unproject(p.x - anchor.x + width / 2, p.y - anchor.y + height / 2, target));
    }
    setZoom(target);
    window.Telegram?.WebApp?.HapticFeedback?.selectionChanged?.();
  };

  const local = (event: { clientX: number; clientY: number }) => {
    const rect = box.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const onPointerDown = (event: React.PointerEvent) => {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, local(event));
    if (pointers.current.size === 1) drag.current = { ...local(event), center: { ...c }, moved: false };
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = Math.hypot(a.x - b.x, a.y - b.y);
      drag.current = null;
    }
  };
  const onPointerMove = (event: React.PointerEvent) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, local(event));
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const ratio = distance / pinch.current;
      if (ratio > 1.35 || ratio < 0.74) {
        zoomTo(zoom + (ratio > 1 ? 1 : -1), { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        pinch.current = distance;
      }
      return;
    }
    const start = drag.current;
    if (!start) return;
    const p = local(event);
    const dx = p.x - start.x;
    const dy = p.y - start.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) start.moved = true;
    if (start.moved) setCenter(unproject(start.center.x - dx, start.center.y - dy, zoom));
  };
  const onPointerUp = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const start = drag.current;
    if (pointers.current.size === 0) {
      drag.current = null;
      // Bo‘sh joyga oddiy bosish — tanlovni olib tashlaydi.
      if (start && !start.moved && (event.target as HTMLElement).classList.contains("tm-hit")) onPick?.(null);
    }
  };

  // Bir-birini yopib qo‘yadigan pinlar biroz yoyiladi.
  const placed = useMemo(() => {
    const buckets = new Map<string, number>();
    return points.map((p) => {
      const s = toScreen(p.lat, p.lng);
      const key = `${Math.round(s.x / 22)}:${Math.round(s.y / 22)}`;
      const n = buckets.get(key) || 0;
      buckets.set(key, n + 1);
      if (!n || p.kind === "branch") return { point: p, ...s };
      const angle = n * 2.4;
      const r = 14 + n * 3;
      return { point: p, x: s.x + Math.cos(angle) * r, y: s.y + Math.sin(angle) * r };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, zoom, origin.x, origin.y]);
  const selected = placed.find((p) => p.point.id === selectedId);
  const showLabels = zoom >= 17;

  return (
    <div
      ref={box}
      className={`tm ${failed ? "tm-nomap" : ""} ${dark ? "tm-dark" : ""}`}
      style={{ height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={(event) => zoomTo(zoom + (event.deltaY < 0 ? 1 : -1), local(event))}
      onDoubleClick={(event) => zoomTo(zoom + 1, local(event))}
    >
      <div className="tm-tiles tm-hit">
        {!failed &&
          tiles.map((t) => (
            <img
              key={t.key}
              src={t.src}
              alt=""
              draggable={false}
              className="tm-hit"
              style={{ left: t.left, top: t.top }}
              onError={() => setFailed(true)}
              onLoad={(e) => e.currentTarget.classList.add("on")}
            />
          ))}
      </div>
      <svg className="tm-overlay" width={width} height={height} aria-hidden>
        {circles.map((circle) => {
          const s = toScreen(circle.lat, circle.lng);
          const r = circle.radius / metersPerPixel(circle.lat, zoom);
          // Juda uzoq masshtabda radius nuqtaday bo‘lib qoladi — chizmaymiz (pin o‘zi yetarli).
          if (r < 10) return null;
          return <circle key={circle.id} cx={s.x} cy={s.y} r={r} className={`tm-zone ${circle.tone || "accent"}`} />;
        })}
        {selected?.point.accuracy ? (
          <circle cx={selected.x} cy={selected.y} r={Math.max(6, selected.point.accuracy / metersPerPixel(selected.point.lat, zoom))} className="tm-accuracy" />
        ) : null}
      </svg>
      {placed.map(({ point, x, y }) =>
        x < -40 || y < -40 || x > width + 40 || y > height + 40 ? null : (
          <button
            key={point.id}
            className={`tm-pin ${point.kind} ${point.tone} ${point.id === selectedId ? "on" : ""}`}
            style={{ transform: `translate(${x}px, ${y}px)` }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              window.Telegram?.WebApp?.HapticFeedback?.selectionChanged?.();
              onPick?.(point);
            }}
            aria-label={point.label}
          >
            {point.kind === "branch" ? (
              <span className="tm-branch-head">
                <Building2 size={16} />
                {point.badge && <em>{point.badge}</em>}
              </span>
            ) : (
              <span className="tm-avatar">{point.photo ? <img src={point.photo} alt="" draggable={false} /> : point.initials}</span>
            )}
            {(showLabels || point.kind === "branch" || point.id === selectedId) && <small>{point.label}</small>}
          </button>
        ),
      )}
      <div className="tm-controls" onPointerDown={(event) => event.stopPropagation()}>
        <button onClick={() => zoomTo(zoom + 1)} aria-label="Yaqinlashtirish" disabled={zoom >= MAX_ZOOM}>
          <Plus size={18} />
        </button>
        <button onClick={() => zoomTo(zoom - 1)} aria-label="Uzoqlashtirish" disabled={zoom <= MIN_ZOOM}>
          <Minus size={18} />
        </button>
        <button onClick={fit} aria-label="Hammasini ko‘rsatish">
          <LocateFixed size={17} />
        </button>
      </div>
      <span className="tm-attrib">{failed ? "Xarita yuklanmadi — sxema" : TILE_ATTRIBUTION}</span>
      {children}
    </div>
  );
}
