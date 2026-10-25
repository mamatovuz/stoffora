import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  Users,
  Clock3,
  Building2,
  ClipboardList,
  ChartNoAxesCombined,
  Megaphone,
  MessagesSquare,
  Bell,
  Settings,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  X,
  LogOut,
  ChevronDown,
  CircleUserRound,
  Plane,
  Lock,
  ClipboardCheck,
  Inbox,
  Wallet,
  LayoutDashboard,
  Sun,
  Moon,
  MonitorSmartphone,
  LifeBuoy,
  Eye,
  ChevronsUpDown,
  TriangleAlert,
  Check,
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

/**
 * Menyu — 12 ta band. Bir bandga tegishli sahifalar (masalan, Moliya: xulosa, ish haqi,
 * tabel, avans, jarima, rag‘bat) sahifa tepasidagi tablarda. Rolga ruxsat etilmagan
 * tab va bandlar ko‘rinmaydi; band birinchi ruxsat etilgan sahifaga olib boradi.
 */
type NavGroup = "Asosiy" | "Xodimlar" | "Boshqaruv" | "Tizim";
type NavItem = { group: NavGroup; label: string; icon: typeof Users; tabs: [string, string][]; count?: string };
const menu: NavItem[] = [
  { group: "Asosiy", label: "Bosh sahifa", icon: LayoutDashboard, tabs: [["/dashboard", "Bosh sahifa"]] },
  { group: "Asosiy", label: "Ish stoli", icon: ClipboardCheck, tabs: [["/workspace", "Ish stoli"]] },
  { group: "Asosiy", label: "Tasdiqlashlar", icon: Inbox, tabs: [["/inbox", "Tasdiqlashlar"]], count: "inbox" },
  {
    group: "Asosiy",
    label: "Keldi-ketdi",
    icon: Clock3,
    tabs: [
      ["/attendance", "Bugun"],
      ["/map", "Xarita"],
      ["/calendar", "Kalendar"],
      ["/attendance-grid", "Tabel"],
      ["/attendance-requests", "Belgilash so‘rovlari"],
    ],
  },
  {
    group: "Xodimlar",
    label: "Xodimlar",
    icon: Users,
    tabs: [
      ["/employees", "Xodimlar"],
      ["/dismissed", "Bo‘shaganlar"],
      ["/assets", "Aktivlar"],
    ],
  },
  { group: "Xodimlar", label: "Ta’til va yo‘qlik", icon: Plane, tabs: [["/leave", "Ta’til va yo‘qlik"]], count: "leave" },
  { group: "Xodimlar", label: "Arizalar", icon: ClipboardList, tabs: [["/registrations", "Arizalar"]], count: "registrations" },
  {
    group: "Xodimlar",
    label: "Tashkilot",
    icon: Building2,
    tabs: [
      ["/branches", "Filiallar"],
      ["/schedules", "Ish grafiklari"],
      ["/departments", "Bo‘limlar"],
      ["/positions", "Lavozimlar"],
    ],
  },
  {
    group: "Boshqaruv",
    label: "Moliya",
    icon: Wallet,
    tabs: [
      ["/finance", "Xulosa"],
      ["/payroll", "Ish haqi"],
      ["/timesheet", "Tabel"],
      ["/advances", "Avanslar"],
      ["/fines", "Jarimalar"],
      ["/rewards", "Rag‘bat"],
    ],
    count: "fines",
  },
  { group: "Boshqaruv", label: "E’lonlar", icon: Megaphone, tabs: [["/announcements", "E’lonlar"]] },
  { group: "Boshqaruv", label: "Murojaatlar", icon: MessagesSquare, tabs: [["/helpdesk", "Murojaatlar"]] },
  {
    group: "Boshqaruv",
    label: "Hisobotlar",
    icon: ChartNoAxesCombined,
    tabs: [
      ["/reports", "Hisobotlar"],
      ["/analytics", "Tahlil"],
    ],
  },
  {
    group: "Tizim",
    label: "Tizim",
    icon: Settings,
    tabs: [
      ["/users", "Foydalanuvchilar"],
      ["/roles", "Rollar"],
      ["/audit", "Audit"],
      ["/settings", "Sozlamalar"],
    ],
  },
  { group: "Tizim", label: "Yordam", icon: LifeBuoy, tabs: [["/support", "Staffora yordami"]] },
];

/** Menyuda yo‘q, lekin ochiladigan sahifalar sarlavhasi. */
const hiddenPages: [string, string][] = [
  ["/notifications", "Bildirishnomalar"],
];

const pageNames: Record<string, string> = Object.fromEntries([
  ...menu.flatMap((item) => item.tabs.map(([path, label]) => [path, item.tabs.length > 1 ? `${item.label} · ${label}` : label] as [string, string])),
  ...hiddenPages,
]);

export function Shell() {
  const { user, refresh } = useAuth();
  const [pageKey, setPageKey] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();
  const searchRef = useRef<HTMLInputElement>(null);
  const [palette, setPalette] = useState(false);
  const [lang, setLang] = useState<Lang>(() => storedLang() || "uz");
  useEffect(() => {
    document.documentElement.lang = lang;
    return startTranslator(document.body, lang, { report: true });
  }, [lang]);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("staffora_sidebar") === "collapsed";
    } catch {
      return false;
    }
  });
  const [mobile, setMobile] = useState(false);
  /** Ochiq ochiluvchi menyu: hisob (yuqorida / yon menyuda), kompaniya yoki til. */
  const [open, setOpen] = useState<null | "top" | "side" | "company" | "lang">(null);
  const { theme, pref: themePref, choose: chooseTheme, toggle: toggleTheme } = useTheme();
  const [scrolled, setScrolled] = useState(false);
  const { data: company } = useApi<Company>("/company");
  const { data: notifications, reload: reloadNotifications } =
    useApi<Notification[]>("/notifications");
  const { data: leave, reload: reloadLeave } =
    useApi<{ status: string }[]>(user && canOpenPage(user.role, "/leave", user.modules) ? "/leave" : null);
  // Faqat rolga ruxsat etilgan bandlar va tablar ko‘rinadi.
  const visibleMenu = useMemo(
    () =>
      menu
        .map((item) => ({ ...item, tabs: item.tabs.filter(([path]) => (user ? canOpenPage(user.role, path, user.modules) : false)) }))
        .filter((item) => item.tabs.length),
    [user],
  );
  const current = visibleMenu.find((item) =>
    item.tabs.some(([path]) => location.pathname === path || location.pathname.startsWith(`${path}/`)),
  );
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
  // Biror so‘rov tasdiqlansa — «Tasdiqlashlar» hisoblagichi darhol yangilanadi.
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
  const { data: registrations, reload: reloadRegistrations } = useApi<{ counts: { PENDING: number } }>(
    user && canOpenPage(user.role, "/registrations", user.modules) ? "/registrations?status=PENDING" : null,
  );
  usePolling(() => void reloadRegistrations(true), 60_000);
  const counts: Record<string, number> = {
    registrations: registrations?.counts.PENDING || 0,
    notifications: notifications?.filter((item) => !item.read).length || 0,
    leave: leave?.filter((item) => item.status === "PENDING").length || 0,
    fines: pendingFines?.length || 0,
    inbox: workspace?.inbox.total || 0,
  };
  const pageTitle = useMemo(() => {
    const exact = pageNames[location.pathname];
    if (exact) return exact;
    if (location.pathname === "/employees/new") return "Yangi xodim";
    if (location.pathname.startsWith("/employees/")) return "Xodim profili";
    return "Staffora";
  }, [location.pathname]);
  // Yo‘l ko‘rsatkich: Kompaniya / Bo‘lim / Sahifa (bo‘lim nomi sahifa nomi bilan bir xil bo‘lsa — bir marta).
  const leaf = pageTitle.split(" · ").pop() || pageTitle;
  const crumbs = [current?.label, leaf !== current?.label ? leaf : undefined].filter(Boolean) as string[];

  useEffect(() => {
    try {
      localStorage.setItem("staffora_sidebar", collapsed ? "collapsed" : "open");
    } catch {
      /* ignore */
    }
  }, [collapsed]);
  useEffect(() => {
    setMobile(false);
    setOpen(null);
    document.title = `${pageTitle} · Staffora`;
  }, [location.pathname, pageTitle]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette(true);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(null);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("keydown", shortcut);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("keydown", shortcut);
      window.removeEventListener("keydown", escape);
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

  const companyInitials =
    company?.name
      .split(/\s+/)
      .map((word) => word[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "ST";
  const companies = user?.companies || [];
  const groups = visibleMenu.reduce<[string, typeof visibleMenu][]>((list, item) => {
    const last = list[list.length - 1];
    if (last && last[0] === item.group) last[1].push(item);
    else list.push([item.group, [item]]);
    return list;
  }, []);
  const toggle = (name: NonNullable<typeof open>) => setOpen((value) => (value === name ? null : name));
  const accountMenu = (placement: "top" | "side") => (
    <div className={`popover account-pop ${placement === "side" ? "up" : ""}`} role="menu">
      <div className="popover-head">
        <b>{user?.name}</b>
        <small>{user?.email}</small>
      </div>
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
      <Link to="/settings" role="menuitem">
        <CircleUserRound size={16} /> Profil va sozlamalar
      </Link>
      <Link to="/support" role="menuitem">
        <LifeBuoy size={16} /> Staffora yordami
      </Link>
      <button className="danger" role="menuitem" onClick={() => void logout()}>
        <LogOut size={16} /> {preview ? "Ko‘rishni tugatish" : "Tizimdan chiqish"}
      </button>
    </div>
  );

  return (
    <div className="app-shell">
      <ScreenLock
        onUnlock={() => {
          void refresh();
          setPageKey((key) => key + 1);
        }}
      />
      {mobile && <button className="backdrop" aria-label="Menyuni yopish" onClick={() => setMobile(false)} />}
      <aside className={`sidebar ${collapsed ? "collapsed" : ""} ${mobile ? "mobile-open" : ""}`}>
        <div className="sidebar-head">
          <Link to={user ? homePage(user.role, user.modules) : "/dashboard"} aria-label="Staffora — bosh sahifa">
            <Logo compact={collapsed} />
          </Link>
          <button className="icon-btn collapse" aria-label={collapsed ? "Menyuni yoyish" : "Menyuni yig‘ish"} title={collapsed ? "Menyuni yoyish" : "Menyuni yig‘ish"} onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
          <button className="icon-btn mobile-close" aria-label="Menyuni yopish" onClick={() => setMobile(false)}>
            <X size={19} />
          </button>
        </div>

        <div className="company-wrap" data-pop>
          <button type="button" className={`company-chip ${open === "company" ? "open" : ""}`} title={company?.name} aria-haspopup="menu" aria-expanded={open === "company"} onClick={() => toggle("company")}>
            <span className="mark">{companyInitials}</span>
            <span>
              <b>{company?.name || "…"}</b>
              <small>{company?.plan ? `${company.plan} tarif` : "Kompaniya"}</small>
            </span>
            <ChevronDown size={15} className="company-switch-icon" aria-hidden />
          </button>
          {open === "company" && (
            <div className="popover company-pop" role="menu">
              {companies.length > 1 ? (
                <>
                  <small className="popover-label">Kompaniyalar</small>
                  {companies.map((c) => (
                    <button key={c.id} role="menuitemradio" aria-checked={c.id === user?.companyId} className={c.id === user?.companyId ? "current" : ""} onClick={() => void switchCompany(c.id)}>
                      <span className="mark sm">
                        {c.name
                          .split(/\s+/)
                          .map((word) => word[0])
                          .slice(0, 2)
                          .join("")
                          .toUpperCase()}
                      </span>
                      <span className="grow">{c.name}</span>
                      {c.id === user?.companyId && <Check size={15} />}
                    </button>
                  ))}
                </>
              ) : (
                <div className="popover-head">
                  <b>{company?.name}</b>
                  <small>{company?.plan ? `${company.plan} tarif` : "Kompaniya"}</small>
                </div>
              )}
              {user && canOpenPage(user.role, "/settings", user.modules) && (
                <Link to="/settings" role="menuitem" className="sep">
                  <Settings size={16} /> Kompaniya sozlamalari
                </Link>
              )}
              {user && canOpenPage(user.role, "/branches", user.modules) && (
                <Link to="/branches" role="menuitem">
                  <Building2 size={16} /> Filiallar
                </Link>
              )}
            </div>
          )}
        </div>

        <nav className="nav" aria-label="Asosiy navigatsiya">
          {groups.map(([group, items]) => (
            <div className="nav-group" key={group} role="group" aria-label={group}>
              <span className="nav-label" aria-hidden>
                {group}
              </span>
              {items.map(({ label, icon: Icon, tabs, count }) => {
                const active = current?.label === label;
                const total = count ? counts[count] : 0;
                return (
                  <Link to={tabs[0][0]} key={label} className={`nav-link ${active ? "active" : ""}`} aria-current={active ? "page" : undefined} title={collapsed ? label : undefined}>
                    <Icon size={17} strokeWidth={1.8} />
                    <span>{label}</span>
                    {total > 0 && <em className="nav-count">{total > 99 ? "99+" : total}</em>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot" data-pop>
          <button type="button" className={`foot-account ${open === "side" ? "open" : ""}`} aria-haspopup="menu" aria-expanded={open === "side"} aria-label="Hisob menyusi" onClick={() => toggle("side")}>
            <Avatar first={firstName} last={lastName} photo={user?.photoDataUrl} />
            <span>
              <b>{user?.name}</b>
              <small>{user ? roleLabels[user.role] : ""}</small>
            </span>
            <ChevronsUpDown size={15} className="foot-icon" aria-hidden />
          </button>
          {open === "side" && accountMenu("side")}
        </div>
      </aside>

      <div className={`app-main ${collapsed ? "expanded" : ""}`}>
        {preview && (
          <div className={`app-banner preview ${preview.mode === "SUPPORT" ? "support" : ""}`} role="status">
            <Eye size={16} />
            <span>
              <b>{preview.mode === "SUPPORT" ? "Yordam rejimi" : "Faqat ko‘rish"}</b> · {preview.companyName || company?.name} ·{" "}
              {preview.mode === "SUPPORT" ? "har bir o‘zgarish auditga yoziladi" : "o‘zgartirish bloklangan"} · {new Date(preview.expiresAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })} gacha
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
        <header className={`topbar ${scrolled ? "scrolled" : ""}`}>
          <button className="icon-btn mobile-menu" aria-label="Menyuni ochish" onClick={() => setMobile(true)}>
            <Menu size={21} />
          </button>
          <nav className="crumbs" aria-label="Yo‘l ko‘rsatkich">
            <span className="crumb-root">{company?.name || "Staffora"}</span>
            {crumbs.map((crumb, index) => (
              <Fragment key={crumb}>
                <span className="crumb-sep" aria-hidden>
                  /
                </span>
                {index === crumbs.length - 1 ? (
                  <b aria-current="page">{crumb}</b>
                ) : current && current.tabs[0] ? (
                  <Link to={current.tabs[0][0]}>{crumb}</Link>
                ) : (
                  <span>{crumb}</span>
                )}
              </Fragment>
            ))}
          </nav>
          <button type="button" className="search search-btn" onClick={() => setPalette(true)} aria-label="Qidiruv (Ctrl+K)">
            <Search size={15} />
            <span>Xodim, filial yoki sahifa qidirish...</span>
            <kbd>Ctrl K</kbd>
          </button>
          <CommandPalette open={palette} onClose={() => setPalette(false)} pages={visibleMenu.flatMap((item) => item.tabs.map(([path]) => [path, pageNames[path]] as [string, string]))} />
          <span className="topbar-sep" aria-hidden />
          <div className="top-actions">
            <div className="lang-menu" data-pop>
              <button className={`lang-toggle ${open === "lang" ? "open" : ""}`} data-no-translate aria-haspopup="menu" aria-expanded={open === "lang"} aria-label="Interfeys tili" onClick={() => toggle("lang")}>
                {lang.toUpperCase()}
                <ChevronDown size={13} aria-hidden />
              </button>
              {open === "lang" && (
                <div className="popover lang-pop" role="menu" data-no-translate>
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
            <button
              type="button"
              className={`icon-btn theme-toggle ${theme === "dark" ? "is-dark" : ""}`}
              aria-label={theme === "dark" ? "Yorug‘ rejimga o‘tish" : "Tungi rejimga o‘tish"}
              title={theme === "dark" ? "Yorug‘ rejim" : "Tungi rejim"}
              onClick={toggleTheme}
            >
              <Sun size={17} className="tt-sun" />
              <Moon size={17} className="tt-moon" />
            </button>
            {user?.screenLock?.enabled && (
              <button className="icon-btn" aria-label="Ekranni qulflash" title="Ekranni qulflash" onClick={() => window.dispatchEvent(new Event("staffora:lock-now"))}>
                <Lock size={17} />
              </button>
            )}
            <Link to="/notifications" className="icon-btn bell" aria-label={`${counts.notifications} ta o‘qilmagan bildirishnoma`} title="Bildirishnomalar">
              <Bell size={18} />
              {counts.notifications > 0 && <i>{counts.notifications > 9 ? "9+" : counts.notifications}</i>}
            </Link>
            <div className="user-menu" data-pop>
              <button className="user-trigger" aria-haspopup="menu" aria-expanded={open === "top"} aria-label="Hisob menyusi" onClick={() => toggle("top")}>
                <Avatar first={firstName} last={lastName} photo={user?.photoDataUrl} size="sm" />
              </button>
              {open === "top" && accountMenu("top")}
            </div>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          {current && current.tabs.length > 1 && current.tabs.some(([path]) => path === location.pathname) && (
            <nav className="section-tabs" aria-label={current.label}>
              {current.tabs.map(([path, label]) => (
                <NavLink key={path} to={path} end className={({ isActive }) => (isActive ? "active" : "")}>
                  {label}
                </NavLink>
              ))}
            </nav>
          )}
          <Fragment key={pageKey}>
            <Outlet />
          </Fragment>
        </main>
      </div>
    </div>
  );
}
