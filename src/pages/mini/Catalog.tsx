import type { LucideIcon } from "lucide-react";

/*
 * «Katalog» ko‘rinishi: guruh sarlavhasi va 4 ustunli ikonkalar to‘ri (och-ko‘k yumshoq kvadrat,
 * ko‘k belgi, ostida nom — ko‘pi bilan 2 qator). Xodimning «Bo‘limlar»i va rahbarning «Boshqaruv»i
 * shu bitta komponentdan foydalanadi.
 */

/** `onClick` o‘zi tebranish (haptic) beradi — navigatsiya funksiyasi buni allaqachon qiladi. */
export type CatalogItem = { key: string; label: string; icon: LucideIcon; badge?: number; onClick: () => void };
export type CatalogGroup = { title: string; items: CatalogItem[] };

export function Catalog({ groups }: { groups: CatalogGroup[] }) {
  return (
    <>
      {groups
        .filter((g) => g.items.length)
        .map((g) => (
          <section key={g.title} className="cat-card" aria-label={g.title}>
            <h2 className="cat-title">{g.title}</h2>
            <div className="cat-grid">
              {g.items.map(({ key, label, icon: Icon, badge, onClick }) => (
                <button key={key} type="button" className="cat-tile" onClick={onClick}>
                  <span className="cat-ico">
                    <Icon size={26} strokeWidth={2} aria-hidden />
                    {badge ? <em className="cat-badge">{badge > 99 ? "99+" : badge}</em> : null}
                  </span>
                  <span className="cat-label">{label}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
    </>
  );
}
