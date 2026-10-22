import { createContext, useContext, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api } from "./api";
import type { Role } from "@/lib/types";
import { canOpenPage, homePage } from "@/lib/permissions";

export interface CurrentUser {
  userId: string;
  companyId?: string;
  name: string;
  email: string;
  role: Role;
  photoDataUrl?: string;
  companyName?: string;
  screenLock?: { enabled: boolean; minutes: number; hasPassword: boolean };
  locked?: boolean;
  /** Super admin o‘chirgan modullar (lib/modules.ts kalitlari). */
  modules?: string[];
  /** Yoqilgan feature flaglar (kompaniya uchun). */
  features?: string[];
  /** Platforma texnik ishlar banneri. */
  maintenance?: { message: string; level: "info" | "warning" | "critical"; endsAt: string | null } | null;
  /** Rahbar bir nechta kompaniyaga kirsa — almashtirish ro‘yxati. */
  companies?: { id: string; name: string }[];
  /** Super admin «kompaniyani ko‘rish» rejimi. */
  preview?: { id: string; mode: "READ_ONLY" | "SUPPORT"; adminId: string; companyName?: string; expiresAt: string };
}
const AuthContext = createContext<{
  user: CurrentUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
}>({ user: null, loading: true, refresh: async () => {} });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  async function refresh() {
    try {
      setUser((await api<{ user: CurrentUser }>("/auth/me")).user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    // Mini App sahifasida panel sessiyasi kerak emas.
    if (window.location.pathname.startsWith("/mini-app")) {
      setLoading(false);
      return;
    }
    // Ko‘rish havolasi (/preview#token) — sessiyani PreviewEntry tokenni saqlagandan keyin o‘zi yuklaydi.
    if (window.location.pathname.startsWith("/preview")) setLoading(false);
    else void refresh();
    // Super admin modullarni o‘zgartirsa — oynaga qaytganda menyu yangilanadi (5 daqiqada bir martadan ko‘p emas).
    let last = Date.now();
    const onVisible = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 5 * 60_000) return;
      last = Date.now();
      void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
  return (
    <AuthContext.Provider value={{ user, loading, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}
export const useAuth = () => useContext(AuthContext);

export function Protected({
  children,
  superAdmin = false,
}: {
  children: React.ReactNode;
  superAdmin?: boolean;
}) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <div className="screen-loader">
        <span />
      </div>
    );
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (superAdmin && user.role !== "SUPER_ADMIN")
    return <Navigate to="/dashboard" replace />;
  if (!superAdmin && user.role === "SUPER_ADMIN")
    return <Navigate to="/super-admin" replace />;
  // Rolga tegishli bo‘lmagan sahifa — o‘zining bosh sahifasiga yo‘naltiriladi.
  // O‘chirilgan modul sahifasi ham shunday (manzil qo‘lda yozilsa ham).
  if (!superAdmin && !canOpenPage(user.role, location.pathname, user.modules)) {
    const home = homePage(user.role, user.modules);
    if (home !== location.pathname) return <Navigate to={home} replace />;
  }
  return children;
}

export const roleLabels: Record<Role, string> = {
  SUPER_ADMIN: "Super admin",
  COMPANY_OWNER: "Kompaniya egasi",
  HR_ADMIN: "HR",
  HR_MANAGER: "HR",
  FINANCE: "Moliya",
  IT_ADMIN: "IT administrator",
  BRANCH_MANAGER: "Filial rahbari",
  EMPLOYEE: "Xodim",
};
