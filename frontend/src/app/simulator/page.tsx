"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Plus, Calculator, Clock, FileCheck, Archive, GitCompare, Bookmark } from "lucide-react";
import { getSimulations, type Simulation } from "@/lib/api";
import { DataTable } from "@/components/data-table";
import type { DataTableColumnDef } from "@/components/data-table/types";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cycleSortField, type DataTableSortState } from "@/components/data-table/types";

const DEFAULT_SORT: DataTableSortState = { field: "updated_at", dir: "desc" };

function SimulationStatusCell({ status, dirty }: { status: Simulation["status"]; dirty?: boolean }) {
  const config = {
    finalized: { label: "Finalisé", variant: "success" as const, Icon: FileCheck },
    archived: { label: "Archivé", variant: "draft" as const, Icon: Archive },
    draft: { label: "Brouillon", variant: "warning" as const, Icon: Clock },
  };
  const { label, variant, Icon } = config[status] ?? config.draft;

  return (
    <span className="inline-flex items-center gap-1.5">
      <StatusBadge variant={variant} className="gap-1">
        <Icon size={11} />
        {label}
      </StatusBadge>
      {dirty && status === "draft" && (
        <span
          className="inline-flex h-2 w-2 rounded-full bg-warm"
          title="Recalcul nécessaire"
        />
      )}
    </span>
  );
}

export default function SimulatorPage() {
  const router = useRouter();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [sort, setSort] = useState<DataTableSortState>(DEFAULT_SORT);
  const { data: simulations, isLoading, error } = useSWR<Simulation[]>(
    ["simulations", includeArchived],
    () => getSimulations({ includeArchived }),
  );

  const columns = useMemo<DataTableColumnDef<Simulation>[]>(
    () => [
      {
        key: "label",
        label: "Nom",
        width: 220,
        render: (sim) => (
          <div>
            <span className="text-sm font-semibold text-foreground">{sim.label}</span>
            {sim.project_name && (
              <span className="mt-0.5 block text-xs text-muted-foreground">{sim.project_name}</span>
            )}
          </div>
        ),
      },
      {
        key: "type",
        label: "Type",
        width: 100,
        render: (sim) => (
          <span className="text-sm text-muted-foreground">
            {sim.simulation_type === "tariff" ? "Tarif" : "Projet"}
          </span>
        ),
      },
      {
        key: "lines",
        label: "Lignes",
        width: 80,
        align: "right",
        render: (sim) => (
          <span className="tabular-nums text-sm text-muted-foreground">{sim.line_count}</span>
        ),
      },
      {
        key: "status",
        label: "Statut",
        width: 140,
        render: (sim) => <SimulationStatusCell status={sim.status} dirty={sim.is_dirty} />,
      },
      {
        key: "last_calc",
        label: "Dernier calcul",
        width: 160,
        render: (sim) => (
          <span className="text-sm text-muted-foreground">
            {sim.last_calculated_at
              ? new Date(sim.last_calculated_at).toLocaleDateString("fr-FR", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "—"}
          </span>
        ),
      },
      {
        key: "updated",
        label: "Modifié",
        width: 120,
        render: (sim) => (
          <span className="text-sm text-muted-foreground">
            {new Date(sim.updated_at).toLocaleDateString("fr-FR")}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="p-6">
      <PageHeader
        title="Simulations"
        description={
          !isLoading && simulations
            ? `${simulations.length} simulation${simulations.length !== 1 ? "s" : ""}`
            : undefined
        }
        actions={
          <>
            <div className="flex items-center gap-2">
              <Checkbox
                id="include-archived"
                checked={includeArchived}
                onCheckedChange={(v) => setIncludeArchived(v === true)}
              />
              <Label htmlFor="include-archived" className="text-sm font-normal text-muted-foreground">
                Inclure les archivées
              </Label>
            </div>
            <Button variant="outline" onClick={() => router.push("/simulator/compare")}>
              <GitCompare size={16} />
              Comparer
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => router.push("/simulator/compare?aside=saved")}
              title="Comparaisons enregistrées"
            >
              <Bookmark size={16} />
            </Button>
            <Button onClick={() => router.push("/simulator/new")}>
              <Plus size={16} />
              Nouvelle simulation
            </Button>
          </>
        }
      />

      <Card className="overflow-hidden py-0">
        <DataTable
          columns={columns}
          rows={simulations ?? []}
          rowKey={(sim) => sim.id}
          storageKey="simulations-list"
          sort={sort}
          defaultSort={DEFAULT_SORT}
          onSort={(field) => setSort((s) => cycleSortField(field, s, DEFAULT_SORT))}
          isLoading={isLoading}
          onRowClick={(sim) => router.push(`/simulator/${sim.id}`)}
          errorState={
            error ? (
              <EmptyState
                icon={<Calculator size={28} />}
                title="Impossible de charger les simulations"
                description={error.message}
              />
            ) : undefined
          }
          emptyState={
            <EmptyState
              icon={<Calculator size={28} />}
              title="Aucune simulation"
              description='Créez votre première simulation en cliquant sur "Nouvelle simulation".'
              action={
                <Button onClick={() => router.push("/simulator/new")}>
                  <Plus size={16} />
                  Nouvelle simulation
                </Button>
              }
            />
          }
        />
      </Card>
    </div>
  );
}
