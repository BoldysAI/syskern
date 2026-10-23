"use client";

import { uiDateLocale } from "@/lib/i18n";
import { useCallback, useMemo, useRef, useState } from "react";
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
  SidebarSimple,
  Faders,
} from "@phosphor-icons/react";
import {
  bulkDeleteSimulationLines,
  bulkEditLines,
  deleteSimulationLine,
  getFilterableAttributes,
  getSimulationLines,
  recalculateSimulationLine,
  updateSimulationLine,
  type BulkEditFilter,
  type CatalogFilters,
  type PaginatedResponse,
  type SimulationDetail,
  type SimulationLine,
} from "@/lib/api";
import { ActiveFilterBar } from "@/app/catalog/_components/ActiveFilterBar";
import { CatalogFilterSheet, CatalogFilterTrigger } from "@/app/catalog/_components/CatalogFilterSheet";
import { countActiveFilters } from "@/app/catalog/_components/active-filters";
import {
  DataTable,
  cycleSortField,
  type DataTableColumnDef,
  type DataTableSortState,
} from "@/components/data-table";
import { cn } from "@/lib/utils";
import { humanizeApiError } from "@/lib/humanize-errors";
import { useConfirm } from "@/components/ConfirmProvider";
import { usePersistedBoolean } from "@/hooks/usePersistedBoolean";
import { useResizableWidth } from "@/hooks/useResizableWidth";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchInput } from "@/components/SearchInput";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { localize } from "@/components/AttributeRenderer";
import { useUiTranslate } from "@/lib/use-ui-translate";
import {
  decToPct,
  fmtEur,
  fmtNum,
  lineDiagnostics,
  LINE_STATUS,
  lineRowClassName,
  lineStatusLabel,
  productEditHref,
} from "./sim-format";
import { formatIncotermDisplay } from "@/lib/incoterms";
import { normalizeIntegerQuantity } from "@/app/simulator/new/_components/wizard-draft";
import { LineDiagnosticsDrawer } from "./LineDiagnosticsDrawer";
import { CalculationBreakdownDrawer } from "./CalculationBreakdownDrawer";
import { RecalculateButton } from "./RecalculateButton";
import { SimulationColumnsDialog } from "./SimulationColumnsDialog";
import {
  loadVisibleSimulationColumns,
  saveVisibleSimulationColumns,
} from "./simulation-column-storage";
import {
  SimulationLinesFilterSidebar,
  SimulationLineStatusFilterSection,
  type LineStatusFilterKey,
} from "./SimulationLinesFilterSidebar";
import { buildSimulationLineBulkFilter } from "./simulation-line-filters";

interface Props {
  sim: SimulationDetail;
  readOnly: boolean;
  /** Live market params from the sidebar (passed to recalc). */
  marketParams?: Record<string, unknown>;
  onBulkEdit: (opts?: { lineIds?: string[]; filter?: BulkEditFilter }) => void;
  onAddProducts: () => void;
  onExport: () => void;
  onHistory: () => void;
  onChanged: () => void;
  /** Refresh sim header + lines after a global recalc. */
  onRecalcDone: () => void;
}

const PAGE_SIZE = 200;
const STORAGE_KEY = "syskern:simulation-col-widths:v1";
const DEFAULT_SORT: DataTableSortState = { field: "product__sku_code", dir: "asc" };
const DEFAULT_STATUS_IN: LineStatusFilterKey[] = ["ok", "warning", "error"];

function buildStatusInParam(statusIn: LineStatusFilterKey[]): string | undefined {
  if (statusIn.length === 0 || statusIn.length === DEFAULT_STATUS_IN.length) return undefined;
  return statusIn.join(",");
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
  integerOnly = false,
  onCommit,
}: {
  override: string;
  effective: string;
  suffix: string;
  disabled: boolean;
  integerOnly?: boolean;
  onCommit: (raw: string) => void;
}) {
  const [v, setV] = useState(override);
  const [prevOverride, setPrevOverride] = useState(override);
  if (prevOverride !== override) {
    setPrevOverride(override);
    setV(override);
  }

  const inputCls =
    "min-w-[3.5rem] rounded border border-border/70 bg-background px-1.5 py-1 text-right text-sm font-medium text-foreground font-data tabular-nums focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-50";

  return (
    <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      <input
        value={v}
        disabled={disabled}
        inputMode={integerOnly ? "numeric" : "decimal"}
        pattern={integerOnly ? "[0-9]*" : undefined}
        onChange={(e) => {
          const next = integerOnly ? e.target.value.replace(/[^\d]/g, "") : e.target.value;
          setV(next);
        }}
        onBlur={() => v !== override && onCommit(v)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        placeholder={effective || "—"}
        className={inputCls}
      />
      {suffix ? <span className="text-sm text-foreground">{suffix}</span> : null}
    </div>
  );
}

/**
 * Mix cell — for project simulations the mix is quantity-driven (auto) unless
 * the line forces the manual slider. Tariff simulations always edit manually.
 */
function MixCell({
  line,
  isProject,
  disabled,
  onCommitOverride,
  onToggleManual,
}: {
  line: SimulationLine;
  isProject: boolean;
  disabled: boolean;
  onCommitOverride: (raw: string) => void;
  onToggleManual: (forceManual: boolean) => void;
}) {
  const t = useUiTranslate();
  const autoMode = isProject && !line.force_manual_mix;
  if (autoMode) {
    return (
      <div
        className="flex items-center justify-end gap-1.5"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="font-data text-sm text-foreground tabular-nums">
          {line.effective_mix_pct != null ? `${line.effective_mix_pct} %` : "—"}
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onToggleManual(true)}
          title={t("simulator.lines.mixAutoTitle")}
          className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-foreground hover:bg-accent/80 disabled:opacity-40"
        >
          {t("simulator.lines.auto")}
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      <OverrideCell
        override={line.stock_purchase_mix_pct_override?.toString() ?? ""}
        effective={line.effective_mix_pct?.toString() ?? ""}
        suffix="%"
        disabled={disabled}
        onCommit={onCommitOverride}
      />
      {isProject && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onToggleManual(false)}
          title={t("simulator.lines.mixManualTitle")}
          className="rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground hover:bg-muted disabled:opacity-40"
        >
          {t("simulator.lines.manual")}
        </button>
      )}
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
  const t = useUiTranslate();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        disabled={disabled}
        className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
        aria-label={t("simulator.lines.actions")}
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
            {t("simulator.lines.breakdown")}
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
            {t("simulator.lines.recalcLine")}
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
            {t("simulator.lines.resetOverrides")}
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
            {t("simulator.lines.remove")}
          </button>
        </div>
      )}
    </div>
  );
}

export function SimulationTable({
  sim,
  readOnly,
  marketParams,
  onBulkEdit,
  onAddProducts,
  onExport,
  onHistory,
  onChanged,
  onRecalcDone,
}: Props) {
  const t = useUiTranslate();
  const { displayLanguage } = useAuth();
  const confirm = useConfirm();
  const [catalogFilters, setCatalogFilters] = useState<CatalogFilters>({});
  const [searchInput, setSearchInput] = useState("");
  const [statusIn, setStatusIn] = useState<LineStatusFilterKey[]>(DEFAULT_STATUS_IN);
  const [filtersCollapsed, setFiltersCollapsed] = usePersistedBoolean(
    "syskern:simulation-lines-filters-collapsed",
    false,
  );
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const {
    width: filterSidebarWidth,
    startResize: startFilterResize,
    isResizing: isFilterResizing,
  } = useResizableWidth(300, {
    min: 240,
    max: 420,
    storageKey: "syskern:simulation-lines-filters-width",
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

  const statusInParam = buildStatusInParam(statusIn);
  const fromSimulation = useMemo(
    () => ({ simulationId: sim.id, simulationLabel: sim.label }),
    [sim.id, sim.label],
  );
  const ordering = `${sort.dir === "desc" ? "-" : ""}${sort.field}`;
  const catalogFiltersKey = JSON.stringify(catalogFilters);
  const activeCatalogFilterCount = countActiveFilters(catalogFilters);
  const activeFilterCount = activeCatalogFilterCount + (statusInParam ? statusIn.length : 0);

  const { data: filterableAttrs } = useSWR("filterable-attrs", getFilterableAttributes);
  const attrLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const attr of filterableAttrs ?? []) {
      labels[attr.code] = localize(attr.label, displayLanguage) || attr.code;
    }
    return labels;
  }, [filterableAttrs, displayLanguage]);

  const onSearchChange = (value: string) => {
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setCatalogFilters((current) => ({ ...current, q: value || undefined }));
      setPage(1);
    }, 300);
  };

  const applyCatalogFilters = useCallback((next: CatalogFilters) => {
    setCatalogFilters(next);
    setSearchInput(next.q ?? "");
    setPage(1);
  }, []);

  const resetCatalogFilters = useCallback(() => {
    setCatalogFilters({});
    setSearchInput("");
    setStatusIn(DEFAULT_STATUS_IN);
    setPage(1);
  }, []);

  const { data, isLoading, mutate } = useSWR<PaginatedResponse<SimulationLine>>(
    ["sim-lines", sim.id, statusInParam, ordering, page, catalogFiltersKey],
    () =>
      getSimulationLines({
        simulation: sim.id,
        status_in: statusInParam,
        ordering,
        page,
        limit: PAGE_SIZE,
        ...catalogFilters,
      }),
    { keepPreviousData: true },
  );

  const activeBulkFilter = useMemo<BulkEditFilter>(
    () => buildSimulationLineBulkFilter(catalogFilters, { status_in: statusInParam }),
    [catalogFilters, statusInParam],
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
      title: t("simulator.lines.removeTitle"),
      description: label,
      confirmLabel: t("simulator.lines.removeAction"),
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
          ? t("simulator.lines.removedOne")
          : t("simulator.lines.removedOther", { count: lineIds.length }),
      );
    } catch (e) {
      toast.error(humanizeApiError(e, t("simulator.lines.removeFailed")));
    } finally {
      setRemoving(false);
    }
  };

  const resetSelectedOverrides = async () => {
    const ok = await confirm({
      title: t("simulator.lines.resetTitle"),
      description: t("simulator.lines.resetDescription", { count: selected.size }),
      confirmLabel: t("simulator.lines.resetAction"),
    });
    if (!ok) return;

    setResetting(true);
    try {
      await bulkEditLines(sim.id, { filter: { line_ids: selectedIds }, reset: true });
      await mutate();
      onChanged();
      toast.success(
        selected.size === 1
          ? t("simulator.lines.resetDoneOne")
          : t("simulator.lines.resetDoneOther", { count: selected.size }),
      );
    } catch (e) {
      toast.error(humanizeApiError(e, t("simulator.lines.resetFailed")));
    } finally {
      setResetting(false);
    }
  };

  const recalculateSelection = async () => {
    const ok = await confirm({
      title: t("simulator.lines.recalcTitle"),
      description: t("simulator.lines.recalcDescription", { count: selected.size }),
      confirmLabel: t("simulator.recalc.button"),
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
        toast.success(
          succeeded === 1
            ? t("simulator.recalc.lineDoneOne")
            : t("simulator.recalc.lineDoneOther", { count: succeeded }),
        );
      } else {
        toast.warning(
          t("simulator.recalc.linePartial", {
            ok: succeeded,
            okSuffix: succeeded !== 1 ? "s" : "",
            failed,
            failedSuffix: failed !== 1 ? "s" : "",
          }),
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
      patch: {
        margin_override?: string | null;
        stock_purchase_mix_pct_override?: number | null;
        quantity?: string | null;
        force_manual_mix?: boolean;
      },
    ) => {
      setBusyLine(lineId);
      try {
        await updateSimulationLine(lineId, patch);
        await mutate();
        onChanged();
      } catch (e) {
        toast.error(humanizeApiError(e, t("simulator.lines.editFailed")));
      } finally {
        setBusyLine(null);
      }
    },
    [mutate, onChanged, t],
  );

  const recalcLine = async (lineId: string) => {
    setBusyLine(lineId);
    try {
      await recalculateSimulationLine(lineId);
      await mutate();
      onChanged();
    } catch (e) {
      toast.error(humanizeApiError(e, t("simulator.recalc.lineFailed")));
    } finally {
      setBusyLine(null);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await onExportWrap(onExport, t("simulator.lines.exportFailed"));
    } finally {
      setExporting(false);
    }
  };

  const isProject = sim.simulation_type === "project";
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() =>
    loadVisibleSimulationColumns(sim.simulation_type === "project"),
  );

  const applyVisibleColumns = (keys: string[]) => {
    setVisibleColumns(keys);
    saveVisibleSimulationColumns(keys);
  };

  const allColumns = useMemo<DataTableColumnDef<SimulationLine>[]>(
    () => [
      {
        key: "product_sku",
        label: t("simulator.column.sku"),
        sortField: "product__sku_code",
        width: 160,
        render: (line) => {
          const overridden =
            line.margin_override != null ||
            line.stock_purchase_mix_pct_override != null;
          return (
            <div className="flex items-center gap-1.5">
              <Link
                href={productEditHref(line.product_sku, [], fromSimulation)}
                className="font-mono text-sm font-semibold text-warm hover:text-warm/80 hover:underline"
                title={t("simulator.lines.editProduct")}
                onClick={(e) => e.stopPropagation()}
              >
                {line.product_sku}
              </Link>
              {overridden && (
                <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-foreground">
                  {t("simulator.lines.overridden")}
                </span>
              )}
            </div>
          );
        },
      },
      {
        key: "designation",
        label: t("simulator.column.designation"),
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
        label: t("simulator.column.range"),
        sortField: "product__range",
        width: 140,
        cellClassName: "text-sm text-muted-foreground",
        render: (line) => line.product_range || "—",
      },
      {
        key: "product_stock",
        label: t("simulator.column.stock"),
        width: 100,
        align: "right",
        cellClassName: "text-sm text-foreground font-data",
        render: (line) => fmtNum(line.product_stock, displayLanguage),
      },
      {
        key: "product_pamp_eur",
        label: t("simulator.column.pamp"),
        width: 110,
        align: "right",
        cellClassName: "text-sm font-medium text-foreground font-data",
        render: (line) => fmtEur(line.product_pamp_eur, displayLanguage),
      },
      {
        key: "pamp_predictive_eur",
        label: t("simulator.column.pampPredictiveShort"),
        width: 120,
        align: "right",
        cellClassName: "text-sm text-foreground font-data",
        render: (line) => fmtEur(line.pamp_predictive_eur, displayLanguage),
      },
      ...(isProject
        ? [
            {
              key: "quantity",
              label: t("simulator.column.quantity"),
              width: 110,
              align: "right" as const,
              render: (line: SimulationLine) => (
                <OverrideCell
                  override={line.quantity?.split(".")[0] ?? ""}
                  effective="1"
                  suffix=""
                  integerOnly
                  disabled={readOnly || busyLine === line.id}
                  onCommit={(raw) =>
                    patchLine(line.id, { quantity: normalizeIntegerQuantity(raw) })
                  }
                />
              ),
            },
          ]
        : []),
      {
        key: "mix",
        label: t("simulator.column.mixEffective"),
        width: isProject ? 130 : 100,
        align: "right",
        render: (line) => (
          <MixCell
            line={line}
            isProject={isProject}
            disabled={readOnly || busyLine === line.id}
            onCommitOverride={(raw) =>
              patchLine(line.id, {
                stock_purchase_mix_pct_override: raw.trim() === "" ? null : parseInt(raw, 10),
              })
            }
            onToggleManual={(forceManual) =>
              patchLine(line.id, {
                force_manual_mix: forceManual,
                // Clearing the override when going back to auto keeps the mix honest.
                ...(forceManual ? {} : { stock_purchase_mix_pct_override: null }),
              })
            }
          />
        ),
      },
      {
        key: "pa_net_eur",
        label: t("simulator.column.paNet"),
        sortField: "pa_net_eur",
        width: 110,
        align: "right",
        cellClassName: "text-sm text-foreground font-data",
        render: (line) => fmtEur(line.pa_net_eur, displayLanguage),
      },
      {
        key: "pr_eur",
        label: t("simulator.column.pr"),
        sortField: "pr_eur",
        width: 100,
        align: "right",
        cellClassName: "text-sm text-foreground font-data",
        render: (line) => fmtEur(line.pr_eur, displayLanguage),
      },
      {
        key: "margin",
        label: t("simulator.column.marginEffective"),
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
        key: "previous_pv_eur",
        label: t("simulator.column.previousPv"),
        sortField: "previous_pv_eur",
        width: 110,
        align: "right",
        cellClassName: "text-sm text-muted-foreground font-data",
        render: (line) => fmtEur(line.previous_pv_eur, displayLanguage),
      },
      {
        key: "pv_eur",
        label: t("simulator.column.pv"),
        sortField: "pv_eur",
        width: 110,
        align: "right",
        cellClassName: "text-sm font-semibold text-foreground font-data",
        render: (line) => fmtEur(line.pv_eur, displayLanguage),
      },
      ...(isProject
        ? [
            {
              key: "pv_total_eur",
              label: t("simulator.column.totalPrice"),
              width: 120,
              align: "right" as const,
              cellClassName: "text-sm font-semibold text-foreground font-data",
              render: (line: SimulationLine) => fmtEur(line.pv_total_eur, displayLanguage),
            },
          ]
        : []),
      {
        key: "status",
        label: t("simulator.column.status"),
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
              title={t("simulator.lines.diagnostics")}
            >
              <span
                className={cn(
                  "inline-flex shrink-0 rounded px-2 py-0.5 text-xs font-medium",
                  st.badge,
                )}
              >
                {lineStatusLabel(line.status, displayLanguage)}
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
    [readOnly, busyLine, patchLine, fromSimulation, isProject, t, displayLanguage],
  );

  const columns = useMemo(
    () => allColumns.filter((col) => visibleColumns.includes(col.key)),
    [allColumns, visibleColumns],
  );

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {filtersCollapsed ? (
        <div className="relative hidden w-12 shrink-0 flex-col items-center border-r border-border bg-card py-3 lg:flex">
          <button
            type="button"
            onClick={() => setFiltersCollapsed(false)}
            className="relative rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("simulator.filters.show")}
            title={t("simulator.filters.title")}
          >
            <Faders size={18} weight="duotone" />
            {activeFilterCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>
      ) : (
        <aside
          className="relative hidden shrink-0 flex-col border-r border-border bg-card lg:flex"
          style={{ width: filterSidebarWidth }}
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <span className="text-sm font-bold text-foreground">{t("simulator.filters.title")}</span>
              {activeFilterCount > 0 && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {activeFilterCount > 1
                    ? t("simulator.filters.activeOther", { count: activeFilterCount })
                    : t("simulator.filters.activeOne", { count: activeFilterCount })}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {activeFilterCount > 0 && (
                <Button type="button" variant="ghost" size="sm" onClick={resetCatalogFilters}>
                  {t("simulator.filters.clear")}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setFiltersCollapsed(true)}
                aria-label={t("simulator.filters.hide")}
                title={t("simulator.filters.hide")}
              >
                <SidebarSimple size={18} />
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <SimulationLinesFilterSidebar
              filters={catalogFilters}
              onChange={applyCatalogFilters}
              statusIn={statusIn}
              onStatusInChange={(next) => {
                setStatusIn(next);
                setPage(1);
              }}
            />
          </div>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t("simulator.filters.resize")}
            onMouseDown={startFilterResize}
            className={cn(
              "absolute right-0 top-0 z-20 flex h-full w-1.5 cursor-col-resize touch-none items-center justify-center transition-colors hover:bg-primary/20",
              isFilterResizing && "bg-primary/30",
            )}
          >
            <span className="h-10 w-0.5 rounded-full bg-border" />
          </div>
        </aside>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="border-b border-border bg-muted/40 px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
            <ContextItem
              label={t("simulator.column.lastCalc")}
              value={
                sim.last_calculated_at
                  ? new Date(sim.last_calculated_at).toLocaleString(uiDateLocale(displayLanguage))
                  : t("simulator.lines.never")
              }
            />
            <ContextItem
              label={t("simulator.market.copperPairParen")}
              value={`${mp(sim, "copper_base_price_rmb")} / ${mp(sim, "copper_current_price_rmb")} RMB`}
            />
            <ContextItem label={t("simulator.fx.eurToRmb")} value={mp(sim, "fx_eur_rmb")} />
            <ContextItem label={t("simulator.fx.eurToUsd")} value={mp(sim, "fx_eur_usd")} />
            <ContextItem
              label={t("simulator.params.saleIncotermShort")}
              value={formatIncotermDisplay(sim.sale_incoterm ?? "EXW", sim.sale_incoterm_location, t)}
            />
            <ContextItem
              label={t("simulator.history.snapshotOdoo")}
              value={
                sim.odoo_snapshot_at ? new Date(sim.odoo_snapshot_at).toLocaleString(uiDateLocale(displayLanguage)) : "—"
              }
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <RecalculateButton
              simId={sim.id}
              marketParams={marketParams}
              disabled={readOnly}
              isDirty={sim.is_dirty}
              onDone={onRecalcDone}
            />
            <Button
              onClick={onAddProducts}
              disabled={readOnly}
              variant="outline"
              size="sm"
              className="gap-1.5"
            >
              <Plus size={15} weight="bold" />
              {t("simulator.lines.addProducts")}
            </Button>
            <Button
              onClick={() => onBulkEdit({ filter: activeBulkFilter })}
              disabled={readOnly}
              variant="outline"
              size="sm"
            >
              {t("simulator.lines.bulkEdit")}
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
              {t("simulator.lines.exportExcel")}
            </Button>
            <Button onClick={onHistory} variant="outline" size="sm">
              {t("simulator.lines.history")}
            </Button>
            <SimulationColumnsDialog
              isProject={isProject}
              visibleKeys={visibleColumns}
              onApply={applyVisibleColumns}
            />
          </div>
        </div>
      </div>

        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-3">
          <CatalogFilterTrigger
            activeCount={activeFilterCount}
            onClick={() => setMobileFiltersOpen(true)}
          />
          <SearchInput
            className="w-full min-w-[200px] flex-1 sm:max-w-sm"
            value={searchInput}
            onChange={onSearchChange}
            placeholder={t("simulator.lines.search")}
          />
          <span className="text-xs text-muted-foreground">
            {total !== 1
              ? t("simulator.lines.countOther", { count: total })
              : t("simulator.lines.countOne", { count: total })}
          </span>
        </div>

        <CatalogFilterSheet
          open={mobileFiltersOpen}
          onOpenChange={setMobileFiltersOpen}
          filters={catalogFilters}
          onChange={applyCatalogFilters}
          onReset={resetCatalogFilters}
          savedFilters={[]}
          onSaveFilter={() => {}}
          onApplyFilter={() => {}}
          onDeleteFilter={() => {}}
          title={t("simulator.filters.linesTitle")}
          prependContent={
            <SimulationLineStatusFilterSection
              statusIn={statusIn}
              onStatusInChange={(next) => {
                setStatusIn(next);
                setPage(1);
              }}
            />
          }
        />

        <ActiveFilterBar
          filters={catalogFilters}
          attrLabels={attrLabels}
          onChange={applyCatalogFilters}
          onClearAll={resetCatalogFilters}
        />

      {selected.size > 0 && !readOnly && (
        <div className="flex shrink-0 items-center justify-between border-b border-primary/20 bg-primary/5 px-5 py-2.5">
          <span className="text-sm font-semibold text-foreground">
            {selected.size > 1
              ? t("simulator.list.selectedOther", { count: selected.size })
              : t("simulator.list.selectedOne", { count: selected.size })}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={removing || resetting || recalculating}
              onClick={() => onBulkEdit({ lineIds: selectedIds })}
            >
              {t("simulator.lines.editSelection")}
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
              {t("simulator.lines.resetOverrides")}
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
              {t("simulator.lines.recalcTitle")}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={removing || resetting || recalculating}
              className="gap-1.5"
              onClick={() =>
                removeLines(
                  selectedIds,
                  selected.size > 1
                    ? t("simulator.lines.removeConfirmOther", { count: selected.size })
                    : t("simulator.lines.removeConfirmOne", { count: selected.size }),
                )
              }
            >
              {removing ? <CircleNotch size={14} className="animate-spin" /> : <Trash size={14} />}
              {t("simulator.lines.removeSelection")}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setSelected(new Set())}
              title={t("simulator.list.clearSelection")}
              aria-label={t("simulator.list.clearSelection")}
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
        reorderable
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
              aria-label={t("simulator.list.selectPage")}
              disabled={lines.length === 0}
            />
          ) : null
        }
        renderLeadingCell={(line) =>
          !readOnly ? (
            <Checkbox
              checked={selected.has(line.id)}
              onCheckedChange={() => toggleRow(line.id)}
              aria-label={t("simulator.list.selectRow", { name: line.product_sku })}
              onClick={(e) => e.stopPropagation()}
            />
          ) : null
        }
        emptyState={
          <div className="text-muted-foreground">
            <Table size={36} weight="duotone" className="mx-auto mb-3 text-muted-foreground/40" />
            <p className="text-sm">{t("simulator.lines.empty")}</p>
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
                force_manual_mix: false,
              })
            }
            onRemove={() =>
              removeLines([line.id], t("simulator.lines.removeSku", { sku: line.product_sku }))
            }
          />
        )}
        pagination={{
          page,
          totalPages,
          totalCount: total,
          pageSize: PAGE_SIZE,
          onPageChange: setPage,
          itemLabel: t("simulator.lines.itemLabel"),
          jumpInputId: "simulation-page-jump",
          ariaLabel: t("simulator.lines.pagination"),
        }}
      />
      </div>
    </div>
  );
}

async function onExportWrap(fn: () => void | Promise<void>, fallback: string): Promise<void> {
  try {
    await fn();
  } catch (e) {
    toast.error(humanizeApiError(e, fallback));
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
