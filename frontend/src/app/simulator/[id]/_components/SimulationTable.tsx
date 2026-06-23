"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  AlertTriangle,
  Calculator,
  Download,
  FileSpreadsheet,
  Loader2,
  MoreVertical,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import {
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
import { decToPct, fmtEur, fmtNum, lineDiagnostics, LINE_STATUS, productEditHref } from "./sim-format";
import { formatIncotermDisplay } from "@/lib/incoterms";
import { LineDiagnosticsDrawer } from "./LineDiagnosticsDrawer";
import { CalculationBreakdownDrawer } from "./CalculationBreakdownDrawer";

interface Props {
  sim: SimulationDetail;
  readOnly: boolean;
  onRecalc: () => void;
  onBulkEdit: () => void;
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
  return (
    <div className="flex items-center justify-end gap-1">
      <input
        value={v}
        disabled={disabled}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== override && onCommit(v)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        placeholder={effective || "—"}
        className="w-16 rounded border border-transparent px-1.5 py-1 text-right text-sm hover:border-[#E2E8F0] focus:border-[#E07200] focus:outline-none disabled:bg-transparent disabled:hover:border-transparent"
      />
      <span className="text-xs text-slate-400">{suffix}</span>
    </div>
  );
}

function RowMenu({
  disabled,
  readOnly,
  onRecalcLine,
  onResetOverrides,
  onShowBreakdown,
}: {
  disabled: boolean;
  readOnly?: boolean;
  onRecalcLine: () => void;
  onResetOverrides: () => void;
  onShowBreakdown: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        disabled={disabled}
        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40"
        aria-label="Actions de la ligne"
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-52 rounded-lg border border-[#E2E8F0] bg-white py-1 shadow-lg">
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              setOpen(false);
              onShowBreakdown();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
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
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RefreshCw size={14} />
            Recalculer cette ligne
          </button>
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              setOpen(false);
              onResetOverrides();
            }}
            disabled={readOnly}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw size={14} />
            Réinitialiser surcharges
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
  onExport,
  onHistory,
  onChanged,
}: Props) {
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

  const statusIn = buildStatusIn(statusFilters);
  const fromSimulation = useMemo(
    () => ({ simulationId: sim.id, simulationLabel: sim.label }),
    [sim.id, sim.label]
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
    { keepPreviousData: true }
  );

  const lines = data?.results ?? [];
  const total = data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleSort = useCallback((field: string) => {
    setPage(1);
    setSort((current) => cycleSortField(field, current, DEFAULT_SORT));
  }, []);

  const patchLine = useCallback(
    async (
      lineId: string,
      patch: { margin_override?: string | null; stock_purchase_mix_pct_override?: number | null }
    ) => {
      setBusyLine(lineId);
      try {
        await updateSimulationLine(lineId, patch);
        await mutate();
        onChanged();
      } catch (e) {
        alert(e instanceof Error ? e.message : "Modification échouée");
      } finally {
        setBusyLine(null);
      }
    },
    [mutate, onChanged]
  );

  const recalcLine = async (lineId: string) => {
    setBusyLine(lineId);
    try {
      await recalculateSimulationLine(lineId);
      await mutate();
      onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Recalcul de ligne échoué");
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
                className="font-mono text-sm font-semibold text-orange-600 hover:text-orange-700 hover:underline"
                title="Modifier le produit"
              >
                {line.product_sku}
              </Link>
              {overridden && (
                <span className="rounded bg-[#FFF3E0] px-1.5 py-0.5 text-[10px] font-semibold text-[#C56400]">
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
        cellClassName: "text-sm text-slate-700 truncate",
        render: (line) => (
          <Link
            href={productEditHref(line.product_sku, [], fromSimulation)}
            className="block truncate hover:text-[#E07200] hover:underline"
            title="Modifier le produit"
          >
            {line.product_designation || line.product_name}
          </Link>
        ),
      },
      {
        key: "product_range",
        label: "Gamme",
        sortField: "product__range",
        width: 140,
        cellClassName: "text-sm text-slate-600",
        render: (line) => line.product_range || "—",
      },
      {
        key: "product_stock",
        label: "Stock",
        width: 100,
        align: "right",
        cellClassName: "text-sm text-slate-700 tabular-nums",
        render: (line) => fmtNum(line.product_stock),
      },
      {
        key: "product_pamp_eur",
        label: "PAMP",
        width: 110,
        align: "right",
        cellClassName: "text-sm font-medium text-slate-800 tabular-nums",
        render: (line) => fmtEur(line.product_pamp_eur),
      },
      {
        key: "pa_net_eur",
        label: "PA net",
        sortField: "pa_net_eur",
        width: 110,
        align: "right",
        cellClassName: "text-sm text-slate-700 tabular-nums",
        render: (line) => fmtEur(line.pa_net_eur),
      },
      {
        key: "pamp_predictive_eur",
        label: "PAMP prév.",
        width: 120,
        align: "right",
        cellClassName: "text-sm text-slate-700 tabular-nums",
        render: (line) => fmtEur(line.pamp_predictive_eur),
      },
      {
        key: "pr_eur",
        label: "PR",
        sortField: "pr_eur",
        width: 100,
        align: "right",
        cellClassName: "text-sm text-slate-700 tabular-nums",
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
                margin_override:
                  raw.trim() === "" ? null : (parseFloat(raw) / 100).toFixed(4),
              })
            }
          />
        ),
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
        key: "pv_eur",
        label: "PV",
        sortField: "pv_eur",
        width: 110,
        align: "right",
        cellClassName: "text-sm font-semibold text-slate-900 tabular-nums",
        render: (line) => fmtEur(line.pv_eur),
      },
      {
        key: "status",
        label: "Statut",
        sortField: "status",
        width: 240,
        render: (line) => {
          const st = LINE_STATUS[line.status] ?? LINE_STATUS.pending;
          const { errors, warnings } = lineDiagnostics(line);
          const isError = errors.length > 0;
          const messages = [...errors, ...warnings];
          const primary = messages[0];
          const extraCount = messages.length > 1 ? messages.length - 1 : 0;
          return (
            <button
              type="button"
              onClick={() => setDiagnosticsLine(line)}
              className="flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-slate-100/80"
              title="Voir le détail des diagnostics"
            >
              <span
                className={cn(
                  "inline-flex shrink-0 rounded px-2 py-0.5 text-xs font-medium",
                  st.badge
                )}
              >
                {st.label}
              </span>
              {primary && (
                <span className="flex min-w-0 items-center gap-1">
                  <AlertTriangle
                    size={13}
                    className={cn("shrink-0", isError ? "text-red-500" : "text-amber-500")}
                  />
                  <span
                    className={cn(
                      "truncate text-xs",
                      isError ? "text-red-600" : "text-amber-600"
                    )}
                  >
                    {primary}
                    {extraCount > 0 && (
                      <span className="ml-1 text-slate-400">(+{extraCount})</span>
                    )}
                  </span>
                </span>
              )}
            </button>
          );
        },
      },
    ],
    [readOnly, busyLine, patchLine, fromSimulation]
  );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[#E2E8F0] bg-white px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-500">
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
              value={formatIncotermDisplay(
                sim.sale_incoterm ?? "EXW",
                sim.sale_incoterm_location
              )}
            />
            <ContextItem
              label="Snapshot Odoo"
              value={
                sim.odoo_snapshot_at
                  ? new Date(sim.odoo_snapshot_at).toLocaleString("fr-FR")
                  : "—"
              }
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onRecalc}
              disabled={readOnly}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50",
                sim.is_dirty
                  ? "bg-[#E07200] text-white shadow-sm hover:bg-[#C56400]"
                  : "border border-[#E2E8F0] text-slate-700 hover:bg-slate-50"
              )}
            >
              <Calculator size={15} />
              Recalculer
              {sim.is_dirty && (
                <span className="h-2 w-2 rounded-full bg-white" title="Recalcul nécessaire" />
              )}
            </button>
            <button
              onClick={onBulkEdit}
              disabled={readOnly}
              className="flex items-center gap-2 rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              Édition groupée
            </button>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex items-center gap-2 rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
              Exporter Excel
            </button>
            <button
              onClick={onHistory}
              className="rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              Historique
            </button>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-4">
          {(
            [
              { key: "ok" as const, label: "OK", accent: "accent-green-600" },
              { key: "warning" as const, label: "Avertissements", accent: "accent-amber-500" },
              { key: "error" as const, label: "Erreurs", accent: "accent-red-500" },
            ] as const
          ).map(({ key, label, accent }) => (
            <label key={key} className="flex items-center gap-1.5 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={statusFilters[key]}
                onChange={(e) => {
                  setStatusFilters((current) => ({ ...current, [key]: e.target.checked }));
                  setPage(1);
                }}
                className={cn("h-3.5 w-3.5 rounded border-slate-300", accent)}
              />
              {label}
            </label>
          ))}
          <span className="text-xs text-slate-400">
            {total} ligne{total !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

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
        isLoading={isLoading && !data}
        emptyState={
          <div className="text-slate-400">
            <FileSpreadsheet size={36} className="mx-auto mb-3 text-slate-200" />
            <p className="text-sm">Aucune ligne à afficher.</p>
          </div>
        }
        rowClassName={(line) => {
          const st = LINE_STATUS[line.status] ?? LINE_STATUS.pending;
          return st.row || "bg-white even:bg-slate-50/40 hover:bg-orange-50/50";
        }}
        renderTrailingCell={(line) => (
                <RowMenu
                  disabled={busyLine === line.id}
                  readOnly={readOnly}
                  onShowBreakdown={() => setBreakdownLine(line)}
                  onRecalcLine={() => recalcLine(line.id)}
                  onResetOverrides={() =>
                    patchLine(line.id, {
                      margin_override: null,
                      stock_purchase_mix_pct_override: null,
                    })
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
    alert(e instanceof Error ? e.message : "Export échoué");
  }
}

function ContextItem({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex flex-col">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <span className="font-medium text-slate-700 tabular-nums">{value}</span>
    </span>
  );
}
