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
} from "lucide-react";
import type { Company, Notification } from "@/lib/types";
import { Logo } from "./Logo";
import { Avatar } from "./ui";
import { roleLabels, useAuth } from "../auth";
import { canAny, canOpenPage, homePage } from "@/lib/permissions";
import { ScreenLock } from "./ScreenLock";
import { CommandPalette } from "./CommandPalette";
import { api } from "../api";
import { useApi, usePolling } from "../hooks";
import { rememberLang, startTranslator, storedLang, type Lang } from "../i18n";

/**
 * Menyu — 12 ta band. Bir bandga tegishli sahifalar (masalan, Moliya: xulosa, ish haqi,
 * tabel, avans, jarima, rag‘bat) sahifa tepasidagi tablarda. Rolga ruxsat etilmagan
 * tab va bandlar ko‘rinmaydi; band birinchi ruxsat etilgan sahifaga olib boradi.
 */
type NavItem = { label: string; icon: typeof Users; tabs: [string, string][]; count?: string };
const menu: NavItem[] = [
  { label: "Bosh sahifa", icon: LayoutDashboard, tabs: [["/dashboard", "Bosh sahifa"]] },
  { label: "Ish stoli", icon: ClipboardCheck, tabs: [["/workspace", "Ish stoli"]] },
  { label: "Tasdiqlashlar", icon: Inbox, tabs: [["/inbox", "Tasdiqlashlar"]], count: "inbox" },
  {
    label: "Keldi-ketdi",
    icon: Clock3,
    tabs: [
      ["/attendance", "Bugun"],
      ["/map", "Xarita"],
      ["/calendar", "Kalendar"],
      ["/attendance-requests", "Belgilash so‘rovlari"],
    ],
  },
  {
    label: "Xodimlar",
    icon: Users,
    tabs: [
      ["/employees", "Xodimlar"],
      ["/dismissed", "Bo‘shaganlar"],
      ["/assets", "Aktivlar"],
    ],
  },
  { label: "Ta’til va yo‘qlik", icon: Plane, tabs: [["/leave", "Ta’til va yo‘qlik"]], count: "leave" },
  { label: "Arizalar", icon: ClipboardList, tabs: [["/registrations", "Arizalar"]], count: "registrations" },
  {
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
  { label: "E’lonlar", icon: Megaphone, tabs: [["/announcements", "E’lonlar"]] },
  { label: "Murojaatlar", icon: MessagesSquare, tabs: [["/helpdesk", "Murojaatlar"]] },
  {
    label: "Hisobotlar",
    icon: ChartNoAxesCombined,
    tabs: [
      ["/reports", "Hisobotlar"],
      ["/analytics", "Tahlil"],
    ],
  },
  {
    label: "Tizim",
    icon: Settings,
    tabs: [
      ["/users", "Foydalanuvchilar"],
      ["/roles", "Rollar"],
      ["/audit", "Audit"],
      ["/settings", "Sozlamalar"],
    ],
  },
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
    return startTranslator(document.body, lang);
  }, [lang]);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("staffora_sidebar") === "collapsed";
    } catch {
      return false;
    }
  });
  const [mobile, setMobile] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { data: company } = useApi<Company>("/company");
  const { data: notifications, reload: reloadNotifications } =
    useApi<Notification[]>("/notifications");
  const { data: leave, reload: reloadLeave } =
    useApi<{ status: string }[]>(user && canOpenPage(user.role, "/leave") ? "/leave" : null);
  // Faqat rolga ruxsat etilgan bandlar va tablar ko‘rinadi.
  const visibleMenu = useMemo(
    () =>
      menu
        .map((item) => ({ ...item, tabs: item.tabs.filter(([path]) => (user ? canOpenPage(user.role, path) : false)) }))
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
    user && canAny(user.role, ["employees.edit", "payroll.edit"]) ? "/fines?status=PENDING" : null,
  );
  usePolling(() => void reloadFines(true), 60_000);
  const { data: registrations, reload: reloadRegistrations } = useApi<{ counts: { PENDING: number } }>(
    user && canOpenPage(user.role, "/registrations") ? "/registrations?status=PENDING" : null,
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

  useEffect(() => {
    try {
      localStorage.setItem("staffora_sidebar", collapsed ? "collapsed" : "open");
    } catch {
      /* ignore */
    }
  }, [collapsed]);
  useEffect(() => {
    setMobile(false);
    setProfileOpen(false);
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
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("keydown", shortcut);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("keydown", shortcut);
    };
  }, []);

  async function logout() {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = "/login";
  }
  const [firstName, lastName] = (user?.name || "?").split(" ");

  return (
    <div className="app-shell">
      <ScreenLock
        onUnlock={() => {
          void refresh();
          setPageKey((key) => key + 1);
        }}
      />
      {mobile && (
        <button
          className="backdrop"
          aria-label="Menyuni yopish"
          onClick={() => setMobile(false)}
        />
      )}
      <aside
        className={`sidebar ${collapsed ? "collapsed" : ""} ${mobile ? "mobile-open" : ""}`}
      >
        <div className="sidebar-head">
          <Link to={user ? homePage(user.role) : "/dashboard"}>
            <Logo compact={collapsed} />
          </Link>
          <button
            className="icon-btn collapse"
            aria-label={collapsed ? "Menyuni yoyish" : "Menyuni yig‘ish"}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? (
              <PanelLeftOpen size={17} />
            ) : (
              <PanelLeftClose size={17} />
            )}
          </button>
          <button
            className="icon-btn mobile-close"
            aria-label="Menyuni yopish"
            onClick={() => setMobile(false)}
          >
            <X size={19} />
          </button>
        </div>

        <div className="company-chip" title={company?.name}>
          <span className="mark">
            {company?.name
              .split(/\s+/)
              .map((word) => word[0])
              .slice(0, 2)
              .join("")
              .toUpperCase() || "ST"}
          </span>
          <span>
            <b>{company?.name || "…"}</b>
            <small>{company?.plan ? `${company.plan} tarif` : "Kompaniya"}</small>
          </span>
        </div>

        <nav className="nav" aria-label="Asosiy navigatsiya">
          {visibleMenu.map(({ label, icon: Icon, tabs, count }) => {
            const active = current?.label === label;
            const total = count ? counts[count] : 0;
            return (
              <Link
                to={tabs[0][0]}
                key={label}
                className={`nav-link ${active ? "active" : ""}`}
                aria-current={active ? "page" : undefined}
                title={collapsed ? label : undefined}
              >
                <Icon size={18} strokeWidth={1.9} />
                <span>{label}</span>
                {total > 0 && <em className="nav-count">{total > 99 ? "99+" : total}</em>}
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          <Avatar first={firstName} last={lastName} photo={user?.photoDataUrl} />
          <span>
            <b>{user?.name}</b>
            <small>{user ? roleLabels[user.role] : ""}</small>
          </span>
          <button
            className="icon-btn"
            aria-label="Chiqish"
            title="Chiqish"
            onClick={() => void logout()}
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      <div className={`app-main ${collapsed ? "expanded" : ""}`}>
        <header className={`topbar ${scrolled ? "scrolled" : ""}`}>
          <button
            className="icon-btn mobile-menu"
            aria-label="Menyuni ochish"
            onClick={() => setMobile(true)}
          >
            <Menu size={21} />
          </button>
          <div className="topbar-title">
            <small>{company?.name || "Staffora"}</small>
            <b>{current && current.tabs.length > 1 && current.tabs.some(([path]) => path === location.pathname) ? current.label : pageTitle}</b>
          </div>
          <button type="button" className="search search-btn" onClick={() => setPalette(true)} aria-label="Qidiruv (Ctrl+K)">
            <Search size={16} />
            <span>Qidirish: xodim, filial, sahifa…</span>
            <kbd>Ctrl K</kbd>
          </button>
          <CommandPalette open={palette} onClose={() => setPalette(false)} pages={visibleMenu.flatMap((item) => item.tabs.map(([path]) => [path, pageNames[path]] as [string, string]))} />
          <div className="top-actions">
            <button
              className="lang-toggle"
              data-no-translate
              title={lang === "uz" ? "Русский язык" : "O‘zbek tili"}
              onClick={() => {
                const next = lang === "uz" ? "ru" : "uz";
                rememberLang(next);
                setLang(next);
              }}
            >
              {lang === "uz" ? "RU" : "UZ"}
            </button>
            {user?.screenLock?.enabled && (
              <button
                className="icon-btn"
                aria-label="Ekranni qulflash"
                title="Ekranni qulflash"
                onClick={() => window.dispatchEvent(new Event("staffora:lock-now"))}
              >
                <Lock size={18} />
              </button>
            )}
            <Link
              to="/notifications"
              className="icon-btn bell"
              aria-label={`${counts.notifications} ta o‘qilmagan bildirishnoma`}
            >
              <Bell size={19} />
              {counts.notifications > 0 && (
                <i>{counts.notifications > 9 ? "9+" : counts.notifications}</i>
              )}
            </Link>
            <div className="user-menu">
              <button
                className="user-trigger"
                aria-expanded={profileOpen}
                onClick={() => setProfileOpen(!profileOpen)}
              >
                <Avatar
                  first={firstName}
                  last={lastName}
                  photo={user?.photoDataUrl}
                  size="sm"
                />
                <span>
                  <b>{firstName}</b>
                  <small>{user ? roleLabels[user.role] : ""}</small>
                </span>
                <ChevronDown size={14} />
              </button>
              {profileOpen && (
                <>
                  <button
                    className="backdrop"
                    style={{ background: "transparent", zIndex: 70 }}
                    aria-label="Yopish"
                    onClick={() => setProfileOpen(false)}
                  />
                  <div className="popover">
                    <div className="popover-head">
                      <b>{user?.name}</b>
                      <small>{user?.email}</small>
                    </div>
                    <Link to="/settings">
                      <CircleUserRound size={16} /> Profil va sozlamalar
                    </Link>
                    <button className="danger" onClick={() => void logout()}>
                      <LogOut size={16} /> Tizimdan chiqish
                    </button>
                  </div>
                </>
              )}
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
