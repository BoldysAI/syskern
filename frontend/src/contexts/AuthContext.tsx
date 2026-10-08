"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { getSession, loginApi, logoutApi, type AuthUser, type Role } from "@/lib/auth";
import type { UiLocale } from "@/lib/i18n";

interface AuthContextValue {
  user: AuthUser | null;
  role: Role | undefined;
  displayLanguage: UiLocale;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [displayLanguage, setDisplayLanguage] = useState<UiLocale>("fr");
  const [isLoading, setIsLoading] = useState(true);
  // Ignores a session check that started before login or logout finished.
  const epoch = useRef(0);

  useEffect(() => {
    const current = epoch.current;
    getSession()
      .then(({ authenticated, user: u, display_language }) => {
        if (current !== epoch.current) return;
        setDisplayLanguage(u?.display_language ?? display_language);
        if (authenticated && u) {
          setUser(u);
          if (window.location.pathname === "/login") router.replace("/");
        } else {
          setUser(null);
          if (window.location.pathname !== "/login") router.replace("/login");
        }
      })
      .catch(() => {
        if (current !== epoch.current) return;
        setUser(null);
        if (window.location.pathname !== "/login") router.replace("/login");
      })
      .finally(() => {
        if (current === epoch.current) setIsLoading(false);
      });
  }, [router]);

  const login = useCallback(
    async (email: string, password: string) => {
      epoch.current += 1;
      const u = await loginApi(email, password);
      setUser(u);
      setDisplayLanguage(u.display_language === "en" ? "en" : "fr");
      router.push("/");
    },
    [router],
  );

  const logout = useCallback(async () => {
    epoch.current += 1;
    await logoutApi();
    setUser(null);
    const session = await getSession().catch(() => null);
    setDisplayLanguage(session?.display_language ?? "fr");
    router.push("/login");
  }, [router]);

  return (
    <AuthContext.Provider
      value={{ user, role: user?.role, displayLanguage, isLoading, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
