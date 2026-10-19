import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { LucideIcon } from "lucide-react";

export type NavMenuItem<K extends string> = { key: K; icon: LucideIcon; label: string };

/*
 * Pastki menyu: tanlangan bo‘lim to‘q «tabletka»ga aylanib, yozuvi bilan kengayadi,
 * qolganlari — faqat ikonka. Kenglik prujinasimon o‘tish bilan o‘zgaradi.
 * Yozuv bitta matn tuguni bo‘lib qoladi — tarjimon (startTranslator) uni almashtira oladi,
 * o‘lcham esa ResizeObserver orqali qayta o‘lchanadi.
 */
export function NavMenu<K extends string>({ items, value, onSelect }: { items: NavMenuItem<K>[]; value: K; onSelect: (key: K) => void }) {
  const texts = useRef<(HTMLSpanElement | null)[]>([]);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [widths, setWidths] = useState<number[]>([]);
  const count = items.length;

  useLayoutEffect(() => {
    const measure = () => {
      const next = texts.current.slice(0, count).map((el) => (el ? Math.ceil(el.getBoundingClientRect().width) : 0));
      setWidths((prev) => (prev.length === next.length && prev.every((w, i) => w === next[i]) ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    texts.current.slice(0, count).forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [count]);

  const onKey = (e: KeyboardEvent, i: number) => {
    const next = { ArrowRight: (i + 1) % count, ArrowLeft: (i + count - 1) % count, Home: 0, End: count - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    onSelect(items[next].key);
    buttons.current[next]?.focus();
  };

  return (
    <nav className={`mini-nav${count > 4 ? " many" : ""}`} role="tablist" aria-label="Navigatsiya" style={{ "--nm-n": count } as CSSProperties}>
      {items.map(({ key, icon: Icon, label }, i) => {
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
            onClick={() => onSelect(key)}
            onKeyDown={(e) => onKey(e, i)}
          >
            <Icon size={22} strokeWidth={on ? 2.2 : 1.9} aria-hidden />
            <span className="nm-label" style={widths[i] ? { width: on ? widths[i] : 0 } : undefined}>
              <span
                className="nm-text"
                ref={(el) => {
                  texts.current[i] = el;
                }}
              >
                {label}
              </span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
