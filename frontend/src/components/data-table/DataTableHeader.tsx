"use client";

import type { MouseEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DotsSixVertical } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { DataTableSortIcon } from "./DataTableSortIcon";
import type { DataTableColumnDef, DataTableSortState } from "./types";
import { isDefaultSort } from "./types";

const TH_CLASS =
  "text-left text-xs font-semibold text-muted-foreground whitespace-nowrap select-none";

function alignClass(align: DataTableColumnDef<unknown>["align"]): string {
  if (align === "right") return "text-right";
  if (align === "center") return "text-center";
  return "text-left";
}

interface HeaderCellProps<T> {
  col: DataTableColumnDef<T>;
  width: number;
  headerPy: string;
  sort: DataTableSortState;
  defaultSort: DataTableSortState;
  onSort: (field: string) => void;
  startResize: (key: string, e: MouseEvent) => void;
  resizingKey: string | null;
  reorderable: boolean;
}

/** Header content shared by the sortable and static cells (sort button + resize grip). */
function HeaderInner<T>({
  col,
  headerPy,
  sort,
  defaultSort,
  onSort,
  startResize,
  resizingKey,
  dragHandle,
}: Omit<HeaderCellProps<T>, "width" | "reorderable"> & { dragHandle: React.ReactNode }) {
  const sortable = !!col.sortField;
  const isActive = sortable && sort.field === col.sortField && !isDefaultSort(sort, defaultSort);
  const showDefaultActive =
    sortable && col.sortField === defaultSort.field && isDefaultSort(sort, defaultSort);
  const showSortState = isActive || showDefaultActive;

  return (
    <div className="flex h-full min-h-[44px] items-stretch">
      {dragHandle}
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
            showSortState && "text-foreground",
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
            col.align === "center" && "justify-center",
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
              : "opacity-60 hover:bg-accent group-hover:opacity-100",
          )}
        >
          <span
            className={cn(
              "h-5 w-0.5 rounded-full transition-colors",
              resizingKey === col.key ? "bg-primary" : "bg-border",
            )}
          />
        </span>
      )}
    </div>
  );
}

function StaticHeaderCell<T>(props: HeaderCellProps<T>) {
  const { col, width } = props;
  return (
    <th
      className={cn(TH_CLASS, alignClass(col.align), "group relative p-0")}
      style={{ width, minWidth: width }}
    >
      <HeaderInner {...props} dragHandle={null} />
    </th>
  );
}

function SortableHeaderCell<T>(props: HeaderCellProps<T>) {
  const { col, width } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: col.key,
  });
  const style = {
    width,
    minWidth: width,
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined,
    zIndex: isDragging ? 30 : undefined,
  };
  const dragHandle = (
    <span
      {...attributes}
      {...listeners}
      aria-label={`Déplacer la colonne ${col.label}`}
      className="flex w-4 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground/40 opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
    >
      <DotsSixVertical size={13} weight="bold" />
    </span>
  );
  return (
    <th
      ref={setNodeRef}
      className={cn(TH_CLASS, alignClass(col.align), "group relative p-0")}
      style={style}
    >
      <HeaderInner {...props} dragHandle={dragHandle} />
    </th>
  );
}

/** One column header — draggable when `reorderable`, plain otherwise. */
export function DataTableHeaderCell<T>(props: HeaderCellProps<T>) {
  return props.reorderable ? <SortableHeaderCell {...props} /> : <StaticHeaderCell {...props} />;
}
