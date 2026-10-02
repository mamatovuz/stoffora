import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  Clock3,
  CalendarDays,
  Building2,
  Network,
  BriefcaseBusiness,
  ClipboardList,
  Banknote,
  ChartNoAxesCombined,
  Megaphone,
  MessagesSquare,
  MapPinned,
  Bell,
  Settings,
  ShieldCheck,
  ScrollText,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  X,
  LogOut,
  ChevronDown,
  CircleUserRound,
  Plane,
  UserCog,
  UserMinus,
  Lock,
  ClipboardCheck,
  TrendingUp,
  ClockAlert,
  HandCoins,
  Gavel,
  Trophy,
  Inbox,
  Wallet,
} from "lucide-react";
import type { Company, Notification } from "@/lib/types";
import { Logo } from "./Logo";
import { Avatar } from "./ui";
import { roleLabels, useAuth } from "../auth";
import { canAny, canOpenPage, homePage } from "@/lib/permissions";
import { ScreenLock } from "./ScreenLock";
import { api } from "../api";
import { useApi, usePolling } from "../hooks";
import { rememberLang, startTranslator, storedLang, type Lang } from "../i18n";

type NavItem = [string, string, typeof Users, string?];
const sections: { label: string; items: NavItem[] }[] = [
  {
    label: "Asosiy",
    items: [
      ["/workspace", "Ish stoli", ClipboardCheck],
      ["/inbox", "Tasdiqlashlar", Inbox, "inbox"],
      ["/dashboard", "Bosh sahifa", LayoutDashboard],
      ["/attendance", "Keldi-ketdi", Clock3],
      ["/map", "Xarita", MapPinned],
      ["/employees", "Xodimlar", Users],
      ["/calendar", "Kalendar", CalendarDays],
      ["/leave", "Ta’til va yo‘qlik", Plane, "leave"],
      ["/attendance-requests", "Davomat so‘rovlari", ClockAlert, "corrections"],
      ["/registrations", "Arizalar", ClipboardCheck, "registrations"],
      ["/dismissed", "Ishdan bo‘shaganlar", UserMinus],
    ],
  },
  {
    label: "Tashkilot",
    items: [
      ["/branches", "Filiallar", Building2],
      ["/schedules", "Ish grafiklari", ClipboardList],
      ["/departments", "Bo‘limlar", Network],
      ["/positions", "Lavozimlar", BriefcaseBusiness],
    ],
  },
  {
    label: "Moliya",
    items: [
      ["/finance", "Moliya xulosasi", Wallet],
      ["/timesheet", "Timesheet", ClipboardList],
      ["/payroll", "Ish haqi", Banknote],
      ["/advances", "Avans oluvchilar", HandCoins],
      ["/fines", "Jarimalar", Gavel, "fines"],
      ["/rewards", "Rag‘batlantirish", Trophy],
    ],
  },
  {
    label: "Tahlil va aloqa",
    items: [
      ["/analytics", "Tahlil", TrendingUp],
      ["/reports", "Hisobotlar", ChartNoAxesCombined],
      ["/announcements", "E’lonlar", Megaphone],
      ["/helpdesk", "Murojaatlar", MessagesSquare],
      ["/notifications", "Bildirishnomalar", Bell, "notifications"],
    ],
  },
  {
    label: "Tizim",
    items: [
      ["/users", "Panel foydalanuvchilari", UserCog],
      ["/roles", "Rollar", ShieldCheck],
      ["/audit", "Audit jurnali", ScrollText],
      ["/settings", "Sozlamalar", Settings],
    ],
  },
];

const pageNames = Object.fromEntries(
  sections.flatMap((section) =>
    section.items.map(([path, label]) => [path, label]),
  ),
);

export function Shell() {
  const { user, refresh } = useAuth();
  const [pageKey, setPageKey] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();
  const searchRef = useRef<HTMLInputElement>(null);
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
  // Faqat rolga ruxsat etilgan bo‘limlar ko‘rinadi.
  const visibleSections = useMemo(
    () =>
      sections
        .map((section) => ({
          ...section,
          items: section.items.filter(([path]) => (user ? canOpenPage(user.role, path) : false)),
        }))
        .filter((section) => section.items.length),
    [user],
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

  const { data: corrections, reload: reloadCorrections } = useApi<{ status: string }[]>(
    user && canOpenPage(user.role, "/attendance-requests") ? "/attendance-corrections?status=PENDING" : null,
  );
  usePolling(() => void reloadCorrections(true), 30_000);
  useEffect(() => {
    const on = () => void reloadCorrections(true);
    window.addEventListener("staffora:leave", on);
    window.addEventListener("staffora:notifications", on);
    return () => {
      window.removeEventListener("staffora:leave", on);
      window.removeEventListener("staffora:notifications", on);
    };
  }, [reloadCorrections]);
  const { data: workspace, reload: reloadWorkspace } = useApi<{ inbox: { total: number } }>(user ? "/workspace/actions" : null);
  usePolling(() => void reloadWorkspace(true), 60_000);
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
    corrections: corrections?.length || 0,
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
        searchRef.current?.focus();
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
            <small>{company ? `${company.plan} tarif` : "Kompaniya"}</small>
          </span>
        </div>

        <nav className="nav" aria-label="Asosiy navigatsiya">
          {visibleSections.map((section) => (
            <div key={section.label}>
              <div className="nav-label">{section.label}</div>
              {section.items.map(([to, label, Icon, countKey]) => (
                <NavLink
                  to={to}
                  key={to}
                  className={({ isActive }) =>
                    `nav-link ${isActive ? "active" : ""}`
                  }
                  title={collapsed ? label : undefined}
                >
                  <Icon size={18} strokeWidth={1.9} />
                  <span>{label}</span>
                  {countKey && counts[countKey] > 0 && (
                    <em className="nav-count">
                      {counts[countKey] > 99 ? "99+" : counts[countKey]}
                    </em>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
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
            <b>{pageTitle}</b>
          </div>
          <form
            className="search"
            onSubmit={(event) => {
              event.preventDefault();
              const value = searchRef.current?.value.trim();
              if (!value) return;
              navigate(`/employees?q=${encodeURIComponent(value)}`);
              searchRef.current?.blur();
            }}
          >
            <Search size={16} />
            <input
              ref={searchRef}
              aria-label="Xodim qidirish"
              placeholder="Xodim, ID yoki telefon…"
            />
            <kbd>Ctrl K</kbd>
          </form>
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
          <Fragment key={pageKey}>
            <Outlet />
          </Fragment>
        </main>
      </div>
    </div>
  );
}
