"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutGrid,
  Calculator,
  FileText,
  Settings,
  Menu,
  LogOut,
  Users,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { AppBreadcrumb, BreadcrumbProvider } from "@/components/layout/BreadcrumbContext";
import { usePersistedBoolean } from "@/hooks/usePersistedBoolean";

const MAIN_SIDEBAR_COLLAPSED_KEY = "syskern:main-sidebar-collapsed";

const NAV_ITEMS = [
  { label: "Catalogue", href: "/catalog", icon: LayoutGrid },
  { label: "Simulations", href: "/simulator", icon: Calculator },
  { label: "Offres", href: "/offers", icon: FileText },
] as const;

const SETTINGS_ITEM = { label: "Paramètres", href: "/settings", icon: Settings } as const;
const USERS_ITEM = { label: "Utilisateurs", href: "/admin/users", icon: Users } as const;

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  commercial: "Commercial",
  viewer: "Lecteur",
};

function NavItem({
  href,
  icon: Icon,
  label,
  active,
  collapsed,
  onClick,
}: {
  href: string;
  icon: React.ElementType;
  label: string;
  active: boolean;
  collapsed?: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={cn(
        "flex items-center rounded-lg text-sm font-medium transition-colors",
        collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5",
        active
          ? "bg-[#E07200] text-white"
          : "text-white/70 hover:bg-[#1B3354] hover:text-white"
      )}
    >
      <Icon size={18} className="shrink-0" />
      {!collapsed && label}
    </Link>
  );
}

function Sidebar({
  pathname,
  collapsed,
  onClose,
}: {
  pathname: string;
  collapsed?: boolean;
  onClose?: () => void;
}) {
  const { user, role, logout } = useAuth();

  return (
    <div
      className={cn(
        "flex h-full flex-col bg-[#0F2137] transition-[width] duration-200",
        collapsed ? "w-16" : "w-60"
      )}
    >
      <div className={cn("border-b border-white/10 py-5", collapsed ? "px-2" : "px-5")}>
        {collapsed ? (
          <div
            className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg bg-[#E07200] text-sm font-bold text-white"
            title="SYSKERN"
          >
            S
          </div>
        ) : (
          <>
            <div className="text-xl font-bold tracking-wide text-white">SYSKERN</div>
            <div className="mt-0.5 text-xs uppercase tracking-wider text-white/40">
              Pricing Platform
            </div>
          </>
        )}
      </div>

      <nav className={cn("flex flex-1 flex-col gap-1 py-4", collapsed ? "px-2" : "px-3")}>
        {NAV_ITEMS.map((item) => (
          <NavItem
            key={item.href}
            href={item.href}
            icon={item.icon}
            label={item.label}
            active={pathname.startsWith(item.href)}
            collapsed={collapsed}
            onClick={onClose}
          />
        ))}

        <div className="my-3 border-t border-white/10" />

        <NavItem
          href={SETTINGS_ITEM.href}
          icon={SETTINGS_ITEM.icon}
          label={SETTINGS_ITEM.label}
          active={pathname.startsWith(SETTINGS_ITEM.href)}
          collapsed={collapsed}
          onClick={onClose}
        />

        {role === "admin" && (
          <NavItem
            href={USERS_ITEM.href}
            icon={USERS_ITEM.icon}
            label={USERS_ITEM.label}
            active={pathname.startsWith(USERS_ITEM.href)}
            collapsed={collapsed}
            onClick={onClose}
          />
        )}
      </nav>

      {/* User footer */}
      <div className={cn("border-t border-white/10 py-4", collapsed ? "px-2" : "px-4")}>
        <div className={cn("mb-3 flex items-center", collapsed ? "justify-center" : "gap-3")}>
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#E07200]"
            title={
              collapsed
                ? user?.first_name && user?.last_name
                  ? `${user.first_name} ${user.last_name}`
                  : user?.email
                : undefined
            }
          >
            <span className="text-xs font-bold text-white">
              {user?.first_name?.[0] ?? user?.email?.[0]?.toUpperCase() ?? "?"}
            </span>
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-white">
                {user?.first_name && user?.last_name
                  ? `${user.first_name} ${user.last_name}`
                  : user?.email}
              </div>
              <div className="text-xs text-white/40">{role ? ROLE_LABELS[role] : "—"}</div>
            </div>
          )}
        </div>
        <button
          onClick={logout}
          title="Déconnexion"
          className={cn(
            "flex w-full items-center rounded-lg text-xs text-white/50 transition-colors hover:bg-white/10 hover:text-white",
            collapsed ? "justify-center px-2 py-2" : "gap-2 px-2 py-1.5"
          )}
        >
          <LogOut size={13} />
          {!collapsed && "Déconnexion"}
        </button>
      </div>
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, , toggleSidebarCollapsed] = usePersistedBoolean(
    MAIN_SIDEBAR_COLLAPSED_KEY,
    false
  );
  const { isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-[#F5F7FA]">
        <div className="w-8 h-8 border-2 border-[#E07200]/30 border-t-[#E07200] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <BreadcrumbProvider>
      <div className="flex h-full">
      {/* Desktop sidebar */}
      <aside className="hidden shrink-0 transition-[width] duration-200 md:flex">
        <Sidebar pathname={pathname} collapsed={sidebarCollapsed} />
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 md:hidden transition-transform duration-300",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <Sidebar pathname={pathname} onClose={() => setMobileOpen(false)} />
      </aside>

      {/* Main content area */}
      <div className="flex flex-col flex-1 min-w-0">
        <header className="flex h-14 shrink-0 items-center gap-4 border-b border-[#E2E8F0] bg-white px-6">
          <button
            className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 md:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Ouvrir le menu"
          >
            <Menu size={20} />
          </button>

          <button
            className="hidden rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 md:inline-flex"
            onClick={toggleSidebarCollapsed}
            aria-label={sidebarCollapsed ? "Déplier la barre latérale" : "Replier la barre latérale"}
            title={sidebarCollapsed ? "Déplier la barre latérale" : "Replier la barre latérale"}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
          </button>

          <div className="min-w-0 flex-1">
            <AppBreadcrumb />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-[#F5F7FA]">{children}</main>
      </div>
      </div>
    </BreadcrumbProvider>
  );
}
