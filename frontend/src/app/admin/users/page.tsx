"use client";

import { useState } from "react";
import useSWR, { mutate } from "swr";
import { Plus, Pencil, Trash2, UserCheck } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ConfirmProvider";
import { toast } from "sonner";
import type { Role } from "@/lib/auth";

interface PlatformUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  role: Role;
  is_active: boolean;
  date_joined: string;
  last_login: string | null;
}

const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrateur",
  commercial: "Commercial",
  viewer: "Lecteur",
};

const ROLE_COLORS: Record<Role, string> = {
  admin: "bg-purple-100 text-purple-700",
  commercial: "bg-blue-100 text-blue-700",
  viewer: "bg-slate-100 text-slate-600",
};

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
    throw new Error(data?.detail ?? data?.email?.[0] ?? "Erreur serveur");
  }
  return res.status === 204 ? null : res.json();
}

function UserModal({ user, onClose }: { user?: PlatformUser; onClose: () => void }) {
  const [email, setEmail] = useState(user?.email ?? "");
  const [firstName, setFirstName] = useState(user?.first_name ?? "");
  const [lastName, setLastName] = useState(user?.last_name ?? "");
  const [role, setRole] = useState<Role>(user?.role ?? "viewer");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md mx-4">
        <h2 className="text-lg font-semibold text-slate-900 mb-5">
          {user ? "Modifier l'utilisateur" : "Nouvel utilisateur"}
        </h2>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Prénom</label>
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Nom</label>
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">E-mail *</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Mot de passe {user ? "(laisser vide pour ne pas changer)" : "*"}
            </label>
            <input
              type="password"
              required={!user}
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Rôle *</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white"
            >
              <option value="admin">Administrateur</option>
              <option value="commercial">Commercial</option>
              <option value="viewer">Lecteur</option>
            </select>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 text-sm border border-border rounded-lg hover:bg-slate-50 transition-colors text-slate-600"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2.5 text-sm bg-primary hover:bg-primary/90 text-white rounded-lg font-semibold transition-colors disabled:opacity-60"
            >
              {loading ? "Enregistrement..." : user ? "Mettre à jour" : "Créer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function UsersPage() {
  const confirm = useConfirm();
  const { role } = useAuth();
  const router = useRouter();
  const [modalUser, setModalUser] = useState<PlatformUser | "new" | null>(null);

  const { data: users, isLoading, error } = useSWR<PlatformUser[]>("platform-users", fetchUsers);

  if (role !== "admin") {
    router.replace("/catalog");
    return null;
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Utilisateurs</h1>
          {!isLoading && users && (
            <p className="text-sm text-slate-500 mt-0.5">
              {users.length} utilisateur{users.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>
        <button
          onClick={() => setModalUser("new")}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary/90 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm"
        >
          <Plus size={16} />
          Nouvel utilisateur
        </button>
      </div>

      <div className="bg-white border border-border rounded-xl shadow-sm overflow-hidden">
        {error ? (
          <div className="py-16 text-center text-slate-400 text-sm">
            Impossible de charger les utilisateurs.
          </div>
        ) : isLoading ? (
          <div className="py-16 text-center text-slate-400 text-sm">Chargement…</div>
        ) : (
          <table className="w-full">
            <thead className="bg-background border-b border-border">
              <tr>
                {["Utilisateur", "E-mail", "Rôle", "Dernière connexion", "Actions"].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users?.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-[brand-navy] flex items-center justify-center flex-shrink-0">
                        <span className="text-white text-xs font-bold">
                          {u.first_name?.[0] ?? u.email[0].toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <div className="text-sm font-medium text-slate-800">
                          {u.first_name || u.last_name
                            ? `${u.first_name} ${u.last_name}`.trim()
                            : "—"}
                        </div>
                        <div className="text-xs text-slate-400">
                          Créé le {new Date(u.date_joined).toLocaleDateString("fr-FR")}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">{u.email}</td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold",
                        ROLE_COLORS[u.role],
                      )}
                    >
                      {u.role === "admin" && <UserCheck size={11} />}
                      {ROLE_LABELS[u.role]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500">
                    {u.last_login
                      ? new Date(u.last_login).toLocaleDateString("fr-FR", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "Jamais"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setModalUser(u)}
                        className="p-1.5 text-slate-400 hover:text-warm hover:bg-accent/50 rounded-lg transition-colors"
                        title="Modifier"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={async () => {
                          const ok = await confirm({
                            title: "Supprimer l'utilisateur",
                            description: `Supprimer ${u.email} ?`,
                            confirmLabel: "Supprimer",
                            destructive: true,
                          });
                          if (!ok) return;
                          try {
                            await apiCall(`/api/users/${u.id}/`, "DELETE");
                            await mutate("platform-users");
                          } catch (err: unknown) {
                            toast.error(err instanceof Error ? err.message : "Erreur");
                          }
                        }}
                        className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        title="Supprimer"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modalUser !== null && (
        <UserModal
          user={modalUser === "new" ? undefined : modalUser}
          onClose={() => setModalUser(null)}
        />
      )}
    </div>
  );
}
