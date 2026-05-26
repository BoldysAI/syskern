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

export interface Simulation {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  status: "draft" | "finalized";
  line_count?: number;
  avg_pa?: number;
}

export interface PaginatedSimulations {
  count: number;
  next?: string;
  previous?: string;
  results: Simulation[];
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

export function getProduct(sku: string): Promise<ProductDetail> {
  return apiFetch<ProductDetail>(`/api/products/${encodeURIComponent(sku)}/`);
}

export function getSimulations(): Promise<Simulation[]> {
  return apiFetch<PaginatedSimulations>("/api/simulations/?limit=200").then(
    (r) => r.results
  );
}

export function getSimulation(id: string): Promise<Simulation> {
  return apiFetch<Simulation>(`/api/simulations/${encodeURIComponent(id)}/`);
}

export function recalculate(id: string): Promise<Simulation> {
  return apiFetch<Simulation>(`/api/simulations/${encodeURIComponent(id)}/recalculate/`, {
    method: "POST",
  });
}

export function getMarketParameters(): Promise<MarketParameter[]> {
  return apiFetch<{ count: number; results: MarketParameter[] }>(
    "/api/market-parameters/?limit=1&ordering=-created_at"
  ).then((r) => r.results);
}
