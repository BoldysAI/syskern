"use client";

import { useState } from "react";
import useSWR from "swr";
import { CircleNotch, Translate, Warning } from "@phosphor-icons/react";
import {
  checkOfferCoverage,
  getTaskStatus,
  startBulkTranslate,
  type BulkTranslateResult,
  type OfferCoverage,
} from "@/lib/api";
import { Button } from "@/components/ui/button";

interface OfferCoverageWarningProps {
  simulationId: string;
  /** Resolution input: explicit language and/or per-client resolution. */
  body: { language?: string; client_ids?: string[]; language_per_client?: boolean };
}

/**
 * Pre-generation multilingual coverage warning (CDC §10.5.1). Lists products
 * whose content would fall back to FR in the target language and offers a
 * one-click auto-translation before the offer is generated.
 */
export function OfferCoverageWarning({ simulationId, body }: OfferCoverageWarningProps) {
  const bodyKey = JSON.stringify(body);
  const {
    data: coverage,
    error: loadError,
    isLoading,
    mutate,
  } = useSWR<OfferCoverage>(
    simulationId ? ["offer-coverage", simulationId, bodyKey] : null,
    () => checkOfferCoverage(simulationId, body),
    { revalidateOnFocus: false },
  );

  const [translating, setTranslating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const autoTranslate = async () => {
    if (!coverage || coverage.product_ids.length === 0) return;
    setTranslating(true);
    setActionError(null);
    try {
      const { task_id } = await startBulkTranslate({
        ids: coverage.product_ids,
        source_lang: "fr",
        target_langs: coverage.languages,
      });
      const start = Date.now();
      while (Date.now() - start < 600_000) {
        const s = await getTaskStatus<BulkTranslateResult>(task_id);
        if (s.status === "SUCCESS") break;
        if (s.status === "FAILURE") throw new Error(s.error || "La traduction a échoué.");
        if (s.status === "REVOKED") throw new Error("Tâche annulée.");
        await new Promise((r) => setTimeout(r, 900));
      }
      await mutate();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "La traduction automatique a échoué.");
    } finally {
      setTranslating(false);
    }
  };

  if (isLoading && !coverage) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <CircleNotch size={14} className="animate-spin" />
        Vérification de la couverture multilingue…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        Vérification de couverture impossible.
      </div>
    );
  }

  if (!coverage || coverage.products.length === 0) return null;

  const langLabel = coverage.languages.map((l) => l.toUpperCase()).join(", ");

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
      <div className="flex items-start gap-2">
        <Warning size={18} weight="duotone" className="mt-0.5 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            {coverage.products.length} produit{coverage.products.length > 1 ? "s" : ""} sans
            contenu en {langLabel}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Ces produits sortiront en français. Traduis-les avant de générer, ou continue avec le
            repli FR.
          </p>
          <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto text-xs text-muted-foreground">
            {coverage.products.slice(0, 8).map((p) => (
              <li key={p.id} className="truncate">
                <span className="font-mono text-foreground">{p.sku_code}</span> — {p.designation}
              </li>
            ))}
            {coverage.products.length > 8 && (
              <li className="italic">… et {coverage.products.length - 8} autre(s)</li>
            )}
          </ul>
          {actionError && <p className="mt-2 text-xs text-destructive">{actionError}</p>}
          <div className="mt-2.5">
            <Button type="button" size="sm" onClick={autoTranslate} disabled={translating}>
              {translating ? (
                <CircleNotch size={14} className="animate-spin" />
              ) : (
                <Translate size={14} weight="duotone" />
              )}
              {translating ? "Traduction en cours…" : "Traduire automatiquement"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
