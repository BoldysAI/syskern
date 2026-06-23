"use client";

import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import useSWR from "swr";
import { Loader2, X } from "lucide-react";
import {
  bulkEditLines,
  bulkEditPreview,
  getBrands,
  getHierarchyLevel,
  type BulkEditFilter,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { StockPurchaseMixSlider } from "@/app/simulator/_components/StockPurchaseMixSlider";

interface Props {
  simId: string;
  open: boolean;
  onClose: () => void;
  onApplied: () => void;
}

type ActionType = "set_margin" | "set_mix" | "reset";

const labelCls = "block text-xs font-semibold text-slate-600 mb-1.5";
const inputCls =
  "w-full px-3 py-2 text-sm border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#E07200]/30 focus:border-[#E07200]";

export function BulkEditModal({ simId, open, onClose, onApplied }: Props) {
  const [filter, setFilter] = useState<BulkEditFilter>({});
  const [action, setAction] = useState<ActionType>("set_margin");
  const [marginPct, setMarginPct] = useState("");
  const [mixPct, setMixPct] = useState(50);
  const [count, setCount] = useState<number | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: universes } = useSWR<string[]>("hierarchy-universe", () =>
    getHierarchyLevel("universe")
  );
  const { data: families } = useSWR<string[]>("hierarchy-family", () =>
    getHierarchyLevel("family")
  );
  const { data: ranges } = useSWR<string[]>("hierarchy-range", () => getHierarchyLevel("range"));
  const { data: brands } = useSWR<string[]>("brands", getBrands);

  // Live preview (debounced) whenever the filter changes.
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // setState is scheduled inside the timeout callback (never synchronously in
    // the effect body) per the repo's debounce convention (frontend.md).
    debounceRef.current = setTimeout(() => {
      setPreviewing(true);
      bulkEditPreview(simId, filter)
        .then((r) => setCount(r.count))
        .catch(() => setCount(null))
        .finally(() => setPreviewing(false));
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [simId, filter, open]);

  const setFlt = (patch: Partial<BulkEditFilter>) => setFilter((f) => ({ ...f, ...patch }));

  const handleApply = async () => {
    setError(null);
    if (action === "set_margin") {
      const n = parseFloat(marginPct);
      if (!Number.isFinite(n) || n < 0 || n >= 100) {
        setError("Saisissez une marge valide (0–99 %).");
        return;
      }
    }
    if (!confirm(`Appliquer à ${count ?? 0} ligne(s) ?`)) return;

    setApplying(true);
    try {
      const body: Parameters<typeof bulkEditLines>[1] = { filter };
      if (action === "set_margin") {
        body.margin_override = (parseFloat(marginPct) / 100).toFixed(4);
      } else if (action === "set_mix") {
        body.stock_purchase_mix_pct_override = mixPct;
      } else {
        body.reset = true;
      }
      await bulkEditLines(simId, body);
      onApplied();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Application échouée.");
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && !applying && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-white shadow-xl focus:outline-none">
          <div className="flex items-center justify-between border-b border-[#E2E8F0] p-5">
            <Dialog.Title className="text-lg font-semibold text-slate-900">
              Édition groupée
            </Dialog.Title>
            <Dialog.Close
              disabled={applying}
              className="text-slate-400 hover:text-slate-600 disabled:opacity-40"
              aria-label="Fermer"
            >
              <X size={20} />
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            <h3 className="mb-3 text-sm font-bold text-slate-800">Filtres cumulables</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Univers</label>
                <select
                  className={inputCls}
                  value={filter.universe ?? ""}
                  onChange={(e) => setFlt({ universe: e.target.value || undefined })}
                >
                  <option value="">Tous</option>
                  {(universes ?? []).map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Famille</label>
                <select
                  className={inputCls}
                  value={filter.family ?? ""}
                  onChange={(e) => setFlt({ family: e.target.value || undefined })}
                >
                  <option value="">Toutes</option>
                  {(families ?? []).map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Gamme</label>
                <select
                  className={inputCls}
                  value={filter.range ?? ""}
                  onChange={(e) => setFlt({ range: e.target.value || undefined })}
                >
                  <option value="">Toutes</option>
                  {(ranges ?? []).map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Marque</label>
                <select
                  className={inputCls}
                  value={filter.brand ?? ""}
                  onChange={(e) => setFlt({ brand: e.target.value || undefined })}
                >
                  <option value="">Toutes</option>
                  {(brands ?? []).map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Code usine</label>
                <input
                  className={inputCls}
                  value={filter.factory_code ?? ""}
                  onChange={(e) => setFlt({ factory_code: e.target.value || undefined })}
                  placeholder="Tous"
                />
              </div>
              <div className="flex items-end gap-4 pb-1">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={!!filter.has_warning}
                    onChange={(e) => setFlt({ has_warning: e.target.checked || undefined })}
                    className="h-4 w-4 rounded border-slate-300 accent-[#E07200]"
                  />
                  Avertissements
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={!!filter.has_error}
                    onChange={(e) => setFlt({ has_error: e.target.checked || undefined })}
                    className="h-4 w-4 rounded border-slate-300 accent-[#E07200]"
                  />
                  Erreurs
                </label>
              </div>
            </div>

            <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              {previewing ? (
                <span className="flex items-center gap-2">
                  <Loader2 size={13} className="animate-spin" /> Calcul…
                </span>
              ) : (
                <span>
                  <span className="font-bold text-[#C56400]">{count ?? 0}</span> ligne
                  {(count ?? 0) !== 1 ? "s" : ""} seront impactées
                </span>
              )}
            </div>

            <h3 className="mb-3 mt-5 text-sm font-bold text-slate-800">Action</h3>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["set_margin", "Définir une marge"],
                  ["set_mix", "Définir un mix"],
                  ["reset", "Réinitialiser les surcharges"],
                ] as [ActionType, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setAction(id)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                    action === id
                      ? "border-[#E07200] bg-[#FFF3E0] text-[#C56400]"
                      : "border-[#E2E8F0] text-slate-600 hover:bg-slate-50"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="mt-4">
              {action === "set_margin" && (
                <div className="max-w-[200px]">
                  <label className={labelCls}>Marge effective (%)</label>
                  <input
                    type="number"
                    min={0}
                    max={99}
                    step="0.1"
                    value={marginPct}
                    onChange={(e) => setMarginPct(e.target.value)}
                    className={inputCls}
                    placeholder="20"
                  />
                </div>
              )}
              {action === "set_mix" && (
                <StockPurchaseMixSlider value={mixPct} onChange={setMixPct} />
              )}
              {action === "reset" && (
                <p className="text-sm text-slate-500">
                  Réinitialise marge et mix surchargés sur les lignes filtrées.
                </p>
              )}
            </div>

            {error && (
              <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-[#E2E8F0] p-4">
            <button
              type="button"
              onClick={onClose}
              disabled={applying}
              className="rounded-lg border border-[#E2E8F0] px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={applying || (count ?? 0) === 0}
              className="flex items-center gap-2 rounded-lg bg-[#E07200] px-4 py-2 text-sm font-semibold text-white hover:bg-[#C56400] disabled:opacity-50"
            >
              {applying && <Loader2 size={14} className="animate-spin" />}
              Appliquer
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
