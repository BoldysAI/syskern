function getCsrfToken(): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(/csrftoken=([^;]+)/);
  return match ? match[1] : "";
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const method = options?.method ?? "GET";
  const needsCsrf = !["GET", "HEAD", "OPTIONS", "TRACE"].includes(method.toUpperCase());
  const res = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(needsCsrf ? { "X-CSRFToken": getCsrfToken() } : {}),
      ...options?.headers,
    },
    credentials: "include",
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${text}`);
  }
  if (res.status === 204 || res.status === 205) {
    return undefined as T;
  }
  const text = await res.text();
  if (!text.trim()) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

// ── Celery polling helpers ───────────────────────────────────────────────
interface TaskResponse<T> {
  task_id: string;
  status: "PENDING" | "STARTED" | "SUCCESS" | "FAILURE" | "REVOKED";
  result?: T;
  error?: string;
}

/** Poll `/api/tasks/{id}` until terminal state, then return result or throw. */
async function pollTask<T>(
  taskId: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<T> {
  const intervalMs = opts.intervalMs ?? 800;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await apiFetch<TaskResponse<T>>(`/api/tasks/${encodeURIComponent(taskId)}/`);
    if (r.status === "SUCCESS") return r.result as T;
    if (r.status === "FAILURE") throw new Error(r.error || "Tâche échouée");
    if (r.status === "REVOKED") throw new Error("Tâche annulée");
    await new Promise((res) => setTimeout(res, intervalMs));
  }
  throw new Error("Délai d'attente dépassé");
}

/** Dispatch a Celery task via the given endpoint, then poll until done. */
async function dispatchAndPoll<T>(
  path: string,
  options?: RequestInit,
  pollOpts?: { intervalMs?: number; timeoutMs?: number },
): Promise<T> {
  const dispatch = await apiFetch<{ task_id: string }>(path, options);
  return pollTask<T>(dispatch.task_id, pollOpts);
}

/** Single snapshot of a Celery task's state (with optional progress). */
export interface TaskStatus<T> {
  task_id: string;
  status: string;
  result?: T;
  error?: string;
  progress?: { current: number; total: number };
}

/** Fetch a Celery task's current state (for custom progress-aware polling). */
export function getTaskStatus<T>(taskId: string): Promise<TaskStatus<T>> {
  return apiFetch<TaskStatus<T>>(`/api/tasks/${encodeURIComponent(taskId)}/`);
}

/** Sentinel value for « Pas de fournisseur » in catalog supplier filters (must match backend). */
export const CATALOG_NO_SUPPLIER_VALUE = "__none__";
export const CATALOG_NO_SUPPLIER_LABEL = "Pas de fournisseur";

/** Catalog sidebar filter state (multi-select, persisted in localStorage). */
export interface CatalogFilters {
  /** Full-text search (Postgres tsvector, FR + simple). */
  q?: string;
  universe?: string[];
  family?: string[];
  range?: string[];
  sub_range?: string[];
  brand?: string[];
  /** Any linked supplier (active or inactive). */
  supplier?: string[];
  /** Active supplier only (matches the « Fournisseur actif » table column). */
  active_supplier?: string[];
  /** Produit actif. Exclusif avec active_out. */
  active_in?: boolean;
  /** Produit inactif (soft-delete). Exclusif avec active_in. */
  active_out?: boolean;
  /** En stock (stock > 0). Exclusif avec stock_out. */
  stock_in?: boolean;
  /** Rupture (stock ≤ 0 ou null). Exclusif avec stock_in. */
  stock_out?: boolean;
  stock_min?: number | null;
  /** PAMP price range (EUR). */
  pamp_min?: number | null;
  pamp_max?: number | null;
  /** Keep only products with < 100% multilingual coverage (CDC §10.7.3). */
  i18n_incomplete?: boolean;
  /** Per-language content filters (marketing or technical description non-empty). */
  lang_fr_in?: boolean;
  lang_fr_out?: boolean;
  lang_en_in?: boolean;
  lang_en_out?: boolean;
  lang_es_in?: boolean;
  lang_es_out?: boolean;
  /** Dynamic attribute filters, keyed by attribute code (value or values). */
  attrs?: Record<string, string | string[] | undefined>;
  /** Attribute codes to include as columns in the catalog list response. */
  attr_columns?: string[];
  /** Explicit product UUIDs (comma-separated in query string). */
  ids?: string[];
}

export interface ProductListParams extends CatalogFilters {
  ordering?: string;
  page?: number;
  limit?: number;
  /** Scope PV enrichment to a specific simulation (draft or finalized). */
  simulation_id?: string;
}

/** Build the shared query string for `GET /api/products` and the export task. */
export function buildCatalogQuery(filters: CatalogFilters): Record<string, string> {
  const params: Record<string, string> = {};
  if (filters.q?.trim()) params.q = filters.q.trim();
  const csvKeys: (keyof CatalogFilters)[] = [
    "universe",
    "family",
    "range",
    "sub_range",
    "brand",
    "supplier",
    "active_supplier",
  ];
  for (const k of csvKeys) {
    const v = filters[k];
    if (Array.isArray(v) && v.length) params[k] = v.join(",");
  }
  const { active_in: activeIn, active_out: activeOut } = filters;
  if (activeIn && !activeOut) params.is_active = "true";
  else if (activeOut && !activeIn) params.is_active = "false";
  const { stock_in: inStock, stock_out: outStock } = filters;
  if (inStock && !outStock) params.in_stock = "true";
  else if (outStock && !inStock) params.in_stock = "false";
  if (!outStock && filters.stock_min != null && filters.stock_min > 0) {
    params.stock_min = String(filters.stock_min);
  }
  if (filters.pamp_min != null && filters.pamp_min > 0) {
    params.pamp_min = String(filters.pamp_min);
  }
  if (filters.pamp_max != null && filters.pamp_max > 0) {
    params.pamp_max = String(filters.pamp_max);
  }
  if (filters.i18n_incomplete) params.i18n_incomplete = "true";
  if (filters.lang_fr_in) params.lang_fr_in = "true";
  if (filters.lang_fr_out) params.lang_fr_out = "true";
  if (filters.lang_en_in) params.lang_en_in = "true";
  if (filters.lang_en_out) params.lang_en_out = "true";
  if (filters.lang_es_in) params.lang_es_in = "true";
  if (filters.lang_es_out) params.lang_es_out = "true";
  for (const [code, raw] of Object.entries(filters.attrs ?? {})) {
    if (raw == null) continue;
    const v = Array.isArray(raw) ? raw.join(",") : String(raw);
    if (v) params[`attr_${code}`] = v;
  }
  if (filters.attr_columns?.length) {
    params.attr_columns = filters.attr_columns.join(",");
  }
  if (filters.ids?.length) {
    params.ids = filters.ids.join(",");
  }
  return params;
}

/** Supported currencies (mirrors core.models.Currency). */
export type Currency = "EUR" | "USD" | "RMB";

/** Supplier embedded in product list/detail */
export interface ProductSupplier {
  id: string;
  supplier_name: string;
  factory_code?: string;
  po_base_price?: string | null;
  po_currency?: Currency;
  is_copper_indexed?: boolean;
  copper_base_price?: string | null;
  incoterm?: string;
  incoterm_location?: string;
  notes?: string;
  is_active: boolean;
}

/** Writable supplier payload (create / update on a product). */
export interface ProductSupplierInput {
  supplier_name: string;
  factory_code?: string;
  po_base_price?: string | null;
  po_currency?: Currency;
  is_copper_indexed?: boolean;
  copper_base_price?: string | null;
  incoterm?: string;
  incoterm_location?: string;
  notes?: string;
  is_active?: boolean;
}

// ── Supplier entity (module Fournisseurs — Épic FEEDBACK 1) ───────────────
/** A supplier managed as a standalone entity (`/api/suppliers/`). */
export interface Supplier {
  id: string;
  name: string;
  code: string;
  factory_code_default?: string;
  currency_default: Currency;
  incoterm_default?: string;
  location?: string;
  notes?: string;
  is_active: boolean;
  linked_skus_count?: number;
  updated_at?: string;
}

export interface SupplierInput {
  name: string;
  code: string;
  factory_code_default?: string;
  currency_default?: Currency;
  incoterm_default?: string;
  location?: string;
  notes?: string;
  is_active?: boolean;
}

/** A product-supplier link seen from the supplier side (SKU-centric). */
export interface SupplierProductLink {
  id: string;
  product: string;
  product_sku: string;
  product_name: string;
  product_designation: string;
  supplier: string | null;
  supplier_name: string;
  factory_code?: string;
  is_active: boolean;
  po_base_price?: string | null;
  po_currency?: Currency;
  incoterm?: string;
  incoterm_location?: string;
  updated_at?: string;
}

export interface SupplierPriceHistoryEntry {
  id: string;
  product_supplier: string;
  product_sku: string;
  supplier_name: string;
  old_po_base_price: string | null;
  new_po_base_price: string | null;
  po_currency: Currency;
  source: "import" | "manual" | "odoo";
  created_at: string;
}

export interface PoImportRejectedRow {
  row: number;
  sku: string;
  supplier: string;
  po: unknown;
  reason: string;
}

export interface PoImportResult {
  total: number;
  updated: number;
  created: number;
  rejected: number;
  rejected_rows: PoImportRejectedRow[];
  report_url: string | null;
}

/** PV from a simulation line — EUR pivot + USD/RMB via that simulation's FX. */
export interface CatalogPv {
  pv_eur: string;
  pv_usd: string | null;
  pv_rmb: string | null;
  simulation_id: string;
}

/** Compact shape returned by the list endpoint */
export interface Product {
  id: string;
  sku_code: string;
  name: string;
  universe: string;
  family: string;
  range?: string;
  sub_range?: string;
  brand?: string;
  gtin?: string;
  hs_code?: string;
  odoo_id?: number;
  is_active: boolean;
  is_copper_indexed?: boolean;
  pamp_eur?: string;
  stock_quantity?: string;
  /** List endpoint returns the active supplier name as a plain string */
  active_supplier?: string;
  /** Multilingual coverage of the product content (CDC §10.7.3). */
  i18n_coverage?: I18nCoverage;
  /** Dynamic attribute values keyed by attribute code (when requested via attr_columns). */
  attribute_values?: Record<string, unknown>;
  /** Present when a simulation line with PV exists (see `simulation_id` query param). */
  catalog_pv?: CatalogPv | null;
  /** Per-product fill rate (%) over the tracked field set (FEEDBACK 1). */
  completeness_pct?: number | null;
  updated_at?: string;
}

/** Multilingual coverage summary attached to product payloads. */
export interface I18nCoverage {
  languages: string[];
  percent: number;
  complete: boolean;
}

/** Full shape returned by the detail endpoint */
export interface ProductDetail extends Omit<Product, "active_supplier"> {
  item_code?: string;
  parent_reference?: string;
  factory_code?: string;
  description_marketing?: Record<string, string>;
  description_technical?: Record<string, string>;
  dop_number?: string;
  copper_weight_kg_per_unit?: string;
  base_unit?: string;
  uom?: string;
  primary_packaging_qty?: number;
  secondary_packaging_qty?: number;
  tertiary_packaging_qty?: number;
  pallet_qty?: number;
  unit_weight_kg?: string;
  supply_policy?: string;
  is_stockable?: boolean;
  pamp_synced_at?: string;
  odoo_last_sync_at?: string;
  migration_source?: string;
  created_at?: string;
  suppliers: ProductSupplier[];
}

// ─── Dynamic attributes (EAV registry + per-product values, CDC §4.5) ───────

export type AttributeCategory =
  | "structural"
  | "technical"
  | "marketing"
  | "commercial"
  | "logistic";

export type AttributeDataType = "text" | "number" | "boolean" | "date" | "select" | "multiselect";

/** One choice for a select / multiselect attribute. */
export interface AttributeOption {
  value: string;
  label: Record<string, string>;
}

/** An attribute definition from the registry. */
export interface AttributeRegistry {
  id: string;
  code: string;
  label: Record<string, string>;
  category: AttributeCategory;
  data_type: AttributeDataType;
  options: AttributeOption[] | null;
  unit: string;
  is_required: boolean;
  is_searchable: boolean;
  /** Exposed as a catalog sidebar filter (CDC §4.1.1). */
  is_filterable?: boolean;
  /** Default value applied to all existing products on attribute creation. */
  default_value?: unknown;
  display_order: number;
  /** Count of product values using this attribute (for cascade-delete warning). */
  value_count?: number;
  created_at?: string;
  updated_at?: string;
}

/**
 * A value set on a product for a given attribute.
 * `value` is the raw JSON payload whose shape depends on the attribute's
 * data_type (string | number | boolean | "YYYY-MM-DD" | string[]).
 */
export interface ProductAttributeValue {
  id: string;
  product: string;
  attribute: string;
  attribute_code: string;
  value: unknown;
  created_at?: string;
  updated_at?: string;
}

/** Generic DRF LimitOffset pagination envelope. */
export interface PaginatedResponse<T> {
  count: number;
  next?: string;
  previous?: string;
  results: T[];
}

export interface PaginatedProducts {
  count: number;
  next?: string;
  previous?: string;
  results: Product[];
}

export type SimulationStatus = "draft" | "finalized" | "archived";
export type SimulationType = "tariff" | "project";

/** Compact shape from the list endpoint. */
export interface Simulation {
  id: string;
  label: string;
  simulation_type: SimulationType;
  status: SimulationStatus;
  project_name: string;
  is_dirty: boolean;
  last_calculated_at: string | null;
  stock_purchase_mix_pct: number;
  symea_margin_rate: string;
  syskern_margin_rate: string;
  sale_incoterm?: string;
  sale_incoterm_location?: string;
  line_count: number;
  created_at: string;
  updated_at: string;
}

export type SimulationLineStatus = "ok" | "pending" | "warning" | "error" | "dirty";

export interface SimulationLine {
  id: string;
  simulation: string;
  product: string;
  product_sku: string;
  product_name: string;
  product_designation: string;
  product_range: string | null;
  product_stock: string | null;
  product_pamp_eur: string | null;
  margin_override: string | null;
  stock_purchase_mix_pct_override: number | null;
  quantity: string | null;
  force_manual_mix: boolean;
  pa_coefficient_override: string | null;
  po_net_eur: string | null;
  pa_net_eur: string | null;
  pamp_predictive_eur: string | null;
  pr_eur: string | null;
  pv_eur: string | null;
  /** PV just before the latest successful recalculation (FEEDBACK 2). */
  previous_pv_eur: string | null;
  pv_total_eur: string | null;
  effective_margin_rate: string | null;
  effective_mix_pct: number | null;
  calculation_breakdown?: Record<string, unknown>;
  supplier_snapshot?: Record<string, unknown>;
  status: SimulationLineStatus;
  last_calculated_at: string | null;
}

/** Recalc scopes (FEEDBACK 2: primary button = params_only; menu = advanced). */
export type RecalcScope = "params_only" | "with_odoo_refresh" | "full_refresh";

/** One frozen per-SKU result inside a recalc trace (CDC §6.9.12). */
export interface RecalculationLineSnapshot {
  product_id: string;
  sku: string;
  designation: string;
  pa_net_eur: string | null;
  pr_eur: string | null;
  pv_eur: string | null;
  effective_margin_rate: string | null;
  effective_mix_pct: number | null;
  status: string;
}

/** One row of the recalculation audit trail (CDC §6.9.12). */
export interface Recalculation {
  id: string;
  simulation: string;
  calculated_at: string;
  trigger_type: string;
  note: string;
  odoo_snapshot_at: string | null;
  stock_purchase_mix_pct: number;
  syskern_margin_rate: string;
  symea_margin_rate: string;
  sale_incoterm?: string;
  sale_incoterm_location?: string;
  market_params: Record<string, unknown>;
  calculation_chain: Record<string, unknown>;
  aggregates: SimulationAggregates;
  /** Present on the detail endpoint (frozen per-SKU results). */
  line_snapshots?: RecalculationLineSnapshot[];
}

/** Aggregates shared by recalc traces and compare columns (CDC §6.9.8/§6.9.12). */
export interface SimulationAggregates {
  line_count?: number;
  avg_pa_eur?: string | null;
  avg_pr_eur?: string | null;
  avg_pv_eur?: string | null;
  avg_margin?: string | null;
  min_pv_eur?: string | null;
  max_pv_eur?: string | null;
  warnings_count?: number;
  errors_count?: number;
}

/** Frozen context for a compare column (params, chain summary, dates). */
export interface CompareColumnContext {
  market_params: Record<string, unknown>;
  stock_purchase_mix_pct: number;
  symea_margin_rate: string;
  syskern_margin_rate: string;
  symea_margin_position: string;
  sale_incoterm: string;
  sale_incoterm_location: string;
  simulation_type: SimulationType | null;
  calculated_at: string | null;
  odoo_snapshot_at: string | null;
  trigger_type: string | null;
  chain_module_count: number;
  note: string | null;
}

/** One comparison column (a live simulation or a frozen recalc snapshot). */
export interface CompareColumn {
  key: string;
  type: "simulation" | "recalculation";
  id: string;
  simulation_id: string;
  label: string;
  status: SimulationStatus | null;
  aggregates: SimulationAggregates;
  context: CompareColumnContext;
}

/** One cell of the compare matrix. */
export interface CompareCell {
  pa_net_eur: string | null;
  pr_eur: string | null;
  pv_eur: string | null;
  effective_margin_rate: string | null;
  effective_mix_pct: number | null;
}

/** One SKU row of the compare matrix. */
export interface CompareProduct {
  product_id: string;
  product_sku: string;
  product_name: string;
  values: Record<string, CompareCell>;
}

export interface CompareResponse {
  columns: CompareColumn[];
  products: CompareProduct[];
}

export interface SavedComparisonColumn {
  type: "simulation" | "recalculation";
  id: string;
  label: string;
  simulation_id: string | null;
}

export interface SavedComparison {
  id: string;
  label: string;
  simulation_ids: string[];
  recalculation_ids: string[];
  note: string;
  column_count: number;
  columns: SavedComparisonColumn[];
  created_at: string;
  updated_at: string;
}

/** Cumulative filter for bulk-edit / preview (CDC §6.9.5) — same product dimensions as the catalogue. */
export type BulkEditFilter = Partial<CatalogFilters> & {
  has_warning?: boolean;
  has_error?: boolean;
  /** Comma-separated statuses: ok, warning, error, dirty, pending. */
  status_in?: string;
  /** Scope bulk actions to explicit simulation line ids. */
  line_ids?: string[];
};

/** Full shape from the detail endpoint (includes nested lines). */
export interface SimulationDetail extends Simulation {
  client_ids: string[];
  market_params: Record<string, unknown>;
  calculation_chain: Record<string, unknown>;
  odoo_snapshot_at: string | null;
  lines: SimulationLine[];
  /** Present (degraded mode) when a refresh recalc could not reach Odoo. */
  odoo_refresh_error?: string;
}

export interface PaginatedSimulations {
  count: number;
  next?: string;
  previous?: string;
  results: Simulation[];
}

/** Sidebar filter state for the simulations list. */
export interface SimulationFilters {
  q?: string;
  simulation_type?: SimulationType[];
  status?: SimulationStatus[];
  /** True = recalcul nécessaire uniquement. */
  is_dirty?: boolean;
}

export interface SimulationListParams extends SimulationFilters {
  ordering?: string;
  page?: number;
  limit?: number;
  /** When false, list only draft + finalized (excludes archived). */
  includeArchived?: boolean;
}

export function buildSimulationQuery(filters: SimulationFilters): Record<string, string> {
  const params: Record<string, string> = {};
  if (filters.q?.trim()) params.q = filters.q.trim();
  if (filters.simulation_type?.length) {
    params.simulation_type = filters.simulation_type.join(",");
  }
  if (filters.status?.length) params.status = filters.status.join(",");
  if (filters.is_dirty === true) params.is_dirty = "true";
  return params;
}

function resolveSimulationListFilters(params: SimulationListParams): SimulationFilters {
  if (params.includeArchived === false && !params.status?.length) {
    return { ...params, status: ["draft", "finalized"] };
  }
  const { includeArchived: _omit, ordering: _o, page: _p, limit: _l, ...filters } = params;
  return filters;
}

export function getSimulationsList(
  params: SimulationListParams = {},
): Promise<PaginatedSimulations> {
  const filters = resolveSimulationListFilters(params);
  const q = new URLSearchParams(buildSimulationQuery(filters));
  const limit = params.limit ?? 50;
  const page = params.page ?? 1;
  const offset = (page - 1) * limit;
  if (params.ordering) q.set("ordering", params.ordering);
  q.set("limit", String(limit));
  q.set("offset", String(offset));
  return apiFetch<PaginatedSimulations>(`/api/simulations/?${q.toString()}`);
}

export function getSimulations(opts?: { includeArchived?: boolean }): Promise<Simulation[]> {
  return getSimulationsList({ includeArchived: opts?.includeArchived, limit: 200 }).then(
    (r) => r.results,
  );
}

export interface CreateSimulationInput {
  label: string;
  simulation_type: SimulationType;
  project_name?: string;
  client_ids?: string[];
  stock_purchase_mix_pct?: number;
  symea_margin_rate?: string;
  syskern_margin_rate?: string;
  market_params?: Record<string, unknown>;
  calculation_chain?: Record<string, unknown>;
  sale_incoterm?: string;
  sale_incoterm_location?: string;
}

export type UpdateSimulationInput = Partial<CreateSimulationInput>;

/** Client (Odoo-synced customer or local prospect) — CDC §3.2. */
export interface Client {
  id: string;
  name: string;
  email: string;
  is_prospect: boolean;
  segment?: string;
  address_city?: string;
  address_country?: string;
}

/** Response shape from `POST /api/products/lookup-bulk` (CDC §6.9.2). */
export interface BulkLookupResult {
  found: Array<{ id: string; sku_code: string; name: string }>;
  not_found: string[];
}

export type MarketParameterType = "copper_price" | "fx_rate";
export type CopperMarket = "LME" | "SHE";

export interface MarketParameter {
  id: string;
  parameter_type: MarketParameterType;
  valid_from: string;
  valid_to: string | null;
  is_active: boolean;
  notes?: string;
  source?: string;
  // Copper-only
  copper_market?: CopperMarket | null;
  copper_price?: string | null;
  copper_currency?: string | null;
  copper_unit?: string | null;
  // FX-only
  fx_from_currency?: string | null;
  fx_to_currency?: string | null;
  fx_rate?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface TransportMode {
  id: string;
  code: string;
  label: Record<string, string>;
  category: "maritime" | "road" | "air" | "rail";
  default_pallet_capacity?: number | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface IncotermRef {
  code: string;
  label: Record<string, string>;
}

export interface SyncLog {
  id: string;
  sync_type: string;
  scope: string;
  odoo_api_version: string;
  started_at: string;
  completed_at: string | null;
  status: "running" | "success" | "partial_failure" | "failed";
  items_created: number;
  items_updated: number;
  items_failed: number;
  errors: Array<{ item_id: string | null; error_message: string }>;
  triggered_by: string;
  created_at?: string;
  updated_at?: string;
}

export interface SyncStatus {
  last: SyncLog | null;
  running: SyncLog | null;
}

export function getProducts(params?: ProductListParams): Promise<PaginatedProducts> {
  const q = new URLSearchParams(buildCatalogQuery(params ?? {}));
  const limit = params?.limit ?? 20;
  const page = params?.page ?? 1;
  const offset = (page - 1) * limit;
  if (params?.ordering) q.set("ordering", params.ordering);
  if (params?.simulation_id) q.set("simulation_id", params.simulation_id);
  q.set("limit", String(limit));
  q.set("offset", String(offset));
  return apiFetch<PaginatedProducts>(`/api/products/?${q.toString()}`);
}

export type CatalogListParams = ProductListParams;

/** Paginated catalog list with full sidebar filter support. */
export function getCatalogProducts(params: CatalogListParams): Promise<PaginatedProducts> {
  return getProducts(params);
}

const CATALOG_BULK_FETCH_LIMIT = 500;

/** Fetch every product matching the given filters (paginates at API max limit). */
export async function fetchAllCatalogProducts(
  params: Omit<CatalogListParams, "page" | "limit">,
): Promise<Product[]> {
  const all: Product[] = [];
  let page = 1;
  let total = Infinity;
  while (all.length < total) {
    const res = await getCatalogProducts({ ...params, page, limit: CATALOG_BULK_FETCH_LIMIT });
    total = res.count;
    all.push(...res.results);
    if (res.results.length === 0) break;
    page += 1;
  }
  return all;
}

/** @deprecated Alias — prefer `buildCatalogQuery`. */
export function catalogFiltersToParams(f: CatalogFilters): Record<string, string> {
  return buildCatalogQuery(f);
}

export interface CatalogFilterBounds {
  pamp_eur: { min: number | null; max: number | null };
  stock_quantity: { min: number | null; max: number | null };
  attributes: Record<string, { min: number; max: number }>;
}

/** Min/max for numeric filters, scoped to current facet context (excludes range sliders). */
export function getCatalogFilterBounds(filters: CatalogFilters = {}): Promise<CatalogFilterBounds> {
  const { pamp_min: _a, pamp_max: _b, stock_min: _c, attrs: _attrs, ...facet } = filters;
  const q = new URLSearchParams(buildCatalogQuery(facet));
  return apiFetch<CatalogFilterBounds>(`/api/products/filter-bounds?${q.toString()}`);
}

/** Trigger an async Excel export (Celery task), then download the file.
 *  Accepts the simple {search, universe} shape (catalog header) or the rich
 *  {filters, columns, ids} shape (export modal). */
export async function exportProducts(opts?: {
  search?: string;
  universe?: string;
  filters?: CatalogFilters;
  columns?: string[];
  ids?: string[];
}): Promise<void> {
  const body: Record<string, unknown> = {};
  if (opts?.filters) {
    body.filters = buildCatalogQuery(opts.filters);
  } else if (opts?.search || opts?.universe) {
    const filters: Record<string, string> = {};
    if (opts.search) filters.q = opts.search;
    if (opts.universe) filters.universe = opts.universe;
    body.filters = filters;
  }
  if (opts?.columns) body.columns = opts.columns;
  if (opts?.ids) body.ids = opts.ids;

  const result = await dispatchAndPoll<{ file_url: string; filename: string }>(
    `/api/products/export/`,
    { method: "POST", body: JSON.stringify(body) },
    { timeoutMs: 180_000 },
  );
  // Trigger the browser download via a short-lived anchor.
  const a = document.createElement("a");
  a.href = result.file_url;
  a.download = result.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Distinct universe values actually present in the catalog (CDC §4.4). */
export function getUniverses(): Promise<string[]> {
  return apiFetch<{ level: string; values: string[] }>(
    "/api/hierarchy/distinct?level=universe",
  ).then((r) => r.values);
}

export function getProduct(sku: string): Promise<ProductDetail> {
  return apiFetch<ProductDetail>(`/api/products/${encodeURIComponent(sku)}/`);
}

export interface PriceHistoryPoint {
  date: string;
  pa_eur: string | null;
  pr_eur: string | null;
  pv_eur: string | null;
  pv_usd?: string | null;
  pv_rmb?: string | null;
  simulation_id: string;
  simulation_label: string;
}

export interface PriceHistory {
  period: string;
  points: PriceHistoryPoint[];
}

/** Trailing PA/PR/PV points from finalized simulations (CDC §4.1.6). */
export function getPriceHistory(
  sku: string,
  period: "3m" | "6m" | "12m" = "6m",
): Promise<PriceHistory> {
  return apiFetch<PriceHistory>(
    `/api/products/${encodeURIComponent(sku)}/price-history/?period=${period}`,
  );
}

/** Re-pull this product's PAMP + stock from Odoo (Celery task). */
export function refreshPamp(sku: string): Promise<ProductDetail> {
  return dispatchAndPoll<ProductDetail>(
    `/api/products/${encodeURIComponent(sku)}/refresh-pamp/`,
    { method: "POST" },
    { timeoutMs: 60_000 },
  );
}

/** Translate the FR descriptions to EN/ES via DeepL (Celery task). */
export function translateProduct(sku: string, targetLang: "en" | "es"): Promise<ProductDetail> {
  return dispatchAndPoll<ProductDetail>(
    `/api/products/${encodeURIComponent(sku)}/translate/`,
    { method: "POST", body: JSON.stringify({ target_lang: targetLang }) },
    { timeoutMs: 60_000 },
  );
}

/** Result payload of the bulk product-translation task (CDC §10.3.2). */
export interface BulkTranslateResult {
  product_count: number;
  processed: number;
  translated_fields: number;
  skipped: string[];
}

/** Dispatch the bulk product-translation Celery task; returns the task id. */
export function startBulkTranslate(body: {
  ids: string[];
  source_lang?: string;
  target_langs: string[];
  content_fields?: string[];
}): Promise<{ task_id: string; product_count: number }> {
  return apiFetch("/api/products/bulk-translate/", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** One product missing content in an offer's target language(s) (CDC §10.5.1). */
export interface OfferCoverageProduct {
  id: string;
  sku_code: string;
  designation: string;
  missing_langs: string[];
}

export interface OfferCoverage {
  languages: string[];
  products: OfferCoverageProduct[];
  product_ids: string[];
}

/** Pre-generation i18n coverage check for an offer's target language(s). */
export function checkOfferCoverage(
  simulationId: string,
  body: { language?: string; client_ids?: string[]; language_per_client?: boolean },
): Promise<OfferCoverage> {
  return apiFetch<OfferCoverage>(
    `/api/simulations/${encodeURIComponent(simulationId)}/offer-coverage-check/`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

/** Translate a single string on the fly via DeepL + cache (CDC §10.4.2). */
export function translateText(
  text: string,
  targetLang: "fr" | "en" | "es",
  sourceLang: "fr" | "en" | "es" = "fr",
): Promise<{ translated_text: string; from_cache: boolean }> {
  return apiFetch<{ translated_text: string; from_cache: boolean }>("/api/translate", {
    method: "POST",
    body: JSON.stringify({ text, source_lang: sourceLang, target_lang: targetLang }),
  });
}

/** Partially update a product's core fields (CDC §4.3 — édition en place). */
export function updateProduct(
  idOrSku: string,
  patch: Partial<ProductDetail>,
): Promise<ProductDetail> {
  return apiFetch<ProductDetail>(`/api/products/${encodeURIComponent(idOrSku)}/`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/** Attribute values currently set on a product (plain array, not paginated). */
export function getProductAttributes(idOrSku: string): Promise<ProductAttributeValue[]> {
  return apiFetch<ProductAttributeValue[]>(
    `/api/products/${encodeURIComponent(idOrSku)}/attributes/`,
  );
}

/** Attribute registry definitions, optionally filtered by category. */
export function getAttributeRegistry(category?: AttributeCategory): Promise<AttributeRegistry[]> {
  const q = new URLSearchParams({ limit: "500" });
  if (category) q.set("category", category);
  return apiFetch<PaginatedResponse<AttributeRegistry>>(`/api/attributes/?${q.toString()}`).then(
    (r) => r.results,
  );
}

/** One field's fill rate across the active catalog (FEEDBACK 1). */
export interface CompletenessField {
  key: string; // core field name, or `attr:<uuid>` for a dynamic attribute
  label: string;
  kind: "core" | "attribute";
  group: string;
  filled: number;
  missing: number;
  percent: number;
}

export interface AttributeCompleteness {
  total_products: number;
  average_percent: number;
  fields: CompletenessField[]; // sorted least-complete first
}

/** Catalog-wide attribute completeness (core columns + dynamic attributes). */
export function getAttributeCompleteness(): Promise<AttributeCompleteness> {
  return apiFetch<AttributeCompleteness>("/api/products/attribute-completeness/");
}

/** Upsert one attribute value on a product (PUT, body `{value}`). */
export function setProductAttribute(
  productId: string,
  attributeId: string,
  value: unknown,
): Promise<ProductAttributeValue> {
  return apiFetch<ProductAttributeValue>(
    `/api/products/${encodeURIComponent(productId)}/attributes/${encodeURIComponent(attributeId)}/`,
    { method: "PUT", body: JSON.stringify({ value }) },
  );
}

/** List clients, optionally filtered by a search term (CDC §6.9.2 step 1). */
export function getClients(search?: string): Promise<Client[]> {
  const q = new URLSearchParams({ limit: "200" });
  if (search) q.set("search", search);
  return apiFetch<PaginatedResponse<Client>>(`/api/clients/?${q.toString()}`).then(
    (r) => r.results,
  );
}

export function getClient(id: string): Promise<Client> {
  return apiFetch<Client>(`/api/clients/${encodeURIComponent(id)}/`);
}

/** Resolve client labels for pre-selected IDs (e.g. simulation edit). */
export async function getClientsByIds(ids: string[]): Promise<Client[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const results = await Promise.all(
    unique.map(async (id) => {
      try {
        return await getClient(id);
      } catch {
        return null;
      }
    }),
  );
  return results.filter((c): c is Client => c !== null);
}

/** Resolve a batch of SKU codes into found products vs not-found codes. */
export function lookupBulkProducts(skus: string[]): Promise<BulkLookupResult> {
  return apiFetch<BulkLookupResult>("/api/products/lookup-bulk", {
    method: "POST",
    body: JSON.stringify({ skus }),
  });
}

export function getSimulation(id: string): Promise<SimulationDetail> {
  return apiFetch<SimulationDetail>(`/api/simulations/${encodeURIComponent(id)}/`);
}

export function createSimulation(data: CreateSimulationInput): Promise<SimulationDetail> {
  return apiFetch<SimulationDetail>("/api/simulations/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateSimulation(
  id: string,
  data: UpdateSimulationInput,
): Promise<SimulationDetail> {
  return apiFetch<SimulationDetail>(`/api/simulations/${encodeURIComponent(id)}/`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteSimulation(id: string): Promise<void> {
  return apiFetch<void>(`/api/simulations/${encodeURIComponent(id)}/`, {
    method: "DELETE",
  });
}

/** Attach products to a simulation (creates lines). */
export interface AddSimulationLineItem {
  product_id: string;
  quantity?: string | null;
}

export function addSimulationLines(
  id: string,
  payload: string[] | AddSimulationLineItem[],
): Promise<{ added: number }> {
  const body =
    payload.length > 0 && typeof payload[0] === "string"
      ? { product_ids: payload as string[] }
      : { items: payload as AddSimulationLineItem[] };
  return apiFetch<{ added: number }>(`/api/simulations/${encodeURIComponent(id)}/lines/`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateSimulationLine(
  lineId: string,
  patch: {
    margin_override?: string | null;
    stock_purchase_mix_pct_override?: number | null;
    quantity?: string | null;
    force_manual_mix?: boolean;
    pa_coefficient_override?: string | null;
  },
): Promise<SimulationLine> {
  return apiFetch<SimulationLine>(`/api/simulation-lines/${encodeURIComponent(lineId)}/`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteSimulationLine(lineId: string): Promise<void> {
  return apiFetch<void>(`/api/simulation-lines/${encodeURIComponent(lineId)}/`, {
    method: "DELETE",
  });
}

/** Force a full recalculation (CDC §6.9.4) — dispatches a Celery task and polls. */
export function recalculateSimulation(
  id: string,
  body?: { scope?: RecalcScope; market_params?: Record<string, unknown>; note?: string },
): Promise<SimulationDetail> {
  return dispatchAndPoll<SimulationDetail>(
    `/api/simulations/${encodeURIComponent(id)}/recalculate/`,
    { method: "POST", body: JSON.stringify(body ?? {}) },
    { timeoutMs: 300_000 },
  );
}

/** Recalculate a single line synchronously (CDC §6.9.5) — no audit trace. */
export function recalculateSimulationLine(lineId: string): Promise<SimulationLine> {
  return apiFetch<SimulationLine>(
    `/api/simulation-lines/${encodeURIComponent(lineId)}/recalculate/`,
    { method: "POST" },
  );
}

export interface SimulationLineQuery extends CatalogFilters {
  simulation: string;
  /** @deprecated Prefer `status_in` — kept for backward compatibility. */
  has_warning?: boolean;
  /** @deprecated Prefer `status_in` — kept for backward compatibility. */
  has_error?: boolean;
  /** Comma-separated statuses: ok, warning, error */
  status_in?: string;
  ordering?: string;
  page?: number;
  limit?: number;
}

/** Paginated lines for the results table (filters + ordering, CDC §6.9.9). */
export function getSimulationLines(
  params: SimulationLineQuery,
): Promise<PaginatedResponse<SimulationLine>> {
  const limit = params.limit ?? 200;
  const page = params.page ?? 1;
  const {
    simulation,
    status_in,
    has_warning,
    has_error,
    ordering,
    page: _p,
    limit: _l,
    ...catalogFilters
  } = params;
  const q = new URLSearchParams({
    simulation,
    limit: String(limit),
    offset: String((page - 1) * limit),
  });
  if (status_in) q.set("status_in", status_in);
  if (has_warning) q.set("has_warning", "true");
  if (has_error) q.set("has_error", "true");
  for (const [key, value] of Object.entries(buildCatalogQuery(catalogFilters))) {
    q.set(key, value);
  }
  if (ordering) q.set("ordering", ordering);
  return apiFetch<PaginatedResponse<SimulationLine>>(`/api/simulation-lines/?${q.toString()}`);
}

/** Count the lines a bulk-edit filter would touch (no mutation). */
export function bulkEditPreview(id: string, filter: BulkEditFilter): Promise<{ count: number }> {
  return apiFetch<{ count: number }>(
    `/api/simulations/${encodeURIComponent(id)}/lines/bulk/preview/`,
    { method: "POST", body: JSON.stringify({ filter }) },
  );
}

/** Apply a bulk-edit action to the filtered lines (CDC §6.9.5). */
export function bulkEditLines(
  id: string,
  body: {
    filter: BulkEditFilter;
    margin_override?: string | null;
    stock_purchase_mix_pct_override?: number | null;
    quantity?: string | null;
    force_manual_mix?: boolean;
    pa_coefficient_override?: string | null;
    reset?: boolean;
  },
): Promise<{ updated: number }> {
  return apiFetch<{ updated: number }>(`/api/simulations/${encodeURIComponent(id)}/lines/bulk/`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Remove lines from a simulation (by ids or cumulative filter). */
export function bulkDeleteSimulationLines(
  id: string,
  body: { filter?: BulkEditFilter; line_ids?: string[] },
): Promise<{ deleted: number }> {
  return apiFetch<{ deleted: number }>(
    `/api/simulations/${encodeURIComponent(id)}/lines/bulk-delete/`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

/** Paginated recalculation history of a simulation, DESC (CDC §6.9.12). */
export function getRecalculations(
  id: string,
  opts?: { limit?: number; offset?: number },
): Promise<PaginatedResponse<Recalculation>> {
  const q = new URLSearchParams();
  q.set("limit", String(opts?.limit ?? 10));
  if (opts?.offset) q.set("offset", String(opts.offset));
  return apiFetch<PaginatedResponse<Recalculation>>(
    `/api/simulations/${encodeURIComponent(id)}/recalculations/?${q.toString()}`,
  );
}

/** Full detail of a single recalc trace, incl. frozen line snapshots. */
export function getRecalculation(simId: string, recalcId: string): Promise<Recalculation> {
  return apiFetch<Recalculation>(
    `/api/simulations/${encodeURIComponent(simId)}/recalculations/${encodeURIComponent(recalcId)}/`,
  );
}

/** Compare 2-4 simulations and/or recalc snapshots (CDC §6.9.8). */
export function compareSimulations(body: {
  simulation_ids?: string[];
  recalculation_ids?: string[];
}): Promise<CompareResponse> {
  return apiFetch<CompareResponse>("/api/simulations/compare", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * What-if comparison (legacy API — no UI since 2026-07-15).
 * Prefer editing market params from Compare → Paramètres → Modifier
 * (`CompareSimulationParamsSheet` + params_only recalc; fork if finalized).
 * See docs/agent/decisions.md § 2026-07-15 and pricing-chain.md § Compare.
 */
export function compareSimulationsWhatIf(body: {
  simulation_ids?: string[];
  recalculation_ids?: string[];
  market_params_override: Record<string, string>;
}): Promise<CompareResponse> {
  return apiFetch<CompareResponse>("/api/simulations/compare/what-if", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getSavedComparisons(): Promise<SavedComparison[]> {
  return getComparisonsList({ limit: 500 }).then((r) => r.results);
}

export interface ComparisonListParams {
  q?: string;
  ordering?: string;
  page?: number;
  limit?: number;
  /** true → only comparisons with recalculation columns; false → sim-only. */
  has_recalculations?: boolean;
  /** Keep comparisons referencing at least one sim of these types. */
  sim_type?: ("tariff" | "project")[];
}

export type PaginatedComparisons = PaginatedResponse<SavedComparison>;

export function getComparisonsList(
  params: ComparisonListParams = {},
): Promise<PaginatedComparisons> {
  const limit = params.limit ?? 50;
  const page = params.page ?? 1;
  const offset = (page - 1) * limit;
  const q = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  if (params.q?.trim()) q.set("q", params.q.trim());
  if (params.ordering) q.set("ordering", params.ordering);
  if (params.has_recalculations != null)
    q.set("has_recalculations", String(params.has_recalculations));
  if (params.sim_type?.length) q.set("sim_type", params.sim_type.join(","));
  return apiFetch<PaginatedComparisons>(`/api/saved-comparisons/?${q.toString()}`);
}

export function getSavedComparison(id: string): Promise<SavedComparison> {
  return apiFetch<SavedComparison>(`/api/saved-comparisons/${encodeURIComponent(id)}/`);
}

export function createSavedComparison(body: {
  label: string;
  simulation_ids: string[];
  recalculation_ids?: string[];
  note?: string;
}): Promise<SavedComparison> {
  return apiFetch<SavedComparison>("/api/saved-comparisons/", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateSavedComparison(
  id: string,
  body: {
    label?: string;
    note?: string;
    simulation_ids?: string[];
    recalculation_ids?: string[];
  },
): Promise<SavedComparison> {
  return apiFetch<SavedComparison>(`/api/saved-comparisons/${encodeURIComponent(id)}/`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteSavedComparison(id: string): Promise<void> {
  return apiFetch<void>(`/api/saved-comparisons/${encodeURIComponent(id)}/`, {
    method: "DELETE",
  });
}

/** Trigger an async Excel export (Celery task), then download the file (CDC §6.9). */
export async function exportSimulation(id: string): Promise<void> {
  const result = await dispatchAndPoll<{ file_url: string; filename: string }>(
    `/api/simulations/${encodeURIComponent(id)}/export/`,
    { method: "POST" },
    { timeoutMs: 180_000 },
  );
  const a = document.createElement("a");
  a.href = result.file_url;
  a.download = result.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function finalizeSimulation(id: string): Promise<SimulationDetail> {
  return apiFetch<SimulationDetail>(`/api/simulations/${encodeURIComponent(id)}/finalize/`, {
    method: "POST",
  });
}

export function duplicateSimulation(id: string, label?: string): Promise<SimulationDetail> {
  return apiFetch<SimulationDetail>(`/api/simulations/${encodeURIComponent(id)}/duplicate/`, {
    method: "POST",
    body: JSON.stringify(label ? { label } : {}),
  });
}

export function archiveSimulation(id: string): Promise<SimulationDetail> {
  return apiFetch<SimulationDetail>(`/api/simulations/${encodeURIComponent(id)}/archive/`, {
    method: "POST",
  });
}

export function unarchiveSimulation(id: string): Promise<SimulationDetail> {
  return apiFetch<SimulationDetail>(`/api/simulations/${encodeURIComponent(id)}/unarchive/`, {
    method: "POST",
  });
}

// ── Market parameters (settings) ─────────────────────────────────────────
export function listMarketParameters(filter?: {
  type?: MarketParameterType;
  activeOnly?: boolean;
  copperMarket?: CopperMarket;
}): Promise<MarketParameter[]> {
  const q = new URLSearchParams();
  if (filter?.type) q.set("parameter_type", filter.type);
  if (filter?.activeOnly) q.set("is_active", "true");
  if (filter?.copperMarket) q.set("copper_market", filter.copperMarket);
  q.set("limit", "200");
  const qs = q.toString();
  return apiFetch<{ count: number; results: MarketParameter[] }>(
    `/api/market-parameters/${qs ? "?" + qs : ""}`,
  ).then((r) => r.results);
}

export function createMarketParameter(data: Partial<MarketParameter>): Promise<MarketParameter> {
  return apiFetch<MarketParameter>("/api/market-parameters/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateMarketParameter(
  id: string,
  patch: Partial<MarketParameter>,
): Promise<MarketParameter> {
  return apiFetch<MarketParameter>(`/api/market-parameters/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteMarketParameter(id: string): Promise<void> {
  return apiFetch<void>(`/api/market-parameters/${id}/`, { method: "DELETE" });
}

export function getCurrentMarketParameter(opts: {
  parameter_type: MarketParameterType;
  fx_from_currency?: string;
  fx_to_currency?: string;
  copper_market?: CopperMarket;
}): Promise<MarketParameter> {
  const q = new URLSearchParams({ parameter_type: opts.parameter_type });
  if (opts.fx_from_currency) q.set("fx_from_currency", opts.fx_from_currency);
  if (opts.fx_to_currency) q.set("fx_to_currency", opts.fx_to_currency);
  if (opts.copper_market) q.set("copper_market", opts.copper_market);
  return apiFetch<MarketParameter>(`/api/market-parameters/current/?${q.toString()}`);
}

// Back-compat alias kept for any older callers; prefer listMarketParameters.
export function getMarketParameters(): Promise<MarketParameter[]> {
  return listMarketParameters({ activeOnly: true });
}

// ── Transport modes ──────────────────────────────────────────────────────
export function listIncoterms(): Promise<IncotermRef[]> {
  return apiFetch<{ incoterms: IncotermRef[] }>("/api/incoterms").then((r) => r.incoterms);
}

export function listTransportModes(activeOnly = false): Promise<TransportMode[]> {
  const qs = activeOnly ? "?is_active=true" : "";
  return apiFetch<{ count: number; results: TransportMode[] }>(`/api/transport-modes/${qs}`).then(
    (r) => r.results,
  );
}

export function createTransportMode(data: Partial<TransportMode>): Promise<TransportMode> {
  return apiFetch<TransportMode>("/api/transport-modes/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateTransportMode(
  id: string,
  patch: Partial<TransportMode>,
): Promise<TransportMode> {
  return apiFetch<TransportMode>(`/api/transport-modes/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteTransportMode(id: string): Promise<void> {
  return apiFetch<void>(`/api/transport-modes/${id}/`, { method: "DELETE" });
}

// ── Transport presets ────────────────────────────────────────────────────
export interface TransportPreset {
  id: string;
  name: string;
  transport_mode_code: string;
  category: TransportMode["category"];
  global_cost: string;
  currency: string;
  pallet_count: string;
  from_location: string;
  to_location: string;
  display_order: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export function listTransportPresets(opts?: { activeOnly?: boolean }): Promise<TransportPreset[]> {
  const q = new URLSearchParams();
  if (opts?.activeOnly) q.set("is_active", "true");
  const qs = q.toString();
  return apiFetch<{ count: number; results: TransportPreset[] }>(
    `/api/transport-presets/${qs ? `?${qs}` : ""}`,
  ).then((r) => r.results);
}

export function createTransportPreset(data: Partial<TransportPreset>): Promise<TransportPreset> {
  return apiFetch<TransportPreset>("/api/transport-presets/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateTransportPreset(
  id: string,
  patch: Partial<TransportPreset>,
): Promise<TransportPreset> {
  return apiFetch<TransportPreset>(`/api/transport-presets/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteTransportPreset(id: string): Promise<void> {
  return apiFetch<void>(`/api/transport-presets/${id}/`, { method: "DELETE" });
}

// ── Odoo sync (settings) ─────────────────────────────────────────────────
export function listSyncLogs(limit = 20): Promise<SyncLog[]> {
  return apiFetch<{ count: number; results: SyncLog[] }>(`/api/odoo/sync/logs?limit=${limit}`).then(
    (r) => r.results,
  );
}

export function getSyncStatus(): Promise<SyncStatus> {
  return apiFetch<SyncStatus>("/api/odoo/sync/status");
}

export function getOdooHealth(): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>("/api/odoo/health");
}

/** Trigger an async Odoo sync (Celery task). Returns the SyncLog row. */
export function triggerOdooSync(
  scope: "all" | "products" | "stock" | "clients" | "suppliers" | "purchases_sales" = "all",
  api_version: "v16" | "v19" = "v19",
): Promise<SyncLog> {
  return dispatchAndPoll<SyncLog>(
    "/api/odoo/sync/trigger",
    { method: "POST", body: JSON.stringify({ scope, api_version }) },
    { timeoutMs: 600_000 },
  );
}

// ── Product create / delete / suppliers / SKU parsing (CDC §4.1.3) ────────

/** Soft-delete a product (is_active = false). */
export function deleteProduct(idOrSku: string): Promise<void> {
  return apiFetch<void>(`/api/products/${encodeURIComponent(idOrSku)}/`, { method: "DELETE" });
}

/** Create a product (core fields); Odoo sync happens server-side, async. */
export function createProduct(payload: Partial<ProductDetail>): Promise<ProductDetail> {
  return apiFetch<ProductDetail>("/api/products/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Add a supplier source to a product. */
export function createSupplier(
  productId: string,
  input: ProductSupplierInput,
): Promise<ProductSupplier> {
  return apiFetch<ProductSupplier>(`/api/products/${encodeURIComponent(productId)}/suppliers/`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Partially update a supplier on a product. */
export function updateProductSupplier(
  productId: string,
  supplierId: string,
  input: Partial<ProductSupplierInput>,
): Promise<ProductSupplier> {
  return apiFetch<ProductSupplier>(
    `/api/products/${encodeURIComponent(productId)}/suppliers/${encodeURIComponent(supplierId)}/`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
}

/** Remove a supplier from a product. */
export function deleteProductSupplier(productId: string, supplierId: string): Promise<void> {
  return apiFetch<void>(
    `/api/products/${encodeURIComponent(productId)}/suppliers/${encodeURIComponent(supplierId)}/`,
    { method: "DELETE" },
  );
}

/** Set one supplier as active and deactivate the others on this product. */
export function activateProductSupplier(
  productId: string,
  supplierId: string,
): Promise<ProductSupplier> {
  return apiFetch<ProductSupplier>(
    `/api/products/${encodeURIComponent(productId)}/suppliers/${encodeURIComponent(supplierId)}/activate/`,
    { method: "POST" },
  );
}

export interface ParsedSku {
  sku: string;
  parent_reference: string | null;
  factory_code: string | null;
}

/** Derive parent_reference + factory_code from a SKU (wizard auto-fill). */
export function parseSku(sku: string): Promise<ParsedSku> {
  return apiFetch<ParsedSku>("/api/products/parse-sku/", {
    method: "POST",
    body: JSON.stringify({ sku }),
  });
}

// ── Distinct catalog facets (filters / wizard) ────────────────────────────

export type HierarchyLevel = "universe" | "family" | "range" | "sub_range";

/** Distinct values for a hierarchy level, optionally scoped by parent levels
 *  (cascade: family within a universe, range within universe+family, …). */
export function getHierarchyLevel(
  level: HierarchyLevel,
  parents?: { universe?: string | string[]; family?: string | string[]; range?: string | string[] },
): Promise<string[]> {
  const q = new URLSearchParams({ level });
  const setCsv = (key: string, val: string | string[] | undefined) => {
    if (!val || (Array.isArray(val) && !val.length)) return;
    q.set(key, Array.isArray(val) ? val.join(",") : val);
  };
  setCsv("universe", parents?.universe);
  setCsv("family", parents?.family);
  setCsv("range", parents?.range);
  return apiFetch<{ level: string; values: string[] }>(
    `/api/hierarchy/distinct?${q.toString()}`,
  ).then((r) => r.values);
}

/** Distinct brand values present in the catalog. */
export function getBrands(): Promise<string[]> {
  return apiFetch<{ values: string[] }>("/api/brands").then((r) => r.values);
}

/** Distinct supplier names across the catalog. */
export function getSupplierNames(): Promise<string[]> {
  return apiFetch<{ values: string[] }>("/api/supplier-names").then((r) => r.values);
}

/** Defaults for an existing supplier name (latest row), to pre-fill the form. */
export function getSupplierTemplate(name: string): Promise<ProductSupplier> {
  return apiFetch<ProductSupplier>(`/api/supplier-names/template?name=${encodeURIComponent(name)}`);
}

// ── Supplier entity CRUD + SKU links + batch PO import (module Fournisseurs) ──

/** List suppliers (entity). Reads the paginated results with a high cap. */
export function listSuppliers(opts?: {
  q?: string;
  is_active?: boolean;
  has_skus?: boolean;
}): Promise<Supplier[]> {
  const q = new URLSearchParams({ limit: "500", ordering: "name" });
  if (opts?.q) q.set("search", opts.q);
  if (opts?.is_active !== undefined) q.set("is_active", String(opts.is_active));
  if (opts?.has_skus !== undefined) q.set("has_skus", String(opts.has_skus));
  return apiFetch<{ results: Supplier[] }>(`/api/suppliers/?${q.toString()}`).then(
    (r) => r.results ?? [],
  );
}

export function getSupplier(id: string): Promise<Supplier> {
  return apiFetch<Supplier>(`/api/suppliers/${encodeURIComponent(id)}/`);
}

export function createSupplierEntity(input: SupplierInput): Promise<Supplier> {
  return apiFetch<Supplier>("/api/suppliers/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateSupplier(id: string, input: Partial<SupplierInput>): Promise<Supplier> {
  return apiFetch<Supplier>(`/api/suppliers/${encodeURIComponent(id)}/`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

/** Soft-delete a supplier. Rejects (409) with the FR detail when SKUs remain linked. */
export async function deleteSupplier(id: string): Promise<void> {
  const res = await fetch(`/api/suppliers/${encodeURIComponent(id)}/`, {
    method: "DELETE",
    credentials: "include",
    headers: { "X-CSRFToken": getCsrfToken() },
  });
  if (res.status === 204) return;
  const data = await res.json().catch(() => ({}));
  throw new Error(data?.detail ?? `Erreur ${res.status}`);
}

export function getSupplierSkus(id: string): Promise<SupplierProductLink[]> {
  return apiFetch<SupplierProductLink[]>(`/api/suppliers/${encodeURIComponent(id)}/skus/`);
}

export async function addSupplierSku(
  id: string,
  body: { sku?: string; product_id?: string },
): Promise<SupplierProductLink> {
  const res = await fetch(`/api/suppliers/${encodeURIComponent(id)}/skus/`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.detail ?? `Erreur ${res.status}`);
  }
  return res.json();
}

export function removeSupplierSku(id: string, linkId: string): Promise<void> {
  return apiFetch<void>(
    `/api/suppliers/${encodeURIComponent(id)}/skus/${encodeURIComponent(linkId)}/`,
    { method: "DELETE" },
  );
}

export function getSupplierPriceHistory(id: string): Promise<SupplierPriceHistoryEntry[]> {
  return apiFetch<SupplierPriceHistoryEntry[]>(
    `/api/suppliers/${encodeURIComponent(id)}/price-history/`,
  );
}

export type BulkPoMode = "set" | "pct" | "abs";

export interface BulkPoResult {
  updated: number;
  skipped: number;
}

export type BulkPoPreviewStatus = "will_update" | "skip_no_po" | "skip_unchanged";

export interface BulkPoPreviewLine {
  link_id: string;
  product_id: string;
  product_sku: string;
  product_name: string;
  po_currency: string;
  old_po_base_price: string | null;
  new_po_base_price: string | null;
  status: BulkPoPreviewStatus;
}

export interface BulkPoPreview {
  summary: {
    will_update: number;
    skip_no_po: number;
    skip_unchanged: number;
    not_linked: number;
    selected: number;
  };
  lines: BulkPoPreviewLine[];
}

/** Dry-run for the batch PO wizard — per-SKU old/new prices without persisting. */
export function previewBulkPo(
  supplierId: string,
  body: { link_ids?: string[]; product_ids?: string[]; mode: BulkPoMode; value: string },
): Promise<BulkPoPreview> {
  return apiFetch<BulkPoPreview>(
    `/api/suppliers/${encodeURIComponent(supplierId)}/skus/bulk-po/preview/`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

/** Batch-update PO base prices on a supplier's links (by link ids or product ids). */
export function bulkUpdatePo(
  supplierId: string,
  body: { link_ids?: string[]; product_ids?: string[]; mode: BulkPoMode; value: string },
): Promise<BulkPoResult> {
  return apiFetch<BulkPoResult>(`/api/suppliers/${encodeURIComponent(supplierId)}/skus/bulk-po/`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Link several existing products (SKUs) to a supplier at once (catalog picker). */
export function bulkLinkSkus(
  supplierId: string,
  productIds: string[],
): Promise<{ created: number; skipped: number }> {
  return apiFetch<{ created: number; skipped: number }>(
    `/api/suppliers/${encodeURIComponent(supplierId)}/skus/bulk-link/`,
    { method: "POST", body: JSON.stringify({ product_ids: productIds }) },
  );
}

// ── PO import wizard (analyze → map → preview → apply) ─────────────────────

/** Logical fields the import wizard can map to Excel columns. */
export type ImportMappableField =
  | "sku"
  | "po"
  | "supplier"
  | "po_currency"
  | "factory_code"
  | "incoterm";

/** Excel-to-platform mapping: logical field → 0-based column index. */
export type ImportColumnMap = Partial<Record<ImportMappableField, number>>;

export interface PoImportAnalyzeResult {
  upload_token: string;
  header_row: number;
  headers: string[];
  sample_rows: string[][];
  column_count: number;
}

export interface PoImportInspectResult {
  header_row: number;
  headers: string[];
  sample_rows: string[][];
  column_count: number;
}

export type PoImportRowStatus =
  | "will_update"
  | "will_create_link"
  | "unchanged"
  | "sku_not_found"
  | "supplier_not_found"
  | "invalid_po"
  | "no_supplier"
  | "missing_sku";

export interface PoImportPreviewLine {
  row: number;
  sku: string;
  supplier: string;
  po: string;
  status: PoImportRowStatus;
  reason: string;
  old_po_base_price: string | null;
  new_po_base_price: string | null;
  po_currency: string | null;
}

export interface PoImportPreview {
  summary: {
    total: number;
    will_update: number;
    will_create_link: number;
    unchanged: number;
    sku_not_found: number;
    supplier_not_found: number;
    invalid_po: number;
    no_supplier: number;
    missing_sku: number;
    rejected: number;
  };
  lines: PoImportPreviewLine[];
}

/** Reusable Excel-to-platform column mapping template. */
export interface SupplierImportMapping {
  id: string;
  name: string;
  supplier: string | null;
  supplier_name: string | null;
  column_map: ImportColumnMap;
  header_row: number;
  created_at: string;
  updated_at: string;
}

/** Upload an Excel and get back its headers + a bounded sample for mapping. */
export async function analyzePoImport(
  file: File,
  headerRow = 1,
): Promise<PoImportAnalyzeResult> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("header_row", String(headerRow));
  const res = await fetch("/api/suppliers/import-po/analyze/", {
    method: "POST",
    credentials: "include",
    headers: { "X-CSRFToken": getCsrfToken() },
    body: fd,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.detail ?? `Erreur ${res.status}`);
  }
  return res.json();
}

/** Re-read an already-uploaded file with a different header row (no re-upload). */
export function inspectPoImport(body: {
  upload_token: string;
  header_row: number;
}): Promise<PoImportInspectResult> {
  return apiFetch<PoImportInspectResult>("/api/suppliers/import-po/inspect/", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

interface PoImportRunBody {
  upload_token: string;
  column_map: ImportColumnMap;
  supplier_id?: string | null;
  header_row: number;
}

/** Dispatch the dry-run resolution (synthesis). Returns a Celery `task_id`. */
export function previewPoImport(body: PoImportRunBody): Promise<{ task_id: string }> {
  return apiFetch<{ task_id: string }>("/api/suppliers/import-po/preview/", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Dispatch the apply step. Returns a Celery `task_id`. */
export function applyPoImport(body: PoImportRunBody): Promise<{ task_id: string }> {
  return apiFetch<{ task_id: string }>("/api/suppliers/import-po/apply/", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** List reusable import mapping templates (optionally scoped to a supplier). */
export function listImportMappings(supplierId?: string): Promise<SupplierImportMapping[]> {
  const q = new URLSearchParams({ limit: "500", ordering: "name" });
  if (supplierId) q.set("supplier", supplierId);
  return apiFetch<PaginatedResponse<SupplierImportMapping>>(
    `/api/suppliers/import-mappings/?${q.toString()}`,
  ).then((r) => r.results ?? []);
}

/** Create a reusable import mapping template. */
export function saveImportMapping(body: {
  name: string;
  supplier?: string | null;
  column_map: ImportColumnMap;
  header_row: number;
}): Promise<SupplierImportMapping> {
  return apiFetch<SupplierImportMapping>("/api/suppliers/import-mappings/", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Delete a reusable import mapping template. */
export function deleteImportMapping(id: string): Promise<void> {
  return apiFetch<void>(`/api/suppliers/import-mappings/${encodeURIComponent(id)}/`, {
    method: "DELETE",
  });
}

// ── Attribute registry admin (CDC §4.1.4) ─────────────────────────────────

/** Full attribute registry (no category filter), with value_count annotations. */
export function listAttributes(): Promise<AttributeRegistry[]> {
  return apiFetch<PaginatedResponse<AttributeRegistry>>("/api/attributes/?limit=500").then(
    (r) => r.results,
  );
}

/** Attributes flagged filterable, for the catalog sidebar. */
export function getFilterableAttributes(): Promise<AttributeRegistry[]> {
  return apiFetch<PaginatedResponse<AttributeRegistry>>(
    "/api/attributes/?is_filterable=true&limit=500",
  ).then((r) => r.results.filter((a) => a.is_filterable));
}

export function createAttribute(input: Partial<AttributeRegistry>): Promise<AttributeRegistry> {
  return apiFetch<AttributeRegistry>("/api/attributes/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateAttribute(
  id: string,
  patch: Partial<AttributeRegistry>,
): Promise<AttributeRegistry> {
  return apiFetch<AttributeRegistry>(`/api/attributes/${encodeURIComponent(id)}/`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteAttribute(id: string): Promise<void> {
  return apiFetch<void>(`/api/attributes/${encodeURIComponent(id)}/`, { method: "DELETE" });
}

/** Persist a new display order for the given attribute ids (single category). */
export function reorderAttributes(ids: string[]): Promise<{ reordered: number }> {
  return apiFetch<{ reordered: number }>("/api/attributes/reorder/", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

// ── Offer expiration-alert recipients (UI-editable, CDC §7.6) ──────────────

export interface OfferAlertSettings {
  recipients: string[];
}

export function getOfferAlertSettings(): Promise<OfferAlertSettings> {
  return apiFetch<OfferAlertSettings>("/api/offers/alert-settings");
}

export function updateOfferAlertSettings(recipients: string[]): Promise<OfferAlertSettings> {
  return apiFetch<OfferAlertSettings>("/api/offers/alert-settings", {
    method: "PUT",
    body: JSON.stringify({ recipients }),
  });
}

// ── Dashboard aggregates ───────────────────────────────────────────────────

export interface OffersDashboard {
  status_counts: Record<string, number>;
  project_conversion_pct: number | null;
  tariff_active: number;
  won_total: string | null;
  generation_error_count?: number;
}

export function getOffersDashboard(): Promise<OffersDashboard> {
  return apiFetch<OffersDashboard>("/api/offers/dashboard");
}

export type DashboardTodoKind =
  | "simulation_dirty"
  | "simulation_never_calculated"
  | "simulation_line_errors"
  | "offer_expiring"
  | "offer_generation_error";

export interface DashboardTodoItem {
  kind: DashboardTodoKind;
  id: string;
  label: string;
  occurred_at: string;
  href_path: string;
}

export type DashboardRecentKind = "simulation" | "offer" | "comparison";

export interface DashboardRecentItem {
  kind: DashboardRecentKind;
  id: string;
  label: string;
  occurred_at: string;
  status: string;
  is_dirty: boolean;
  href_path: string;
}

export interface DashboardMarketSnapshot {
  value: string | null;
  valid_from: string;
  updated_at: string;
  currency?: string;
  unit?: string;
  market?: string;
  from_currency?: string;
  to_currency?: string;
}

export interface DashboardSummary {
  catalog: { product_count: number; universe_count: number };
  simulations: {
    total: number;
    draft: number;
    finalized: number;
    dirty: number;
    never_calculated: number;
    with_line_errors: number;
  };
  offers: OffersDashboard;
  comparisons: { total: number };
  library: { document_count: number };
  market: {
    copper_lme: DashboardMarketSnapshot | null;
    fx_usd_eur: DashboardMarketSnapshot | null;
  };
  todo: DashboardTodoItem[];
  recent: DashboardRecentItem[];
}

export function getDashboardSummary(): Promise<DashboardSummary> {
  return apiFetch<DashboardSummary>("/api/dashboard/summary");
}

// ── Admin dashboard helpers ───────────────────────────────────────────────

export interface QuarantineFacets {
  total: number;
  resolved: number;
  unresolved: number;
  by_reason: Record<string, number>;
  source_files: string[];
}

export function getQuarantineFacets(): Promise<QuarantineFacets> {
  return apiFetch<QuarantineFacets>("/api/migration/unmatched/facets/");
}

export interface PlatformUserSummary {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  is_active: boolean;
}

export function listUsers(): Promise<PlatformUserSummary[]> {
  return apiFetch<PlatformUserSummary[]>("/api/users/");
}

export interface DocumentLibraryEntry {
  id: string;
  label?: string;
  name?: Record<string, string>;
  category?: string;
  file_name?: string;
  language?: string;
  created_at: string;
}

export function getDocumentLibraryCount(): Promise<number> {
  return apiFetch<{ count: number; results: DocumentLibraryEntry[] }>(
    "/api/document-library/?limit=1",
  ).then((r) => r.count);
}

/** Active library documents, for attaching to an offer (CDC §7.4). */
export function listDocumentLibrary(): Promise<DocumentLibraryEntry[]> {
  return apiFetch<{ results: DocumentLibraryEntry[] }>("/api/document-library/?limit=200").then(
    (r) => r.results ?? [],
  );
}

export interface OfferSummary {
  id: string;
  label: string;
  offer_type: "tariff" | "project";
  status: string;
  created_at: string;
}

export function getRecentOffers(limit = 5): Promise<OfferSummary[]> {
  const q = new URLSearchParams({ ordering: "-created_at", limit: String(limit) });
  return apiFetch<{ count: number; results: OfferSummary[] }>(`/api/offers/?${q}`).then(
    (r) => r.results,
  );
}
