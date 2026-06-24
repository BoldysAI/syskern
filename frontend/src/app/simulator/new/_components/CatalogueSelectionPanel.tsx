"use client";

import { useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { Search } from "lucide-react";
import { getProducts, type PaginatedProducts, type Product } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { SelectedSku } from "./wizard-draft";

const PAGE_SIZE = 25;

interface Props {
  selectedIds: Set<string>;
  onAdd: (skus: SelectedSku[]) => void;
  onRemove: (id: string) => void;
}

/** Catalog reused in forced multi-selection mode (CDC §6.9.2, PIM-3). */
export function CatalogueSelectionPanel({ selectedIds, onAdd, onRemove }: Props) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onSearchChange = (v: string) => {
    setSearch(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setDebounced(v);
      setPage(1);
    }, 300);
  };

  const { data, isLoading } = useSWR<PaginatedProducts>(
    ["sku-catalogue", debounced, page],
    () => getProducts({ search: debounced || undefined, page, limit: PAGE_SIZE }),
    { keepPreviousData: true }
  );

  const products = useMemo(() => data?.results ?? [], [data]);
  const total = data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const toggle = (p: Product) => {
    if (selectedIds.has(p.id)) {
      onRemove(p.id);
    } else {
      onAdd([{ id: p.id, sku_code: p.sku_code, name: p.name }]);
    }
  };

  const pageSelectable = products;
  const allPageSelected =
    pageSelectable.length > 0 && pageSelectable.every((p) => selectedIds.has(p.id));
  const toggleSelectPage = () => {
    if (allPageSelected) {
      products.forEach((p) => onRemove(p.id));
    } else {
      onAdd(
        products
          .filter((p) => !selectedIds.has(p.id))
          .map((p) => ({ id: p.id, sku_code: p.sku_code, name: p.name }))
      );
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Rechercher par SKU ou désignation…"
          className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
        />
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-background border-b border-border">
            <tr>
              <th className="px-3 py-2.5 w-10">
                <input
                  type="checkbox"
                  checked={allPageSelected}
                  onChange={toggleSelectPage}
                  className="w-4 h-4 rounded border-slate-300 accent-primary"
                  aria-label="Sélectionner toute la page"
                />
              </th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                SKU
              </th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Désignation
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F1F5F9]">
            {isLoading ? (
              <tr>
                <td colSpan={3} className="py-8 text-center text-sm text-slate-400">
                  Chargement…
                </td>
              </tr>
            ) : products.length === 0 ? (
              <tr>
                <td colSpan={3} className="py-8 text-center text-sm text-slate-400">
                  Aucun produit trouvé.
                </td>
              </tr>
            ) : (
              products.map((p) => {
                const checked = selectedIds.has(p.id);
                return (
                  <tr
                    key={p.id}
                    className={cn("cursor-pointer hover:bg-slate-50", checked && "bg-orange-50/70")}
                    onClick={() => toggle(p)}
                  >
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(p)}
                        className="w-4 h-4 rounded border-slate-300 accent-primary"
                        aria-label={`Sélectionner ${p.sku_code}`}
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-sm font-semibold text-slate-800">
                      {p.sku_code}
                    </td>
                    <td className="px-3 py-2 text-sm text-slate-600 truncate max-w-xs">{p.name}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>
            {total.toLocaleString("fr-FR")} produit{total !== 1 ? "s" : ""}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 border border-border rounded-lg disabled:opacity-40 hover:bg-slate-50"
            >
              Précédent
            </button>
            <span className="tabular-nums">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 border border-border rounded-lg disabled:opacity-40 hover:bg-slate-50"
            >
              Suivant
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
