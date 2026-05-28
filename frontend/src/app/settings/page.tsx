"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR, { mutate as globalMutate } from "swr";
import * as Tabs from "@radix-ui/react-tabs";
import {
  Activity,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  CircleDashed,
  Truck,
  Coins,
  Database,
  X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  listMarketParameters,
  createMarketParameter,
  updateMarketParameter,
  deleteMarketParameter,
  listTransportModes,
  createTransportMode,
  updateTransportMode,
  deleteTransportMode,
  listSyncLogs,
  getSyncStatus,
  getOdooHealth,
  triggerOdooSync,
  type MarketParameter,
  type MarketParameterType,
  type TransportMode,
  type SyncLog,
  type SyncStatus,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const inputCls =
  "w-full px-3 py-2 text-sm border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#E07200]/30 focus:border-[#E07200]";
const labelCls = "block text-xs font-semibold text-slate-600 mb-1.5";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Generic modal shell ──────────────────────────────────────────────────
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-[#E2E8F0]">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ── Tab : Marché (Market parameters) ─────────────────────────────────────
function MarketParamModal({
  param,
  onClose,
}: {
  param?: MarketParameter;
  onClose: () => void;
}) {
  const [type, setType] = useState<MarketParameterType>(param?.parameter_type ?? "copper_price");
  const [validFrom, setValidFrom] = useState(param?.valid_from ?? todayIso());
  const [validTo, setValidTo] = useState(param?.valid_to ?? "");
  const [isActive, setIsActive] = useState(param?.is_active ?? true);
  const [notes, setNotes] = useState(param?.notes ?? "");
  const [copperMarket, setCopperMarket] = useState(param?.copper_market ?? "LME");
  const [copperPrice, setCopperPrice] = useState(param?.copper_price ?? "");
  const [copperCurrency, setCopperCurrency] = useState(param?.copper_currency ?? "USD");
  const [copperUnit, setCopperUnit] = useState(param?.copper_unit ?? "ton");
  const [fxFrom, setFxFrom] = useState(param?.fx_from_currency ?? "EUR");
  const [fxTo, setFxTo] = useState(param?.fx_to_currency ?? "USD");
  const [fxRate, setFxRate] = useState(param?.fx_rate ?? "");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload: Partial<MarketParameter> = {
      parameter_type: type,
      valid_from: validFrom,
      valid_to: validTo || null,
      is_active: isActive,
      notes,
    };
    if (type === "copper_price") {
      payload.copper_market = copperMarket as MarketParameter["copper_market"];
      payload.copper_price = copperPrice;
      payload.copper_currency = copperCurrency;
      payload.copper_unit = copperUnit;
    } else {
      payload.fx_from_currency = fxFrom;
      payload.fx_to_currency = fxTo;
      payload.fx_rate = fxRate;
    }
    try {
      if (param) await updateMarketParameter(param.id, payload);
      else await createMarketParameter(payload);
      await globalMutate("market-params");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
      setSaving(false);
    }
  };

  return (
    <Modal title={param ? "Modifier le paramètre marché" : "Nouveau paramètre marché"} onClose={onClose}>
      {error && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label className={labelCls}>Type</label>
          <div className="flex gap-2">
            {(["copper_price", "fx_rate"] as MarketParameterType[]).map((t) => (
              <button
                type="button"
                key={t}
                onClick={() => setType(t)}
                disabled={!!param}
                className={cn(
                  "flex-1 py-2 text-sm font-medium rounded-lg border transition-colors",
                  type === t ? "border-[#E07200] bg-[#FFF3E0] text-[#C56400]" : "border-[#E2E8F0] text-slate-600 hover:bg-slate-50",
                  param && "opacity-60 cursor-not-allowed"
                )}
              >
                {t === "copper_price" ? "Prix cuivre" : "Taux de change"}
              </button>
            ))}
          </div>
        </div>

        {type === "copper_price" ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Marché</label>
                <select value={copperMarket ?? ""} onChange={(e) => setCopperMarket(e.target.value as "LME" | "SHE")} className={inputCls}>
                  <option value="LME">LME (London)</option>
                  <option value="SHE">SHE (Shanghai)</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Devise</label>
                <select value={copperCurrency ?? ""} onChange={(e) => setCopperCurrency(e.target.value)} className={inputCls}>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="RMB">RMB</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Prix</label>
                <input value={copperPrice ?? ""} onChange={(e) => setCopperPrice(e.target.value)} required type="number" step="0.0001" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Unité</label>
                <input value={copperUnit ?? ""} onChange={(e) => setCopperUnit(e.target.value)} placeholder="ton / kg" className={inputCls} />
              </div>
            </div>
          </>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>De</label>
              <input value={fxFrom ?? ""} onChange={(e) => setFxFrom(e.target.value.toUpperCase())} required maxLength={3} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Vers</label>
              <input value={fxTo ?? ""} onChange={(e) => setFxTo(e.target.value.toUpperCase())} required maxLength={3} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Taux</label>
              <input value={fxRate ?? ""} onChange={(e) => setFxRate(e.target.value)} required type="number" step="0.000001" className={inputCls} />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Valide à partir du</label>
            <input value={validFrom} onChange={(e) => setValidFrom(e.target.value)} required type="date" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Jusqu&apos;au (optionnel)</label>
            <input value={validTo ?? ""} onChange={(e) => setValidTo(e.target.value)} type="date" className={inputCls} />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="w-4 h-4 rounded border-slate-300 accent-[#E07200]" />
          Actif
        </label>

        <div>
          <label className={labelCls}>Notes</label>
          <textarea value={notes ?? ""} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls} />
        </div>

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 text-sm border border-[#E2E8F0] rounded-lg hover:bg-slate-50 text-slate-600">Annuler</button>
          <button type="submit" disabled={saving} className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm bg-[#E07200] hover:bg-[#C56400] text-white rounded-lg font-semibold disabled:opacity-50">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {param ? "Mettre à jour" : "Créer"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TabMarche() {
  const { data, isLoading, error } = useSWR<MarketParameter[]>("market-params", () => listMarketParameters());
  const [editing, setEditing] = useState<MarketParameter | "new" | null>(null);

  const handleDelete = async (p: MarketParameter) => {
    if (!confirm("Supprimer ce paramètre ?")) return;
    try {
      await deleteMarketParameter(p.id);
      await globalMutate("market-params");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Suppression échouée");
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-500">
          Historique versionné des prix cuivre (LME/SHE) et taux de change. Les simulations fixent les valeurs au moment du calcul.
        </p>
        <button onClick={() => setEditing("new")} className="flex items-center gap-2 px-3 py-2 text-sm bg-[#E07200] hover:bg-[#C56400] text-white rounded-lg font-medium">
          <Plus size={14} />
          Nouveau paramètre
        </button>
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-sm overflow-hidden">
        {error ? (
          <div className="py-12 text-center text-sm text-slate-400">Impossible de charger les paramètres.</div>
        ) : isLoading ? (
          <div className="py-12 text-center text-sm text-slate-400">Chargement…</div>
        ) : !data?.length ? (
          <div className="py-12 text-center text-slate-400">
            <Coins size={36} className="mx-auto mb-3 text-slate-200" />
            <p className="text-sm">Aucun paramètre marché. Ajoutez un prix cuivre ou un taux de change.</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-[#F5F7FA] border-b border-[#E2E8F0]">
              <tr>
                {["Type", "Détail", "Valide du", "Au", "Actif", ""].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {data.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 text-sm font-medium text-slate-800">
                    {p.parameter_type === "copper_price" ? "Cuivre" : "Change"}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-slate-700">
                    {p.parameter_type === "copper_price"
                      ? `${p.copper_market} : ${p.copper_price} ${p.copper_currency}/${p.copper_unit}`
                      : `1 ${p.fx_from_currency} = ${p.fx_rate} ${p.fx_to_currency}`}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-slate-500">{p.valid_from}</td>
                  <td className="px-4 py-2.5 text-sm text-slate-500">{p.valid_to || "—"}</td>
                  <td className="px-4 py-2.5">
                    <span className={cn("inline-flex px-2 py-0.5 rounded text-xs font-medium", p.is_active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500")}>
                      {p.is_active ? "Oui" : "Non"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => setEditing(p)} className="p-1.5 text-slate-400 hover:text-[#E07200] hover:bg-[#FFF3E0] rounded-lg" title="Modifier">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => handleDelete(p)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg" title="Supprimer">
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

      {editing !== null && (
        <MarketParamModal param={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

// ── Tab : Transport modes ────────────────────────────────────────────────
function TransportModeModal({
  mode,
  onClose,
}: {
  mode?: TransportMode;
  onClose: () => void;
}) {
  const [code, setCode] = useState(mode?.code ?? "");
  const [labelFr, setLabelFr] = useState(mode?.label?.fr ?? "");
  const [category, setCategory] = useState<TransportMode["category"]>(mode?.category ?? "maritime");
  const [capacity, setCapacity] = useState(mode?.default_pallet_capacity?.toString() ?? "");
  const [isActive, setIsActive] = useState(mode?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload: Partial<TransportMode> = {
      code: code.trim().toUpperCase(),
      label: { fr: labelFr.trim() },
      category,
      default_pallet_capacity: capacity ? parseInt(capacity, 10) : null,
      is_active: isActive,
    };
    try {
      if (mode) await updateTransportMode(mode.id, payload);
      else await createTransportMode(payload);
      await globalMutate("transport-modes");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
      setSaving(false);
    }
  };

  return (
    <Modal title={mode ? "Modifier le mode de transport" : "Nouveau mode de transport"} onClose={onClose}>
      {error && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Code *</label>
            <input value={code} onChange={(e) => setCode(e.target.value)} required maxLength={32} className={inputCls} placeholder="MARITIME_FCL" />
          </div>
          <div>
            <label className={labelCls}>Catégorie *</label>
            <select value={category} onChange={(e) => setCategory(e.target.value as TransportMode["category"])} className={inputCls}>
              <option value="maritime">Maritime</option>
              <option value="road">Route</option>
              <option value="air">Aérien</option>
              <option value="rail">Ferroviaire</option>
            </select>
          </div>
        </div>
        <div>
          <label className={labelCls}>Libellé (français) *</label>
          <input value={labelFr} onChange={(e) => setLabelFr(e.target.value)} required className={inputCls} placeholder="Maritime conteneur complet" />
        </div>
        <div>
          <label className={labelCls}>Capacité palette par défaut</label>
          <input value={capacity} onChange={(e) => setCapacity(e.target.value)} type="number" min={0} className={inputCls} />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="w-4 h-4 rounded border-slate-300 accent-[#E07200]" />
          Actif
        </label>
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 text-sm border border-[#E2E8F0] rounded-lg hover:bg-slate-50 text-slate-600">Annuler</button>
          <button type="submit" disabled={saving} className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm bg-[#E07200] hover:bg-[#C56400] text-white rounded-lg font-semibold disabled:opacity-50">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {mode ? "Mettre à jour" : "Créer"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TabTransport() {
  const { data, isLoading, error } = useSWR<TransportMode[]>("transport-modes", () => listTransportModes());
  const [editing, setEditing] = useState<TransportMode | "new" | null>(null);

  const handleDelete = async (m: TransportMode) => {
    if (!confirm(`Supprimer le mode "${m.code}" ?`)) return;
    try {
      await deleteTransportMode(m.id);
      await globalMutate("transport-modes");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Suppression échouée");
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-500">Modes de transport utilisables dans les chaînes de calcul des simulations.</p>
        <button onClick={() => setEditing("new")} className="flex items-center gap-2 px-3 py-2 text-sm bg-[#E07200] hover:bg-[#C56400] text-white rounded-lg font-medium">
          <Plus size={14} />
          Nouveau mode
        </button>
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-sm overflow-hidden">
        {error ? (
          <div className="py-12 text-center text-sm text-slate-400">Impossible de charger.</div>
        ) : isLoading ? (
          <div className="py-12 text-center text-sm text-slate-400">Chargement…</div>
        ) : !data?.length ? (
          <div className="py-12 text-center text-slate-400">
            <Truck size={36} className="mx-auto mb-3 text-slate-200" />
            <p className="text-sm">Aucun mode de transport. Ajoutez-en un.</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-[#F5F7FA] border-b border-[#E2E8F0]">
              <tr>
                {["Code", "Libellé", "Catégorie", "Capacité palette", "Actif", ""].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {data.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-mono text-sm font-semibold text-slate-800">{m.code}</td>
                  <td className="px-4 py-2.5 text-sm text-slate-700">{m.label?.fr ?? "—"}</td>
                  <td className="px-4 py-2.5 text-sm text-slate-600 capitalize">{m.category}</td>
                  <td className="px-4 py-2.5 text-sm text-slate-600">{m.default_pallet_capacity ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <span className={cn("inline-flex px-2 py-0.5 rounded text-xs font-medium", m.is_active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500")}>
                      {m.is_active ? "Oui" : "Non"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => setEditing(m)} className="p-1.5 text-slate-400 hover:text-[#E07200] hover:bg-[#FFF3E0] rounded-lg" title="Modifier">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => handleDelete(m)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg" title="Supprimer">
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

      {editing !== null && (
        <TransportModeModal mode={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

// ── Tab : Odoo sync ──────────────────────────────────────────────────────
const SYNC_SCOPES = [
  { id: "all", label: "Tout (catalogue + stock + clients)" },
  { id: "products", label: "Produits uniquement" },
  { id: "stock", label: "Stock + PAMP" },
  { id: "clients", label: "Clients" },
] as const;

function syncStatusBadge(s: SyncLog["status"]) {
  const map = {
    success: { Icon: CheckCircle2, cls: "bg-green-100 text-green-700", label: "Succès" },
    failed: { Icon: XCircle, cls: "bg-red-100 text-red-700", label: "Échec" },
    partial_failure: { Icon: AlertTriangle, cls: "bg-amber-100 text-amber-700", label: "Partiel" },
    running: { Icon: CircleDashed, cls: "bg-blue-100 text-blue-700", label: "En cours" },
  } as const;
  return map[s] ?? map.running;
}

function TabOdoo() {
  const { data: health } = useSWR<{ ok: boolean }>("odoo-health", getOdooHealth, { refreshInterval: 30_000 });
  const { data: status } = useSWR<SyncStatus>("odoo-sync-status", getSyncStatus, { refreshInterval: 5_000 });
  const { data: logs } = useSWR<SyncLog[]>("odoo-sync-logs", () => listSyncLogs(20), { refreshInterval: 5_000 });

  const [scope, setScope] = useState<typeof SYNC_SCOPES[number]["id"]>("all");
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTrigger = async () => {
    setSyncing(true);
    setError(null);
    try {
      await triggerOdooSync(scope);
      await Promise.all([
        globalMutate("odoo-sync-status"),
        globalMutate("odoo-sync-logs"),
        globalMutate("odoo-health"),
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync échouée");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Health + manual trigger */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 bg-white border border-[#E2E8F0] rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Santé Odoo</span>
            <Activity size={14} className="text-slate-400" />
          </div>
          <div className="flex items-center gap-2 mt-3">
            {health == null ? (
              <span className="text-sm text-slate-400">…</span>
            ) : health.ok ? (
              <>
                <CheckCircle2 size={20} className="text-green-600" />
                <span className="text-base font-semibold text-green-700">Connecté</span>
              </>
            ) : (
              <>
                <XCircle size={20} className="text-red-500" />
                <span className="text-base font-semibold text-red-600">Hors ligne</span>
              </>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-2">Test toutes les 30 s</p>
        </div>

        <div className="lg:col-span-2 bg-white border border-[#E2E8F0] rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Synchronisation manuelle</span>
            <Database size={14} className="text-slate-400" />
          </div>
          {error && (
            <div className="mb-3 p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>
          )}
          <div className="flex items-center gap-3 flex-wrap">
            <select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} disabled={syncing} className="flex-1 min-w-[260px] px-3 py-2 text-sm border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#E07200]/30 focus:border-[#E07200] disabled:opacity-50">
              {SYNC_SCOPES.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
            <button onClick={handleTrigger} disabled={syncing} className="flex items-center gap-2 px-4 py-2 text-sm bg-[#E07200] hover:bg-[#C56400] text-white rounded-lg font-semibold transition-colors disabled:opacity-50">
              {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {syncing ? "Sync en cours…" : "Lancer la synchronisation"}
            </button>
          </div>
          {status?.running && (
            <p className="text-xs text-blue-600 mt-3">
              Sync en cours (scope: {status.running.scope}) démarré le {new Date(status.running.started_at).toLocaleString("fr-FR")}.
            </p>
          )}
        </div>
      </div>

      {/* Logs */}
      <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-[#E2E8F0]">
          <h3 className="text-sm font-semibold text-slate-700">Historique des synchronisations</h3>
        </div>
        {!logs ? (
          <div className="py-10 text-center text-sm text-slate-400">Chargement…</div>
        ) : logs.length === 0 ? (
          <div className="py-10 text-center text-slate-400">
            <Database size={32} className="mx-auto mb-2 text-slate-200" />
            <p className="text-sm">Aucune synchronisation enregistrée.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[#F5F7FA] border-b border-[#E2E8F0]">
                <tr>
                  {["Date", "Type", "Scope", "Statut", "Créés", "MAJ", "Échecs", "Déclenché par"].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0]">
                {logs.map((l) => {
                  const b = syncStatusBadge(l.status);
                  return (
                    <tr key={l.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2 text-sm text-slate-700 whitespace-nowrap">
                        {new Date(l.started_at).toLocaleString("fr-FR")}
                      </td>
                      <td className="px-4 py-2 text-sm text-slate-600 capitalize">{l.sync_type}</td>
                      <td className="px-4 py-2 text-sm text-slate-600">{l.scope}</td>
                      <td className="px-4 py-2">
                        <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium", b.cls)}>
                          <b.Icon size={11} />
                          {b.label}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-sm text-slate-600">{l.items_created}</td>
                      <td className="px-4 py-2 text-sm text-slate-600">{l.items_updated}</td>
                      <td className={cn("px-4 py-2 text-sm", l.items_failed ? "text-red-600 font-semibold" : "text-slate-600")}>{l.items_failed}</td>
                      <td className="px-4 py-2 text-sm text-slate-500">{l.triggered_by}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Settings page (with tabs) ────────────────────────────────────────────
const TABS = [
  { id: "marche", label: "Paramètres marché", Icon: Coins },
  { id: "transport", label: "Modes de transport", Icon: Truck },
  { id: "odoo", label: "Synchronisation Odoo", Icon: Database },
];

export default function SettingsPage() {
  const { role, isLoading } = useAuth();
  const router = useRouter();

  if (!isLoading && role !== "admin") {
    router.replace("/catalog");
    return null;
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Paramètres</h1>
        <p className="text-sm text-slate-500 mt-0.5">Configuration de la plateforme — réservé aux administrateurs.</p>
      </div>

      <Tabs.Root defaultValue="marche">
        <Tabs.List className="flex gap-0.5 bg-white border border-[#E2E8F0] rounded-xl p-1 shadow-sm mb-6 overflow-x-auto">
          {TABS.map(({ id, label, Icon }) => (
            <Tabs.Trigger
              key={id}
              value={id}
              className={cn(
                "flex items-center gap-2 flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                "text-slate-500 hover:text-slate-800",
                "data-[state=active]:bg-[#E07200] data-[state=active]:text-white"
              )}
            >
              <Icon size={14} />
              {label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="marche"><TabMarche /></Tabs.Content>
        <Tabs.Content value="transport"><TabTransport /></Tabs.Content>
        <Tabs.Content value="odoo"><TabOdoo /></Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
