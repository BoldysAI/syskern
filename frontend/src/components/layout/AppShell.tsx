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
  X,
  User,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { label: "Catalogue", href: "/catalog", icon: LayoutGrid },
  { label: "Simulations", href: "/simulator", icon: Calculator },
  { label: "Offres", href: "/offers", icon: FileText },
] as const;

const SETTINGS_ITEM = { label: "Paramètres", href: "/settings", icon: Settings } as const;

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
      </nav>

      <div className="px-5 py-4 border-t border-white/10">
        <div className="text-white/30 text-xs">v1.0.0</div>
      </div>
    </div>
  );
}

function Breadcrumb({ pathname }: { pathname: string }) {
  const segments = pathname.split("/").filter(Boolean);
  const labels: Record<string, string> = {
    catalog: "Catalogue",
    simulator: "Simulations",
    offers: "Offres",
    settings: "Paramètres",
    login: "Connexion",
  };

  return (
    <nav className="flex items-center gap-1.5 text-sm text-slate-500">
      <Link href="/catalog" className="hover:text-slate-700 transition-colors">
        Accueil
      </Link>
      {segments.map((seg, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <ChevronRight size={14} className="text-slate-400" />
          <span className={i === segments.length - 1 ? "text-slate-800 font-medium" : "hover:text-slate-700"}>
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
        {/* Top header */}
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

          <div className="flex items-center gap-2 text-sm text-slate-600">
            <div className="w-7 h-7 rounded-full bg-[#0F2137] flex items-center justify-center">
              <User size={14} className="text-white" />
            </div>
            <span className="hidden sm:block font-medium">Admin</span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto bg-[#F5F7FA]">{children}</main>
      </div>
    </div>
  );
}
