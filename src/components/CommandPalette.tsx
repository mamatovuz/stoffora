import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Building2, CornerDownLeft, FileText, LayoutGrid, Megaphone, Network, Search, UserRound } from "lucide-react";
import { api } from "../api";
import { useDebounced } from "../hooks";

/*
 * Umumiy qidiruv (Ctrl+K): sahifalar + xodimlar, filiallar, bo‘limlar, lavozimlar, e’lonlar. ↑↓ — tanlash, Enter — ochish, Esc — yopish.
 */

type Hit = { kind: string; id: string; title: string; sub?: string; link: string; photo?: string };
const ICONS: Record<string, typeof Search> = {
  page: LayoutGrid,
  employee: UserRound,
  branch: Building2,
  department: Network,
  position: Network,
  announcement: Megaphone,
};
const GROUP: Record<string, string> = { page: "Sahifalar", employee: "Xodimlar", branch: "Filiallar", department: "Bo‘limlar", position: "Lavozimlar", announcement: "E’lonlar" };
const norm = (s: string) => s.toLowerCase().replace(/[‘’ʼ`']/g, "");

export function CommandPalette({ open, onClose, pages }: { open: boolean; onClose: () => void; pages: [string, string][] }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const debounced = useDebounced(q, 180);
  useEffect(() => {
    if (open) {
      setQ("");
      setHits([]);
      setActive(0);
      window.setTimeout(() => input.current?.focus(), 30);
    }
  }, [open]);
  useEffect(() => {
    if (!open || debounced.trim().length < 2) return setHits([]);
    let live = true;
    setLoading(true);
    api<Hit[]>(`/search?q=${encodeURIComponent(debounced.trim())}`)
      .then((r) => live && setHits(r))
      .catch(() => live && setHits([]))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [debounced, open]);
  const pageHits: Hit[] = useMemo(() => {
    const n = norm(q.trim());
    return pages
      .filter(([, label]) => !n || norm(label).includes(n))
      .slice(0, n ? 6 : 8)
      .map(([path, label]) => ({ kind: "page", id: path, title: label, link: path }));
  }, [pages, q]);
  const all = [...pageHits, ...hits];
  const go = (hit?: Hit) => {
    if (!hit) return;
    onClose();
    navigate(hit.link);
  };
  if (!open) return null;
  let index = -1;
  const groups = [...new Set(all.map((h) => h.kind))];
  return (
    <div className="cmdk-layer" onMouseDown={onClose}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Qidiruv" onMouseDown={(e) => e.stopPropagation()}>
        <label className="cmdk-input">
          <Search size={18} />
          <input
            ref={input}
            value={q}
            onChange={(e) => (setQ(e.target.value), setActive(0))}
            placeholder="Xodim, telefon, filial, sahifa, maqola…"
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(all.length - 1, a + 1)));
              else if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(0, a - 1)));
              else if (e.key === "Enter") (e.preventDefault(), go(all[active]));
            }}
          />
          {loading && <span className="cmdk-spin" />}
          <kbd>Esc</kbd>
        </label>
        <div className="cmdk-list">
          {!all.length ? (
            <p className="cmdk-empty">{q.trim().length >= 2 ? "Hech narsa topilmadi" : "Kamida 2 ta harf yozing"}</p>
          ) : (
            groups.map((g) => (
              <div key={g}>
                <div className="cmdk-group">{GROUP[g] || g}</div>
                {all
                  .filter((h) => h.kind === g)
                  .map((h) => {
                    index += 1;
                    const i = index;
                    const Icon = ICONS[h.kind] || FileText;
                    return (
                      <button key={`${h.kind}-${h.id}`} className={`cmdk-item ${i === active ? "on" : ""}`} onMouseEnter={() => setActive(i)} onClick={() => go(h)}>
                        {h.photo ? <img src={h.photo} alt="" /> : <span className="cmdk-ico"><Icon size={16} /></span>}
                        <span>
                          <b>{h.title}</b>
                          {h.sub && <small>{h.sub}</small>}
                        </span>
                        {i === active ? <CornerDownLeft size={14} /> : <ArrowRight size={14} className="cmdk-arrow" />}
                      </button>
                    );
                  })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
