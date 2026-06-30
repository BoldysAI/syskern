import { getSimulationLines, type SimulationLine } from "@/lib/api";

/** Fetch all SKU lines for a simulation (paginated API, client-side merge). */
export async function fetchSimulationSkus(simulationId: string): Promise<SimulationLine[]> {
  const pageSize = 200;
  const lines: SimulationLine[] = [];
  let page = 1;
  let total = Infinity;

  while (lines.length < total) {
    const res = await getSimulationLines({
      simulation: simulationId,
      page,
      limit: pageSize,
    });
    lines.push(...res.results);
    total = res.count;
    if (!res.results.length) break;
    page += 1;
  }

  return lines;
}

export interface SkuOverlapStats {
  perSimulation: Array<{
    id: string;
    label: string;
    skuCount: number;
  }>;
  commonCount: number;
  commonSkus: Array<{ productId: string; sku: string; name: string }>;
  unionCount: number;
}

export function computeSkuOverlap(
  simulations: Array<{ id: string; label: string; lines: SimulationLine[] }>,
): SkuOverlapStats {
  const perSimulation = simulations.map((s) => ({
    id: s.id,
    label: s.label,
    skuCount: s.lines.length,
  }));

  if (simulations.length < 2) {
    return {
      perSimulation,
      commonCount: simulations[0]?.lines.length ?? 0,
      commonSkus: (simulations[0]?.lines ?? []).map((l) => ({
        productId: l.product,
        sku: l.product_sku,
        name: l.product_name,
      })),
      unionCount: simulations[0]?.lines.length ?? 0,
    };
  }

  const productSets = simulations.map(
    (s) => new Map(s.lines.map((l) => [l.product, l] as const)),
  );
  const first = productSets[0];
  const commonIds = [...first.keys()].filter((pid) =>
    productSets.every((set) => set.has(pid)),
  );

  const unionIds = new Set<string>();
  for (const set of productSets) {
    for (const pid of set.keys()) unionIds.add(pid);
  }

  const commonSkus = commonIds.map((pid) => {
    const line = first.get(pid)!;
    return { productId: pid, sku: line.product_sku, name: line.product_name };
  });

  return {
    perSimulation,
    commonCount: commonIds.length,
    commonSkus,
    unionCount: unionIds.size,
  };
}
