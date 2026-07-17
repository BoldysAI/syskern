"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR, { mutate as globalMutate } from "swr";
import {
  ArrowLeft,
  Bookmark,
  GitDiff,
  FloppyDisk,
  MagnifyingGlass,
} from "@phosphor-icons/react";
import {
  getSimulations,
  type SavedComparison,
  type Simulation,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/PageHeader";
import { CompareWorkspace } from "@/app/comparator/_components/CompareWorkspace";
import { SaveComparisonModal } from "./_components/SaveComparisonModal";
import { SavedComparisonsPanel } from "./_components/SavedComparisonsPanel";

const MAX_COLUMNS = 4;

type AsideTab = "pick" | "saved";

function CompareSimulationsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Chargement…</div>}>
      <CompareWithKey />
    </Suspense>
  );
}

export default CompareSimulationsPage;

function CompareWithKey() {
  const searchParams = useSearchParams();
  const remountKey = `${searchParams.get("sims") ?? ""}-${searchParams.get("recalc") ?? ""}-${searchParams.get("saved") ?? ""}`;
  return <CompareContent key={remountKey} />;
}

function buildCompareUrl(item: {
  simulation_ids: string[];
  recalculation_ids: string[];
  id?: string;
}): string {
  const qs = new URLSearchParams();
  if (item.simulation_ids.length) qs.set("sims", item.simulation_ids.join(","));
  if (item.recalculation_ids.length) qs.set("recalc", item.recalculation_ids.join(","));
  if (item.id) qs.set("saved", item.id);
  const q = qs.toString();
  return q ? `/simulator/compare?${q}` : "/simulator/compare";
}

function CompareContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const simsParam = searchParams.get("sims") ?? "";
  const recalcParam = searchParams.get("recalc") ?? "";
  const savedParam = searchParams.get("saved");
  const asideParam = searchParams.get("aside");

  const initialSims = useMemo(
    () => simsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, MAX_COLUMNS),
    [simsParam]
  );
  const recalcIds = useMemo(
    () => recalcParam.split(",").map((s) => s.trim()).filter(Boolean),
    [recalcParam]
  );

  const [selected, setSelected] = useState<string[]>(initialSims);
  const [query, setQuery] = useState("");
  const [asideTab, setAsideTab] = useState<AsideTab>(
    savedParam || asideParam === "saved" ? "saved" : "pick"
  );
  const [saveOpen, setSaveOpen] = useState(false);
  const [activeSavedId, setActiveSavedId] = useState<string | null>(savedParam);

  // Deep-link legacy: /simulator/compare?saved=<id> → page objet comparaison.
  useEffect(() => {
    if (!savedParam) return;
    router.replace(`/comparator/${savedParam}`);
  }, [savedParam, router]);

  const { data: simulations } = useSWR<Simulation[]>("simulations", () => getSimulations());

  const columnCount = selected.length + recalcIds.length;

  const compareReturnHref = buildCompareUrl({
    simulation_ids: selected,
    recalculation_ids: recalcIds,
  });

  const toggle = (id: string) => {
    setActiveSavedId(null);
    const next = selected.includes(id)
      ? selected.filter((x) => x !== id)
      : selected.length + recalcIds.length >= MAX_COLUMNS
        ? selected
        : [...selected, id];
    if (next === selected) return;
    setSelected(next);
    router.replace(buildCompareUrl({ simulation_ids: next, recalculation_ids: recalcIds }));
  };

  const loadSaved = useCallback(
    (item: SavedComparison) => {
      router.push(buildCompareUrl(item));
      setAsideTab("pick");
    },
    [router]
  );

  const filteredSims = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (simulations ?? []).filter(
      (s) => !q || s.label.toLowerCase().includes(q) || s.project_name?.toLowerCase().includes(q)
    );
  }, [simulations, query]);

  const defaultSaveLabel = useMemo(() => {
    const map = new Map((simulations ?? []).map((s) => [s.id, s.label]));
    return selected
      .map((id) => map.get(id) ?? id.slice(0, 8))
      .join(" vs ")
      .slice(0, 120);
  }, [selected, simulations]);

  const canSave = columnCount >= 2;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border bg-card px-6 py-4">
        <Link
          href="/simulator"
          className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-warm"
        >
          <ArrowLeft size={14} />
          Retour aux simulations
        </Link>
        <PageHeader
          title="Comparer des simulations"
          description="Vue synthétique, paramètres détaillés et comparaisons enregistrées."
          className="mb-0"
          actions={
            canSave ? (
              <button
                type="button"
                onClick={() => setSaveOpen(true)}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted"
              >
                <FloppyDisk size={16} />
                Enregistrer
              </button>
            ) : undefined
          }
        />
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-[#FAFBFC]">
          <div className="flex border-b border-border">
            <AsideTabBtn
              active={asideTab === "pick"}
              onClick={() => setAsideTab("pick")}
              label="Sélection"
            />
            <AsideTabBtn
              active={asideTab === "saved"}
              onClick={() => setAsideTab("saved")}
              label="Enregistrées"
              icon={<Bookmark size={13} />}
            />
          </div>

          {asideTab === "pick" ? (
            <>
              {!recalcIds.length && (
                <div className="border-b border-border p-3">
                  <div className="relative">
                    <MagnifyingGlass size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Rechercher…"
                      className="w-full rounded-lg border border-border py-2 pl-8 pr-3 text-sm focus:border-primary focus:outline-none"
                    />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {columnCount}/{MAX_COLUMNS} colonne{columnCount !== 1 ? "s" : ""}
                  </p>
                </div>
              )}
              {recalcIds.length > 0 ? (
                <div className="border-b border-border p-3 text-xs text-muted-foreground">
                  Mode snapshot : {selected.length} simulation{selected.length !== 1 ? "s" : ""} +{" "}
                  {recalcIds.length} recalcul{recalcIds.length !== 1 ? "s" : ""}.
                </div>
              ) : (
                <ul className="flex-1 overflow-y-auto p-2">
                  {filteredSims.map((s) => {
                    const checked = selected.includes(s.id);
                    const disabled = !checked && columnCount >= MAX_COLUMNS;
                    return (
                      <li key={s.id}>
                        <label
                          className={cn(
                            "flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 text-sm hover:bg-card",
                            disabled && "cursor-not-allowed opacity-40"
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={disabled}
                            onChange={() => toggle(s.id)}
                            className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-primary"
                          />
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-foreground">
                              {s.label}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {s.simulation_type === "tariff" ? "Tarif" : "Projet"} ·{" "}
                              {s.line_count} lignes
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          ) : (
            <SavedComparisonsPanel activeId={activeSavedId} onLoad={loadSaved} />
          )}
        </aside>

        <main className="min-w-0 flex-1 overflow-auto p-6">
          {recalcIds.length > 0 && (
            <div className="mb-4 rounded-lg bg-accent px-4 py-2.5 text-sm text-accent-foreground">
              Comparaison incluant un ou plusieurs snapshots de recalcul historique.
            </div>
          )}
          {activeSavedId && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-4 py-2 text-sm text-violet-800">
              <Bookmark size={15} />
              Comparaison enregistrée chargée
            </div>
          )}
          {columnCount < 2 ? (
            <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
              <GitDiff size={36} className="mb-3 text-muted-foreground/40" />
              <p className="text-sm">Sélectionnez au moins 2 colonnes à comparer.</p>
              <p className="mt-1 text-xs">
                Ou choisissez une comparaison dans l&apos;onglet « Enregistrées ».
              </p>
            </div>
          ) : (
            <CompareWorkspace
              simulationIds={selected}
              recalculationIds={recalcIds}
              compareReturnHref={compareReturnHref}
              compareReturnLabel="Comparaison"
              onSimulationIdsChange={(ids) => {
                setSelected(ids);
                router.replace(
                  buildCompareUrl({ simulation_ids: ids, recalculation_ids: recalcIds }),
                );
              }}
            />
          )}
        </main>
      </div>

      <SaveComparisonModal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        simulationIds={selected}
        recalculationIds={recalcIds}
        defaultLabel={defaultSaveLabel}
        onSaved={(id) => {
          void globalMutate("saved-comparisons");
          router.push(`/comparator/${id}`);
        }}
      />
    </div>
  );
}

function AsideTabBtn({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-colors",
        active
          ? "border-b-2 border-primary text-accent-foreground bg-card"
          : "text-muted-foreground hover:bg-card/60"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
