"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR, { mutate as globalMutate } from "swr";
import { ArrowLeft, PencilSimple, Trash } from "@phosphor-icons/react";
import { deleteSavedComparison, getSavedComparison, type SavedComparison } from "@/lib/api";
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
  const [editOpen, setEditOpen] = useState(false);

  const { data, isLoading, error, mutate } = useSWR<SavedComparison>(["saved-comparison", id], () =>
    getSavedComparison(id),
  );

  const breadcrumbCrumbs = useMemo((): BreadcrumbCrumb[] | null => {
    if (!data) return null;
    return [
      { href: "/", label: "Tableau de bord" },
      { href: "/comparator", label: "Comparaisons" },
      { label: data.label },
    ];
  }, [data]);

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
      title: "Supprimer la comparaison",
      description: `Supprimer « ${data.label} » ?`,
      confirmLabel: "Supprimer",
      destructive: true,
    });
    if (!ok) return;
    await deleteSavedComparison(data.id);
    void globalMutate((key) => Array.isArray(key) && key[0] === "comparisons-list");
    router.push("/comparator");
  };

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Chargement…</div>;
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Comparaison introuvable."}
        </p>
        <Button variant="outline" className="mt-4" onClick={() => router.push("/comparator")}>
          Retour à la liste
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
          Retour aux comparaisons
        </Link>
        <PageHeader
          title={data.label}
          description={
            data.note ||
            `${data.column_count} colonne${data.column_count !== 1 ? "s" : ""} · modifiée le ${new Date(data.updated_at).toLocaleDateString("fr-FR")}`
          }
          className="mb-0"
          actions={
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={() => setEditOpen(true)}>
                <PencilSimple size={16} />
                Modifier
              </Button>
              <Button type="button" variant="outline" onClick={() => void handleDelete()}>
                <Trash size={16} />
                Supprimer
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
