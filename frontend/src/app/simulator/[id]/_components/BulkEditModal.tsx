"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { CircleNotch } from "@phosphor-icons/react";
import {
  bulkEditLines,
  bulkEditPreview,
  getBrands,
  getHierarchyLevel,
  type BulkEditFilter,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ConfirmProvider";
import { FilterSelect } from "@/components/FilterSelect";
import { StockPurchaseMixSlider } from "@/app/simulator/_components/StockPurchaseMixSlider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  simId: string;
  open: boolean;
  onClose: () => void;
  onApplied: () => void;
}

type ActionType = "set_margin" | "set_mix" | "reset";

const labelCls = "mb-1.5 block text-xs font-semibold text-muted-foreground";
const inputCls =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30";

export function BulkEditModal({ simId, open, onClose, onApplied }: Props) {
  const confirm = useConfirm();
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

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
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
    const ok = await confirm({
      title: "Appliquer la modification",
      description: `Appliquer à ${count ?? 0} ligne(s) ?`,
      confirmLabel: "Appliquer",
    });
    if (!ok) return;

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
    <Dialog open={open} onOpenChange={(o) => !o && !applying && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col gap-0 p-0 sm:max-w-4xl" showCloseButton={!applying}>
        <DialogHeader className="border-b border-border p-5">
          <DialogTitle>Édition groupée</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-5">
          <h3 className="mb-3 text-sm font-bold text-foreground">Filtres cumulables</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Univers</label>
              <FilterSelect
                value={filter.universe ?? ""}
                onChange={(v) => setFlt({ universe: v || undefined })}
                placeholder="Tous"
                options={(universes ?? []).map((u) => ({ value: u, label: u }))}
              />
            </div>
            <div>
              <label className={labelCls}>Famille</label>
              <FilterSelect
                value={filter.family ?? ""}
                onChange={(v) => setFlt({ family: v || undefined })}
                placeholder="Toutes"
                options={(families ?? []).map((f) => ({ value: f, label: f }))}
              />
            </div>
            <div>
              <label className={labelCls}>Gamme</label>
              <FilterSelect
                value={filter.range ?? ""}
                onChange={(v) => setFlt({ range: v || undefined })}
                placeholder="Toutes"
                options={(ranges ?? []).map((r) => ({ value: r, label: r }))}
              />
            </div>
            <div>
              <label className={labelCls}>Marque</label>
              <FilterSelect
                value={filter.brand ?? ""}
                onChange={(v) => setFlt({ brand: v || undefined })}
                placeholder="Toutes"
                options={(brands ?? []).map((b) => ({ value: b, label: b }))}
              />
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
              <div className="flex items-center gap-2">
                <Checkbox
                  id="bulk-has-warning"
                  checked={!!filter.has_warning}
                  onCheckedChange={(v) => setFlt({ has_warning: v === true || undefined })}
                />
                <Label htmlFor="bulk-has-warning" className="text-sm font-normal">
                  Avertissements
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="bulk-has-error"
                  checked={!!filter.has_error}
                  onCheckedChange={(v) => setFlt({ has_error: v === true || undefined })}
                />
                <Label htmlFor="bulk-has-error" className="text-sm font-normal">
                  Erreurs
                </Label>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
            {previewing ? (
              <span className="flex items-center gap-2">
                <CircleNotch size={13} className="animate-spin" /> Calcul…
              </span>
            ) : (
              <span>
                <span className="font-bold text-accent-foreground">{count ?? 0}</span> ligne
                {(count ?? 0) !== 1 ? "s" : ""} seront impactées
              </span>
            )}
          </div>

          <h3 className="mb-3 mt-5 text-sm font-bold text-foreground">Action</h3>
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
                    ? "border-primary bg-accent text-accent-foreground"
                    : "border-border text-muted-foreground hover:bg-muted"
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
            {action === "set_mix" && <StockPurchaseMixSlider value={mixPct} onChange={setMixPct} />}
            {action === "reset" && (
              <p className="text-sm text-muted-foreground">
                Réinitialise marge et mix surchargés sur les lignes filtrées.
              </p>
            )}
          </div>

          {error && (
            <div className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border p-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={applying}>
            Annuler
          </Button>
          <Button
            type="button"
            onClick={handleApply}
            disabled={applying || (count ?? 0) === 0}
            className="gap-2"
          >
            {applying && <CircleNotch size={14} className="animate-spin" />}
            Appliquer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
