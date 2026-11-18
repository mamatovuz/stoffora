import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Activity,
  Bell,
  Building2,
  Check,
  ChevronDown,
  CircleHelp,
  CircleUserRound,
  Clock3,
  Eye,
  LayoutDashboard,
  ListChecks,
  Lock,
  LogOut,
  Menu,
  Moon,
  MonitorSmartphone,
  Search,
  Settings,
  Sun,
  TriangleAlert,
  Users,
  Wallet,
  X,
} from "lucide-react";
import type { Company, Notification } from "@/lib/types";
import { Logo } from "./Logo";
import { Avatar } from "./ui";
import { roleLabels, useAuth } from "../auth";
import { canAny, canOpenPage, homePage } from "@/lib/permissions";
import { ScreenLock } from "./ScreenLock";
import { CommandPalette } from "./CommandPalette";
import { api, clearPreviewToken } from "../api";
import { useApi, usePolling } from "../hooks";
import { rememberLang, startTranslator, storedLang, type Lang } from "../i18n";
import { useTheme, type ThemePref } from "../theme";
import { StafforaAI } from "./StafforaAI";

/**
 * Yuqori gorizontal menyu — 7 ta asosiy bo‘lim. Bir bo‘limdagi sahifalar ochiluvchi ro‘yxatda
 * va sahifa tepasidagi tablarda. Rolga ruxsat etilmagan sahifa va bo‘limlar ko‘rinmaydi;
 * tizim sahifalari (sozlamalar, rollar, audit) o‘ng tomondagi ⚙ menyusida.
 */
type NavItem = { label: string; icon: typeof Users; tabs: [string, string][]; count?: string[] };
const menu: NavItem[] = [
  { label: "Boshqaruv paneli", icon: LayoutDashboard, tabs: [["/dashboard", "Boshqaruv paneli"]] },
  {
    label: "Tashkilot tuzilmasi",
    icon: Building2,
    tabs: [
      ["/branches", "Filiallar"],
      ["/departments", "Bo‘limlar"],
      ["/positions", "Lavozimlar"],
      ["/schedules", "Ish grafiklari"],
    ],
  },
  {
    label: "Xodimlar",
    icon: Users,
    tabs: [
      ["/employees", "Xodimlar"],
      ["/registrations", "Arizalar"],
      ["/leave", "Ta’til va yo‘qlik"],
      ["/dismissed", "Bo‘shaganlar"],
      ["/assets", "Aktivlar"],
    ],
    count: ["registrations", "leave"],
  },
  {
    label: "Davomat",
    icon: Clock3,
    tabs: [
      ["/attendance", "Bugungi davomat"],
      ["/attendance-grid", "Tabel"],
      ["/calendar", "Kalendar"],
      ["/attendance-requests", "Belgilash so‘rovlari"],
    ],
  },
  {
    label: "Vazifalar",
    icon: ListChecks,
    tabs: [
      ["/workspace", "Ish stoli"],
      ["/inbox", "Tasdiqlashlar"],
      ["/helpdesk", "Murojaatlar"],
      ["/announcements", "E’lonlar"],
    ],
    count: ["inbox"],
  },
  {
    label: "Moliya",
    icon: Wallet,
    tabs: [
      ["/payroll", "Ish haqi"],
      ["/finance", "Moliya xulosasi"],
      ["/timesheet", "Ish vaqti tabeli"],
      ["/advances", "Avanslar"],
      ["/fines", "Jarimalar"],
      ["/rewards", "Rag‘bat"],
    ],
    count: ["fines"],
  },
  {
    label: "Monitoring",
    icon: Activity,
    tabs: [
      ["/map", "Jonli xarita"],
      ["/analytics", "Tahlil"],
      ["/reports", "Hisobotlar"],
    ],
  },
];
const systemTabs: [string, string][] = [
  ["/settings", "Kompaniya sozlamalari"],
  ["/settings/ai", "Staffora AI"],
  ["/users", "Foydalanuvchilar"],
  ["/roles", "Rollar"],
  ["/audit", "Audit jurnali"],
];

/** Menyuda yo‘q, lekin ochiladigan sahifalar sarlavhasi. */
const hiddenPages: [string, string][] = [
  ["/notifications", "Bildirishnomalar"],
  ["/app-support", "Staffora yordami"],
];

const pageNames: Record<string, string> = Object.fromEntries([
  ...menu.flatMap((item) => item.tabs.map(([path, label]) => [path, label] as [string, string])),
  ...systemTabs,
  ...hiddenPages,
]);

const initials = (name = "") =>
  name
    .split(/\s+/)
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "ST";

type Open = null | "account" | "system" | "lang" | "mobile" | `nav:${string}`;

export function Shell() {
  const { user, refresh } = useAuth();
  const [pageKey, setPageKey] = useState(0);
  const location = useLocation();
  const [palette, setPalette] = useState(false);
  const [lang, setLang] = useState<Lang>(() => storedLang() || "uz");
  useEffect(() => {
    document.documentElement.lang = lang;
    return startTranslator(document.body, lang, { report: true });
  }, [lang]);
  const [open, setOpen] = useState<Open>(null);
  const { theme, pref: themePref, choose: chooseTheme, toggle: toggleTheme } = useTheme();
  const [scrolled, setScrolled] = useState(false);
  const { data: company } = useApi<Company>("/company");
  const { data: notifications, reload: reloadNotifications } = useApi<Notification[]>("/notifications");
  const allowed = (path: string) => (user ? canOpenPage(user.role, path, user.modules) : false);
  const { data: leave, reload: reloadLeave } = useApi<{ status: string }[]>(allowed("/leave") ? "/leave" : null);
  // Faqat rolga ruxsat etilgan bo‘limlar va sahifalar ko‘rinadi.
  const visibleMenu = useMemo(
    () => menu.map((item) => ({ ...item, tabs: item.tabs.filter(([path]) => allowed(path)) })).filter((item) => item.tabs.length),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const visibleSystem = useMemo(() => systemTabs.filter(([path]) => allowed(path)), [user]);
  const matches = (path: string) => location.pathname === path || location.pathname.startsWith(`${path}/`);
  const current = visibleMenu.find((item) => item.tabs.some(([path]) => matches(path)));
  const inSystem = visibleSystem.some(([path]) => location.pathname === path);
  usePolling(() => {
    void reloadNotifications(true);
    void reloadLeave(true);
  }, 60_000);
  // Boshqa sahifada o‘qildi/tasdiqlandi bosilsa — hisoblagich darhol yangilanadi.
  useEffect(() => {
    const onNotifications = () => void reloadNotifications(true);
    const onLeave = () => void reloadLeave(true);
    window.addEventListener("staffora:notifications", onNotifications);
    window.addEventListener("staffora:leave", onLeave);
    return () => {
      window.removeEventListener("staffora:notifications", onNotifications);
      window.removeEventListener("staffora:leave", onLeave);
    };
  }, [reloadNotifications, reloadLeave]);

  const { data: workspace, reload: reloadWorkspace } = useApi<{ inbox: { total: number } }>(user ? "/workspace/actions" : null);
  usePolling(() => void reloadWorkspace(true), 60_000);
  useEffect(() => {
    const on = () => void reloadWorkspace(true);
    window.addEventListener("staffora:leave", on);
    window.addEventListener("staffora:notifications", on);
    return () => {
      window.removeEventListener("staffora:leave", on);
      window.removeEventListener("staffora:notifications", on);
    };
  }, [reloadWorkspace]);
  const { data: pendingFines, reload: reloadFines } = useApi<{ id: string }[]>(
    user && canAny(user.role, ["employees.edit", "payroll.edit"]) && !user.modules?.includes("fines") ? "/fines?status=PENDING" : null,
  );
  usePolling(() => void reloadFines(true), 60_000);
  const { data: registrations, reload: reloadRegistrations } = useApi<{ counts: { PENDING: number } }>(allowed("/registrations") ? "/registrations?status=PENDING" : null);
  usePolling(() => void reloadRegistrations(true), 60_000);
  const counts: Record<string, number> = {
    registrations: registrations?.counts.PENDING || 0,
    notifications: notifications?.filter((item) => !item.read).length || 0,
    leave: leave?.filter((item) => item.status === "PENDING").length || 0,
    fines: pendingFines?.length || 0,
    inbox: workspace?.inbox.total || 0,
  };
  const tabCount: Record<string, number> = { "/registrations": counts.registrations, "/leave": counts.leave, "/inbox": counts.inbox, "/fines": counts.fines };
  const pageTitle = useMemo(() => {
    const exact = pageNames[location.pathname];
    if (exact) return exact;
    if (location.pathname === "/employees/new") return "Yangi xodim";
    if (location.pathname.startsWith("/employees/")) return "Xodim profili";
    return "Staffora";
  }, [location.pathname]);

  useEffect(() => {
    setOpen(null);
    document.title = `${pageTitle} · Staffora`;
  }, [location.pathname, pageTitle]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    const keys = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette(true);
      }
      if (event.key === "Escape") setOpen(null);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("keydown", keys);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("keydown", keys);
    };
  }, []);

  // Ochiluvchi menyu tashqarisiga bosilsa yopiladi.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest("[data-pop]")) setOpen(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const preview = user?.preview;
  async function logout() {
    // Ko‘rish rejimi: faqat shu tab sessiyasi tugatiladi, super admin cookie’si saqlanadi.
    if (preview) return exitPreview();
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = "/login";
  }
  async function exitPreview() {
    await api("/auth/preview/exit", { method: "POST" }).catch(() => undefined);
    clearPreviewToken();
    window.close();
    // Tab skript bilan ochilmagan bo‘lsa yopilmaydi — super admin paneliga qaytamiz.
    window.location.href = "/super-admin";
  }
  async function switchCompany(companyId: string) {
    if (!companyId || companyId === user?.companyId) return;
    try {
      await api("/auth/switch-company", { method: "POST", body: JSON.stringify({ companyId }) });
      window.location.href = "/dashboard";
    } catch {
      /* ruxsat yo‘q — tanlov o‘zgarmaydi */
    }
  }
  const [maintenanceHidden, setMaintenanceHidden] = useState(() => {
    try {
      return sessionStorage.getItem("staffora_maintenance_hidden") || "";
    } catch {
      return "";
    }
  });
  const maintenance = user?.maintenance && maintenanceHidden !== user.maintenance.message ? user.maintenance : null;
  const [firstName, lastName] = (user?.name || "?").split(" ");
  const companies = user?.companies || [];
  const toggle = (name: NonNullable<Open>) => setOpen((value) => (value === name ? null : name));
  const home = user ? homePage(user.role, user.modules) : "/dashboard";
  // Bo‘lim ichidagi sahifalar — sarlavha ostida tablar (bo‘limda bittadan ko‘p sahifa bo‘lsa).
  const sectionTabs =
    current && current.tabs.length > 1 && current.tabs.some(([path]) => path === location.pathname)
      ? current.tabs
      : inSystem && visibleSystem.length > 1
        ? visibleSystem
        : null;

  return (
    <div className="tn-shell">
      <ScreenLock
        onUnlock={() => {
          void refresh();
          setPageKey((key) => key + 1);
        }}
      />
      <header className={`tn-bar ${scrolled ? "scrolled" : ""}`}>
        <div className="tn-inner">
          <button type="button" className="tn-icon tn-burger" data-pop aria-label={open === "mobile" ? "Menyuni yopish" : "Menyuni ochish"} aria-expanded={open === "mobile"} onClick={() => toggle("mobile")}>
            {open === "mobile" ? <X size={20} /> : <Menu size={20} />}
          </button>
          <Link to={home} className="tn-brand" aria-label="Staffora — bosh sahifa">
            <Logo />
          </Link>

          <nav className={`tn-nav ${open === "mobile" ? "open" : ""}`} aria-label="Asosiy navigatsiya" data-pop>
            {visibleMenu.map((item) => {
              const active = current?.label === item.label;
              const total = (item.count || []).reduce((sum, key) => sum + (counts[key] || 0), 0);
              const Icon = item.icon;
              const body = (
                <>
                  <Icon size={16} strokeWidth={1.9} aria-hidden />
                  <span>{item.label}</span>
                  {total > 0 && <em className="tn-count">{total > 99 ? "99+" : total}</em>}
                </>
              );
              if (item.tabs.length === 1)
                return (
                  <Link key={item.label} to={item.tabs[0][0]} className={`tn-link ${active ? "active" : ""}`} aria-current={active ? "page" : undefined}>
                    {body}
                  </Link>
                );
              const key = `nav:${item.label}` as const;
              const expanded = open === key;
              return (
                <div key={item.label} className={`tn-item ${expanded ? "expanded" : ""}`}>
                  <button type="button" className={`tn-link ${active ? "active" : ""}`} aria-haspopup="menu" aria-expanded={expanded} onClick={() => toggle(key)}>
                    {body}
                    <ChevronDown size={14} className="tn-caret" aria-hidden />
                  </button>
                  <div className="tn-drop" role="menu" aria-label={item.label}>
                    {item.tabs.map(([path, label]) => (
                      <NavLink key={path} to={path} end role="menuitem" className={({ isActive }) => (isActive ? "current" : "")}>
                        <span>{label}</span>
                        {tabCount[path] > 0 && <em className="tn-count">{tabCount[path]}</em>}
                      </NavLink>
                    ))}
                  </div>
                </div>
              );
            })}
            {visibleSystem.length > 0 && (
              <div className="tn-mobile-only tn-item expanded">
                <span className="tn-group-label">Tizim</span>
                <div className="tn-drop" role="menu" aria-label="Tizim">
                  {visibleSystem.map(([path, label]) => (
                    <NavLink key={path} to={path} end role="menuitem" className={({ isActive }) => (isActive ? "current" : "")}>
                      <span>{label}</span>
                    </NavLink>
                  ))}
                </div>
              </div>
            )}
          </nav>

          <div className="tn-actions">
            <button type="button" className="tn-icon tn-search" onClick={() => setPalette(true)} aria-label="Qidiruv (Ctrl+K)" title="Qidiruv · Ctrl K">
              <Search size={17} />
            </button>
            <div className="tn-pop-wrap" data-pop>
              <button type="button" className={`tn-lang ${open === "lang" ? "open" : ""}`} data-no-translate aria-haspopup="menu" aria-expanded={open === "lang"} aria-label="Interfeys tili" onClick={() => toggle("lang")}>
                {lang.toUpperCase()}
                <ChevronDown size={13} aria-hidden />
              </button>
              {open === "lang" && (
                <div className="popover tn-menu sm" role="menu" data-no-translate>
                  {(
                    [
                      ["uz", "O‘zbekcha"],
                      ["ru", "Русский"],
                    ] as [Lang, string][]
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      role="menuitemradio"
                      aria-checked={lang === value}
                      className={lang === value ? "current" : ""}
                      onClick={() => {
                        rememberLang(value);
                        setLang(value);
                        setOpen(null);
                      }}
                    >
                      <span className="lang-code">{value.toUpperCase()}</span>
                      <span className="grow">{label}</span>
                      {lang === value && <Check size={15} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {user?.screenLock?.enabled && (
              <button className="tn-icon" aria-label="Ekranni qulflash" title="Ekranni qulflash" onClick={() => window.dispatchEvent(new Event("staffora:lock-now"))}>
                <Lock size={17} />
              </button>
            )}
            <Link to="/notifications" className="tn-icon tn-bell" aria-label={`${counts.notifications} ta o‘qilmagan bildirishnoma`} title="Bildirishnomalar">
              <Bell size={17} />
              {counts.notifications > 0 && <i>{counts.notifications > 9 ? "9+" : counts.notifications}</i>}
            </Link>
            {allowed("/app-support") && (
              <Link to="/app-support" className="tn-icon tn-help" aria-label="Yordam" title="Staffora yordami">
                <CircleHelp size={17} />
              </Link>
            )}
            {visibleSystem.length > 0 && (
              <div className="tn-pop-wrap tn-system" data-pop>
                <button type="button" className={`tn-icon ${inSystem || open === "system" ? "on" : ""}`} aria-haspopup="menu" aria-expanded={open === "system"} aria-label="Tizim sozlamalari" title="Tizim" onClick={() => toggle("system")}>
                  <Settings size={17} />
                </button>
                {open === "system" && (
                  <div className="popover tn-menu" role="menu">
                    <small className="popover-label">Tizim</small>
                    {visibleSystem.map(([path, label]) => (
                      <Link key={path} to={path} role="menuitem" className={location.pathname === path ? "current" : ""}>
                        {label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
            <span className="tn-sep" aria-hidden />
            <div className="tn-pop-wrap" data-pop>
              <button type="button" className={`tn-user ${open === "account" ? "open" : ""}`} aria-haspopup="menu" aria-expanded={open === "account"} aria-label="Hisob menyusi" onClick={() => toggle("account")}>
                <Avatar first={firstName} last={lastName} photo={user?.photoDataUrl} size="sm" />
                <span className="tn-user-text">
                  <b>{user?.name}</b>
                  <small>{company?.name || (user ? roleLabels[user.role] : "")}</small>
                </span>
                <ChevronDown size={14} aria-hidden />
              </button>
              {open === "account" && (
                <div className="popover tn-menu account" role="menu">
                  <div className="popover-head">
                    <b>{user?.name}</b>
                    <small>
                      {user?.email} · {user ? roleLabels[user.role] : ""}
                    </small>
                  </div>
                  {companies.length > 1 ? (
                    <>
                      <small className="popover-label">Kompaniyalar</small>
                      {companies.map((c) => (
                        <button key={c.id} role="menuitemradio" aria-checked={c.id === user?.companyId} className={c.id === user?.companyId ? "current" : ""} onClick={() => void switchCompany(c.id)}>
                          <span className="mark sm">{initials(c.name)}</span>
                          <span className="grow">{c.name}</span>
                          {c.id === user?.companyId && <Check size={15} />}
                        </button>
                      ))}
                    </>
                  ) : (
                    company && (
                      <div className="tn-company">
                        <span className="mark sm">{initials(company.name)}</span>
                        <span>
                          <b>{company.name}</b>
                          <small>{company.plan ? `${company.plan} tarif` : "Kompaniya"}</small>
                        </span>
                      </div>
                    )
                  )}
                  <div className="theme-pick" role="radiogroup" aria-label="Ko‘rinish">
                    <small>Ko‘rinish</small>
                    <div>
                      {(
                        [
                          ["light", "Yorug‘", Sun],
                          ["dark", "Tungi", Moon],
                          ["system", "Tizim", MonitorSmartphone],
                        ] as [ThemePref, string, typeof Sun][]
                      ).map(([value, label, Icon]) => (
                        <button key={value} type="button" role="radio" aria-checked={themePref === value} className={themePref === value ? "active" : ""} onClick={() => chooseTheme(value)}>
                          <Icon size={15} /> {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {allowed("/settings") && (
                    <Link to="/settings" role="menuitem">
                      <CircleUserRound size={16} /> Profil va sozlamalar
                    </Link>
                  )}
                  <button role="menuitem" onClick={toggleTheme}>
                    {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />} {theme === "dark" ? "Yorug‘ rejim" : "Tungi rejim"}
                  </button>
                  <button className="danger" role="menuitem" onClick={() => void logout()}>
                    <LogOut size={16} /> {preview ? "Ko‘rishni tugatish" : "Tizimdan chiqish"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        <CommandPalette
          open={palette}
          onClose={() => setPalette(false)}
          pages={[...visibleMenu.flatMap((item) => item.tabs), ...visibleSystem].map(([path]) => [path, pageNames[path]] as [string, string])}
        />
      </header>
      {open === "mobile" && <button className="tn-backdrop" aria-label="Menyuni yopish" onClick={() => setOpen(null)} />}

      {preview && (
        <div className={`app-banner preview ${preview.mode === "SUPPORT" ? "support" : ""}`} role="status">
          <Eye size={16} />
          <span>
            <b>{preview.mode === "SUPPORT" ? "Yordam rejimi" : "Faqat ko‘rish"}</b> · {preview.companyName || company?.name} ·{" "}
            {preview.mode === "SUPPORT" ? "har bir o‘zgarish auditga yoziladi" : "o‘zgartirish bloklangan"} ·{" "}
            {new Date(preview.expiresAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })} gacha
          </span>
          <button className="btn btn-sm" onClick={() => void exitPreview()}>
            Tugatish
          </button>
        </div>
      )}
      {maintenance && (
        <div className={`app-banner maintenance ${maintenance.level}`} role="status">
          <TriangleAlert size={16} />
          <span>{maintenance.message}</span>
          <button
            className="icon-btn"
            aria-label="Yopish"
            onClick={() => {
              try {
                sessionStorage.setItem("staffora_maintenance_hidden", maintenance.message);
              } catch {
                /* e’tiborsiz */
              }
              setMaintenanceHidden(maintenance.message);
            }}
          >
            <X size={15} />
          </button>
        </div>
      )}
      <main id="main-content" className="tn-main" tabIndex={-1}>
        {sectionTabs && (
          <nav className="tn-tabs" aria-label={current?.label || "Tizim"}>
            {sectionTabs.map(([path, label]) => (
              <NavLink key={path} to={path} end className={({ isActive }) => (isActive ? "active" : "")}>
                {label}
                {tabCount[path] > 0 && <em className="tn-count">{tabCount[path]}</em>}
              </NavLink>
            ))}
          </nav>
        )}
        <Fragment key={pageKey}>
          <Outlet />
        </Fragment>
      </main>
      {!preview && user?.role !== "EMPLOYEE" && <StafforaAI />}
    </div>
  );
}
