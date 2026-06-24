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
  return res.json() as Promise<T>;
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

export interface ProductListParams {
  universe?: string;
  family?: string;
  range?: string;
  search?: string;
  ordering?: string;
  page?: number;
  limit?: number;
}

/** Catalog sidebar filter state (multi-select, persisted in localStorage). */
export interface CatalogFilters {
  q?: string;
  universe?: string[];
  family?: string[];
  range?: string[];
  sub_range?: string[];
  brand?: string[];
  supplier?: string[];
  stock_in?: boolean;
  stock_out?: boolean;
  stock_min?: number | null;
  /** PAMP price range (EUR). */
  pamp_min?: number | null;
  pamp_max?: number | null;
  /** Dynamic attribute filters, keyed by attribute code (value or values). */
  attrs?: Record<string, string | string[] | undefined>;
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
  updated_at?: string;
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
  po_net_eur: string | null;
  pa_net_eur: string | null;
  pamp_predictive_eur: string | null;
  pr_eur: string | null;
  pv_eur: string | null;
  effective_margin_rate: string | null;
  effective_mix_pct: number | null;
  calculation_breakdown?: Record<string, unknown>;
  supplier_snapshot?: Record<string, unknown>;
  status: SimulationLineStatus;
  last_calculated_at: string | null;
}

/** Recalc scopes from the modal (CDC §6.9.4). */
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

/** Cumulative filter for bulk-edit / preview (CDC §6.9.5). */
export interface BulkEditFilter {
  universe?: string;
  family?: string;
  range?: string;
  brand?: string;
  factory_code?: string;
  has_warning?: boolean;
  has_error?: boolean;
}

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
  const q = new URLSearchParams();
  const limit = params?.limit ?? 20;
  const page = params?.page ?? 1;
  const offset = (page - 1) * limit;
  if (params?.universe) q.set("universe", params.universe);
  if (params?.family) q.set("family", params.family);
  if (params?.range) q.set("range", params.range);
  if (params?.search) q.set("search", params.search);
  if (params?.ordering) q.set("ordering", params.ordering);
  q.set("limit", String(limit));
  q.set("offset", String(offset));
  return apiFetch<PaginatedProducts>(`/api/products/?${q.toString()}`);
}

export interface CatalogListParams extends CatalogFilters {
  ordering?: string;
  page?: number;
  limit?: number;
}

/** Paginated catalog list with full sidebar filter support. */
export function getCatalogProducts(params: CatalogListParams): Promise<PaginatedProducts> {
  const q = new URLSearchParams(catalogFiltersToParams(params));
  const limit = params.limit ?? 20;
  const page = params.page ?? 1;
  const offset = (page - 1) * limit;
  if (params.ordering) q.set("ordering", params.ordering);
  q.set("limit", String(limit));
  q.set("offset", String(offset));
  return apiFetch<PaginatedProducts>(`/api/products/?${q.toString()}`);
}

/** Map the sidebar filter state to backend `ProductFilter` query params. */
export function catalogFiltersToParams(f: CatalogFilters): Record<string, string> {
  const p: Record<string, string> = {};
  if (f.q?.trim()) p.q = f.q.trim();
  const csvKeys: (keyof CatalogFilters)[] = [
    "universe",
    "family",
    "range",
    "sub_range",
    "brand",
    "supplier",
  ];
  for (const k of csvKeys) {
    const v = f[k];
    if (Array.isArray(v) && v.length) p[k] = v.join(",");
  }
  if (f.stock_in && !f.stock_out) p.in_stock = "true";
  if (f.stock_out && !f.stock_in) p.in_stock = "false";
  if (f.stock_min != null && f.stock_min > 0) p.stock_min = String(f.stock_min);
  if (f.pamp_min != null && f.pamp_min > 0) p.pamp_min = String(f.pamp_min);
  if (f.pamp_max != null && f.pamp_max > 0) p.pamp_max = String(f.pamp_max);
  for (const [code, raw] of Object.entries(f.attrs ?? {})) {
    if (raw == null) continue;
    p[`attr_${code}`] = Array.isArray(raw) ? raw.join(",") : String(raw);
  }
  return p;
}

export interface CatalogFilterBounds {
  pamp_eur: { min: number | null; max: number | null };
  stock_quantity: { min: number | null; max: number | null };
  attributes: Record<string, { min: number; max: number }>;
}

/** Min/max for numeric filters, scoped to current facet context (excludes range sliders). */
export function getCatalogFilterBounds(filters: CatalogFilters = {}): Promise<CatalogFilterBounds> {
  const { pamp_min: _a, pamp_max: _b, stock_min: _c, ...facet } = filters;
  const q = new URLSearchParams(catalogFiltersToParams(facet));
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
    body.filters = catalogFiltersToParams(opts.filters);
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

export function getSimulations(opts?: { includeArchived?: boolean }): Promise<Simulation[]> {
  const q = new URLSearchParams({ limit: "200" });
  if (opts?.includeArchived) q.set("include_archived", "true");
  return apiFetch<PaginatedSimulations>(`/api/simulations/?${q.toString()}`).then(
    (r) => r.results
  );
}

/** List clients, optionally filtered by a search term (CDC §6.9.2 step 1). */
export function getClients(search?: string): Promise<Client[]> {
  const q = new URLSearchParams({ limit: "200" });
  if (search) q.set("search", search);
  return apiFetch<PaginatedResponse<Client>>(`/api/clients/?${q.toString()}`).then(
    (r) => r.results
  );
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
  data: UpdateSimulationInput
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
export function addSimulationLines(id: string, productIds: string[]): Promise<unknown> {
  return apiFetch(`/api/simulations/${encodeURIComponent(id)}/lines/`, {
    method: "POST",
    body: JSON.stringify({ product_ids: productIds }),
  });
}

export function updateSimulationLine(
  lineId: string,
  patch: {
    margin_override?: string | null;
    stock_purchase_mix_pct_override?: number | null;
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
  body?: { scope?: RecalcScope; market_params?: Record<string, unknown>; note?: string }
): Promise<SimulationDetail> {
  return dispatchAndPoll<SimulationDetail>(
    `/api/simulations/${encodeURIComponent(id)}/recalculate/`,
    { method: "POST", body: JSON.stringify(body ?? {}) },
    { timeoutMs: 300_000 }
  );
}

/** Recalculate a single line synchronously (CDC §6.9.5) — no audit trace. */
export function recalculateSimulationLine(lineId: string): Promise<SimulationLine> {
  return apiFetch<SimulationLine>(
    `/api/simulation-lines/${encodeURIComponent(lineId)}/recalculate/`,
    { method: "POST" }
  );
}

export interface SimulationLineQuery {
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
  params: SimulationLineQuery
): Promise<PaginatedResponse<SimulationLine>> {
  const limit = params.limit ?? 200;
  const page = params.page ?? 1;
  const q = new URLSearchParams({
    simulation: params.simulation,
    limit: String(limit),
    offset: String((page - 1) * limit),
  });
  if (params.status_in) q.set("status_in", params.status_in);
  if (params.has_warning) q.set("has_warning", "true");
  if (params.has_error) q.set("has_error", "true");
  if (params.ordering) q.set("ordering", params.ordering);
  return apiFetch<PaginatedResponse<SimulationLine>>(
    `/api/simulation-lines/?${q.toString()}`
  );
}

/** Count the lines a bulk-edit filter would touch (no mutation). */
export function bulkEditPreview(
  id: string,
  filter: BulkEditFilter
): Promise<{ count: number }> {
  return apiFetch<{ count: number }>(
    `/api/simulations/${encodeURIComponent(id)}/lines/bulk/preview/`,
    { method: "POST", body: JSON.stringify({ filter }) }
  );
}

/** Apply a bulk-edit action to the filtered lines (CDC §6.9.5). */
export function bulkEditLines(
  id: string,
  body: {
    filter: BulkEditFilter;
    margin_override?: string | null;
    stock_purchase_mix_pct_override?: number | null;
    reset?: boolean;
  }
): Promise<{ updated: number }> {
  return apiFetch<{ updated: number }>(
    `/api/simulations/${encodeURIComponent(id)}/lines/bulk/`,
    { method: "POST", body: JSON.stringify(body) }
  );
}

/** Paginated recalculation history of a simulation, DESC (CDC §6.9.12). */
export function getRecalculations(
  id: string,
  opts?: { limit?: number; offset?: number }
): Promise<PaginatedResponse<Recalculation>> {
  const q = new URLSearchParams();
  q.set("limit", String(opts?.limit ?? 10));
  if (opts?.offset) q.set("offset", String(opts.offset));
  return apiFetch<PaginatedResponse<Recalculation>>(
    `/api/simulations/${encodeURIComponent(id)}/recalculations/?${q.toString()}`
  );
}

/** Full detail of a single recalc trace, incl. frozen line snapshots. */
export function getRecalculation(simId: string, recalcId: string): Promise<Recalculation> {
  return apiFetch<Recalculation>(
    `/api/simulations/${encodeURIComponent(simId)}/recalculations/${encodeURIComponent(recalcId)}/`
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

export function getSavedComparisons(): Promise<SavedComparison[]> {
  return apiFetch<SavedComparison[]>("/api/saved-comparisons/");
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
  body: { label?: string; note?: string }
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
    { timeoutMs: 180_000 }
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
  return apiFetch<SimulationDetail>(
    `/api/simulations/${encodeURIComponent(id)}/duplicate/`,
    { method: "POST", body: JSON.stringify(label ? { label } : {}) }
  );
}

export function archiveSimulation(id: string): Promise<SimulationDetail> {
  return apiFetch<SimulationDetail>(
    `/api/simulations/${encodeURIComponent(id)}/archive/`,
    { method: "POST" }
  );
}

export function unarchiveSimulation(id: string): Promise<SimulationDetail> {
  return apiFetch<SimulationDetail>(
    `/api/simulations/${encodeURIComponent(id)}/unarchive/`,
    { method: "POST" }
  );
}

// ── Market parameters (settings) ─────────────────────────────────────────
export function listMarketParameters(filter?: {
  type?: MarketParameterType;
  activeOnly?: boolean;
}): Promise<MarketParameter[]> {
  const q = new URLSearchParams();
  if (filter?.type) q.set("parameter_type", filter.type);
  if (filter?.activeOnly) q.set("is_active", "true");
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
}): Promise<MarketParameter> {
  const q = new URLSearchParams({ parameter_type: opts.parameter_type });
  if (opts.fx_from_currency) q.set("fx_from_currency", opts.fx_from_currency);
  if (opts.fx_to_currency) q.set("fx_to_currency", opts.fx_to_currency);
  return apiFetch<MarketParameter>(`/api/market-parameters/current/?${q.toString()}`);
}

// Back-compat alias kept for any older callers; prefer listMarketParameters.
export function getMarketParameters(): Promise<MarketParameter[]> {
  return listMarketParameters({ activeOnly: true });
}

// ── Transport modes ──────────────────────────────────────────────────────
export function listIncoterms(): Promise<IncotermRef[]> {
  return apiFetch<{ incoterms: IncotermRef[] }>("/api/incoterms").then(
    (r) => r.incoterms
  );
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

/** Distinct values for a hierarchy level, optionally scoped by parent levels
 *  (cascade: family within a universe, range within universe+family, …). */
export type HierarchyLevel = "universe" | "family" | "range" | "sub_range";

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
  ).then((r) => r.results);
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
}

export function getOffersDashboard(): Promise<OffersDashboard> {
  return apiFetch<OffersDashboard>("/api/offers/dashboard");
}

export interface DocumentLibraryEntry {
  id: string;
  label?: string;
  created_at: string;
}

export function getDocumentLibraryCount(): Promise<number> {
  return apiFetch<{ count: number; results: DocumentLibraryEntry[] }>(
    "/api/document-library/?limit=1",
  ).then((r) => r.count);
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
