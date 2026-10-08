/*
 * Sayt sozlamasi — server index.html ichiga qo‘yadi (server/landing.ts):
 * panel domeni (app.…) va landing domeni (asosiy domen). Mahalliy ishlab chiqishda yo‘q —
 * hammasi bitta domenda, landing esa /landing manzilida.
 */
type SiteConfig = { app: string; landing: string; landingHosts: string[] };

function read(): SiteConfig {
  try {
    const raw = document.getElementById("staffora-site")?.textContent;
    if (raw) return JSON.parse(raw) as SiteConfig;
  } catch {
    /* e’tiborsiz */
  }
  return { app: "", landing: "", landingHosts: [] };
}

export const site = read();

/** Hozir landing domenidamizmi (staffora.uz, www.staffora.uz)? */
export const onLandingHost = () => site.landingHosts.includes(window.location.hostname.toLowerCase());

/** Panel manzili: landing domenidan — app domeniga to‘liq havola, aks holda shu domendagi yo‘l. */
export const appHref = (path: string) => (onLandingHost() && site.app ? `${site.app}${path}` : path);
