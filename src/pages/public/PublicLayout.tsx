import { useEffect } from "react";
import { Link, NavLink } from "react-router-dom";
import { ArrowRight, LogIn, Moon, Sun } from "lucide-react";
import { Logo } from "../../components/Logo";
import { useAuth } from "../../auth";
import { useTheme } from "../../theme";

type Meta = {
  title: string;
  description: string;
  path: "/privacy" | "/terms" | "/support";
};

type SiteConfig = { app?: string; landing?: string };

function siteOrigin() {
  const node = document.getElementById("staffora-site");
  if (!node?.textContent) return "";
  try {
    const config = JSON.parse(node.textContent) as SiteConfig;
    // Public route'lar hozir panel/app hostida xizmat qiladi; domen almashtirilsa APP_URL yetarli.
    const value = (config.app || "").replace(/\/+$/, "");
    return /^https:\/\//i.test(value) ? value : "";
  } catch {
    return "";
  }
}

function upsertMeta(selector: string, attributes: Record<string, string>) {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement("meta");
    document.head.appendChild(element);
  }
  Object.entries(attributes).forEach(([key, value]) => element!.setAttribute(key, value));
}

export function usePublicMeta({ title, description, path }: Meta) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title;
    upsertMeta('meta[name="description"]', { name: "description", content: description });
    upsertMeta('meta[property="og:title"]', { property: "og:title", content: title });
    upsertMeta('meta[property="og:description"]', { property: "og:description", content: description });
    upsertMeta('meta[property="og:type"]', { property: "og:type", content: "website" });
    const origin = siteOrigin();
    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (origin) {
      if (!canonical) {
        canonical = document.createElement("link");
        canonical.rel = "canonical";
        document.head.appendChild(canonical);
      }
      canonical.href = `${origin}${path}`;
      upsertMeta('meta[property="og:url"]', { property: "og:url", content: `${origin}${path}` });
    } else {
      canonical?.remove();
      document.head.querySelector('meta[property="og:url"]')?.remove();
    }
    return () => {
      document.title = previousTitle;
    };
  }, [description, path, title]);
}

export function PublicLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { theme, toggle } = useTheme();
  return (
    <div className="public-site">
      <header className="public-header">
        <div className="public-container public-header-inner">
          <Link to="/" className="public-brand" aria-label="Staffora bosh sahifasi">
            <Logo />
          </Link>
          <nav className="public-nav" aria-label="Huquqiy va yordam sahifalari">
            <NavLink to="/privacy">Maxfiylik</NavLink>
            <NavLink to="/terms">Shartlar</NavLink>
            <NavLink to="/support">Yordam</NavLink>
          </nav>
          <div className="public-header-actions">
            <button className="public-theme" type="button" onClick={toggle} aria-label={theme === "dark" ? "Yorug‘ rejimni yoqish" : "Tungi rejimni yoqish"}>
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <Link className="btn btn-primary public-login" to={user ? (user.role === "SUPER_ADMIN" ? "/super-admin" : "/dashboard") : "/login"}>
              {user ? "Panelga qaytish" : "Kirish"} {user ? <ArrowRight size={16} /> : <LogIn size={16} />}
            </Link>
          </div>
        </div>
      </header>
      <main id="main-content">{children}</main>
      <footer className="public-footer">
        <div className="public-container public-footer-grid">
          <div>
            <Logo />
            <p>Xodimlar va kompaniya boshqaruvini yagona platformada birlashtiring.</p>
          </div>
          <nav aria-label="Pastki navigatsiya">
            <Link to="/">Bosh sahifa</Link>
            <Link to="/privacy">Maxfiylik siyosati</Link>
            <Link to="/terms">Foydalanish shartlari</Link>
            <Link to="/support">Yordam markazi</Link>
          </nav>
        </div>
        <div className="public-container public-footer-bottom">
          <span>© 2026 Staffora. Barcha huquqlar himoyalangan.</span>
          <span>O‘zbekiston</span>
        </div>
      </footer>
    </div>
  );
}

export function LegalHero({ eyebrow, title, description, updated }: { eyebrow: string; title: string; description: string; updated: string }) {
  return (
    <section className="legal-hero">
      <div className="public-container">
        <span className="public-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
        <time dateTime="2026-11-03">Oxirgi yangilanish: {updated}</time>
      </div>
    </section>
  );
}

export function LegalDocument({ sections }: { sections: { id: string; title: string; content: React.ReactNode }[] }) {
  return (
    <div className="public-container legal-layout">
      <aside className="legal-toc" aria-label="Mundarija">
        <strong>Mundarija</strong>
        <nav>
          {sections.map((section, index) => (
            <a key={section.id} href={`#${section.id}`}>
              <span>{String(index + 1).padStart(2, "0")}</span> {section.title}
            </a>
          ))}
        </nav>
      </aside>
      <article className="legal-document">
        {sections.map((section, index) => (
          <section id={section.id} key={section.id}>
            <span className="legal-number">{String(index + 1).padStart(2, "0")}</span>
            <h2>{section.title}</h2>
            <div>{section.content}</div>
          </section>
        ))}
      </article>
    </div>
  );
}
