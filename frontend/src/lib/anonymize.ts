/**
 * Display-only brand scrubber for the throwaway demo branch.
 * Never writes to the database. Do not merge to main.
 */

const EMPTY = "—";

/** Engine identifiers in breakdown metadata — keep so UI mapping still works. */
const KEEP_EXACT = new Set(["syskern", "symea"]);

function domainRe(): RegExp {
  return /(?:syskern|symea|unikkern|unnikkern|amplify)(?:\.[a-z]{2,})+/gi;
}

function tokenRe(): RegExp {
  return /amplify\s+invest|unnikkern|unikkern|syskern|symea|simea|amplify/gi;
}

export function anonymizeText(value: string): string {
  if (value === "") return value;
  if (KEEP_EXACT.has(value)) return value;
  let out = value.replace(domainRe(), "exemple.com");
  out = out.replace(tokenRe(), "");
  out = out.replace(/\s{2,}/g, " ");
  out = out.replace(/\s+,/g, ",");
  out = out.replace(/\(\s*\)/g, "");
  out = out.replace(/^[\s\-–—/,]+|[\s\-–—/,]+$/g, "");
  out = out.trim();
  return out === "" ? EMPTY : out;
}

export function anonymizeJson<T>(value: T): T {
  if (typeof value === "string") {
    return anonymizeText(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => anonymizeJson(item)) as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = anonymizeJson(nested);
    }
    return out as T;
  }
  return value;
}

/** Patch window.fetch so raw `fetch().json()` paths (offers, library, admin) are masked too. */
export function installAnonymizeFetch(): void {
  if (typeof window === "undefined") return;
  const w = window as Window & { __demoAnonymizeFetch?: boolean };
  if (w.__demoAnonymizeFetch) return;
  w.__demoAnonymizeFetch = true;
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await orig(input, init);
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return res;
    const text = await res.text();
    const headers = new Headers(res.headers);
    if (!text.trim()) {
      return new Response(text, { status: res.status, statusText: res.statusText, headers });
    }
    try {
      const body = JSON.stringify(anonymizeJson(JSON.parse(text)));
      return new Response(body, { status: res.status, statusText: res.statusText, headers });
    } catch {
      return new Response(text, { status: res.status, statusText: res.statusText, headers });
    }
  };
}
