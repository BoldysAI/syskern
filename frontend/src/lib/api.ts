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
  opts: { intervalMs?: number; timeoutMs?: number } = {}
): Promise<T> {
  const intervalMs = opts.intervalMs ?? 800;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await apiFetch<TaskResponse<T>>(
      `/api/tasks/${encodeURIComponent(taskId)}/`
    );
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
  pollOpts?: { intervalMs?: number; timeoutMs?: number }
): Promise<T> {
  const dispatch = await apiFetch<{ task_id: string }>(path, options);
  return pollTask<T>(dispatch.task_id, pollOpts);
}

export interface ProductListParams {
  universe?: string;
  family?: string;
  range?: string;
  search?: string;
  page?: number;
  limit?: number;
}

/** Supplier embedded in product list/detail */
export interface ProductSupplier {
  id: string;
  supplier_name: string;
  factory_code?: string;
  po_base_price?: string;
  po_currency?: string;
  is_copper_indexed?: boolean;
  incoterm?: string;
  incoterm_location?: string;
  is_active: boolean;
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

export type AttributeDataType =
  | "text"
  | "number"
  | "boolean"
  | "date"
  | "select"
  | "multiselect";

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
  display_order: number;
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
  line_count: number;
  created_at: string;
  updated_at: string;
}

export interface SimulationLine {
  id: string;
  simulation: string;
  product: string;
  product_sku: string;
  product_name: string;
  margin_override: string | null;
  stock_purchase_mix_pct_override: number | null;
  po_net_eur: string | null;
  pa_net_eur: string | null;
  pamp_predictive_eur: string | null;
  pr_eur: string | null;
  pv_eur: string | null;
  status: "ok" | "pending" | "warning" | "error" | "dirty";
  last_calculated_at: string | null;
}

/** Full shape from the detail endpoint (includes nested lines). */
export interface SimulationDetail extends Simulation {
  client_ids: string[];
  market_params: Record<string, unknown>;
  calculation_chain: Record<string, unknown>;
  lines: SimulationLine[];
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
  stock_purchase_mix_pct?: number;
  symea_margin_rate?: string;
  syskern_margin_rate?: string;
  market_params?: Record<string, unknown>;
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
  q.set("limit", String(limit));
  q.set("offset", String(offset));
  return apiFetch<PaginatedProducts>(`/api/products/?${q.toString()}`);
}

/** Trigger an async Excel export (Celery task), then download the file. */
export async function exportProducts(params?: {
  search?: string;
  universe?: string;
}): Promise<void> {
  const q = new URLSearchParams();
  if (params?.search) q.set("search", params.search);
  if (params?.universe) q.set("universe", params.universe);
  const result = await dispatchAndPoll<{ file_url: string; filename: string }>(
    `/api/products/export/?${q.toString()}`,
    { method: "POST", body: JSON.stringify({}) },
    { timeoutMs: 180_000 }
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
    "/api/hierarchy/distinct?level=universe"
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
  period: "3m" | "6m" | "12m" = "6m"
): Promise<PriceHistory> {
  return apiFetch<PriceHistory>(
    `/api/products/${encodeURIComponent(sku)}/price-history/?period=${period}`
  );
}

/** Re-pull this product's PAMP + stock from Odoo (Celery task). */
export function refreshPamp(sku: string): Promise<ProductDetail> {
  return dispatchAndPoll<ProductDetail>(
    `/api/products/${encodeURIComponent(sku)}/refresh-pamp/`,
    { method: "POST" },
    { timeoutMs: 60_000 }
  );
}

/** Translate the FR descriptions to EN/ES via DeepL (Celery task). */
export function translateProduct(
  sku: string,
  targetLang: "en" | "es"
): Promise<ProductDetail> {
  return dispatchAndPoll<ProductDetail>(
    `/api/products/${encodeURIComponent(sku)}/translate/`,
    { method: "POST", body: JSON.stringify({ target_lang: targetLang }) },
    { timeoutMs: 60_000 }
  );
}

/** Partially update a product's core fields (CDC §4.3 — édition en place). */
export function updateProduct(
  idOrSku: string,
  patch: Partial<ProductDetail>
): Promise<ProductDetail> {
  return apiFetch<ProductDetail>(`/api/products/${encodeURIComponent(idOrSku)}/`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/** Attribute values currently set on a product (plain array, not paginated). */
export function getProductAttributes(
  idOrSku: string
): Promise<ProductAttributeValue[]> {
  return apiFetch<ProductAttributeValue[]>(
    `/api/products/${encodeURIComponent(idOrSku)}/attributes/`
  );
}

/** Attribute registry definitions, optionally filtered by category. */
export function getAttributeRegistry(
  category?: AttributeCategory
): Promise<AttributeRegistry[]> {
  const q = new URLSearchParams({ limit: "500" });
  if (category) q.set("category", category);
  return apiFetch<PaginatedResponse<AttributeRegistry>>(
    `/api/attributes/?${q.toString()}`
  ).then((r) => r.results);
}

/** Upsert one attribute value on a product (PUT, body `{value}`). */
export function setProductAttribute(
  productId: string,
  attributeId: string,
  value: unknown
): Promise<ProductAttributeValue> {
  return apiFetch<ProductAttributeValue>(
    `/api/products/${encodeURIComponent(productId)}/attributes/${encodeURIComponent(attributeId)}/`,
    { method: "PUT", body: JSON.stringify({ value }) }
  );
}

export function getSimulations(): Promise<Simulation[]> {
  return apiFetch<PaginatedSimulations>("/api/simulations/?limit=200").then(
    (r) => r.results
  );
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

export function deleteSimulation(id: string): Promise<void> {
  return apiFetch<void>(`/api/simulations/${encodeURIComponent(id)}/`, {
    method: "DELETE",
  });
}

/** Attach products to a simulation (creates lines). */
export function addSimulationLines(
  id: string,
  productIds: string[]
): Promise<unknown> {
  return apiFetch(`/api/simulations/${encodeURIComponent(id)}/lines/`, {
    method: "POST",
    body: JSON.stringify({ product_ids: productIds }),
  });
}

export function updateSimulationLine(
  lineId: string,
  patch: { margin_override?: string | null; stock_purchase_mix_pct_override?: number | null }
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

export function recalculate(
  id: string,
  body?: { market_params?: Record<string, unknown>; note?: string }
): Promise<SimulationDetail> {
  return dispatchAndPoll<SimulationDetail>(
    `/api/simulations/${encodeURIComponent(id)}/recalculate/`,
    { method: "POST", body: JSON.stringify(body ?? {}) },
    { timeoutMs: 180_000 }
  );
}

export function finalizeSimulation(id: string): Promise<SimulationDetail> {
  return apiFetch<SimulationDetail>(
    `/api/simulations/${encodeURIComponent(id)}/finalize/`,
    { method: "POST" }
  );
}

export function duplicateSimulation(id: string): Promise<SimulationDetail> {
  return apiFetch<SimulationDetail>(
    `/api/simulations/${encodeURIComponent(id)}/duplicate/`,
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
    `/api/market-parameters/${qs ? "?" + qs : ""}`
  ).then((r) => r.results);
}

export function createMarketParameter(
  data: Partial<MarketParameter>
): Promise<MarketParameter> {
  return apiFetch<MarketParameter>("/api/market-parameters/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateMarketParameter(
  id: string,
  patch: Partial<MarketParameter>
): Promise<MarketParameter> {
  return apiFetch<MarketParameter>(`/api/market-parameters/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteMarketParameter(id: string): Promise<void> {
  return apiFetch<void>(`/api/market-parameters/${id}/`, { method: "DELETE" });
}

// Back-compat alias kept for any older callers; prefer listMarketParameters.
export function getMarketParameters(): Promise<MarketParameter[]> {
  return listMarketParameters({ activeOnly: true });
}

// ── Transport modes ──────────────────────────────────────────────────────
export function listTransportModes(activeOnly = false): Promise<TransportMode[]> {
  const qs = activeOnly ? "?is_active=true" : "";
  return apiFetch<{ count: number; results: TransportMode[] }>(
    `/api/transport-modes/${qs}`
  ).then((r) => r.results);
}

export function createTransportMode(
  data: Partial<TransportMode>
): Promise<TransportMode> {
  return apiFetch<TransportMode>("/api/transport-modes/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateTransportMode(
  id: string,
  patch: Partial<TransportMode>
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
  return apiFetch<{ count: number; results: SyncLog[] }>(
    `/api/odoo/sync/logs?limit=${limit}`
  ).then((r) => r.results);
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
  api_version: "v16" | "v19" = "v19"
): Promise<SyncLog> {
  return dispatchAndPoll<SyncLog>(
    "/api/odoo/sync/trigger",
    { method: "POST", body: JSON.stringify({ scope, api_version }) },
    { timeoutMs: 600_000 }
  );
}

