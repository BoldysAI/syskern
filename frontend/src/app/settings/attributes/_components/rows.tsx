"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DotsSixVertical, PencilSimple, Trash } from "@phosphor-icons/react";
import { localize } from "@/components/AttributeRenderer";
import { AppIcon } from "@/components/AppIcon";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import type { AttributeRegistry } from "@/lib/api";
import { cn } from "@/lib/utils";
import { CATEGORY_LABELS, DATA_TYPE_LABELS } from "./constants";

interface RowProps {
  attribute: AttributeRegistry;
  onEdit: (a: AttributeRegistry) => void;
  onDelete: (a: AttributeRegistry) => void;
}

function DataCells({ attribute, onEdit, onDelete }: RowProps) {
  return (
    <>
      <td className="px-4 py-2.5 font-mono text-sm font-semibold text-foreground">{attribute.code}</td>
      <td className="px-4 py-2.5 text-sm text-muted-foreground">{localize(attribute.label)}</td>
      <td className="px-4 py-2.5 text-sm text-muted-foreground">
        {CATEGORY_LABELS[attribute.category]}
      </td>
      <td className="px-4 py-2.5 text-sm text-muted-foreground">
        {DATA_TYPE_LABELS[attribute.data_type]}
        {attribute.unit && <span className="text-muted-foreground/70"> ({attribute.unit})</span>}
      </td>
      <td className="px-4 py-2.5">
        {attribute.is_required ? (
          <StatusBadge variant="success">Oui</StatusBadge>
        ) : (
          <span className="text-sm text-muted-foreground">Non</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-sm tabular-nums text-muted-foreground">
        {attribute.display_order}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onEdit(attribute)}
            title="Modifier"
            aria-label={`Modifier ${attribute.code}`}
          >
            <AppIcon icon={PencilSimple} size="sm" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onDelete(attribute)}
            title="Supprimer"
            aria-label={`Supprimer ${attribute.code}`}
          >
            <AppIcon icon={Trash} size="sm" className="text-muted-foreground" />
          </Button>
        </div>
      </td>
    </>
  );
}

/** Static row used when no single category is isolated (drag disabled). */
export function AttributeRow(props: RowProps) {
  return (
    <tr className="hover:bg-muted/30">
      <td
        className="w-10 px-3 py-2.5 text-muted-foreground/30"
        title="Filtrez par une catégorie pour réordonner"
      >
        <AppIcon icon={DotsSixVertical} size="sm" />
      </td>
      <DataCells {...props} />
    </tr>
  );
}

/** Draggable row (within a single category) backed by @dnd-kit/sortable. */
export function SortableAttributeRow(props: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.attribute.id,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={cn("hover:bg-muted/30", isDragging && "bg-accent opacity-60")}
    >
      <td className="w-10 px-3 py-2.5">
        <button
          {...attributes}
          {...listeners}
          aria-label={`Réordonner ${props.attribute.code}`}
          className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
        >
          <AppIcon icon={DotsSixVertical} size="sm" />
        </button>
      </td>
      <DataCells {...props} />
    </tr>
  );
}
