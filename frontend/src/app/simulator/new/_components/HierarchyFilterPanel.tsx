"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Loader2, Plus } from "lucide-react";
import {
  getHierarchyLevel,
  getProducts,
  type CatalogFilters,
  type HierarchyLevel,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import type { SelectedSku } from "./wizard-draft";

interface Props {
  selectedIds: Set<string>;
  onAdd: (skus: SelectedSku[]) => void;
}

const selectCls =
  "w-full px-3 py-2 text-sm border border-[#E2E8F0] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#E07200]/30 focus:border-[#E07200] disabled:bg-slate-50 disabled:text-slate-400";

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
      <label className="block text-xs font-semibold text-slate-600 mb-1.5">{label}</label>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={selectCls}
      >
        <option value="">Tous</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
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
      () => getHierarchyLevel(level, parents)
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
    () => getProducts({ ...filters, limit: 1, page: 1 })
  );
  const matchCount = preview?.count ?? 0;

  const handleAddAll = async () => {
    setError(null);
    setAdding(true);
    try {
      const collected: SelectedSku[] = [];
      const limit = 500;
      let page = 1;
      // Page through every matching product, deduplicating against the
      // current selection.
      for (;;) {
        const res = await getProducts({ ...filters, limit, page });
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-sm text-slate-500">
          {hasFilter ? (
            <>
              <span className="font-semibold text-slate-700 tabular-nums">{matchCount}</span> SKU
              correspondent à ce filtre
            </>
          ) : (
            "Sélectionnez au moins un univers."
          )}
        </span>
        <button
          type="button"
          onClick={handleAddAll}
          disabled={!hasFilter || matchCount === 0 || adding}
          className={cn(
            "flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-colors",
            "bg-[#E07200] text-white hover:bg-[#C56400] disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          {adding ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
          Ajouter tous les SKU correspondants
        </button>
      </div>
    </div>
  );
}
