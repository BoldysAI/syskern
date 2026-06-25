"use client";

import { cn } from "@/lib/utils";
import { DataTablePagination } from "./DataTablePagination";
import { DataTableSortIcon } from "./DataTableSortIcon";
import type { DataTableColumnDef, DataTableProps } from "./types";
import { isDefaultSort } from "./types";
import { useColumnWidths } from "./useColumnWidths";

import { Skeleton } from "@/components/ui/skeleton";

const TH_CLASS =
  "text-left text-xs font-semibold text-muted-foreground whitespace-nowrap select-none";

function TableSkeleton({ className }: { className?: string }) {
  return <Skeleton className={cn("h-4 w-full", className)} />;
}

function alignClass(align: DataTableColumnDef<unknown>["align"]): string {
  if (align === "right") return "text-right";
  if (align === "center") return "text-center";
  return "text-left";
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  storageKey,
  sort,
  defaultSort,
  onSort,
  isLoading = false,
  loadingRowCount = 10,
  emptyState,
  errorState,
  onRowClick,
  rowClassName,
  leadingWidth = 44,
  renderLeadingHeader,
  renderLeadingCell,
  trailingWidth,
  renderTrailingCell,
  pagination,
  scrollRef,
  className,
  density = "default",
  selectedRowKeys,
}: DataTableProps<T>) {
  const defaultWidths = Object.fromEntries(columns.map((c) => [c.key, c.width]));
  const { widths, startResize, resizingKey } = useColumnWidths(defaultWidths, storageKey);

  const cellPy = density === "compact" ? "py-2" : "py-3";
  const headerPy = density === "compact" ? "py-2.5" : "py-3.5";

  const hasLeading = !!renderLeadingHeader || !!renderLeadingCell;
  const hasTrailing = !!renderTrailingCell;
  const colSpan = columns.length + (hasLeading ? 1 : 0) + (hasTrailing ? 1 : 0);

  if (errorState) {
    return (
      <div ref={scrollRef} className={cn("flex-1 overflow-auto", className)}>
        {errorState}
      </div>
    );
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div ref={scrollRef} className="flex-1 overflow-auto">
        <table
          className="border-collapse table-fixed"
          style={{ width: "max-content", minWidth: "100%" }}
        >
          <colgroup>
            {hasLeading && <col style={{ width: leadingWidth }} />}
            {columns.map((c) => (
              <col key={c.key} style={{ width: widths[c.key] }} />
            ))}
            {hasTrailing && <col style={{ width: trailingWidth ?? 48 }} />}
          </colgroup>
          <thead className="sticky top-0 z-10 border-b border-border bg-muted/95 shadow-sm backdrop-blur-sm">
            <tr>
              {hasLeading && (
                <th className="px-3 py-3">{renderLeadingHeader?.()}</th>
              )}
              {columns.map((col) => {
                const sortable = !!col.sortField;
                const isActive =
                  sortable &&
                  sort.field === col.sortField &&
                  !isDefaultSort(sort, defaultSort);
                const showDefaultActive =
                  sortable &&
                  col.sortField === defaultSort.field &&
                  isDefaultSort(sort, defaultSort);
                const showSortState = isActive || showDefaultActive;

                return (
                  <th
                    key={col.key}
                    className={cn(TH_CLASS, alignClass(col.align), "group relative p-0")}
                    style={{ width: widths[col.key], minWidth: widths[col.key] }}
                  >
                    <div className="flex h-full min-h-[44px] items-stretch">
                      {sortable ? (
                        <button
                          type="button"
                          onClick={() => onSort(col.sortField!)}
                          className={cn(
                            "flex min-w-0 flex-1 items-center gap-1 px-4",
                            headerPy,
                            col.align === "right" && "justify-end text-right",
                            col.align === "center" && "justify-center",
                            "transition-colors hover:text-foreground",
                            showSortState && "text-foreground"
                          )}
                          title="Trier : croissant, décroissant, puis défaut"
                        >
                          <span className="truncate">{col.label}</span>
                          <DataTableSortIcon
                            active={showSortState}
                            dir={sort.field === col.sortField ? sort.dir : defaultSort.dir}
                          />
                        </button>
                      ) : (
                        <span
                          className={cn(
                            "flex flex-1 items-center truncate px-4",
                            headerPy,
                            col.align === "right" && "justify-end",
                            col.align === "center" && "justify-center"
                          )}
                        >
                          {col.label}
                        </span>
                      )}
                      {col.resizable !== false && (
                        <span
                          role="separator"
                          aria-orientation="vertical"
                          aria-label={`Redimensionner la colonne ${col.label}`}
                          onMouseDown={(e) => startResize(col.key, e)}
                          className={cn(
                            "relative z-20 flex w-3 shrink-0 cursor-col-resize touch-none items-center justify-center",
                            resizingKey === col.key
                              ? "bg-primary/20"
                              : "opacity-60 hover:bg-accent group-hover:opacity-100"
                          )}
                        >
                          <span
                            className={cn(
                              "h-5 w-0.5 rounded-full transition-colors",
                              resizingKey === col.key ? "bg-primary" : "bg-border"
                            )}
                          />
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
              {hasTrailing && <th className="w-10" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              Array.from({ length: loadingRowCount }).map((_, i) => (
                <tr key={i} className="bg-card">
                  {hasLeading && (
                    <td className="px-3 py-3">
                      <TableSkeleton className="h-4 w-4" />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className="overflow-hidden px-4 py-3"
                      style={{ width: widths[col.key], maxWidth: widths[col.key] }}
                    >
                      <TableSkeleton />
                    </td>
                  ))}
                  {hasTrailing && (
                    <td className="px-4 py-3">
                      <TableSkeleton className="h-4 w-6" />
                    </td>
                  )}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="py-24 text-center">
                  {emptyState}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const key = rowKey(row);
                const extraRowClass = rowClassName?.(row);
                const isSelected = selectedRowKeys?.has(key);
                return (
                  <tr
                    key={key}
                    className={cn(
                      "border-b border-border transition-colors duration-200",
                      onRowClick && "cursor-pointer",
                      isSelected && "bg-primary/5 hover:bg-primary/10",
                      extraRowClass ??
                        (isSelected
                          ? undefined
                          : "bg-card even:bg-muted/30 hover:bg-accent/50")
                    )}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {hasLeading && (
                      <td className={cn("px-3", cellPy)} onClick={(e) => e.stopPropagation()}>
                        {renderLeadingCell?.(row)}
                      </td>
                    )}
                    {columns.map((col) => {
                      const cellClass =
                        typeof col.cellClassName === "function"
                          ? col.cellClassName(row)
                          : col.cellClassName;
                      return (
                        <td
                          key={col.key}
                          className={cn(
                            "overflow-hidden px-4",
                            cellPy,
                            alignClass(col.align),
                            cellClass
                          )}
                          style={{ width: widths[col.key], maxWidth: widths[col.key] }}
                        >
                          {col.render(row)}
                        </td>
                      );
                    })}
                    {hasTrailing && (
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        {renderTrailingCell?.(row)}
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {pagination && !isLoading && (
        <DataTablePagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          totalCount={pagination.totalCount}
          pageSize={pagination.pageSize}
          onPageChange={pagination.onPageChange}
          itemLabel={pagination.itemLabel}
          jumpInputId={pagination.jumpInputId}
          ariaLabel={pagination.ariaLabel}
        />
      )}
    </div>
  );
}
