export type Role = "admin" | "commercial" | "viewer";

export interface AuthUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  role: Role;
}

export interface SessionResponse {
  authenticated: boolean;
  user: AuthUser | null;
}

function getCsrfToken(): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(/csrftoken=([^;]+)/);
  return match ? match[1] : "";
}

export async function getSession(): Promise<SessionResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch("/api/auth/session", {
      credentials: "include",
      signal: controller.signal,
    });
    if (!res.ok) return { authenticated: false, user: null };
    return res.json();
  } catch {
    return { authenticated: false, user: null };
  } finally {
    clearTimeout(timeout);
  }
}

export async function loginApi(email: string, password: string): Promise<AuthUser> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.detail ?? "Identifiants incorrects.");
  }
  const data = await res.json();
  return data.user as AuthUser;
}

export async function logoutApi(): Promise<void> {
  await fetch("/api/auth/logout", {
    method: "POST",
    headers: { "X-CSRFToken": getCsrfToken() },
    credentials: "include",
  });
}

export function canEdit(role: Role | undefined): boolean {
  return role === "admin" || role === "commercial";
}

export function isAdmin(role: Role | undefined): boolean {
  return role === "admin";
}
