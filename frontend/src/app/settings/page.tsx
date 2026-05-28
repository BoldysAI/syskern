"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Database,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  Package,
  BarChart3,
  Users,
} from "lucide-react";
import {
  SyncLog,
  SyncScope,
  SyncStatusResponse,
  triggerSync,
  getSyncStatus,
  getSyncLogs,
} from "@/lib/api";

type OdooVersion = "v16" | "v19";

const SCOPE_CONFIG: { value: SyncScope; label: string; icon: React.ElementType }[] = [
  { value: "all", label: "Tout synchroniser", icon: Database },
  { value: "products", label: "Produits", icon: Package },
  { value: "stock", label: "Stock & PAMP", icon: BarChart3 },
  { value: "clients", label: "Clients", icon: Users },
];

function StatusBadge({ status }: { status: SyncLog["status"] }) {
  const map: Record<SyncLog["status"], { icon: React.ElementType; label: string; cls: string }> = {
    running: { icon: Loader2, label: "En cours", cls: "bg-blue-50 text-blue-700 border-blue-200" },
    success: { icon: CheckCircle2, label: "Succès", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    partial_failure: { icon: AlertTriangle, label: "Partiel", cls: "bg-amber-50 text-amber-700 border-amber-200" },
    failed: { icon: XCircle, label: "Échoué", cls: "bg-red-50 text-red-700 border-red-200" },
  };
  const cfg = map[status];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.cls}`}>
      <Icon size={12} className={status === "running" ? "animate-spin" : ""} />
      {cfg.label}
    </span>
  );
}

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function SettingsPage() {
  const [status, setStatus] = useState<SyncStatusResponse | null>(null);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState<SyncScope | null>(null);
  const [version, setVersion] = useState<OdooVersion>("v19");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [s, l] = await Promise.all([getSyncStatus(), getSyncLogs({ limit: 10 })]);
      setStatus(s);
      setLogs(l);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 8000);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleSync = async (scope: SyncScope) => {
    setSyncing(scope);
    setError(null);
    try {
      await triggerSync(scope, version);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur lors du sync");
    } finally {
      setSyncing(null);
    }
  };

  const isRunning = status?.running != null;

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Paramètres</h1>
        <p className="text-sm text-slate-500 mt-0.5">Configuration de la plateforme</p>
      </div>

      {/* ── Odoo Sync Section ─────────────────────────────────────────── */}
      <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center">
            <Database size={18} className="text-indigo-600" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Synchronisation Odoo</h2>
            <p className="text-xs text-slate-500">Tirer les données produits, stock et clients depuis Odoo ERP</p>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* Version selector */}
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-slate-600">Instance Odoo :</span>
            <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
              {(["v16", "v19"] as OdooVersion[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setVersion(v)}
                  disabled={isRunning}
                  className={`px-4 py-1.5 text-sm font-medium transition-colors
                    ${version === v
                      ? "bg-indigo-600 text-white"
                      : "bg-white text-slate-600 hover:bg-slate-50"
                    }
                    disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {v === "v16" ? "Odoo 16" : "Odoo 19"}
                </button>
              ))}
            </div>
            <span className="text-xs text-slate-400">
              Les produits sont recoupés par SKU — pas de doublons
            </span>
          </div>

          {/* Current status */}
          {status?.running && (
            <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg">
              <Loader2 size={16} className="text-blue-600 animate-spin" />
              <div className="flex-1">
                <p className="text-sm font-medium text-blue-800">
                  Sync en cours — {status.running.scope} ({status.running.odoo_api_version})
                </p>
                <p className="text-xs text-blue-600">
                  Démarré à {formatDateTime(status.running.started_at)}
                </p>
              </div>
              <StatusBadge status="running" />
            </div>
          )}

          {status?.last && !status.running && (
            <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg">
              <CheckCircle2 size={16} className="text-slate-500" />
              <div className="flex-1">
                <p className="text-sm text-slate-700">
                  Dernier sync — {status.last.odoo_api_version} · {formatDateTime(status.last.completed_at)}
                </p>
                <p className="text-xs text-slate-500">
                  {status.last.items_created} créés · {status.last.items_updated} mis à jour
                  {status.last.items_failed > 0 && (
                    <span className="text-red-600"> · {status.last.items_failed} échoués</span>
                  )}
                </p>
              </div>
              <StatusBadge status={status.last.status} />
            </div>
          )}

          {/* Trigger buttons */}
          <div className="grid grid-cols-2 gap-3">
            {SCOPE_CONFIG.map(({ value, label, icon: Icon }) => {
              const active = syncing === value;
              return (
                <button
                  key={value}
                  onClick={() => handleSync(value)}
                  disabled={isRunning || active}
                  className="flex items-center gap-2.5 px-4 py-3 rounded-lg border border-slate-200
                    bg-white hover:bg-slate-50 active:bg-slate-100
                    disabled:opacity-50 disabled:cursor-not-allowed
                    transition-colors text-sm font-medium text-slate-700
                    focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
                >
                  {active ? (
                    <Loader2 size={16} className="text-indigo-600 animate-spin" />
                  ) : (
                    <RefreshCw size={16} className={isRunning ? "text-slate-300" : "text-indigo-500"} />
                  )}
                  {label}
                </button>
              );
            })}
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
              {error}
            </p>
          )}
        </div>

        {/* ── Recent Sync Logs ────────────────────────────────────── */}
        <div className="border-t border-[#E2E8F0]">
          <div className="px-5 py-3 bg-slate-50/50">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Historique récent
            </h3>
          </div>
          <div className="divide-y divide-slate-100">
            {logs.length === 0 && (
              <p className="px-5 py-6 text-sm text-slate-400 text-center">Aucun sync enregistré</p>
            )}
            {logs.map((log) => (
              <div key={log.id} className="px-5 py-3 flex items-center gap-3 text-sm">
                <StatusBadge status={log.status} />
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-mono font-medium
                  ${log.odoo_api_version === "v16" ? "bg-orange-50 text-orange-700" : "bg-violet-50 text-violet-700"}`}>
                  {log.odoo_api_version}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-slate-700 capitalize">{log.scope.replace("_", " ")}</span>
                  <span className="text-slate-400 mx-1.5">·</span>
                  <span className="text-slate-500">{log.triggered_by}</span>
                </div>
                <div className="text-right text-xs text-slate-400 shrink-0">
                  <p>{formatDateTime(log.started_at)}</p>
                  <p>
                    {log.items_created}+ {log.items_updated}~
                    {log.items_failed > 0 && <span className="text-red-500"> {log.items_failed}!</span>}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
