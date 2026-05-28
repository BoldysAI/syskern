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

export interface MarketParameter {
  id: string;
  copper_rate?: string;
  euro_usd?: string;
  created_at?: string;
  updated_at?: string;
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

/** Download the filtered catalog as an Excel workbook (CDC §4.1.1). */
export async function exportProducts(params?: {
  search?: string;
  universe?: string;
}): Promise<void> {
  const q = new URLSearchParams();
  if (params?.search) q.set("search", params.search);
  if (params?.universe) q.set("universe", params.universe);
  const res = await fetch(`/api/products/export/?${q.toString()}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Export échoué (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "catalogue_syskern.xlsx";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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

/** Re-pull this product's PAMP + stock from Odoo (read-only on Odoo). */
export function refreshPamp(sku: string): Promise<ProductDetail> {
  return apiFetch<ProductDetail>(
    `/api/products/${encodeURIComponent(sku)}/refresh-pamp/`,
    { method: "POST" }
  );
}

/** Translate the FR descriptions to EN/ES via DeepL (cached in JSONB). */
export function translateProduct(
  sku: string,
  targetLang: "en" | "es"
): Promise<ProductDetail> {
  return apiFetch<ProductDetail>(
    `/api/products/${encodeURIComponent(sku)}/translate/`,
    { method: "POST", body: JSON.stringify({ target_lang: targetLang }) }
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
  return apiFetch<SimulationDetail>(
    `/api/simulations/${encodeURIComponent(id)}/recalculate/`,
    { method: "POST", body: JSON.stringify(body ?? {}) }
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

export function getMarketParameters(): Promise<MarketParameter[]> {
  return apiFetch<{ count: number; results: MarketParameter[] }>(
    "/api/market-parameters/?limit=1&ordering=-created_at"
  ).then((r) => r.results);
}

// ── Odoo Sync ────────────────────────────────────────────────────────────────

export type SyncScope = "all" | "products" | "stock" | "clients" | "suppliers" | "purchases_sales";
export type SyncStatus = "running" | "success" | "partial_failure" | "failed";

export interface SyncLog {
  id: string;
  sync_type: string;
  scope: SyncScope;
  odoo_api_version: string;
  started_at: string;
  completed_at: string | null;
  status: SyncStatus;
  items_created: number;
  items_updated: number;
  items_failed: number;
  errors: { item_id: string | null; error_message: string }[];
  triggered_by: string;
}

export interface SyncStatusResponse {
  last: SyncLog | null;
  running: SyncLog | null;
}

export function triggerSync(scope: SyncScope = "all", apiVersion: string = "v19"): Promise<SyncLog> {
  return apiFetch<SyncLog>("/api/odoo/sync/trigger", {
    method: "POST",
    body: JSON.stringify({ scope, api_version: apiVersion }),
  });
}

export function getSyncStatus(): Promise<SyncStatusResponse> {
  return apiFetch<SyncStatusResponse>("/api/odoo/sync/status");
}

export function getSyncLogs(params?: { scope?: SyncScope; limit?: number }): Promise<SyncLog[]> {
  const q = new URLSearchParams();
  if (params?.scope) q.set("scope", params.scope);
  q.set("limit", String(params?.limit ?? 20));
  return apiFetch<{ count: number; results: SyncLog[] }>(
    `/api/odoo/sync/logs?${q.toString()}`
  ).then((r) => r.results);
}
