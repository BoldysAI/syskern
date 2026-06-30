"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Bookmark, CircleNotch, Trash } from "@phosphor-icons/react";
import {
  deleteSavedComparison,
  getComparisonsList,
  type SavedComparison,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ConfirmProvider";

interface Props {
  activeId?: string | null;
  onLoad?: (item: SavedComparison) => void;
}

export function SavedComparisonsPanel({ activeId, onLoad }: Props) {
  const router = useRouter();
  const confirm = useConfirm();
  const { data, isLoading, mutate } = useSWR(
    "saved-comparisons",
    () => getComparisonsList({ limit: 500 }),
  );
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleOpen = (item: SavedComparison) => {
    if (onLoad) onLoad(item);
    else router.push(`/comparator/${item.id}`);
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: "Supprimer la comparaison",
      description: "Supprimer cette comparaison enregistrée ?",
      confirmLabel: "Supprimer",
      destructive: true,
    });
    if (!ok) return;
    setDeletingId(id);
    try {
      await deleteSavedComparison(id);
      await mutate();
    } finally {
      setDeletingId(null);
    }
  };

  if (isLoading) {
    return <div className="p-4 text-center text-xs text-muted-foreground">Chargement…</div>;
  }

  const items = data?.results ?? [];

  if (!items.length) {
    return (
      <div className="flex flex-col items-center px-4 py-10 text-center text-muted-foreground">
        <Bookmark size={28} className="mb-2 text-muted-foreground/40" />
        <p className="text-xs">Aucune comparaison enregistrée.</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Lancez une comparaison puis cliquez sur « Enregistrer ».
        </p>
      </div>
    );
  }

  return (
    <ul className="flex-1 space-y-1 overflow-y-auto p-2">
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <li
            key={item.id}
            className={cn(
              "group relative rounded-lg border transition-colors",
              active
                ? "border-primary bg-accent"
                : "border-transparent hover:border-border hover:bg-card"
            )}
          >
            <button
              type="button"
              onClick={() => handleOpen(item)}
              className="w-full rounded-lg px-3 py-2.5 pr-10 text-left"
            >
              <div className="min-w-0">
                <span className="block truncate text-sm font-medium text-foreground">
                  {item.label}
                </span>
                <span className="mt-0.5 block text-[10px] text-muted-foreground">
                  {item.column_count} colonne{item.column_count !== 1 ? "s" : ""} ·{" "}
                  {new Date(item.created_at).toLocaleDateString("fr-FR")}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {item.columns.slice(0, 4).map((col, i) => (
                  <span
                    key={`${col.type}-${col.id}`}
                    className={cn(
                      "max-w-[100px] truncate rounded px-1.5 py-0.5 text-[9px] font-medium",
                      col.type === "recalculation"
                        ? "bg-violet-100 text-violet-700"
                        : i === 0
                          ? "bg-orange-100 text-orange-800"
                          : "bg-muted text-muted-foreground"
                    )}
                    title={col.label}
                  >
                    {col.label}
                  </span>
                ))}
              </div>
            </button>
            <button
              type="button"
              onClick={() => handleDelete(item.id)}
              disabled={deletingId === item.id}
              className="absolute right-2 top-2 rounded p-1 text-muted-foreground/60 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 disabled:opacity-50"
              aria-label="Supprimer"
            >
              {deletingId === item.id ? (
                <CircleNotch size={14} className="animate-spin" />
              ) : (
                <Trash size={14} />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
