"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { getSession, loginApi, logoutApi, type AuthUser, type Role } from "@/lib/auth";

interface AuthContextValue {
  user: AuthUser | null;
  role: Role | undefined;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getSession()
      .then(({ authenticated, user: u }) => {
        if (authenticated && u) {
          setUser(u);
        } else {
          setUser(null);
          const path = window.location.pathname;
          if (path !== "/login") router.replace("/login");
        }
      })
      .catch(() => {
        // Network error (e.g. backend temporarily down): treat as unauthenticated.
        setUser(null);
        const path = window.location.pathname;
        if (path !== "/login") router.replace("/login");
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [router]);

  const login = useCallback(
    async (email: string, password: string) => {
      const u = await loginApi(email, password);
      setUser(u);
      router.push("/");
    },
    [router],
  );

  const logout = useCallback(async () => {
    await logoutApi();
    setUser(null);
    router.push("/login");
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, role: user?.role, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
