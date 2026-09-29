import { createContext, useContext, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api } from "./api";
import type { Role } from "@/lib/types";

export interface CurrentUser {
  userId: string;
  companyId?: string;
  name: string;
  email: string;
  role: Role;
  photoDataUrl?: string;
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
    void refresh();
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
  return children;
}
