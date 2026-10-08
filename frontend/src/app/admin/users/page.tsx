"use client";

import { useCallback, useMemo, useState } from "react";
import useSWR, { mutate } from "swr";
import { PencilSimple, Plus, ShieldCheck, Trash, UserPlus } from "@phosphor-icons/react";
import { useRequireAdmin } from "@/hooks/useRequireAdmin";
import { useConfirm } from "@/components/ConfirmProvider";
import { toast } from "sonner";
import { DataTable } from "@/components/data-table";
import type { DataTableColumnDef, DataTableSortState } from "@/components/data-table/types";
import { cycleSortField } from "@/components/data-table/types";
import { AppModal } from "@/components/AppModal";
import { FormField } from "@/components/FormField";
import { AppIcon } from "@/components/AppIcon";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { OptionSelect } from "@/components/OptionSelect";
import { useAuth } from "@/contexts/AuthContext";
import type { Role } from "@/lib/auth";
import { translate, uiDateLocale, type MessageKey } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const LOCALE_UNSET = "deployment";

type TFn = (key: MessageKey, vars?: Record<string, string | number>) => string;

function roleOptions(locale: string) {
  return [
    { value: "admin", label: translate("users.roleAdmin", locale) },
    { value: "commercial", label: translate("users.roleCommercial", locale) },
    { value: "viewer", label: translate("users.roleViewer", locale) },
  ];
}

function localeOptions(locale: string) {
  return [
    { value: LOCALE_UNSET, label: translate("users.localeDeployment", locale) },
    { value: "fr", label: "Français" },
    { value: "en", label: "English" },
  ];
}

interface PlatformUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  role: Role;
  locale: string;
  is_active: boolean;
  date_joined: string;
  last_login: string | null;
}

function roleLabel(role: Role, locale: string): string {
  if (role === "admin") return translate("users.roleAdmin", locale);
  if (role === "commercial") return translate("users.roleCommercial", locale);
  return translate("users.roleViewer", locale);
}

function roleBadgeVariant(role: Role) {
  switch (role) {
    case "admin":
      return "oem" as const;
    case "commercial":
      return "info" as const;
    default:
      return "draft" as const;
  }
}

const DEFAULT_SORT: DataTableSortState = { field: "email", dir: "asc" };

function getCsrfToken(): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(/csrftoken=([^;]+)/);
  return match ? match[1] : "";
}

async function fetchUsers(): Promise<PlatformUser[]> {
  const res = await fetch("/api/users/", { credentials: "include" });
  if (!res.ok) throw new Error("Erreur de chargement");
  return res.json();
}

async function apiCall(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": getCsrfToken(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const emailError = Array.isArray(data?.email) ? data.email[0] : undefined;
    throw new Error(data?.detail ?? emailError ?? "");
  }
  return res.status === 204 ? null : res.json();
}

function UserModal({
  user,
  open,
  onClose,
}: {
  user?: PlatformUser;
  open: boolean;
  onClose: () => void;
}) {
  const [email, setEmail] = useState(user?.email ?? "");
  const [firstName, setFirstName] = useState(user?.first_name ?? "");
  const [lastName, setLastName] = useState(user?.last_name ?? "");
  const [role, setRole] = useState<Role>(user?.role ?? "viewer");
  const [localeChoice, setLocaleChoice] = useState(
    user?.locale === "fr" || user?.locale === "en" ? user.locale : LOCALE_UNSET,
  );
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { displayLanguage } = useAuth();
  const t: TFn = (key, vars) => translate(key, displayLanguage, vars);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const body: Record<string, string> = {
        email,
        first_name: firstName,
        last_name: lastName,
        role,
        locale: localeChoice === LOCALE_UNSET ? "" : localeChoice,
      };
      if (password) body.password = password;
      if (!user) body.password = password || "";
      if (user) {
        await apiCall(`/api/users/${user.id}/`, "PATCH", body);
      } else {
        await apiCall("/api/users/create/", "POST", body);
      }
      await mutate("platform-users");
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error && err.message ? err.message : t("users.genericError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppModal
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={user ? t("users.edit") : t("users.new")}
      size="md"
    >
      {error && (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <FormField label={t("users.firstName")}>
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </FormField>
          <FormField label={t("users.lastName")}>
            <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </FormField>
        </div>

        <FormField label={t("users.email")} required>
          <Input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </FormField>

        <FormField
          label={user ? t("users.passwordKeep") : t("users.password")}
          required={!user}
        >
          <Input
            type="password"
            required={!user}
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </FormField>

        <FormField label={t("users.role")} required>
          <OptionSelect
            value={role}
            onValueChange={(v) => setRole(v as Role)}
            options={roleOptions(displayLanguage)}
          />
        </FormField>

        <FormField label={t("users.locale")}>
          <OptionSelect
            value={localeChoice}
            onValueChange={setLocaleChoice}
            options={localeOptions(displayLanguage)}
          />
        </FormField>

        <div className="flex gap-3 pt-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
            {t("users.cancel")}
          </Button>
          <Button type="submit" disabled={loading} className="flex-1">
            {loading ? t("users.saving") : user ? t("users.update") : t("users.create")}
          </Button>
        </div>
      </form>
    </AppModal>
  );
}

export default function UsersPage() {
  const confirm = useConfirm();
  const { displayLanguage } = useAuth();
  const t: TFn = useCallback((key, vars) => translate(key, displayLanguage, vars), [displayLanguage]);
  const dateLocale = uiDateLocale(displayLanguage);
  const { isLoading: authLoading, allowed } = useRequireAdmin();
  const [modalUser, setModalUser] = useState<PlatformUser | "new" | null>(null);
  const [sort, setSort] = useState<DataTableSortState>(DEFAULT_SORT);

  const { data: users, isLoading, error } = useSWR<PlatformUser[]>("platform-users", fetchUsers);

  const sortedUsers = useMemo(() => {
    if (!users) return [];
    const copy = [...users];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sort.field === "email") cmp = a.email.localeCompare(b.email);
      else if (sort.field === "role") cmp = a.role.localeCompare(b.role);
      else if (sort.field === "last_login") {
        const aTime = a.last_login ? new Date(a.last_login).getTime() : 0;
        const bTime = b.last_login ? new Date(b.last_login).getTime() : 0;
        cmp = aTime - bTime;
      }
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [users, sort]);

  const columns = useMemo<DataTableColumnDef<PlatformUser>[]>(
    () => [
      {
        key: "user",
        label: t("users.columnUser"),
        width: 260,
        render: (u) => (
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-navy">
              <span className="text-xs font-bold text-primary-foreground">
                {u.first_name?.[0] ?? u.email[0].toUpperCase()}
              </span>
            </div>
            <div>
              <div className="text-sm font-medium text-foreground">
                {u.first_name || u.last_name ? `${u.first_name} ${u.last_name}`.trim() : "—"}
              </div>
              <div className="text-xs text-muted-foreground">
                {t("users.createdOn", {
                  date: new Date(u.date_joined).toLocaleDateString(dateLocale),
                })}
              </div>
            </div>
          </div>
        ),
      },
      {
        key: "email",
        label: t("users.email"),
        width: 220,
        sortField: "email",
        render: (u) => <span className="text-sm text-muted-foreground">{u.email}</span>,
      },
      {
        key: "role",
        label: t("users.role"),
        width: 150,
        sortField: "role",
        render: (u) => (
          <StatusBadge variant={roleBadgeVariant(u.role)} className="gap-1">
            {u.role === "admin" && <AppIcon icon={ShieldCheck} size="sm" />}
            {roleLabel(u.role, displayLanguage)}
          </StatusBadge>
        ),
      },
      {
        key: "last_login",
        label: t("users.lastLogin"),
        width: 180,
        sortField: "last_login",
        render: (u) => (
          <span className="text-sm text-muted-foreground">
            {u.last_login
              ? new Date(u.last_login).toLocaleDateString(dateLocale, {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : t("users.never")}
          </span>
        ),
      },
    ],
    [dateLocale, displayLanguage, t],
  );

  if (authLoading || !allowed) {
    return (
      <div className="p-6">
        <div className="py-12 text-center text-sm text-muted-foreground">{t("users.loading")}</div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <PageHeader
        title={t("users.title")}
        description={
          !isLoading && users
            ? t(users.length === 1 ? "users.countOne" : "users.countOther", { count: users.length })
            : undefined
        }
        actions={
          <Button onClick={() => setModalUser("new")}>
            <AppIcon icon={UserPlus} size="sm" />
            {t("users.new")}
          </Button>
        }
      />

      <Card className="overflow-hidden py-0">
        <DataTable
          columns={columns}
          rows={sortedUsers}
          rowKey={(u) => String(u.id)}
          storageKey="admin-users"
          sort={sort}
          defaultSort={DEFAULT_SORT}
          onSort={(field) => setSort((s) => cycleSortField(field, s, DEFAULT_SORT))}
          isLoading={isLoading}
          trailingWidth={88}
          renderTrailingCell={(u) => (
            <div className="flex items-center justify-end gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setModalUser(u)}
                title={t("users.editAction")}
              >
                <AppIcon icon={PencilSimple} size="sm" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={async () => {
                  const ok = await confirm({
                    title: t("users.deleteTitle"),
                    description: t("users.deleteDescription", { email: u.email }),
                    confirmLabel: t("users.deleteAction"),
                    destructive: true,
                  });
                  if (!ok) return;
                  try {
                    await apiCall(`/api/users/${u.id}/`, "DELETE");
                    await mutate("platform-users");
                  } catch (err: unknown) {
                    toast.error(
                      err instanceof Error && err.message ? err.message : t("users.genericError"),
                    );
                  }
                }}
                title={t("users.deleteAction")}
              >
                <AppIcon icon={Trash} size="sm" className="text-muted-foreground" />
              </Button>
            </div>
          )}
          errorState={
            error ? (
              <EmptyState
                icon={<AppIcon icon={UserPlus} size="lg" />}
                title={t("users.loadError")}
              />
            ) : undefined
          }
          emptyState={
            <EmptyState
              icon={<AppIcon icon={UserPlus} size="lg" />}
              title={t("users.empty")}
              action={
                <Button onClick={() => setModalUser("new")}>
                  <AppIcon icon={Plus} size="sm" />
                  {t("users.new")}
                </Button>
              }
            />
          }
        />
      </Card>

      {modalUser !== null && (
        <UserModal
          user={modalUser === "new" ? undefined : modalUser}
          open
          onClose={() => setModalUser(null)}
        />
      )}
    </div>
  );
}
