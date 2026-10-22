"use client";

import { useMemo, useState } from "react";
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
import { Plus, Tag } from "@phosphor-icons/react";
import {
  listAttributes,
  reorderAttributes,
  type AttributeCategory,
  type AttributeRegistry,
} from "@/lib/api";
import { useRequireAdmin } from "@/hooks/useRequireAdmin";
import { AppIcon } from "@/components/AppIcon";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useUiTranslate } from "@/lib/use-ui-translate";
import { cn } from "@/lib/utils";
import { Suspense } from "react";
import SettingsNav, { SettingsNavFallback } from "../_components/SettingsNav";
import AttributeFormModal from "./_components/AttributeFormModal";
import CompletenessPanel from "./_components/CompletenessPanel";
import DeleteAttributeDialog from "./_components/DeleteAttributeDialog";
import { CATEGORIES } from "./_components/constants";
import { AttributeRow, SortableAttributeRow } from "./_components/rows";

const SWR_KEY = "attributes-registry";
const COLUMN_KEYS = [
  "",
  "settings.code",
  "settings.attributes.column.labelFr",
  "settings.category",
  "settings.type",
  "settings.attributes.required",
  "settings.attributes.column.order",
  "",
] as const;

type CategoryFilter = AttributeCategory | "all";

export default function AttributesAdminPage() {
  const t = useUiTranslate();
  const { isLoading: authLoading, allowed, denied } = useRequireAdmin();

  const { data, isLoading, error } = useSWR<AttributeRegistry[]>(SWR_KEY, listAttributes);

  const [selectedCat, setSelectedCat] = useState<CategoryFilter>("all");
  const [editing, setEditing] = useState<AttributeRegistry | "new" | null>(null);
  const [deleting, setDeleting] = useState<AttributeRegistry | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const filtered = useMemo(() => {
    if (!data) return [];
    return selectedCat === "all" ? data : data.filter((a) => a.category === selectedCat);
  }, [data, selectedCat]);

  const dndEnabled = selectedCat !== "all";

  if (authLoading) {
    return (
      <div className="p-6">
        <div className="py-12 text-center text-sm text-muted-foreground">{t("common.loading")}</div>
      </div>
    );
  }

  if (denied) {
    return (
      <div className="p-6">
        <div className="py-12 text-center text-sm text-muted-foreground">
          {t("settings.adminOnly")}
        </div>
      </div>
    );
  }

  if (!allowed) {
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
      (a, b) => a.display_order - b.display_order || a.code.localeCompare(b.code),
    );

    setReorderError(null);
    globalMutate(SWR_KEY, optimistic, { revalidate: false });
    try {
      await reorderAttributes(reordered.map((a) => a.id));
      globalMutate(SWR_KEY);
    } catch (err) {
      setReorderError(err instanceof Error ? err.message : t("settings.attributes.reorderFailed"));
      globalMutate(SWR_KEY);
    }
  };

  const refresh = () => globalMutate(SWR_KEY);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">{t("settings.title")}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("settings.subtitle")}</p>
      </div>

      <Suspense fallback={<SettingsNavFallback />}>
        <SettingsNav />
      </Suspense>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("settings.attributes.intro")}</p>
        <Button onClick={() => setEditing("new")} className="shrink-0">
          <AppIcon icon={Plus} size="sm" />
          {t("settings.attributes.new")}
        </Button>
      </div>

      {/* Category filter chips */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        <Chip active={selectedCat === "all"} onClick={() => setSelectedCat("all")}>
          {t("settings.attributes.all")}
        </Chip>
        {CATEGORIES.map((c) => (
          <Chip key={c.id} active={selectedCat === c.id} onClick={() => setSelectedCat(c.id)}>
            {t(c.labelKey)}
          </Chip>
        ))}
      </div>

      {reorderError && (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {reorderError}
        </div>
      )}

      <Card className="overflow-hidden py-0">
        {error ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {t("settings.attributes.loadError")}
          </div>
        ) : isLoading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">{t("common.loading")}</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            <AppIcon icon={Tag} size="xl" className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">{t("settings.attributes.empty")}</p>
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
      </Card>

      <CompletenessPanel />

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
  const t = useUiTranslate();
  const table = (
    <table className="w-full">
      <thead className="border-b border-border bg-muted/50">
        <tr>
          {COLUMN_KEYS.map((key, i) => (
            <th
              key={i}
              className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {key ? t(key) : ""}
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
              <SortableAttributeRow key={a.id} attribute={a} onEdit={onEdit} onDelete={onDelete} />
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
          : "border-border text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}
