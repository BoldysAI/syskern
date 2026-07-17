"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, Loader2, X } from "lucide-react";
import {
  writeCatalogSeed,
  resolveSelectedSkusByProductIds,
} from "@/app/simulator/new/_components/wizard-draft";
import { addSimulationLines, getSimulations, type Simulation } from "@/lib/api";
import { cn } from "@/lib/utils";

interface AddToSimulationDialogProps {
  productIds: string[];
  productLabel: string;
  /** Known SKU rows when navigating to the wizard (e.g. product detail page). */
  prefilledSkus?: Array<{ id: string; sku_code: string; name: string }>;
  /** Called after products are successfully added or when opening the wizard. */
  onAdded?: () => void;
  /** The element that opens the dialog (wrapped as the trigger). */
  children: ReactNode;
}

type Tab = "existing" | "new";

export function AddToSimulationDialog({
  productIds,
  productLabel,
  prefilledSkus,
  onAdded,
  children,
}: AddToSimulationDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("existing");
  const [selectedSim, setSelectedSim] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: simulations, isLoading } = useSWR<Simulation[]>(
    open ? "simulations-for-add" : null,
    getSimulations,
  );
  const drafts = (simulations ?? []).filter((s) => s.status === "draft");

  const resetState = () => {
    setTab("existing");
    setSelectedSim("");
    setSubmitting(false);
    setError(null);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) resetState();
  };

  const handleConfirm = async () => {
    if (productIds.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      if (tab === "new") {
        const selectedSkus = await resolveSelectedSkusByProductIds(
          productIds,
          prefilledSkus ?? [],
        );
        if (selectedSkus.length === 0) {
          setError("Impossible de charger les produits sélectionnés.");
          return;
        }
        writeCatalogSeed(productIds, selectedSkus);
        onAdded?.();
        setOpen(false);
        const qs = new URLSearchParams({
          from: "catalog",
          product_ids: productIds.join(","),
        });
        router.push(`/simulator/new?${qs.toString()}`);
        return;
      }

      await addSimulationLines(selectedSim, productIds);
      onAdded?.();
      setOpen(false);
      router.push(`/simulator/${selectedSim}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'ajout à la simulation.");
    } finally {
      setSubmitting(false);
    }
  };

  const canConfirm =
    !submitting &&
    productIds.length > 0 &&
    (tab === "new" || selectedSim !== "");

  const confirmLabel =
    tab === "new"
      ? submitting
        ? "Préparation…"
        : "Ouvrir le wizard"
      : submitting
        ? "Ajout…"
        : "Ajouter";

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger asChild>{children}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-popover shadow-xl focus:outline-none">
          <div className="flex items-center justify-between border-b border-border p-5">
            <Dialog.Title className="text-lg font-semibold text-foreground">
              Ajouter à une simulation
            </Dialog.Title>
            <Dialog.Close
              className="text-muted-foreground hover:text-muted-foreground"
              aria-label="Fermer"
            >
              <X size={20} />
            </Dialog.Close>
          </div>

          <div className="p-5">
            <Dialog.Description className="mb-4 text-sm text-muted-foreground">
              {productIds.length > 1 ? "Produits" : "Produit"}{" "}
              <span className="font-mono font-medium text-foreground">{productLabel}</span>
            </Dialog.Description>

            <div className="mb-4 flex gap-2">
              {(["existing", "new"] as Tab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={cn(
                    "flex-1 rounded-lg border py-2 text-sm font-medium transition-colors",
                    tab === t
                      ? "border-primary bg-accent text-accent-foreground"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  {t === "existing" ? "Simulation existante" : "Nouvelle simulation"}
                </button>
              ))}
            </div>

            {tab === "existing" ? (
              isLoading ? (
                <div className="py-6 text-center text-sm text-muted-foreground">Chargement…</div>
              ) : drafts.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  Aucune simulation brouillon. Créez-en une nouvelle via l&apos;onglet
                  « Nouvelle simulation ».
                </div>
              ) : (
                <div className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
                  {drafts.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSelectedSim(s.id)}
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors",
                        selectedSim === s.id
                          ? "border-primary bg-accent"
                          : "border-border hover:bg-muted",
                      )}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">{s.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {s.simulation_type === "tariff" ? "Tarif" : "Projet"} · {s.line_count}{" "}
                          ligne(s)
                        </div>
                      </div>
                      {selectedSim === s.id && (
                        <Check size={16} className="shrink-0 text-primary" />
                      )}
                    </button>
                  ))}
                </div>
              )
            ) : (
              <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                <p>
                  Les {productIds.length} produit{productIds.length > 1 ? "s" : ""} sélectionné
                  {productIds.length > 1 ? "s" : ""} seront pré-remplis dans le wizard de création
                  (type, client, paramètres marché et chaîne de calcul).
                </p>
              </div>
            )}

            {error && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="mt-5 flex gap-3">
              <Dialog.Close className="flex-1 rounded-lg border border-border py-2.5 text-center text-sm text-muted-foreground transition-colors hover:bg-muted">
                Annuler
              </Dialog.Close>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={!canConfirm}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting && <Loader2 size={15} className="animate-spin" />}
                {confirmLabel}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
