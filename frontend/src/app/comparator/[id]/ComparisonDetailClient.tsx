"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR, { mutate as globalMutate } from "swr";
import { ArrowLeft, PencilSimple, Trash } from "@phosphor-icons/react";
import { deleteSavedComparison, getSavedComparison, type SavedComparison } from "@/lib/api";
import { humanizeApiError } from "@/lib/humanize-errors";
import { useUiTranslate } from "@/lib/use-ui-translate";
import { useConfirm } from "@/components/ConfirmProvider";
import { useBreadcrumbOverride, type BreadcrumbCrumb } from "@/components/layout/BreadcrumbContext";
import { persistLastVisited } from "@/lib/last-visited";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { CompareWorkspace } from "@/app/comparator/_components/CompareWorkspace";
import { ComparisonEditDialog } from "@/app/comparator/_components/ComparisonEditDialog";

interface Props {
  id: string;
}

export function ComparisonDetailPage({ id }: Props) {
  const router = useRouter();
  const confirm = useConfirm();
  const t = useUiTranslate();
  const [editOpen, setEditOpen] = useState(false);

  const { data, isLoading, error, mutate } = useSWR<SavedComparison>(["saved-comparison", id], () =>
    getSavedComparison(id),
  );

  const breadcrumbCrumbs = useMemo((): BreadcrumbCrumb[] | null => {
    if (!data) return null;
    return [
      { href: "/", label: t("comparator.detail.dashboard") },
      { href: "/comparator", label: t("comparator.list.title") },
      { label: data.label },
    ];
  }, [data, t]);

  useBreadcrumbOverride(breadcrumbCrumbs, Boolean(data));

  useEffect(() => {
    if (!data) return;
    persistLastVisited({
      kind: "comparison",
      id: data.id,
      label: data.label,
      path: `/comparator/${data.id}`,
    });
  }, [data]);

  const handleDelete = async () => {
    if (!data) return;
    const ok = await confirm({
      title: t("comparator.detail.deleteTitle"),
      description: t("comparator.detail.deleteDescription", { name: data.label }),
      confirmLabel: t("common.delete"),
      destructive: true,
    });
    if (!ok) return;
    await deleteSavedComparison(data.id);
    void globalMutate((key) => Array.isArray(key) && key[0] === "comparisons-list");
    router.push("/comparator");
  };

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">
          {error instanceof Error
            ? humanizeApiError(error, t("comparator.detail.notFound"))
            : t("comparator.detail.notFound")}
        </p>
        <Button variant="outline" className="mt-4" onClick={() => router.push("/comparator")}>
          {t("comparator.detail.backToList")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border bg-card px-6 py-4">
        <Link
          href="/comparator"
          className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-brand-green"
        >
          <ArrowLeft size={14} />
          {t("comparator.backToList")}
        </Link>
        <PageHeader
          title={data.label}
          description={
            data.note ||
            (data.column_count === 1
              ? t("comparator.detail.metaOne", {
                  count: data.column_count,
                  date: new Date(data.updated_at).toLocaleDateString("fr-FR"),
                })
              : t("comparator.detail.metaOther", {
                  count: data.column_count,
                  date: new Date(data.updated_at).toLocaleDateString("fr-FR"),
                }))
          }
          className="mb-0"
          actions={
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={() => setEditOpen(true)}>
                <PencilSimple size={16} />
                {t("common.edit")}
              </Button>
              <Button type="button" variant="outline" onClick={() => void handleDelete()}>
                <Trash size={16} />
                {t("common.delete")}
              </Button>
            </div>
          }
        />
      </div>

      <main className="min-h-0 flex-1 overflow-auto p-6">
        <CompareWorkspace
          simulationIds={data.simulation_ids}
          recalculationIds={data.recalculation_ids}
          savedComparisonId={data.id}
          compareReturnHref={`/comparator/${data.id}`}
          compareReturnLabel={data.label}
        />
      </main>

      <ComparisonEditDialog
        comparison={data}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={(updated) => {
          void mutate(updated, false);
          void globalMutate((key) => Array.isArray(key) && key[0] === "comparisons-list");
        }}
      />
    </div>
  );
}
