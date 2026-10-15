"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { IconProps } from "@phosphor-icons/react";
import {
  BookOpenText,
  Books,
  ChartLineUp,
  Files,
  GearSix,
  GitDiff,
  House,
  List,
  Sidebar as SidebarIcon,
  SidebarSimple,
  SignOut,
  SquaresFour,
  Truck,
  Users,
  Warning,
} from "@phosphor-icons/react";
import { useAuth } from "@/contexts/AuthContext";
import { isAdmin } from "@/lib/auth";
import type { MessageKey } from "@/lib/i18n";
import { useUiTranslate } from "@/lib/use-ui-translate";
import { cn } from "@/lib/utils";
import { AppBreadcrumb, BreadcrumbProvider } from "@/components/layout/BreadcrumbContext";
import { HelpPopover } from "@/components/help/HelpPopover";
import { usePersistedBoolean } from "@/hooks/usePersistedBoolean";
import { BrandLogo } from "@/components/BrandLogo";
import { AppIcon } from "@/components/AppIcon";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

const MAIN_SIDEBAR_COLLAPSED_KEY = "syskern:main-sidebar-collapsed";
/** Hauteur commune barre logo sidebar + header fil d'Ariane */
const SHELL_TOP_BAR_CLASS = "h-14 shrink-0";

const HOME_ITEM = {
  labelKey: "nav.dashboard",
  href: "/",
  icon: House,
} as const;

const NAV_ITEMS = [
  { labelKey: "nav.catalog", href: "/catalog", icon: SquaresFour },
  { labelKey: "nav.suppliers", href: "/suppliers", icon: Truck },
  { labelKey: "nav.simulations", href: "/simulator", icon: ChartLineUp },
  { labelKey: "nav.comparisons", href: "/comparator", icon: GitDiff },
  { labelKey: "nav.offers", href: "/offers", icon: Files },
  { labelKey: "nav.library", href: "/library", icon: Books },
] as const;

const SETTINGS_ITEM = {
  labelKey: "nav.settings",
  href: "/settings",
  icon: GearSix,
} as const;
const USERS_ITEM = {
  labelKey: "nav.users",
  href: "/admin/users",
  icon: Users,
} as const;
const QUARANTINE_ITEM = {
  labelKey: "nav.quarantine",
  href: "/admin/migration-quarantine",
  icon: Warning,
} as const;

const ROLE_LABELS: Record<string, MessageKey> = {
  admin: "common.roleAdmin",
  commercial: "common.roleCommercial",
  viewer: "common.roleViewer",
};

function isNavActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

function NavItem({
  href,
  icon,
  label,
  active,
  collapsed,
  onClick,
}: {
  href: string;
  icon: React.ComponentType<IconProps>;
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
        "relative flex items-center rounded-lg text-sm font-semibold transition-all duration-200",
        collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5",
        active
          ? collapsed
            ? "bg-primary/25 text-white ring-1 ring-primary/50"
            : "bg-primary/15 text-white before:absolute before:left-0 before:top-1/2 before:h-6 before:w-1 before:-translate-y-1/2 before:rounded-full before:bg-primary"
          : "text-white/70 hover:bg-white/10 hover:text-white",
      )}
    >
      <AppIcon icon={icon} weight={active ? "duotone" : "regular"} size="sm" />
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
  const { user, role, logout, setLocale } = useAuth();
  const localeValue = user?.locale === "fr" || user?.locale === "en" ? user.locale : "deployment";
  const t = useUiTranslate();
  const displayName =
    user?.first_name && user?.last_name ? `${user.first_name} ${user.last_name}` : user?.email;

  return (
    <div
      className={cn(
        "flex h-full flex-col bg-gradient-to-b from-brand-navy to-brand-navy-dark transition-[width] duration-200 ease-out",
        collapsed ? "w-16" : "w-60",
      )}
    >
      <div
        className={cn(
          "flex w-full shrink-0 items-center justify-center border-b border-border bg-white",
          SHELL_TOP_BAR_CLASS,
          collapsed ? "px-2" : "px-3",
        )}
      >
        <Link
          href="/"
          title={t("nav.dashboard")}
          className="flex h-full w-full items-center justify-center"
        >
          <BrandLogo
            variant="syskern"
            compact={collapsed}
            className={cn(
              "h-full w-full object-contain object-center",
              collapsed ? "max-h-9 max-w-9" : "max-h-11 max-w-full",
            )}
          />
        </Link>
      </div>

      <nav className={cn("flex flex-1 flex-col gap-1 py-4", collapsed ? "px-2" : "px-3")}>
        <NavItem
          href={HOME_ITEM.href}
          icon={HOME_ITEM.icon}
          label={t(HOME_ITEM.labelKey)}
          active={isNavActive(pathname, HOME_ITEM.href)}
          collapsed={collapsed}
          onClick={onClose}
        />

        {NAV_ITEMS.map((item) => (
          <NavItem
            key={item.href}
            href={item.href}
            icon={item.icon}
            label={t(item.labelKey)}
            active={isNavActive(pathname, item.href)}
            collapsed={collapsed}
            onClick={onClose}
          />
        ))}

        {isAdmin(role) && (
          <>
            <div className="my-3 border-t border-white/10" />

            {!collapsed && (
              <p className="mb-1 px-3 text-xs font-medium text-white/40">{t("nav.admin")}</p>
            )}

            <NavItem
              href={SETTINGS_ITEM.href}
              icon={SETTINGS_ITEM.icon}
              label={t(SETTINGS_ITEM.labelKey)}
              active={isNavActive(pathname, SETTINGS_ITEM.href)}
              collapsed={collapsed}
              onClick={onClose}
            />

            <NavItem
              href={USERS_ITEM.href}
              icon={USERS_ITEM.icon}
              label={t(USERS_ITEM.labelKey)}
              active={isNavActive(pathname, USERS_ITEM.href)}
              collapsed={collapsed}
              onClick={onClose}
            />
            <NavItem
              href={QUARANTINE_ITEM.href}
              icon={QUARANTINE_ITEM.icon}
              label={t(QUARANTINE_ITEM.labelKey)}
              active={isNavActive(pathname, QUARANTINE_ITEM.href)}
              collapsed={collapsed}
              onClick={onClose}
            />
          </>
        )}
      </nav>

      <div className={cn("border-t border-white/10 py-4", collapsed ? "px-2" : "px-4")}>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className={cn(
                  "flex w-full items-center rounded-lg text-left transition-colors hover:bg-white/10",
                  collapsed ? "justify-center p-2" : "gap-3 p-2",
                )}
              />
            }
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary">
              <span className="text-xs font-bold text-white">
                {user?.first_name?.[0] ?? user?.email?.[0]?.toUpperCase() ?? "?"}
              </span>
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-white">{displayName}</div>
                <div className="text-xs text-white/40">
                  {role ? (ROLE_LABELS[role] ? t(ROLE_LABELS[role]) : null) : "—"}
                </div>
              </div>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-56">
            <DropdownMenuItem disabled className="text-xs text-muted-foreground">
              {user?.email}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t("users.locale")}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={localeValue}
              onValueChange={(next) => {
                if (!next || next === localeValue) return;
                void setLocale(next === "deployment" ? "" : next);
              }}
            >
              <DropdownMenuRadioItem value="fr">{t("users.localeFr")}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="en">{t("users.localeEn")}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="deployment">
                {t("users.localeDeployment")}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/help" />}>
              <BookOpenText size={16} />
              {t("help.title")}
            </DropdownMenuItem>
            {isAdmin(role) && (
              <DropdownMenuItem render={<Link href="/settings" />}>
                <GearSix size={16} />
                {t("nav.settings")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem variant="destructive" onClick={() => void logout()}>
              <SignOut size={16} />
              {t("common.logout")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, , toggleSidebarCollapsed] = usePersistedBoolean(
    MAIN_SIDEBAR_COLLAPSED_KEY,
    false,
  );
  const { isLoading } = useAuth();
  const t = useUiTranslate();

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <Skeleton className="h-8 w-8 rounded-full" />
      </div>
    );
  }

  return (
    <BreadcrumbProvider>
      <div className="flex h-full">
        <aside className="hidden shrink-0 transition-[width] duration-200 md:flex">
          <Sidebar pathname={pathname} collapsed={sidebarCollapsed} />
        </aside>

        {mobileOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}

        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-50 transition-transform duration-300 md:hidden",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <Sidebar pathname={pathname} onClose={() => setMobileOpen(false)} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header
            className={cn(
              "flex items-center gap-4 border-b border-border bg-card/80 px-6 shadow-[var(--shadow-soft)] backdrop-blur-sm",
              SHELL_TOP_BAR_CLASS,
            )}
          >
            <Button
              variant="ghost"
              size="icon-sm"
              className="md:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label={t("common.openMenu")}
            >
              <List size={20} weight="bold" />
            </Button>

            <Button
              variant="ghost"
              size="icon-sm"
              className="hidden md:inline-flex"
              onClick={toggleSidebarCollapsed}
              aria-label={t(sidebarCollapsed ? "common.expandSidebar" : "common.collapseSidebar")}
              title={t(sidebarCollapsed ? "common.expandSidebar" : "common.collapseSidebar")}
            >
              {sidebarCollapsed ? (
                <SidebarIcon size={20} weight="bold" />
              ) : (
                <SidebarSimple size={20} weight="bold" />
              )}
            </Button>

            <div className="min-w-0 flex-1">
              <AppBreadcrumb />
            </div>

            <HelpPopover />
          </header>

          <main className="min-h-0 flex-1 overflow-y-auto bg-background">{children}</main>
        </div>
      </div>
    </BreadcrumbProvider>
  );
}
