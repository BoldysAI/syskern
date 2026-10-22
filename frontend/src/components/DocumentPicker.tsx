"use client";

import useSWR from "swr";
import { listDocumentLibrary, type DocumentLibraryEntry } from "@/lib/api";
import { Checkbox } from "@/components/ui/checkbox";
import type { MessageKey } from "@/lib/i18n";
import { useUiTranslate } from "@/lib/use-ui-translate";

const CATEGORY_LABEL_KEYS: Record<string, MessageKey> = {
  cgv: "common.docCategoryCgv",
  warranty: "common.docCategoryWarranty",
  quality: "common.docCategoryQuality",
  project_reference: "common.docCategoryProjectRef",
  company: "common.docCategoryCompany",
  other: "common.docCategoryOther",
};

function docLabel(d: DocumentLibraryEntry, fallback: string): string {
  return d.name?.fr || d.name?.en || d.file_name || d.label || fallback;
}

/** Multiselect of active library documents to attach to an offer (CDC §7.4). */
export function DocumentPicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const t = useUiTranslate();
  const { data, isLoading } = useSWR("document-library:list", listDocumentLibrary);

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">{t("common.loadingDocuments")}</p>;
  }
  if (!data || data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("common.libraryEmptyLead")}{" "}
        <span className="font-medium text-foreground">{t("nav.library")}</span>.
      </p>
    );
  }

  return (
    <div className="space-y-1 rounded-lg border border-border p-2">
      {data.map((d) => {
        const categoryKey = CATEGORY_LABEL_KEYS[d.category ?? ""];
        return (
          <label
            key={d.id}
            className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
          >
            <Checkbox checked={selected.includes(d.id)} onCheckedChange={() => toggle(d.id)} />
            <span className="flex-1 text-foreground">{docLabel(d, t("common.document"))}</span>
            <span className="text-xs text-muted-foreground">
              {categoryKey ? t(categoryKey) : d.category}
              {d.language ? ` · ${d.language.toUpperCase()}` : ""}
            </span>
          </label>
        );
      })}
    </div>
  );
}
