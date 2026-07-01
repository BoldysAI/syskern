const STORAGE_KEY = "syskern:new-comparison-draft:v1";
export const MAX_COMPARE_COLUMNS = 4;

export interface ComparisonWizardDraft {
  label: string;
  note: string;
  simulationIds: string[];
  recalculationIds: string[];
}

export const EMPTY_DRAFT: ComparisonWizardDraft = {
  label: "",
  note: "",
  simulationIds: [],
  recalculationIds: [],
};

export function loadDraft(prefill?: Partial<ComparisonWizardDraft>): ComparisonWizardDraft {
  if (typeof window === "undefined") {
    return { ...EMPTY_DRAFT, ...prefill };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ComparisonWizardDraft;
      return { ...EMPTY_DRAFT, ...parsed, ...prefill };
    }
  } catch {
    /* ignore */
  }
  return { ...EMPTY_DRAFT, ...prefill };
}

export function persistDraft(draft: ComparisonWizardDraft): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
}

export function clearDraft(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

export function step1Valid(draft: ComparisonWizardDraft): boolean {
  return draft.label.trim().length > 0;
}

export function step2Valid(draft: ComparisonWizardDraft): boolean {
  const total = draft.simulationIds.length + draft.recalculationIds.length;
  return total >= 2 && total <= MAX_COMPARE_COLUMNS;
}

export function draftFromSearchParams(params: {
  sims?: string | null;
  recalc?: string | null;
}): Partial<ComparisonWizardDraft> {
  const simulationIds = (params.sims ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_COMPARE_COLUMNS);
  const recalculationIds = (params.recalc ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const slotsLeft = MAX_COMPARE_COLUMNS - recalculationIds.length;
  return {
    simulationIds: simulationIds.slice(0, Math.max(0, slotsLeft)),
    recalculationIds,
  };
}
