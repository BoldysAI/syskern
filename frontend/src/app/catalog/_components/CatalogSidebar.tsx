"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import {
  Bookmark,
  BookmarkSimple,
  Checks,
  CurrencyEur,
  Factory,
  Faders,
  Package,
  Star,
  Tag,
  Trash,
  TreeStructure,
} from "@phosphor-icons/react";
import {
  getBrands,
  getCatalogFilterBounds,
  getFilterableAttributes,
  getSupplierNames,
  catalogFiltersToParams,
  type CatalogFilters,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { FilterSection } from "@/components/FilterSection";
import { FilterCheckboxGroup } from "@/components/FilterCheckboxGroup";
import { RangeFilterSlider } from "@/components/RangeFilterSlider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { countActiveFilters } from "./active-filters";
import { CatalogAttributeFilter } from "./CatalogAttributeFilter";
import { HierarchyFilterCascade } from "./HierarchyFilterCascade";
import { isEmptyFilter, type SavedFilter } from "./filters-storage";
import { boundsToSliderConfig, clampFilterValue } from "./slider-bounds";

/** Known bad values — excluded from the brand filter (data typos). */
const EXCLUDED_BRANDS = new Set(["unnikern"]);

interface CatalogSidebarProps {
  filters: CatalogFilters;
  onChange: (next: CatalogFilters) => void;
  savedFilters: SavedFilter[];
  onSaveFilter: (name: string) => void;
  onApplyFilter: (f: SavedFilter) => void;
  onDeleteFilter: (id: string) => void;
  className?: string;
}

export function CatalogSidebar({
  filters,
  onChange,
  savedFilters,
  onSaveFilter,
  onApplyFilter,
  onDeleteFilter,
  className,
}: CatalogSidebarProps) {
  const boundsFilters = useMemo(() => {
    const { pamp_min: _pm, pamp_max: _px, stock_min: _sm, ...rest } = filters;
    return rest;
  }, [filters]);

  const { data: bounds } = useSWR(
    ["catalog-filter-bounds", catalogFiltersToParams(boundsFilters)],
    () => getCatalogFilterBounds(boundsFilters),
    { revalidateOnFocus: false, dedupingInterval: 30_000 },
  );

  const pampSlider = useMemo(
    () => boundsToSliderConfig(bounds?.pamp_eur, 500),
    [bounds?.pamp_eur],
  );
  const stockSlider = useMemo(
    () => boundsToSliderConfig(bounds?.stock_quantity, 200),
    [bounds?.stock_quantity],
  );

  const { data: brands } = useSWR("brands", getBrands);
  const { data: suppliers } = useSWR("supplier-names", getSupplierNames);
  const { data: attributes } = useSWR("filterable-attrs", getFilterableAttributes);

  const brandOptions = useMemo(
    () =>
      (brands ?? [])
        .filter((b) => !EXCLUDED_BRANDS.has(b.toLowerCase()))
        .sort((a, b) => a.localeCompare(b, "fr")),
    [brands],
  );

  const patch = (p: Partial<CatalogFilters>) => onChange({ ...filters, ...p });

  const setAttr = (code: string, value: string | string[]) => {
    const attrs = { ...(filters.attrs ?? {}) };
    if ((Array.isArray(value) && value.length === 0) || value === "") {
      delete attrs[code];
    } else {
      attrs[code] = value;
    }
    patch({ attrs: Object.keys(attrs).length ? attrs : undefined });
  };

  const [saveName, setSaveName] = useState("");
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);

  const handleSave = () => {
    const name = saveName.trim();
    if (!name || isEmptyFilter(filters)) return;
    onSaveFilter(name);
    setSaveName("");
    setSaveFeedback(`Filtre « ${name} » enregistré.`);
    window.setTimeout(() => setSaveFeedback(null), 4000);
  };

  const canSave = saveName.trim().length > 0 && !isEmptyFilter(filters);

  const hierarchyCount =
    (filters.universe?.length ?? 0) +
    (filters.family?.length ?? 0) +
    (filters.range?.length ?? 0) +
    (filters.sub_range?.length ?? 0);

  const stockCount =
    (filters.stock_in ? 1 : 0) +
    (filters.stock_out ? 1 : 0) +
    (!filters.stock_out && filters.stock_min != null && filters.stock_min > 0 ? 1 : 0);

  const activeCount = (filters.active_in ? 1 : 0) + (filters.active_out ? 1 : 0);

  const showStockMinSlider = !filters.stock_out;

  const pampCount =
    (filters.pamp_min != null && filters.pamp_min > 0 ? 1 : 0) +
    (filters.pamp_max != null && filters.pamp_max > 0 ? 1 : 0);

  const attrCount = Object.values(filters.attrs ?? {}).reduce((n, v) => {
    if (Array.isArray(v)) return n + v.length;
    return v ? n + 1 : n;
  }, 0);

  return (
    <div className={cn("flex flex-col", className)}>
      <FilterSection
        title="Hiérarchie produit"
        icon={TreeStructure}
        activeCount={hierarchyCount}
      >
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          Cochez plusieurs valeurs par niveau (univers, famille, gamme, sous-gamme). Les niveaux
          inférieurs restent combinables avec l&apos;ensemble des parents sélectionnés.
        </p>
        <HierarchyFilterCascade filters={filters} onChange={onChange} />
      </FilterSection>

      <FilterSection title="Marque" icon={Tag} activeCount={filters.brand?.length ?? 0}>
        <FilterCheckboxGroup
          options={brandOptions.map((b) => ({ value: b, label: b }))}
          selected={filters.brand ?? []}
          onChange={(next) => patch({ brand: next.length ? next : undefined })}
          searchable={brandOptions.length > 5}
          sortSelectedFirst
        />
      </FilterSection>

      <FilterSection title="Fournisseur" icon={Factory} activeCount={filters.supplier?.length ?? 0}>
        <FilterCheckboxGroup
          options={(suppliers ?? []).map((s) => ({ value: s, label: s }))}
          selected={filters.supplier ?? []}
          onChange={(next) => patch({ supplier: next.length ? next : undefined })}
          searchable={(suppliers?.length ?? 0) > 5}
          sortSelectedFirst
        />
      </FilterSection>

      <FilterSection title="Statut produit" icon={Checks} activeCount={activeCount}>
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card/40 p-3">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="active-in" className="text-sm font-medium">
              Actif
            </Label>
            <Switch
              id="active-in"
              checked={!!filters.active_in}
              onCheckedChange={(checked) =>
                patch(checked ? { active_in: true, active_out: false } : { active_in: false })
              }
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="active-out" className="text-sm font-medium">
              Non actif
            </Label>
            <Switch
              id="active-out"
              checked={!!filters.active_out}
              onCheckedChange={(checked) =>
                patch(checked ? { active_out: true, active_in: false } : { active_out: false })
              }
            />
          </div>
        </div>
      </FilterSection>

      <FilterSection title="Prix PAMP" icon={CurrencyEur} activeCount={pampCount}>
        <RangeFilterSlider
          label="Fourchette PAMP"
          min={pampSlider.min}
          max={pampSlider.max}
          step={pampSlider.step}
          dual
          minValue={clampFilterValue(filters.pamp_min, pampSlider.max)}
          maxValue={clampFilterValue(filters.pamp_max, pampSlider.max)}
          onChange={(min, max) =>
            patch({
              pamp_min: min,
              pamp_max: max ?? null,
            })
          }
          formatValue={(n) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}
          unit="€"
        />
      </FilterSection>

      <FilterSection title="Stock & disponibilité" icon={Package} activeCount={stockCount}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-card/40 p-3">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="stock-in" className="text-sm font-medium">
                En stock
              </Label>
              <Switch
                id="stock-in"
                checked={!!filters.stock_in}
                onCheckedChange={(checked) =>
                  patch(
                    checked
                      ? { stock_in: true, stock_out: false }
                      : { stock_in: false },
                  )
                }
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="stock-out" className="text-sm font-medium">
                Rupture
              </Label>
              <Switch
                id="stock-out"
                checked={!!filters.stock_out}
                onCheckedChange={(checked) =>
                  patch(
                    checked
                      ? { stock_out: true, stock_in: false, stock_min: null }
                      : { stock_out: false },
                  )
                }
              />
            </div>
          </div>

          {showStockMinSlider && (
            <RangeFilterSlider
              label="Quantité minimale en stock"
              min={stockSlider.min}
              max={stockSlider.max}
              step={stockSlider.step}
              minValue={clampFilterValue(filters.stock_min, stockSlider.max)}
              onChange={(min) => patch({ stock_min: min })}
              unit="u."
            />
          )}
        </div>
      </FilterSection>

      {!!attributes?.length && (
        <FilterSection title="Attributs dynamiques" icon={Faders} activeCount={attrCount}>
          <div className="flex flex-col gap-3">
            {attributes.map((attr) => (
              <CatalogAttributeFilter
                key={attr.id}
                attribute={attr}
                value={filters.attrs?.[attr.code]}
                onChange={(v) => setAttr(attr.code, v)}
                numberBounds={bounds?.attributes[attr.code]}
              />
            ))}
          </div>
        </FilterSection>
      )}

      <FilterSection title="Filtres favoris" icon={Bookmark}>
        <div className="flex flex-col gap-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Sauvegardez vos combinaisons de filtres pour les réappliquer en un clic.
          </p>
          <Input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && canSave && handleSave()}
            placeholder="Nom du filtre (ex. Cuivre en stock)"
          />
          <Button type="button" disabled={!canSave} onClick={handleSave} className="w-full">
            <BookmarkSimple size={16} weight="duotone" />
            Sauvegarder le filtre courant
          </Button>
          {isEmptyFilter(filters) && (
            <p className="rounded-lg border border-muted-foreground/20 bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              Appliquez au moins un filtre avant de sauvegarder.
            </p>
          )}
          {saveFeedback && (
            <p className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
              {saveFeedback}
            </p>
          )}
          {savedFilters.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {savedFilters.map((sf) => (
                <li
                  key={sf.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-2.5 py-2 transition-colors hover:border-primary/30 hover:shadow-[var(--shadow-soft)]"
                >
                  <button
                    type="button"
                    onClick={() => onApplyFilter(sf)}
                    className="group flex min-w-0 flex-1 items-center gap-2 text-left"
                    title="Appliquer ce filtre"
                  >
                    <Star
                      size={14}
                      weight="duotone"
                      className="shrink-0 text-primary group-hover:scale-110 transition-transform"
                    />
                    <span className="truncate text-sm text-foreground group-hover:text-primary">
                      {sf.name}
                    </span>
                    <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                      {countActiveFilters(sf.filters)}
                    </span>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => onDeleteFilter(sf.id)}
                    aria-label={`Supprimer ${sf.name}`}
                  >
                    <Trash size={14} />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-2 text-center text-xs text-muted-foreground">Aucun filtre sauvegardé.</p>
          )}
        </div>
      </FilterSection>
    </div>
  );
}
