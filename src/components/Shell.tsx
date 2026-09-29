import { useEffect, useMemo, useRef, useState } from "react";
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
} from "lucide-react";
import type { Company, Notification, Role } from "@/lib/types";
import { Logo } from "./Logo";
import { Avatar } from "./ui";
import { useAuth } from "../auth";
import { api } from "../api";
import { useApi } from "../hooks";

const sections = [
  {
    label: "Asosiy",
    items: [
      ["/dashboard", "Bosh sahifa", LayoutDashboard],
      ["/employees", "Xodimlar", Users],
      ["/attendance", "Davomat", Clock3],
      ["/calendar", "Kalendar", CalendarDays],
      ["/branches", "Filiallar", Building2],
    ],
  },
  {
    label: "Tashkilot",
    items: [
      ["/departments", "Bo‘limlar", Network],
      ["/positions", "Lavozimlar", BriefcaseBusiness],
      ["/schedules", "Ish grafiklari", ClipboardList],
    ],
  },
  {
    label: "Boshqaruv",
    items: [
      ["/leave", "Ta’til va yo‘qlik", CalendarDays],
      ["/payroll", "Ish haqi", Banknote],
      ["/reports", "Hisobotlar", ChartNoAxesCombined],
      ["/announcements", "E’lonlar", Megaphone],
      ["/notifications", "Bildirishnomalar", Bell],
    ],
  },
  {
    label: "Tizim",
    items: [
      ["/roles", "Rollar va ruxsatlar", ShieldCheck],
      ["/audit", "Audit jurnali", ScrollText],
      ["/settings", "Sozlamalar", Settings],
    ],
  },
] as const;

const pageNames = Object.fromEntries(
  sections.flatMap((section) =>
    section.items.map(([path, label]) => [path, label]),
  ),
);

export function Shell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const searchRef = useRef<HTMLInputElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const { data: company } = useApi<Company>("/company");
  const { data: notifications } = useApi<Notification[]>("/notifications");

  const pageTitle = useMemo(() => {
    const exact = pageNames[location.pathname];
    if (exact) return exact;
    if (location.pathname.startsWith("/employees/")) return "Xodim profili";
    return "STAFFORA";
  }, [location.pathname]);
  const unread = notifications?.filter((item) => !item.read).length || 0;

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  async function logout() {
    await api("/auth/logout", { method: "POST" });
    navigate("/login");
    window.location.reload();
  }

  return (
    <div className="app-shell">
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
        <div className="sidebar-logo">
          <Logo compact={collapsed} />
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

        <div className="company-switch" title={company?.name}>
          <span className="company-mark">
            {company?.name
              .split(" ")
              .map((word) => word[0])
              .slice(0, 2)
              .join("") || "ST"}
          </span>
          {!collapsed && (
            <>
              <span>
                <b>{company?.name || "Yuklanmoqda..."}</b>
                <small>{company ? `${company.plan} reja` : "Kompaniya"}</small>
              </span>
              <ChevronDown size={14} />
            </>
          )}
        </div>

        <nav className="side-nav" aria-label="Asosiy navigatsiya">
          {sections.map((section) => (
            <div className="nav-section" key={section.label}>
              {!collapsed && (
                <div className="nav-section-label">{section.label}</div>
              )}
              {section.items.map(([to, label, Icon]) => (
                <NavLink
                  to={to}
                  key={to}
                  onClick={() => setMobile(false)}
                  className={({ isActive }) =>
                    `nav-link ${isActive ? "active" : ""}`
                  }
                  title={collapsed ? label : undefined}
                >
                  <Icon size={17} strokeWidth={1.8} />
                  {!collapsed && <span>{label}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="side-user">
          <Avatar
            first={user?.name.split(" ")[0] || "?"}
            last={user?.name.split(" ")[1]}
            photo={user?.photoDataUrl}
          />
          {!collapsed && (
            <span>
              <b>{user?.name}</b>
              <small>{roleLabel(user?.role)}</small>
            </span>
          )}
        </div>
      </aside>

      <div className={`app-main ${collapsed ? "expanded" : ""}`}>
        <header className="topbar">
          <button
            className="icon-btn mobile-menu"
            aria-label="Menyuni ochish"
            onClick={() => setMobile(true)}
          >
            <Menu size={21} />
          </button>
          <div className="top-context">
            <small>{company?.name || "STAFFORA"}</small>
            <b>{pageTitle}</b>
          </div>
          <div className="global-search">
            <Search size={16} />
            <input
              ref={searchRef}
              aria-label="Xodim qidirish"
              placeholder="Xodim yoki ID bo‘yicha qidiring"
              onKeyDown={(event) => {
                if (event.key === "Enter" && event.currentTarget.value.trim()) {
                  navigate(
                    `/employees?q=${encodeURIComponent(event.currentTarget.value.trim())}`,
                  );
                  event.currentTarget.blur();
                }
              }}
            />
            <kbd>⌘ K</kbd>
          </div>
          <div className="top-actions">
            <Link
              to="/notifications"
              className="icon-btn top-notification"
              aria-label={`${unread} ta o‘qilmagan bildirishnoma`}
            >
              <Bell size={18} />
              {unread > 0 && <span>{unread > 9 ? "9+" : unread}</span>}
            </Link>
            <div className="top-user-wrap">
              <button
                className="top-user"
                aria-expanded={profileOpen}
                onClick={() => setProfileOpen(!profileOpen)}
              >
                <Avatar
                  first={user?.name.split(" ")[0] || "?"}
                  last={user?.name.split(" ")[1]}
                  photo={user?.photoDataUrl}
                />
                <span>
                  <b>{user?.name.split(" ")[0]}</b>
                  <small>{roleLabel(user?.role)}</small>
                </span>
                <ChevronDown size={14} />
              </button>
              {profileOpen && (
                <div className="user-popover">
                  <div>
                    <b>{user?.name}</b>
                    <small>{user?.email}</small>
                  </div>
                  <Link to="/settings" onClick={() => setProfileOpen(false)}>
                    <CircleUserRound size={16} /> Profil va sozlamalar
                  </Link>
                  <button onClick={() => void logout()}>
                    <LogOut size={16} /> Tizimdan chiqish
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function roleLabel(role?: Role) {
  const labels: Partial<Record<Role, string>> = {
    COMPANY_OWNER: "Kompaniya egasi",
    HR_ADMIN: "HR administrator",
    HR_MANAGER: "HR menejer",
    FINANCE: "Moliya",
    IT_ADMIN: "IT administrator",
    BRANCH_MANAGER: "Filial menejeri",
    EMPLOYEE: "Xodim",
  };
  return role ? labels[role] || role.replaceAll("_", " ") : "";
}
