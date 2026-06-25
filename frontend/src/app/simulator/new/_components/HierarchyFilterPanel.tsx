"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { CircleNotch, Plus } from "@phosphor-icons/react";
import {
  getHierarchyLevel,
  getCatalogProducts,
  type CatalogFilters,
  type HierarchyLevel,
} from "@/lib/api";
import { FilterSelect } from "@/components/FilterSelect";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { SelectedSku } from "./wizard-draft";

interface Props {
  selectedIds: Set<string>;
  onAdd: (skus: SelectedSku[]) => void;
}

function LevelSelect({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <Label className="mb-1.5 block text-xs font-semibold text-muted-foreground">{label}</Label>
      <FilterSelect
        value={value}
        onChange={onChange}
        placeholder="Tous"
        disabled={disabled}
        options={options.map((o) => ({ value: o, label: o }))}
      />
    </div>
  );
}

export function HierarchyFilterPanel({ selectedIds, onAdd }: Props) {
  const [universe, setUniverse] = useState("");
  const [family, setFamily] = useState("");
  const [range, setRange] = useState("");
  const [subRange, setSubRange] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const useLevel = (level: HierarchyLevel, parents: Record<string, string>, enabled: boolean) =>
    useSWR<string[]>(
      enabled ? ["hierarchy", level, JSON.stringify(parents)] : null,
      () => getHierarchyLevel(level, parents),
    );

  const { data: universes } = useLevel("universe", {}, true);
  const { data: families } = useLevel("family", { universe }, !!universe);
  const { data: ranges } = useLevel("range", { universe, family }, !!family);
  const { data: subRanges } = useLevel("sub_range", { universe, family, range }, !!range);

  const filters = useMemo<CatalogFilters>(() => {
    const f: CatalogFilters = {};
    if (universe) f.universe = [universe];
    if (family) f.family = [family];
    if (range) f.range = [range];
    if (subRange) f.sub_range = [subRange];
    return f;
  }, [universe, family, range, subRange]);

  const hasFilter = !!universe;
  const { data: preview } = useSWR(
    hasFilter ? ["hierarchy-count", JSON.stringify(filters)] : null,
    () => getCatalogProducts({ ...filters, limit: 1, page: 1 }),
  );
  const matchCount = preview?.count ?? 0;

  const handleAddAll = async () => {
    setError(null);
    setAdding(true);
    try {
      const collected: SelectedSku[] = [];
      const limit = 500;
      let page = 1;
      for (;;) {
        const res = await getCatalogProducts({ ...filters, limit, page });
        for (const p of res.results) {
          if (!selectedIds.has(p.id)) {
            collected.push({ id: p.id, sku_code: p.sku_code, name: p.name });
          }
        }
        if (page * limit >= res.count || res.results.length === 0) break;
        page += 1;
      }
      if (collected.length) onAdd(collected);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'ajout.");
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <LevelSelect
          label="Univers"
          value={universe}
          options={universes ?? []}
          disabled={false}
          onChange={(v) => {
            setUniverse(v);
            setFamily("");
            setRange("");
            setSubRange("");
          }}
        />
        <LevelSelect
          label="Famille"
          value={family}
          options={families ?? []}
          disabled={!universe}
          onChange={(v) => {
            setFamily(v);
            setRange("");
            setSubRange("");
          }}
        />
        <LevelSelect
          label="Gamme"
          value={range}
          options={ranges ?? []}
          disabled={!family}
          onChange={(v) => {
            setRange(v);
            setSubRange("");
          }}
        />
        <LevelSelect
          label="Sous-gamme"
          value={subRange}
          options={subRanges ?? []}
          disabled={!range}
          onChange={setSubRange}
        />
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">
          {hasFilter ? (
            <>
              <span className="font-semibold tabular-nums text-foreground">{matchCount}</span> SKU
              correspondent à ce filtre
            </>
          ) : (
            "Sélectionnez au moins un univers."
          )}
        </span>
        <Button type="button" onClick={handleAddAll} disabled={!hasFilter || matchCount === 0 || adding}>
          {adding ? <CircleNotch size={15} className="animate-spin" /> : <Plus size={15} />}
          Ajouter tous les SKU correspondants
        </Button>
      </div>
    </div>
  );
}
