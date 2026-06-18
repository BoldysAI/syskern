"use client";

import { useMemo, useState, type ReactNode } from "react";
import useSWR from "swr";
import * as Collapsible from "@radix-ui/react-collapsible";
import {
  Bookmark,
  Boxes,
  ChevronDown,
  Factory,
  Layers,
  Search,
  SlidersHorizontal,
  Star,
  Tag,
  Trash2,
} from "lucide-react";
import {
  getBrands,
  getFilterableAttributes,
  getHierarchyLevel,
  getSupplierNames,
  type AttributeRegistry,
  type CatalogFilters,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { countActiveFilters } from "./active-filters";
import { isEmptyFilter, type SavedFilter } from "./filters-storage";

const PINNED_BRANDS = ["Unnikern"];

const inputCls =
  "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/25 focus:border-orange-500 transition-shadow";

interface CatalogSidebarProps {
  filters: CatalogFilters;
  onChange: (next: CatalogFilters) => void;
  savedFilters: SavedFilter[];
  onSaveFilter: (name: string) => void;
  onApplyFilter: (f: SavedFilter) => void;
  onDeleteFilter: (id: string) => void;
  className?: string;
}

function localize(label: Record<string, string>): string {
  return label.fr || label.en || label.es || Object.values(label)[0] || "";
}

function Section({
  title,
  icon,
  activeCount = 0,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon: ReactNode;
  activeCount?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="border-b border-slate-200/80">
      <Collapsible.Trigger
        className={cn(
          "flex w-full items-center gap-2.5 px-4 py-3.5 text-left transition-colors",
          "hover:bg-slate-50/80",
          open && "bg-slate-50/50"
        )}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
          {icon}
        </span>
        <span className="flex-1 text-sm font-semibold text-slate-800">{title}</span>
        {activeCount > 0 && (
          <span className="min-w-[1.35rem] h-5 px-1.5 rounded-full bg-orange-500 text-white text-[11px] font-bold flex items-center justify-center tabular-nums">
            {activeCount}
          </span>
        )}
        <ChevronDown
          size={16}
          className={cn("text-slate-400 transition-transform duration-200", open && "rotate-180")}
        />
      </Collapsible.Trigger>
      <Collapsible.Content className="px-4 pb-4 pt-0 data-[state=open]:animate-in data-[state=closed]:animate-out">
        {children}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

function CheckboxRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={cn(
        "flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-all border",
        checked
          ? "bg-orange-50 border-orange-200/90 shadow-sm"
          : "border-transparent hover:bg-white hover:border-slate-200"
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="w-4 h-4 rounded border-slate-300 accent-orange-500 flex-shrink-0"
      />
      <span
        className={cn(
          "text-sm leading-snug",
          checked ? "font-medium text-slate-800" : "text-slate-600"
        )}
      >
        {label}
      </span>
    </label>
  );
}

function toggleInArray(current: string[] | undefined, value: string): string[] {
  const list = current ?? [];
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

function MultiCheckboxGroup({
  label,
  options,
  selected,
  onToggle,
  onClear,
  emptyMessage = "Aucune valeur",
  searchable = true,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  onClear?: () => void;
  emptyMessage?: string;
  searchable?: boolean;
}) {
  const [query, setQuery] = useState("");
  const showSearch = searchable && options.length > 4;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? options.filter((o) => o.toLowerCase().includes(q)) : [...options];
    const sel = new Set(selected);
    list.sort((a, b) => {
      const as = sel.has(a);
      const bs = sel.has(b);
      if (as !== bs) return as ? -1 : 1;
      return a.localeCompare(b, "fr");
    });
    return list;
  }, [options, query, selected]);

  return (
    <div className="rounded-xl border border-slate-200/90 bg-slate-50/50 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-200/60 bg-white/80">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {label}
        </span>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-[11px] font-semibold text-orange-600 hover:text-orange-700"
          >
            Effacer ({selected.length})
          </button>
        )}
      </div>

      {showSearch && (
        <div className="px-2 pt-2 pb-1">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Rechercher…`}
              className="w-full pl-8 pr-2 py-1.5 text-xs border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400"
            />
          </div>
        </div>
      )}

      <div className="flex max-h-44 flex-col gap-0.5 overflow-y-auto p-1.5">
        {options.length === 0 ? (
          <span className="text-xs text-slate-400 px-2 py-3 text-center">{emptyMessage}</span>
        ) : visible.length === 0 ? (
          <span className="text-xs text-slate-400 px-2 py-3 text-center">Aucun résultat</span>
        ) : (
          visible.map((opt) => (
            <CheckboxRow
              key={opt}
              label={opt}
              checked={selected.includes(opt)}
              onChange={() => onToggle(opt)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function StockToggle({
  label,
  active,
  onClick,
  variant,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  variant: "in" | "out";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 px-3 py-2.5 rounded-lg text-sm font-medium border transition-all",
        active
          ? variant === "in"
            ? "bg-green-50 border-green-300 text-green-800 shadow-sm"
            : "bg-slate-100 border-slate-300 text-slate-800 shadow-sm"
          : "bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"
      )}
    >
      {label}
    </button>
  );
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
  const { data: universes } = useSWR(["hierarchy", "universe"], () =>
    getHierarchyLevel("universe")
  );
  const { data: families } = useSWR(["hierarchy", "family"], () => getHierarchyLevel("family"));
  const { data: ranges } = useSWR(["hierarchy", "range"], () => getHierarchyLevel("range"));
  const { data: subRanges } = useSWR(["hierarchy", "sub_range"], () =>
    getHierarchyLevel("sub_range")
  );
  const { data: brands } = useSWR("brands", getBrands);
  const { data: suppliers } = useSWR("supplier-names", getSupplierNames);
  const { data: attributes } = useSWR("filterable-attrs", getFilterableAttributes);

  const brandOptions = useMemo(() => {
    const merged = [...PINNED_BRANDS];
    for (const b of brands ?? []) {
      if (!merged.some((x) => x.toLowerCase() === b.toLowerCase())) merged.push(b);
    }
    return merged.sort((a, b) => a.localeCompare(b, "fr"));
  }, [brands]);

  const patch = (p: Partial<CatalogFilters>) => onChange({ ...filters, ...p });

  const toggleList = (
    key: keyof Pick<CatalogFilters, "universe" | "family" | "range" | "sub_range" | "brand" | "supplier">,
    value: string
  ) => {
    const current = filters[key] as string[] | undefined;
    patch({ [key]: toggleInArray(current, value) } as Partial<CatalogFilters>);
  };

  const clearList = (
    key: keyof Pick<CatalogFilters, "universe" | "family" | "range" | "sub_range" | "brand" | "supplier">
  ) => patch({ [key]: undefined });

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
    (filters.stock_in && !filters.stock_out ? 1 : 0) +
    (filters.stock_out && !filters.stock_in ? 1 : 0) +
    (filters.stock_min != null && filters.stock_min > 0 ? 1 : 0);

  const attrCount = Object.values(filters.attrs ?? {}).reduce((n, v) => {
    if (Array.isArray(v)) return n + v.length;
    return v ? n + 1 : n;
  }, 0);

  return (
    <div className={cn("flex flex-col", className)}>
      <Section
        title="Hiérarchie produit"
        icon={<Layers size={16} />}
        activeCount={hierarchyCount}
        defaultOpen
      >
        <p className="text-xs text-slate-500 mb-3 leading-relaxed">
          Filtrez par univers, famille, gamme ou sous-gamme — chaque niveau est indépendant.
        </p>
        <div className="flex flex-col gap-2.5">
          <MultiCheckboxGroup
            label="Univers"
            options={universes ?? []}
            selected={filters.universe ?? []}
            onToggle={(v) => toggleList("universe", v)}
            onClear={() => clearList("universe")}
            emptyMessage="Chargement…"
          />
          <MultiCheckboxGroup
            label="Famille"
            options={families ?? []}
            selected={filters.family ?? []}
            onToggle={(v) => toggleList("family", v)}
            onClear={() => clearList("family")}
          />
          <MultiCheckboxGroup
            label="Gamme"
            options={ranges ?? []}
            selected={filters.range ?? []}
            onToggle={(v) => toggleList("range", v)}
            onClear={() => clearList("range")}
          />
          <MultiCheckboxGroup
            label="Sous-gamme"
            options={subRanges ?? []}
            selected={filters.sub_range ?? []}
            onToggle={(v) => toggleList("sub_range", v)}
            onClear={() => clearList("sub_range")}
          />
        </div>
      </Section>

      <Section
        title="Marque"
        icon={<Tag size={16} />}
        activeCount={filters.brand?.length ?? 0}
        defaultOpen={false}
      >
        <MultiCheckboxGroup
          label="Marques"
          options={brandOptions}
          selected={filters.brand ?? []}
          onToggle={(v) => toggleList("brand", v)}
          onClear={() => clearList("brand")}
        />
      </Section>

      <Section
        title="Fournisseur"
        icon={<Factory size={16} />}
        activeCount={filters.supplier?.length ?? 0}
        defaultOpen={false}
      >
        <MultiCheckboxGroup
          label="Fournisseurs"
          options={suppliers ?? []}
          selected={filters.supplier ?? []}
          onToggle={(v) => toggleList("supplier", v)}
          onClear={() => clearList("supplier")}
          emptyMessage="Aucun fournisseur"
        />
      </Section>

      <Section
        title="Stock & disponibilité"
        icon={<Boxes size={16} />}
        activeCount={stockCount}
        defaultOpen={false}
      >
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <StockToggle
              label="En stock"
              variant="in"
              active={!!filters.stock_in}
              onClick={() => patch({ stock_in: !filters.stock_in })}
            />
            <StockToggle
              label="Rupture"
              variant="out"
              active={!!filters.stock_out}
              onClick={() => patch({ stock_out: !filters.stock_out })}
            />
          </div>
          {filters.stock_in && filters.stock_out && (
            <p className="text-xs text-slate-500 bg-slate-100 rounded-lg px-3 py-2">
              Les deux options actives = aucun filtre de disponibilité.
            </p>
          )}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 block mb-1.5">
              Quantité minimale
            </label>
            <input
              type="number"
              min={0}
              value={filters.stock_min ?? ""}
              onChange={(e) =>
                patch({ stock_min: e.target.value === "" ? null : Number(e.target.value) })
              }
              placeholder="Ex. 10 unités"
              className={inputCls}
            />
          </div>
        </div>
      </Section>

      {!!attributes?.length && (
        <Section
          title="Attributs techniques"
          icon={<SlidersHorizontal size={16} />}
          activeCount={attrCount}
          defaultOpen={false}
        >
          <div className="flex flex-col gap-3">
            {attributes.map((attr) => (
              <AttributeFilter
                key={attr.id}
                attribute={attr}
                value={filters.attrs?.[attr.code]}
                onChange={(v) => setAttr(attr.code, v)}
              />
            ))}
          </div>
        </Section>
      )}

      <Section
        title="Filtres favoris"
        icon={<Bookmark size={16} />}
        activeCount={0}
        defaultOpen={savedFilters.length > 0}
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-slate-500 leading-relaxed">
            Sauvegardez vos combinaisons de filtres pour les réappliquer en un clic.
          </p>
          <input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && canSave && handleSave()}
            placeholder="Nom du filtre (ex. Cuivre en stock)"
            className={inputCls}
          />
          <button
            type="button"
            disabled={!canSave}
            onClick={handleSave}
            className="flex w-full items-center justify-center gap-2 px-3 py-2.5 text-sm font-semibold text-white bg-orange-500 rounded-lg hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
          >
            <Bookmark size={15} />
            Sauvegarder le filtre courant
          </button>
          {isEmptyFilter(filters) && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              Appliquez au moins un filtre avant de sauvegarder.
            </p>
          )}
          {saveFeedback && (
            <p className="text-xs text-green-800 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
              {saveFeedback}
            </p>
          )}
          {savedFilters.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {savedFilters.map((sf) => (
                <li
                  key={sf.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 hover:border-orange-200 hover:shadow-sm transition-all"
                >
                  <button
                    type="button"
                    onClick={() => onApplyFilter(sf)}
                    className="flex flex-1 items-center gap-2 text-left min-w-0 group"
                    title="Appliquer ce filtre"
                  >
                    <Star
                      size={14}
                      className="text-orange-500 flex-shrink-0 group-hover:scale-110 transition-transform"
                    />
                    <span className="truncate text-sm text-slate-700 group-hover:text-orange-600">
                      {sf.name}
                    </span>
                    <span className="text-[10px] text-slate-400 tabular-nums shrink-0">
                      {countActiveFilters(sf.filters)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteFilter(sf.id)}
                    className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 flex-shrink-0 transition-colors"
                    aria-label={`Supprimer ${sf.name}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-400 text-center py-2">Aucun filtre sauvegardé.</p>
          )}
        </div>
      </Section>
    </div>
  );
}

function AttributeFilter({
  attribute,
  value,
  onChange,
}: {
  attribute: AttributeRegistry;
  value: string | string[] | undefined;
  onChange: (v: string | string[]) => void;
}) {
  const label = localize(attribute.label);

  if (attribute.data_type === "boolean") {
    const tri = (value as string) ?? "";
    return (
      <div className="rounded-xl border border-slate-200/90 bg-slate-50/50 p-2">
        <p className="text-xs font-semibold text-slate-600 px-1 mb-2">{label}</p>
        <div className="flex gap-1.5">
          {[
            { v: "", l: "Tous" },
            { v: "true", l: "Oui" },
            { v: "false", l: "Non" },
          ].map((opt) => (
            <button
              key={opt.v || "all"}
              type="button"
              onClick={() => onChange(opt.v)}
              className={cn(
                "flex-1 py-1.5 text-xs font-medium rounded-md border transition-colors",
                tri === opt.v
                  ? "bg-orange-50 border-orange-300 text-orange-800"
                  : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
              )}
            >
              {opt.l}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (attribute.data_type === "select" || attribute.data_type === "multiselect") {
    const selected = Array.isArray(value) ? value : value ? [value as string] : [];
    const opts = (attribute.options ?? []).map((o) => ({
      value: o.value,
      label: localize(o.label),
    }));
    return (
      <div className="rounded-xl border border-slate-200/90 bg-slate-50/50 overflow-hidden">
        <div className="px-3 py-2 border-b border-slate-200/60 bg-white/80 text-xs font-semibold text-slate-600">
          {label}
        </div>
        <div className="flex flex-col gap-0.5 p-1.5 max-h-36 overflow-y-auto">
          {opts.map((opt) => (
            <CheckboxRow
              key={opt.value}
              label={opt.label}
              checked={selected.includes(opt.value)}
              onChange={() => {
                const next = selected.includes(opt.value)
                  ? selected.filter((v) => v !== opt.value)
                  : [...selected, opt.value];
                onChange(
                  attribute.data_type === "select"
                    ? next.length === 1
                      ? next[0]
                      : next.length
                        ? next
                        : ""
                    : next
                );
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <label className="text-xs font-semibold text-slate-600 block mb-1.5">
        {label}
        {attribute.unit ? ` (${attribute.unit})` : ""}
      </label>
      <input
        type={attribute.data_type === "number" ? "number" : "text"}
        value={(value as string) ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className={inputCls}
      />
    </div>
  );
}
