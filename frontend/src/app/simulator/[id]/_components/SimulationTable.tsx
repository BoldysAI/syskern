"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  Warning,
  Calculator,
  DownloadSimple,
  Table,
  CircleNotch,
  DotsThreeVertical,
  ArrowsClockwise,
  ArrowCounterClockwise,
  Trash,
  X,
  Plus,
} from "@phosphor-icons/react";
import {
  bulkDeleteSimulationLines,
  bulkEditLines,
  deleteSimulationLine,
  getSimulationLines,
  recalculateSimulationLine,
  updateSimulationLine,
  type PaginatedResponse,
  type SimulationDetail,
  type SimulationLine,
} from "@/lib/api";
import {
  DataTable,
  cycleSortField,
  type DataTableColumnDef,
  type DataTableSortState,
} from "@/components/data-table";
import { cn } from "@/lib/utils";
import { humanizeApiError } from "@/lib/humanize-errors";
import { useConfirm } from "@/components/ConfirmProvider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  decToPct,
  fmtEur,
  fmtNum,
  lineDiagnostics,
  LINE_STATUS,
  lineRowClassName,
  productEditHref,
} from "./sim-format";
import { formatIncotermDisplay } from "@/lib/incoterms";
import { LineDiagnosticsDrawer } from "./LineDiagnosticsDrawer";
import { CalculationBreakdownDrawer } from "./CalculationBreakdownDrawer";

interface Props {
  sim: SimulationDetail;
  readOnly: boolean;
  onRecalc: () => void;
  onBulkEdit: (lineIds?: string[]) => void;
  onAddProducts: () => void;
  onExport: () => void;
  onHistory: () => void;
  onChanged: () => void;
}

const PAGE_SIZE = 200;
const STORAGE_KEY = "syskern:simulation-col-widths:v1";
const DEFAULT_SORT: DataTableSortState = { field: "product__sku_code", dir: "asc" };
const STATUS_FILTER_KEYS = ["ok", "warning", "error"] as const;
type StatusFilterKey = (typeof STATUS_FILTER_KEYS)[number];

function buildStatusIn(filters: Record<StatusFilterKey, boolean>): string | undefined {
  const active = STATUS_FILTER_KEYS.filter((key) => filters[key]);
  if (active.length === 0 || active.length === STATUS_FILTER_KEYS.length) {
    return undefined;
  }
  return active.join(",");
}

function mp(sim: SimulationDetail, key: string): string {
  const v = (sim.market_params ?? {})[key];
  return v == null ? "—" : String(v);
}

function OverrideCell({
  override,
  effective,
  suffix,
  disabled,
  onCommit,
}: {
  override: string;
  effective: string;
  suffix: string;
  disabled: boolean;
  onCommit: (raw: string) => void;
}) {
  const [v, setV] = useState(override);
  // Reset the editable value when the canonical override changes — render-time
  // pattern (React docs) instead of a set-state-in-effect.
  const [prevOverride, setPrevOverride] = useState(override);
  if (prevOverride !== override) {
    setPrevOverride(override);
    setV(override);
  }

  return (
    <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      <input
        value={v}
        disabled={disabled}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== override && onCommit(v)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        placeholder={effective || "—"}
        className="w-16 rounded border border-transparent px-1.5 py-1 text-right text-sm hover:border-border focus:border-primary focus:outline-none disabled:bg-transparent disabled:hover:border-transparent"
      />
      <span className="text-xs text-muted-foreground">{suffix}</span>
    </div>
  );
}

function RowMenu({
  disabled,
  readOnly,
  onRecalcLine,
  onResetOverrides,
  onShowBreakdown,
  onRemove,
}: {
  disabled: boolean;
  readOnly?: boolean;
  onRecalcLine: () => void;
  onResetOverrides: () => void;
  onShowBreakdown: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        disabled={disabled}
        className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
        aria-label="Actions de la ligne"
      >
        <DotsThreeVertical size={16} />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-52 rounded-lg border border-border bg-popover py-1 shadow-lg">
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              setOpen(false);
              onShowBreakdown();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
          >
            <Calculator size={14} />
            Détail du calcul
          </button>
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              setOpen(false);
              onRecalcLine();
            }}
            disabled={readOnly}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowsClockwise size={14} />
            Recalculer cette ligne
          </button>
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              setOpen(false);
              onResetOverrides();
            }}
            disabled={readOnly}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowCounterClockwise size={14} />
            Réinitialiser surcharges
          </button>
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              setOpen(false);
              onRemove();
            }}
            disabled={readOnly}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash size={14} />
            Retirer de la simulation
          </button>
        </div>
      )}
    </div>
  );
}

export function SimulationTable({
  sim,
  readOnly,
  onRecalc,
  onBulkEdit,
  onAddProducts,
  onExport,
  onHistory,
  onChanged,
}: Props) {
  const confirm = useConfirm();
  const [statusFilters, setStatusFilters] = useState<Record<StatusFilterKey, boolean>>({
    ok: true,
    warning: true,
    error: true,
  });
  const [diagnosticsLine, setDiagnosticsLine] = useState<SimulationLine | null>(null);
  const [breakdownLine, setBreakdownLine] = useState<SimulationLine | null>(null);
  const [sort, setSort] = useState<DataTableSortState>(DEFAULT_SORT);
  const [page, setPage] = useState(1);
  const [busyLine, setBusyLine] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [recalculating, setRecalculating] = useState(false);

  const statusIn = buildStatusIn(statusFilters);
  const fromSimulation = useMemo(
    () => ({ simulationId: sim.id, simulationLabel: sim.label }),
    [sim.id, sim.label],
  );
  const ordering = `${sort.dir === "desc" ? "-" : ""}${sort.field}`;
  const { data, isLoading, mutate } = useSWR<PaginatedResponse<SimulationLine>>(
    ["sim-lines", sim.id, statusIn, ordering, page],
    () =>
      getSimulationLines({
        simulation: sim.id,
        status_in: statusIn,
        ordering,
        page,
        limit: PAGE_SIZE,
      }),
    { keepPreviousData: true },
  );

  const lines = data?.results ?? [];
  const total = data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const selectedIds = useMemo(() => [...selected], [selected]);
  const allPageSelected = lines.length > 0 && lines.every((line) => selected.has(line.id));

  const toggleRow = (lineId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  };

  const toggleSelectPage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        for (const line of lines) next.delete(line.id);
      } else {
        for (const line of lines) next.add(line.id);
      }
      return next;
    });
  };

  const removeLines = async (lineIds: string[], label: string) => {
    const ok = await confirm({
      title: "Retirer de la simulation",
      description: label,
      confirmLabel: "Retirer",
      destructive: true,
    });
    if (!ok) return;

    setRemoving(true);
    try {
      if (lineIds.length === 1) {
        await deleteSimulationLine(lineIds[0]);
      } else {
        await bulkDeleteSimulationLines(sim.id, { line_ids: lineIds });
      }
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of lineIds) next.delete(id);
        return next;
      });
      await mutate();
      onChanged();
      toast.success(
        lineIds.length === 1
          ? "Produit retiré de la simulation."
          : `${lineIds.length} produits retirés de la simulation.`,
      );
    } catch (e) {
      toast.error(humanizeApiError(e, "Suppression échouée"));
    } finally {
      setRemoving(false);
    }
  };

  const resetSelectedOverrides = async () => {
    const ok = await confirm({
      title: "Réinitialiser les surcharges",
      description: `Réinitialiser la marge et le mix surchargés de ${selected.size} ligne(s) ?`,
      confirmLabel: "Réinitialiser",
    });
    if (!ok) return;

    setResetting(true);
    try {
      await bulkEditLines(sim.id, { filter: { line_ids: selectedIds }, reset: true });
      await mutate();
      onChanged();
      toast.success(
        selected.size === 1
          ? "Surcharges réinitialisées."
          : `Surcharges réinitialisées sur ${selected.size} lignes.`,
      );
    } catch (e) {
      toast.error(humanizeApiError(e, "Réinitialisation échouée"));
    } finally {
      setResetting(false);
    }
  };

  const recalculateSelection = async () => {
    const ok = await confirm({
      title: "Recalculer la sélection",
      description: `Recalculer ${selected.size} ligne(s) avec les paramètres actuels de la simulation ?`,
      confirmLabel: "Recalculer",
    });
    if (!ok) return;

    setRecalculating(true);
    let succeeded = 0;
    let failed = 0;
    try {
      for (const lineId of selectedIds) {
        try {
          await recalculateSimulationLine(lineId);
          succeeded += 1;
        } catch {
          failed += 1;
        }
      }
      await mutate();
      onChanged();
      if (failed === 0) {
        toast.success(succeeded === 1 ? "1 ligne recalculée." : `${succeeded} lignes recalculées.`);
      } else {
        toast.warning(
          `${succeeded} ligne${succeeded !== 1 ? "s" : ""} recalculée${succeeded !== 1 ? "s" : ""}, ${failed} échec${failed !== 1 ? "s" : ""}.`,
        );
      }
    } finally {
      setRecalculating(false);
    }
  };

  const handleSort = useCallback((field: string) => {
    setPage(1);
    setSort((current) => cycleSortField(field, current, DEFAULT_SORT));
  }, []);

  const patchLine = useCallback(
    async (
      lineId: string,
      patch: { margin_override?: string | null; stock_purchase_mix_pct_override?: number | null },
    ) => {
      setBusyLine(lineId);
      try {
        await updateSimulationLine(lineId, patch);
        await mutate();
        onChanged();
      } catch (e) {
        toast.error(humanizeApiError(e, "Modification échouée"));
      } finally {
        setBusyLine(null);
      }
    },
    [mutate, onChanged],
  );

  const recalcLine = async (lineId: string) => {
    setBusyLine(lineId);
    try {
      await recalculateSimulationLine(lineId);
      await mutate();
      onChanged();
    } catch (e) {
      toast.error(humanizeApiError(e, "Recalcul de ligne échoué"));
    } finally {
      setBusyLine(null);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await onExportWrap(onExport);
    } finally {
      setExporting(false);
    }
  };

  const columns = useMemo<DataTableColumnDef<SimulationLine>[]>(
    () => [
      {
        key: "product_sku",
        label: "SKU",
        sortField: "product__sku_code",
        width: 160,
        render: (line) => {
          const overridden =
            line.margin_override != null || line.stock_purchase_mix_pct_override != null;
          return (
            <div className="flex items-center gap-1.5">
              <Link
                href={productEditHref(line.product_sku, [], fromSimulation)}
                className="font-mono text-sm font-semibold text-warm hover:text-warm/80 hover:underline"
                title="Modifier le produit"
                onClick={(e) => e.stopPropagation()}
              >
                {line.product_sku}
              </Link>
              {overridden && (
                <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-foreground">
                  surchargé
                </span>
              )}
            </div>
          );
        },
      },
      {
        key: "designation",
        label: "Désignation",
        width: 280,
        cellClassName: "text-sm text-foreground truncate",
        render: (line) => (
          <span className="block truncate" title={line.product_designation || line.product_name}>
            {line.product_designation || line.product_name}
          </span>
        ),
      },
      {
        key: "product_range",
        label: "Gamme",
        sortField: "product__range",
        width: 140,
        cellClassName: "text-sm text-muted-foreground",
        render: (line) => line.product_range || "—",
      },
      {
        key: "product_stock",
        label: "Stock",
        width: 100,
        align: "right",
        cellClassName: "text-sm text-foreground font-data",
        render: (line) => fmtNum(line.product_stock),
      },
      {
        key: "product_pamp_eur",
        label: "PAMP",
        width: 110,
        align: "right",
        cellClassName: "text-sm font-medium text-foreground font-data",
        render: (line) => fmtEur(line.product_pamp_eur),
      },
      {
        key: "pamp_predictive_eur",
        label: "PAMP prév.",
        width: 120,
        align: "right",
        cellClassName: "text-sm text-foreground font-data",
        render: (line) => fmtEur(line.pamp_predictive_eur),
      },
      {
        key: "mix",
        label: "Mix eff.",
        width: 100,
        align: "right",
        render: (line) => (
          <OverrideCell
            override={line.stock_purchase_mix_pct_override?.toString() ?? ""}
            effective={line.effective_mix_pct?.toString() ?? ""}
            suffix="%"
            disabled={readOnly || busyLine === line.id}
            onCommit={(raw) =>
              patchLine(line.id, {
                stock_purchase_mix_pct_override: raw.trim() === "" ? null : parseInt(raw, 10),
              })
            }
          />
        ),
      },
      {
        key: "pa_net_eur",
        label: "PA net",
        sortField: "pa_net_eur",
        width: 110,
        align: "right",
        cellClassName: "text-sm text-foreground font-data",
        render: (line) => fmtEur(line.pa_net_eur),
      },
      {
        key: "pr_eur",
        label: "PR",
        sortField: "pr_eur",
        width: 100,
        align: "right",
        cellClassName: "text-sm text-foreground font-data",
        render: (line) => fmtEur(line.pr_eur),
      },
      {
        key: "margin",
        label: "Marge eff.",
        width: 110,
        align: "right",
        render: (line) => (
          <OverrideCell
            override={decToPct(line.margin_override)}
            effective={decToPct(line.effective_margin_rate)}
            suffix="%"
            disabled={readOnly || busyLine === line.id}
            onCommit={(raw) =>
              patchLine(line.id, {
                margin_override: raw.trim() === "" ? null : (parseFloat(raw) / 100).toFixed(4),
              })
            }
          />
        ),
      },
      {
        key: "pv_eur",
        label: "PV",
        sortField: "pv_eur",
        width: 110,
        align: "right",
        cellClassName: "text-sm font-semibold text-foreground font-data",
        render: (line) => fmtEur(line.pv_eur),
      },
      {
        key: "status",
        label: "Statut",
        sortField: "status",
        width: 320,
        render: (line) => {
          const st = LINE_STATUS[line.status] ?? LINE_STATUS.pending;
          const { errors, warnings } = lineDiagnostics(line);
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setDiagnosticsLine(line);
              }}
              className="flex min-w-0 flex-col items-start gap-1 rounded px-1 py-0.5 text-left hover:bg-muted/80"
              title="Voir le détail des diagnostics"
            >
              <span
                className={cn(
                  "inline-flex shrink-0 rounded px-2 py-0.5 text-xs font-medium",
                  st.badge,
                )}
              >
                {st.label}
              </span>
              {errors.length > 0 && (
                <ul className="flex w-full min-w-0 flex-col gap-0.5">
                  {errors.map((msg, i) => (
                    <li key={`e-${i}`} className="flex min-w-0 items-start gap-1">
                      <Warning
                        size={13}
                        weight="fill"
                        className="mt-0.5 shrink-0 text-destructive"
                      />
                      <span className="text-xs leading-snug text-destructive">{msg}</span>
                    </li>
                  ))}
                </ul>
              )}
              {warnings.length > 0 && (
                <ul className="flex w-full min-w-0 flex-col gap-0.5">
                  {warnings.map((msg, i) => (
                    <li key={`w-${i}`} className="flex min-w-0 items-start gap-1">
                      <Warning size={13} weight="fill" className="mt-0.5 shrink-0 text-warm" />
                      <span className="text-xs leading-snug text-warm">{msg}</span>
                    </li>
                  ))}
                </ul>
              )}
            </button>
          );
        },
      },
    ],
    [readOnly, busyLine, patchLine, fromSimulation],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border bg-muted/40 px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
            <ContextItem
              label="Dernier calcul"
              value={
                sim.last_calculated_at
                  ? new Date(sim.last_calculated_at).toLocaleString("fr-FR")
                  : "Jamais"
              }
            />
            <ContextItem
              label="Cuivre (base / actuel)"
              value={`${mp(sim, "copper_base_price_rmb")} / ${mp(sim, "copper_current_price_rmb")} RMB`}
            />
            <ContextItem label="FX EUR→RMB" value={mp(sim, "fx_eur_rmb")} />
            <ContextItem label="FX EUR→USD" value={mp(sim, "fx_eur_usd")} />
            <ContextItem
              label="Incoterm vente"
              value={formatIncotermDisplay(sim.sale_incoterm ?? "EXW", sim.sale_incoterm_location)}
            />
            <ContextItem
              label="Snapshot Odoo"
              value={
                sim.odoo_snapshot_at ? new Date(sim.odoo_snapshot_at).toLocaleString("fr-FR") : "—"
              }
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={onRecalc}
              disabled={readOnly}
              variant={sim.is_dirty ? "default" : "outline"}
              size="sm"
              className="gap-2 font-semibold"
            >
              <Calculator size={15} />
              Recalculer
              {sim.is_dirty && (
                <span
                  className="h-2 w-2 rounded-full bg-primary-foreground"
                  title="Recalcul nécessaire"
                />
              )}
            </Button>
            <Button
              onClick={onAddProducts}
              disabled={readOnly}
              variant="outline"
              size="sm"
              className="gap-1.5"
            >
              <Plus size={15} weight="bold" />
              Ajouter des produits
            </Button>
            <Button onClick={() => onBulkEdit()} disabled={readOnly} variant="outline" size="sm">
              Édition groupée
            </Button>
            <Button
              onClick={handleExport}
              disabled={exporting}
              variant="outline"
              size="sm"
              className="gap-2"
            >
              {exporting ? (
                <CircleNotch size={15} className="animate-spin" />
              ) : (
                <DownloadSimple size={15} />
              )}
              Exporter Excel
            </Button>
            <Button onClick={onHistory} variant="outline" size="sm">
              Historique
            </Button>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-4">
          {(
            [
              { key: "ok" as const, label: "OK" },
              { key: "warning" as const, label: "Avertissements" },
              { key: "error" as const, label: "Erreurs" },
            ] as const
          ).map(({ key, label }) => (
            <div key={key} className="flex items-center gap-1.5">
              <Checkbox
                id={`status-filter-${key}`}
                checked={statusFilters[key]}
                onCheckedChange={(checked) => {
                  setStatusFilters((current) => ({ ...current, [key]: checked === true }));
                  setPage(1);
                }}
              />
              <Label
                htmlFor={`status-filter-${key}`}
                className="text-xs font-normal text-muted-foreground"
              >
                {label}
              </Label>
            </div>
          ))}
          <span className="text-xs text-muted-foreground">
            {total} ligne{total !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {selected.size > 0 && !readOnly && (
        <div className="flex shrink-0 items-center justify-between border-b border-primary/20 bg-primary/5 px-5 py-2.5">
          <span className="text-sm font-semibold text-foreground">
            {selected.size} sélectionné{selected.size > 1 ? "s" : ""}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={removing || resetting || recalculating}
              onClick={() => onBulkEdit(selectedIds)}
            >
              Modifier la sélection
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={removing || resetting || recalculating}
              className="gap-1.5"
              onClick={resetSelectedOverrides}
            >
              {resetting ? (
                <CircleNotch size={14} className="animate-spin" />
              ) : (
                <ArrowCounterClockwise size={14} />
              )}
              Réinitialiser surcharges
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={removing || resetting || recalculating}
              className="gap-1.5"
              onClick={recalculateSelection}
            >
              {recalculating ? (
                <CircleNotch size={14} className="animate-spin" />
              ) : (
                <ArrowsClockwise size={14} />
              )}
              Recalculer la sélection
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={removing || resetting || recalculating}
              className="gap-1.5"
              onClick={() =>
                removeLines(
                  selectedIds,
                  `Retirer ${selected.size} produit${selected.size > 1 ? "s" : ""} de cette simulation ?`,
                )
              }
            >
              {removing ? <CircleNotch size={14} className="animate-spin" /> : <Trash size={14} />}
              Retirer la sélection
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setSelected(new Set())}
              title="Vider la sélection"
              aria-label="Vider la sélection"
            >
              <X size={16} weight="bold" />
            </Button>
          </div>
        </div>
      )}

      <LineDiagnosticsDrawer
        line={diagnosticsLine}
        fromSimulation={fromSimulation}
        open={diagnosticsLine != null}
        onClose={() => setDiagnosticsLine(null)}
      />

      <CalculationBreakdownDrawer
        line={breakdownLine}
        open={breakdownLine != null}
        onClose={() => setBreakdownLine(null)}
      />

      <DataTable
        columns={columns}
        rows={lines}
        rowKey={(line) => line.id}
        storageKey={STORAGE_KEY}
        sort={sort}
        defaultSort={DEFAULT_SORT}
        onSort={handleSort}
        density="compact"
        isLoading={isLoading && !data}
        onRowClick={(line) => setBreakdownLine(line)}
        selectedRowKeys={selected}
        renderLeadingHeader={() =>
          !readOnly ? (
            <Checkbox
              checked={allPageSelected}
              onCheckedChange={() => toggleSelectPage()}
              aria-label="Tout sélectionner sur la page"
              disabled={lines.length === 0}
            />
          ) : null
        }
        renderLeadingCell={(line) =>
          !readOnly ? (
            <Checkbox
              checked={selected.has(line.id)}
              onCheckedChange={() => toggleRow(line.id)}
              aria-label={`Sélectionner ${line.product_sku}`}
              onClick={(e) => e.stopPropagation()}
            />
          ) : null
        }
        emptyState={
          <div className="text-muted-foreground">
            <Table size={36} weight="duotone" className="mx-auto mb-3 text-muted-foreground/40" />
            <p className="text-sm">Aucune ligne à afficher.</p>
          </div>
        }
        rowClassName={(line) => lineRowClassName(line.status)}
        renderTrailingCell={(line) => (
          <RowMenu
            disabled={busyLine === line.id || removing || resetting || recalculating}
            readOnly={readOnly}
            onShowBreakdown={() => setBreakdownLine(line)}
            onRecalcLine={() => recalcLine(line.id)}
            onResetOverrides={() =>
              patchLine(line.id, {
                margin_override: null,
                stock_purchase_mix_pct_override: null,
              })
            }
            onRemove={() =>
              removeLines([line.id], `Retirer ${line.product_sku} de cette simulation ?`)
            }
          />
        )}
        pagination={{
          page,
          totalPages,
          totalCount: total,
          pageSize: PAGE_SIZE,
          onPageChange: setPage,
          itemLabel: "ligne",
          jumpInputId: "simulation-page-jump",
          ariaLabel: "Pagination des lignes de simulation",
        }}
      />
    </div>
  );
}

async function onExportWrap(fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    toast.error(humanizeApiError(e, "Export échoué"));
  }
}

function ContextItem({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex flex-col">
      <span className="text-[10px] font-semibold text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground tabular-nums">{value}</span>
    </span>
  );
}
