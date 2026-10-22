import { lazy, Suspense, useEffect, useMemo, useState, type ComponentType } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import {
  AlertOctagon,
  Archive,
  BarChart3,
  Bell,
  Blocks,
  Bug,
  Building2,
  ChevronDown,
  CircleGauge,
  ClipboardCheck,
  Cpu,
  CreditCard,
  Database,
  FileSignature,
  FileText,
  Flag,
  HardDrive,
  History,
  KeyRound,
  Languages,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  LogOut,
  Megaphone,
  Menu,
  Moon,
  MonitorSmartphone,
  Package,
  Plug,
  Receipt,
  Send,
  Settings,
  Shield,
  ShieldCheck,
  Sun,
  Tag,
  UserCog,
  Users,
  Webhook,
  X,
} from "lucide-react";
import { api } from "../../api";
import { Logo } from "../../components/Logo";
import { useAuth } from "../../auth";
import { useTheme } from "../../theme";
import { PlatformProvider, ReauthProvider, Skeleton, usePlatform } from "./kit";
import type { PlatformPermission } from "@/lib/platform/permissions";

/*
 * Super Admin Control Center qobig‘i: guruhlangan, yig‘iladigan sidebar (ruxsatga qarab),
 * faol yo‘l belgisi, badge’lar (murojaatlar, incidentlar, yangi xatolar), mobil — chiquvchi menyu.
 * Sahifalar kerak bo‘lganda yuklanadi (lazy) — birinchi ochilish tez.
 */

const pages = {
  overview: lazy(() => import("./Overview")),
  companies: lazy(() => import("./Companies")),
  company: lazy(() => import("./CompanyDetail")),
  people: lazy(() => import("./People")),
  business: lazy(() => import("./Business")),
  platform: lazy(() => import("./PlatformPages")),
  operations: lazy(() => import("./Operations")),
  comms: lazy(() => import("./Communication")),
  security: lazy(() => import("./Security")),
  system: lazy(() => import("./SystemPages")),
};
type PageModule = keyof typeof pages;

type NavItem = { path: string; label: string; icon: ComponentType<{ size?: number }>; perm: PlatformPermission | PlatformPermission[]; module: PageModule; view: string; badge?: "tickets" | "incidents" | "errors" | "approvals" };
type NavGroup = { key: string; label: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  {
    key: "overview",
    label: "Umumiy ko‘rinish",
    items: [
      { path: "", label: "Dashboard", icon: LayoutDashboard, perm: "dashboard.read", module: "overview", view: "dashboard" },
      { path: "analytics", label: "Analitika", icon: BarChart3, perm: "analytics.read", module: "overview", view: "analytics" },
      { path: "activities", label: "So‘nggi faollik", icon: History, perm: "dashboard.read", module: "overview", view: "activities" },
    ],
  },
  {
    key: "org",
    label: "Tashkilotlar",
    items: [
      { path: "companies", label: "Kompaniyalar", icon: Building2, perm: "companies.read", module: "companies", view: "list", badge: "approvals" },
      { path: "onboarding", label: "Onboarding", icon: ListChecks, perm: "companies.read", module: "companies", view: "onboarding" },
      { path: "users", label: "Foydalanuvchilar", icon: Users, perm: "users.read", module: "people", view: "users" },
      { path: "leaders", label: "Rahbarlar", icon: UserCog, perm: "users.read", module: "people", view: "leaders" },
      { path: "archived", label: "Arxiv", icon: Archive, perm: "companies.read", module: "companies", view: "archived" },
    ],
  },
  {
    key: "business",
    label: "Biznes",
    items: [
      { path: "plans", label: "Tariflar", icon: Package, perm: "subscriptions.read", module: "business", view: "plans" },
      { path: "subscriptions", label: "Obunalar", icon: CreditCard, perm: "subscriptions.read", module: "business", view: "subscriptions" },
      { path: "billing", label: "Hisob-kitob", icon: Receipt, perm: "billing.read", module: "business", view: "billing" },
      { path: "promos", label: "Promo kodlar", icon: Tag, perm: "promos.manage", module: "business", view: "promos" },
      { path: "contracts", label: "Shartnomalar", icon: FileSignature, perm: "contracts.read", module: "business", view: "contracts" },
    ],
  },
  {
    key: "platform",
    label: "Platforma",
    items: [
      { path: "modules", label: "Modullar", icon: Blocks, perm: "companies.read", module: "platform", view: "modules" },
      { path: "flags", label: "Feature flaglar", icon: Flag, perm: "flags.manage", module: "platform", view: "flags" },
      { path: "integrations", label: "Integratsiyalar", icon: Plug, perm: "integrations.read", module: "platform", view: "integrations" },
      { path: "api-keys", label: "API kalitlar", icon: KeyRound, perm: "integrations.read", module: "platform", view: "apikeys" },
      { path: "webhooks", label: "Webhooklar", icon: Webhook, perm: "integrations.read", module: "platform", view: "webhooks" },
      { path: "resources", label: "Resurslar", icon: HardDrive, perm: "monitoring.read", module: "platform", view: "resources" },
    ],
  },
  {
    key: "ops",
    label: "Operatsiyalar",
    items: [
      { path: "monitoring", label: "Monitoring", icon: CircleGauge, perm: "monitoring.read", module: "operations", view: "monitoring" },
      { path: "errors", label: "Xatolar", icon: Bug, perm: "monitoring.read", module: "operations", view: "errors", badge: "errors" },
      { path: "incidents", label: "Incidentlar", icon: AlertOctagon, perm: "monitoring.read", module: "operations", view: "incidents", badge: "incidents" },
      { path: "backups", label: "Zaxiralar", icon: Database, perm: "backups.read", module: "operations", view: "backups" },
      { path: "jobs", label: "Fon ishlari", icon: Cpu, perm: "monitoring.read", module: "operations", view: "jobs" },
    ],
  },
  {
    key: "comms",
    label: "Aloqa",
    items: [
      { path: "notifications", label: "Bildirishnomalar", icon: Bell, perm: "notifications.read", module: "comms", view: "notifications" },
      { path: "bulk", label: "Ommaviy xabarlar", icon: Megaphone, perm: "notifications.read", module: "comms", view: "bulk" },
      { path: "support", label: "Murojaatlar", icon: LifeBuoy, perm: "support.read", module: "comms", view: "support", badge: "tickets" },
      { path: "leads", label: "Demo so‘rovlari", icon: Send, perm: "companies.read", module: "comms", view: "leads" },
    ],
  },
  {
    key: "security",
    label: "Xavfsizlik",
    items: [
      { path: "security", label: "Xavfsizlik markazi", icon: ShieldCheck, perm: "security.read", module: "security", view: "center" },
      { path: "audit", label: "Audit jurnali", icon: ClipboardCheck, perm: "audit.read", module: "security", view: "audit" },
      { path: "sessions", label: "Sessiyalar", icon: MonitorSmartphone, perm: "users.read", module: "security", view: "sessions" },
      { path: "admins", label: "Admin rollari", icon: Shield, perm: "admins.manage", module: "security", view: "admins" },
    ],
  },
  {
    key: "system",
    label: "Tizim",
    items: [
      { path: "languages", label: "Tillar", icon: Languages, perm: "settings.read", module: "system", view: "languages" },
      { path: "settings", label: "Global sozlamalar", icon: Settings, perm: "settings.read", module: "system", view: "settings" },
      { path: "exports", label: "Eksport markazi", icon: FileText, perm: "audit.export", module: "system", view: "exports" },
    ],
  },
];

function Page({ item }: { item: NavItem }) {
  const Module = pages[item.module] as ComponentType<{ view: string }>;
  return <Module view={item.view} />;
}

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me, can } = usePlatform();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem("sa_nav") || "{}");
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("sa_nav", JSON.stringify(collapsed));
    } catch {
      /* ignore */
    }
  }, [collapsed]);
  const groups = useMemo(() => NAV.map((g) => ({ ...g, items: g.items.filter((i) => (Array.isArray(i.perm) ? i.perm : [i.perm]).some(can)) })).filter((g) => g.items.length), [can]);
  const active = (item: NavItem) => {
    const full = `/super-admin${item.path ? `/${item.path}` : ""}`;
    if (!item.path) return location.pathname === "/super-admin" || location.pathname === "/super-admin/";
    return location.pathname === full || location.pathname.startsWith(`${full}/`);
  };
  return (
    <aside className={`sa-sidebar ${open ? "open" : ""}`} aria-label="Super Admin navigatsiyasi">
      <div className="sa-sidebar-head">
        <Logo />
        <span className="sa-pill">Control Center</span>
        <button className="icon-btn sa-mobile-only" onClick={onClose} aria-label="Menyuni yopish">
          <X size={18} />
        </button>
      </div>
      <nav className="sa-nav">
        {!me && <Skeleton rows={8} />}
        {groups.map((group) => {
          const isCollapsed = collapsed[group.key] && !group.items.some(active);
          return (
            <div key={group.key} className="sa-nav-group">
              <button className="sa-nav-title" aria-expanded={!isCollapsed} onClick={() => setCollapsed({ ...collapsed, [group.key]: !collapsed[group.key] })}>
                {group.label}
                <ChevronDown size={14} className={isCollapsed ? "rot" : ""} />
              </button>
              {!isCollapsed &&
                group.items.map((item) => {
                  const badge = item.badge ? me?.badges[item.badge] || 0 : 0;
                  return (
                    <NavLink key={item.path} to={`/super-admin${item.path ? `/${item.path}` : ""}`} end={!item.path} className={active(item) ? "active" : ""} onClick={onClose}>
                      <item.icon size={17} />
                      <span>{item.label}</span>
                      {badge > 0 && <em className="sa-badge">{badge > 99 ? "99+" : badge}</em>}
                    </NavLink>
                  );
                })}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { me } = usePlatform();
  const { user } = useAuth();
  const { theme, toggle } = useTheme();
  return (
    <header className="sa-topbar">
      <button className="icon-btn sa-mobile-only" onClick={onMenu} aria-label="Menyuni ochish">
        <Menu size={20} />
      </button>
      <span className="sa-env">{me?.platformName || "Staffora"} · Super Admin</span>
      <div className="sa-top-actions">
        <button className="icon-btn" onClick={toggle} aria-label="Ko‘rinishni almashtirish" title={theme === "dark" ? "Yorug‘ rejim" : "Qorong‘i rejim"}>
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        </button>
        <span className="sa-me">
          <b>{user?.name}</b>
          <small>{me?.user.roleLabel || "…"}</small>
        </span>
        <button
          className="btn btn-sm"
          onClick={async () => {
            await api("/auth/logout", { method: "POST" }).catch(() => undefined);
            location.href = "/login";
          }}
        >
          <LogOut size={14} /> Chiqish
        </button>
      </div>
    </header>
  );
}

function Routed() {
  const { can, me } = usePlatform();
  const items = NAV.flatMap((g) => g.items);
  const allowed = (item: NavItem) => (Array.isArray(item.perm) ? item.perm : [item.perm]).some(can);
  const home = items.find(allowed);
  const Company = pages.company;
  return (
    <Suspense fallback={<Skeleton rows={6} />}>
      <Routes>
        {items.map((item) => (
          <Route key={item.path} path={item.path || "/"} element={!me ? <Skeleton rows={6} /> : allowed(item) ? <Page item={item} /> : home && home !== item ? <Navigate to={`/super-admin/${home.path}`} replace /> : <Page item={item} />} />
        ))}
        <Route path="companies/:id" element={<Company />} />
        <Route path="companies/:id/:tab" element={<Company />} />
        <Route path="*" element={<Navigate to="/super-admin" replace />} />
      </Routes>
    </Suspense>
  );
}

export function SuperAdminApp() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => {
    setOpen(false);
    window.scrollTo({ top: 0 });
  }, [location.pathname]);
  useEffect(() => {
    document.title = "Control Center · Staffora";
  }, []);
  return (
    <PlatformProvider>
      <ReauthProvider>
        <div className="sa-app">
          {open && <button className="sa-backdrop" aria-label="Menyuni yopish" onClick={() => setOpen(false)} />}
          <Sidebar open={open} onClose={() => setOpen(false)} />
          <div className="sa-main">
            <TopBar onMenu={() => setOpen(true)} />
            <main className="sa-content" id="main-content" tabIndex={-1}>
              <Routed />
            </main>
          </div>
        </div>
      </ReauthProvider>
    </PlatformProvider>
  );
}

