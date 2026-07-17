import {
  buildCatalogQuery,
  type BulkEditFilter,
  type CatalogFilters,
} from "@/lib/api";

/** Map catalog filter state → simulation-line API / bulk-edit query params. */
export function buildSimulationLineProductQuery(
  filters: CatalogFilters,
): Record<string, string> {
  return buildCatalogQuery(filters);
}

export function buildSimulationLineBulkFilter(
  filters: CatalogFilters,
  extras?: Pick<BulkEditFilter, "status_in" | "line_ids" | "has_warning" | "has_error">,
): BulkEditFilter {
  return {
    ...buildCatalogQuery(filters),
    ...extras,
  };
}
