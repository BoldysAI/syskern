"use client";

import useSWR from "swr";
import { listDocumentLibrary, type DocumentLibraryEntry } from "@/lib/api";
import { Checkbox } from "@/components/ui/checkbox";

const CATEGORY_LABELS: Record<string, string> = {
  cgv: "CGV",
  warranty: "Garantie",
  quality: "Qualité",
  project_reference: "Références projet",
  company: "Présentation",
  other: "Autre",
};

function docLabel(d: DocumentLibraryEntry): string {
  return d.name?.fr || d.name?.en || d.file_name || d.label || "Document";
}

/** Multiselect of active library documents to attach to an offer (CDC §7.4). */
export function DocumentPicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const { data, isLoading } = useSWR("document-library:list", listDocumentLibrary);

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Chargement des documents…</p>;
  }
  if (!data || data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Aucun document dans la bibliothèque. Ajoutez-en dans{" "}
        <span className="font-medium text-foreground">Bibliothèque</span>.
      </p>
    );
  }

  return (
    <div className="space-y-1 rounded-lg border border-border p-2">
      {data.map((d) => (
        <label
          key={d.id}
          className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
        >
          <Checkbox checked={selected.includes(d.id)} onCheckedChange={() => toggle(d.id)} />
          <span className="flex-1 text-foreground">{docLabel(d)}</span>
          <span className="text-xs text-muted-foreground">
            {CATEGORY_LABELS[d.category ?? ""] ?? d.category}
            {d.language ? ` · ${d.language.toUpperCase()}` : ""}
          </span>
        </label>
      ))}
    </div>
  );
}
