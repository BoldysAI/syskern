const STORAGE_KEY = "syskern:last-visited:v1";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type LastVisitedKind = "simulation" | "offer" | "comparison";

export interface LastVisited {
  kind: LastVisitedKind;
  id: string;
  label: string;
  path: string;
  at: string;
}

export function persistLastVisited(entry: Omit<LastVisited, "at">): void {
  if (typeof window === "undefined") return;
  const payload: LastVisited = { ...entry, at: new Date().toISOString() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function loadLastVisited(): LastVisited | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LastVisited;
    if (Date.now() - new Date(parsed.at).getTime() > MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}
