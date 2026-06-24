"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR, { mutate as globalMutate } from "swr";
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
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Plus, Tags } from "lucide-react";
import { listAttributes, reorderAttributes, type AttributeCategory, type AttributeRegistry } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import SettingsNav from "../_components/SettingsNav";
import AttributeFormModal from "./_components/AttributeFormModal";
import DeleteAttributeDialog from "./_components/DeleteAttributeDialog";
import { CATEGORIES } from "./_components/constants";
import { AttributeRow, SortableAttributeRow } from "./_components/rows";

const SWR_KEY = "attributes-registry";
const COLUMNS = ["", "Code", "Label FR", "Catégorie", "Type", "Obligatoire", "Ordre", ""];

type CategoryFilter = AttributeCategory | "all";

export default function AttributesAdminPage() {
  const { role, isLoading: authLoading } = useAuth();
  const router = useRouter();

  const { data, isLoading, error } = useSWR<AttributeRegistry[]>(SWR_KEY, listAttributes);

  const [selectedCat, setSelectedCat] = useState<CategoryFilter>("all");
  const [editing, setEditing] = useState<AttributeRegistry | "new" | null>(null);
  const [deleting, setDeleting] = useState<AttributeRegistry | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const filtered = useMemo(() => {
    if (!data) return [];
    return selectedCat === "all" ? data : data.filter((a) => a.category === selectedCat);
  }, [data, selectedCat]);

  const dndEnabled = selectedCat !== "all";

  if (!authLoading && role !== "admin") {
    router.replace("/catalog");
    return null;
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !data) return;

    const oldIndex = filtered.findIndex((a) => a.id === active.id);
    const newIndex = filtered.findIndex((a) => a.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(filtered, oldIndex, newIndex).map((a, i) => ({
      ...a,
      display_order: i,
    }));
    const others = data.filter((a) => a.category !== selectedCat);
    const optimistic = [...others, ...reordered].sort(
      (a, b) => a.display_order - b.display_order || a.code.localeCompare(b.code)
    );

    setReorderError(null);
    globalMutate(SWR_KEY, optimistic, { revalidate: false });
    try {
      await reorderAttributes(reordered.map((a) => a.id));
      globalMutate(SWR_KEY);
    } catch (err) {
      setReorderError(err instanceof Error ? err.message : "Réordonnancement échoué.");
      globalMutate(SWR_KEY);
    }
  };

  const refresh = () => globalMutate(SWR_KEY);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Paramètres</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Configuration de la plateforme — réservé aux administrateurs.
        </p>
      </div>

      <SettingsNav />

      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <p className="text-sm text-slate-500">
          Registre des attributs dynamiques du PIM. Ajoutez des champs sans migration ; réordonnez
          au sein d&apos;une catégorie en filtrant puis en glissant les lignes.
        </p>
        <button
          onClick={() => setEditing("new")}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-primary hover:bg-primary/90 text-white rounded-lg font-medium flex-shrink-0"
        >
          <Plus size={14} />
          Nouvel attribut
        </button>
      </div>

      {/* Category filter chips */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        <Chip active={selectedCat === "all"} onClick={() => setSelectedCat("all")}>
          Toutes
        </Chip>
        {CATEGORIES.map((c) => (
          <Chip key={c.id} active={selectedCat === c.id} onClick={() => setSelectedCat(c.id)}>
            {c.label}
          </Chip>
        ))}
      </div>

      {reorderError && (
        <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {reorderError}
        </div>
      )}

      <div className="bg-white border border-border rounded-xl shadow-sm overflow-hidden">
        {error ? (
          <div className="py-12 text-center text-sm text-slate-400">
            Impossible de charger les attributs.
          </div>
        ) : isLoading ? (
          <div className="py-12 text-center text-sm text-slate-400">Chargement…</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-slate-400">
            <Tags size={36} className="mx-auto mb-3 text-slate-200" />
            <p className="text-sm">Aucun attribut dans cette catégorie. Créez-en un.</p>
          </div>
        ) : (
          <AttributesTable
            attributes={filtered}
            dndEnabled={dndEnabled}
            sensors={sensors}
            onDragEnd={handleDragEnd}
            onEdit={setEditing}
            onDelete={setDeleting}
          />
        )}
      </div>

      {editing !== null && (
        <AttributeFormModal
          attribute={editing === "new" ? undefined : editing}
          defaultCategory={editing === "new" && selectedCat !== "all" ? selectedCat : undefined}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
      {deleting !== null && (
        <DeleteAttributeDialog
          attribute={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={refresh}
        />
      )}
    </div>
  );
}

/** DndContext must wrap the table, not tbody — it injects accessibility divs. */
function AttributesTable({
  attributes,
  dndEnabled,
  sensors,
  onDragEnd,
  onEdit,
  onDelete,
}: {
  attributes: AttributeRegistry[];
  dndEnabled: boolean;
  sensors: ReturnType<typeof useSensors>;
  onDragEnd: (event: DragEndEvent) => void;
  onEdit: (a: AttributeRegistry) => void;
  onDelete: (a: AttributeRegistry) => void;
}) {
  const table = (
    <table className="w-full">
      <thead className="bg-background border-b border-border">
        <tr>
          {COLUMNS.map((h, i) => (
            <th
              key={i}
              className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap"
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {dndEnabled ? (
          <SortableContext
            items={attributes.map((a) => a.id)}
            strategy={verticalListSortingStrategy}
          >
            {attributes.map((a) => (
              <SortableAttributeRow
                key={a.id}
                attribute={a}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          </SortableContext>
        ) : (
          attributes.map((a) => (
            <AttributeRow key={a.id} attribute={a} onEdit={onEdit} onDelete={onDelete} />
          ))
        )}
      </tbody>
    </table>
  );

  if (!dndEnabled) return table;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      {table}
    </DndContext>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "px-3 py-1.5 text-sm font-medium rounded-full border transition-colors",
        active
          ? "border-primary bg-accent text-accent-foreground"
          : "border-border text-slate-600 hover:bg-slate-50"
      )}
    >
      {children}
    </button>
  );
}
