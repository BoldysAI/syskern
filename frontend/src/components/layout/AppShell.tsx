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
  ChevronRight,
  Users,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

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
  onClick,
}: {
  href: string;
  icon: React.ElementType;
  label: string;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
        active
          ? "bg-[#E07200] text-white"
          : "text-white/70 hover:bg-[#1B3354] hover:text-white"
      )}
    >
      <Icon size={18} />
      {label}
    </Link>
  );
}

function Sidebar({
  pathname,
  onClose,
}: {
  pathname: string;
  onClose?: () => void;
}) {
  const { user, role, logout } = useAuth();

  return (
    <div className="flex flex-col h-full bg-[#0F2137] w-60">
      <div className="px-5 py-5 border-b border-white/10">
        <div className="text-white font-bold text-xl tracking-wide">SYSKERN</div>
        <div className="text-white/40 text-xs mt-0.5 tracking-wider uppercase">
          Pricing Platform
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
        {NAV_ITEMS.map((item) => (
          <NavItem
            key={item.href}
            href={item.href}
            icon={item.icon}
            label={item.label}
            active={pathname.startsWith(item.href)}
            onClick={onClose}
          />
        ))}

        <div className="my-3 border-t border-white/10" />

        <NavItem
          href={SETTINGS_ITEM.href}
          icon={SETTINGS_ITEM.icon}
          label={SETTINGS_ITEM.label}
          active={pathname.startsWith(SETTINGS_ITEM.href)}
          onClick={onClose}
        />

        {role === "admin" && (
          <NavItem
            href={USERS_ITEM.href}
            icon={USERS_ITEM.icon}
            label={USERS_ITEM.label}
            active={pathname.startsWith(USERS_ITEM.href)}
            onClick={onClose}
          />
        )}
      </nav>

      {/* User footer */}
      <div className="px-4 py-4 border-t border-white/10">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-[#E07200] flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-bold">
              {user?.first_name?.[0] ?? user?.email?.[0]?.toUpperCase() ?? "?"}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-white text-sm font-medium truncate">
              {user?.first_name && user?.last_name
                ? `${user.first_name} ${user.last_name}`
                : user?.email}
            </div>
            <div className="text-white/40 text-xs">
              {role ? ROLE_LABELS[role] : "—"}
            </div>
          </div>
        </div>
        <button
          onClick={logout}
          className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-white/50 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
        >
          <LogOut size={13} />
          Déconnexion
        </button>
      </div>
    </div>
  );
}

function Breadcrumb({ pathname }: { pathname: string }) {
  const segments = pathname.split("/").filter(Boolean);
  const labels: Record<string, string> = {
    catalog: "Catalogue",
    new: "Nouveau produit",
    simulator: "Simulations",
    offers: "Offres",
    settings: "Paramètres",
    admin: "Admin",
    users: "Utilisateurs",
  };

  return (
    <nav className="flex items-center gap-1.5 text-sm text-slate-500">
      <Link href="/catalog" className="hover:text-slate-700 transition-colors">
        Accueil
      </Link>
      {segments.map((seg, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <ChevronRight size={14} className="text-slate-400" />
          <span
            className={
              i === segments.length - 1
                ? "text-slate-800 font-medium"
                : "hover:text-slate-700"
            }
          >
            {labels[seg] ?? seg}
          </span>
        </span>
      ))}
    </nav>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-[#F5F7FA]">
        <div className="w-8 h-8 border-2 border-[#E07200]/30 border-t-[#E07200] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-shrink-0">
        <Sidebar pathname={pathname} />
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
        <header className="flex-shrink-0 h-14 bg-white border-b border-[#E2E8F0] flex items-center px-6 gap-4">
          <button
            className="md:hidden p-1 text-slate-600 hover:text-slate-900 transition-colors"
            onClick={() => setMobileOpen(true)}
            aria-label="Ouvrir le menu"
          >
            <Menu size={20} />
          </button>

          <div className="flex-1">
            <Breadcrumb pathname={pathname} />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-[#F5F7FA]">{children}</main>
      </div>
    </div>
  );
}
