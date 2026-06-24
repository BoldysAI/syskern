"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pencil, Trash2 } from "lucide-react";
import { localize } from "@/components/AttributeRenderer";
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
      <td className="px-4 py-2.5 font-mono text-sm font-semibold text-slate-800">{attribute.code}</td>
      <td className="px-4 py-2.5 text-sm text-slate-700">{localize(attribute.label)}</td>
      <td className="px-4 py-2.5 text-sm text-slate-600">{CATEGORY_LABELS[attribute.category]}</td>
      <td className="px-4 py-2.5 text-sm text-slate-600">
        {DATA_TYPE_LABELS[attribute.data_type]}
        {attribute.unit && <span className="text-slate-400"> ({attribute.unit})</span>}
      </td>
      <td className="px-4 py-2.5">
        {attribute.is_required ? (
          <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">Oui</span>
        ) : (
          <span className="text-sm text-slate-400">Non</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-sm text-slate-500 tabular-nums">{attribute.display_order}</td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onEdit(attribute)}
            className="p-1.5 text-slate-400 hover:text-warm hover:bg-accent/50 rounded-lg"
            title="Modifier"
            aria-label={`Modifier ${attribute.code}`}
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={() => onDelete(attribute)}
            className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg"
            title="Supprimer"
            aria-label={`Supprimer ${attribute.code}`}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </td>
    </>
  );
}

/** Static row used when no single category is isolated (drag disabled). */
export function AttributeRow(props: RowProps) {
  return (
    <tr className="hover:bg-slate-50">
      <td
        className="px-3 py-2.5 w-10 text-slate-200"
        title="Filtrez par une catégorie pour réordonner"
      >
        <GripVertical size={16} />
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
      className={cn("hover:bg-slate-50", isDragging && "opacity-60 bg-accent")}
    >
      <td className="px-3 py-2.5 w-10">
        <button
          {...attributes}
          {...listeners}
          aria-label={`Réordonner ${props.attribute.code}`}
          className="touch-none cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600"
        >
          <GripVertical size={16} />
        </button>
      </td>
      <DataCells {...props} />
    </tr>
  );
}
