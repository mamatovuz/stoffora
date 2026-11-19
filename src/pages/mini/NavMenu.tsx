import { useRef, type CSSProperties, type KeyboardEvent } from "react";
import type { LucideIcon } from "lucide-react";

export type NavMenuItem<K extends string> = { key: K; icon: LucideIcon; label: string; badge?: number };

/*
 * Pastki menyu: ekran eni bo‘ylab qotirilgan panel — har bir bo‘limda ikonka va yozuv doim ko‘rinadi,
 * tanlangani ko‘k. Yozuv bitta matn tuguni bo‘lib qoladi — tarjimon (startTranslator) uni almashtira oladi.
 */
export function NavMenu<K extends string>({ items, value, onSelect }: { items: NavMenuItem<K>[]; value: K; onSelect: (key: K) => void }) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const count = items.length;

  const onKey = (e: KeyboardEvent, i: number) => {
    const next = { ArrowRight: (i + 1) % count, ArrowLeft: (i + count - 1) % count, Home: 0, End: count - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    onSelect(items[next].key);
    buttons.current[next]?.focus();
  };

  return (
    <nav className="mini-nav" role="tablist" aria-label="Navigatsiya" style={{ "--nm-n": count } as CSSProperties}>
      {items.map(({ key, icon: Icon, label, badge }, i) => {
        const on = key === value;
        return (
          <button
            key={key}
            ref={(el) => {
              buttons.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            className={`nm-key${on ? " on" : ""}`}
            onClick={() => !on && onSelect(key)}
            onKeyDown={(e) => onKey(e, i)}
          >
            <span className="nm-icon">
              <Icon size={23} strokeWidth={on ? 2.2 : 1.8} aria-hidden />
              {badge ? <em className="nm-badge">{badge > 99 ? "99+" : badge}</em> : null}
            </span>
            <span className="nm-text">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
