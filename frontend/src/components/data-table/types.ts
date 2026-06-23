import type { ReactNode, RefObject } from "react";

export type SortDir = "asc" | "desc";

export interface DataTableSortState {
  field: string;
  dir: SortDir;
}

export interface DataTableColumnDef<T> {
  key: string;
  label: string;
  width: number;
  /** Backend `ordering` field — omit for non-sortable columns. */
  sortField?: string;
  align?: "left" | "right" | "center";
  resizable?: boolean;
  render: (row: T) => ReactNode;
  cellClassName?: string | ((row: T) => string);
}

export interface DataTablePaginationConfig {
  page: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  /** Singular noun for the range label, e.g. "produit" or "ligne". */
  itemLabel?: string;
  jumpInputId?: string;
  ariaLabel?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumnDef<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** `localStorage` key for persisted column widths (one per screen). */
  storageKey: string;

  sort: DataTableSortState;
  defaultSort: DataTableSortState;
  onSort: (field: string) => void;

  isLoading?: boolean;
  loadingRowCount?: number;
  emptyState?: ReactNode;
  errorState?: ReactNode;

  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;

  leadingWidth?: number;
  renderLeadingHeader?: () => ReactNode;
  renderLeadingCell?: (row: T) => ReactNode;

  trailingWidth?: number;
  renderTrailingCell?: (row: T) => ReactNode;

  pagination?: DataTablePaginationConfig;
  scrollRef?: RefObject<HTMLDivElement | null>;
  className?: string;
}

/** Tri cyclique : asc → desc → défaut (catalogue + simulation). */
export function cycleSortField(
  field: string,
  current: DataTableSortState,
  defaultSort: DataTableSortState
): DataTableSortState {
  if (current.field === field) {
    if (current.dir === "asc") return { field, dir: "desc" };
    return { ...defaultSort };
  }
  return { field, dir: "asc" };
}

export function isDefaultSort(sort: DataTableSortState, defaultSort: DataTableSortState): boolean {
  return sort.field === defaultSort.field && sort.dir === defaultSort.dir;
}
