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

  useEffect(() => {
    if (!isLoading && !allowed) {
      router.replace(redirectTo);
    }
  }, [isLoading, allowed, router, redirectTo]);

  return { isLoading, allowed };
}
