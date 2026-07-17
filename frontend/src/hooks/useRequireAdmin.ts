"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { isAdmin } from "@/lib/auth";

/** Redirect non-admins away; safe for use in client pages (no router call during render). */
export function useRequireAdmin(redirectTo = "/") {
  const { role, isLoading } = useAuth();
  const router = useRouter();
  const allowed = isAdmin(role);
  const denied = !isLoading && !allowed;

  useEffect(() => {
    if (denied) {
      router.replace(redirectTo);
    }
  }, [denied, router, redirectTo]);

  return { isLoading, allowed, denied };
}
