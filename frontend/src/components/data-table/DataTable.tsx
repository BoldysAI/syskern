"use client";

import { useMemo } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import { DataTableHeaderCell } from "./DataTableHeader";
import { DataTablePagination } from "./DataTablePagination";
import type { DataTableColumnDef, DataTableProps } from "./types";
import { useColumnOrder } from "./useColumnOrder";
import { useColumnWidths } from "./useColumnWidths";

import { Skeleton } from "@/components/ui/skeleton";

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
  reorderable = false,
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
  const defaultWidths = useMemo(
    () => Object.fromEntries(columns.map((c) => [c.key, c.width])),
    [columns],
  );
  const { resolveWidth, startResize, resizingKey } = useColumnWidths(defaultWidths, storageKey);

  const { orderedColumns, move } = useColumnOrder(columns, storageKey, reorderable);
  const reorderEnabled = reorderable;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleHeaderDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) move(String(active.id), String(over.id));
  };

  const cellPy = density === "compact" ? "py-2" : "py-3";
  const headerPy = density === "compact" ? "py-2.5" : "py-3.5";

  const hasLeading = !!renderLeadingHeader || !!renderLeadingCell;
  const hasTrailing = !!renderTrailingCell;
  const colSpan = orderedColumns.length + (hasLeading ? 1 : 0) + (hasTrailing ? 1 : 0);

  if (errorState) {
    return (
      <div ref={scrollRef} className={cn("flex-1 overflow-auto", className)}>
        {errorState}
      </div>
    );
  }

  const headerCells = orderedColumns.map((col) => (
    <DataTableHeaderCell
      key={col.key}
      col={col}
      width={resolveWidth(col.key, col.width)}
      headerPy={headerPy}
      sort={sort}
      defaultSort={defaultSort}
      onSort={onSort}
      startResize={startResize}
      resizingKey={resizingKey}
      reorderable={reorderEnabled}
    />
  ));

  const tableEl = (
    <table
      className="border-collapse table-fixed"
      style={{ width: "max-content", minWidth: "100%" }}
    >
      <colgroup>
        {hasLeading && <col style={{ width: leadingWidth }} />}
        {orderedColumns.map((c) => (
          <col key={c.key} style={{ width: resolveWidth(c.key, c.width) }} />
        ))}
        {hasTrailing && <col style={{ width: trailingWidth ?? 48 }} />}
      </colgroup>
      <thead className="sticky top-0 z-10 border-b border-border bg-muted/95 shadow-sm backdrop-blur-sm">
        <tr>
          {hasLeading && <th className="px-3 py-3">{renderLeadingHeader?.()}</th>}
          {reorderEnabled ? (
            <SortableContext
              items={orderedColumns.map((c) => c.key)}
              strategy={horizontalListSortingStrategy}
            >
              {headerCells}
            </SortableContext>
          ) : (
            headerCells
          )}
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
              {orderedColumns.map((col) => (
                <td
                  key={col.key}
                  className="overflow-hidden px-4 py-3"
                  style={{
                    width: resolveWidth(col.key, col.width),
                    maxWidth: resolveWidth(col.key, col.width),
                  }}
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
                    (isSelected ? undefined : "bg-card even:bg-muted/30 hover:bg-accent/50"),
                )}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {hasLeading && (
                  <td className={cn("px-3", cellPy)} onClick={(e) => e.stopPropagation()}>
                    {renderLeadingCell?.(row)}
                  </td>
                )}
                {orderedColumns.map((col) => {
                  const cellClass =
                    typeof col.cellClassName === "function"
                      ? col.cellClassName(row)
                      : col.cellClassName;
                  const colWidth = resolveWidth(col.key, col.width);
                  return (
                    <td
                      key={col.key}
                      className={cn(
                        "overflow-hidden px-4",
                        cellPy,
                        alignClass(col.align),
                        cellClass,
                      )}
                      style={{ width: colWidth, maxWidth: colWidth }}
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
  );

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div ref={scrollRef} className="flex-1 overflow-auto">
        {reorderEnabled ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleHeaderDragEnd}
          >
            {tableEl}
          </DndContext>
        ) : (
          tableEl
        )}
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
