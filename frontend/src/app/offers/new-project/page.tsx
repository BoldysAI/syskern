"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { AlertTriangle, Check, ExternalLink, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

interface SimLine {
  id: string;
  product_sku: string;
  product_name: string;
}
interface SimulationDetail {
  id: string;
  label: string;
  project_name: string;
  client_ids: string[];
  simulation_type: string;
  status: string;
  lines: SimLine[];
}
interface ClientLite {
  id: string;
  name: string;
}
interface GenResult {
  offer_id: string;
  generation_status: string;
  gamma_url: string;
  error: string;
}

const LANGUAGES = [
  { code: "fr", label: "Français" },
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
];
const STEPS = ["Client & projet", "Quantités", "Langue & validité", "Sections", "Instructions IA"];
const SECTIONS: { key: string; label: string }[] = [
  { key: "cover", label: "1. Couverture" },
  { key: "presentation", label: "2. Présentation Syskern" },
  { key: "pricing", label: "3. Tableau de prix" },
  { key: "arguments", label: "4. Argumentaires (IA)" },
  { key: "conditions", label: "5. Conditions" },
];

// ── Fetch helpers ─────────────────────────────────────────────────────────────

function getCsrfToken(): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(/csrftoken=([^;]+)/);
  return m ? m[1] : "";
}
async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error("Erreur de chargement");
  return res.json();
}
async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.detail ?? JSON.stringify(data));
  }
  return res.json();
}

// Gamma generation runs 1-3 min server-side — poll patiently.
async function pollGeneration(taskId: string): Promise<GenResult> {
  for (let i = 0; i < 120; i++) {
    const data = await getJson<{ status: string; result?: GenResult; error?: string }>(
      `/api/tasks/${taskId}/`,
    );
    if (data.status === "SUCCESS" && data.result) return data.result;
    if (data.status === "FAILURE") throw new Error(data.error ?? "Génération échouée.");
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("Délai de génération dépassé.");
}

// ── Wizard ─────────────────────────────────────────────────────────────────────

function ProjectWizard() {
  const router = useRouter();
  const simulationId = useSearchParams().get("simulation_id") ?? "";

  const { data: sim, error: simError } = useSWR<SimulationDetail>(
    simulationId ? `sim:${simulationId}` : null,
    () => getJson<SimulationDetail>(`/api/simulations/${simulationId}/`),
  );
  const { data: clientsResp } = useSWR("clients:all", () =>
    getJson<{ results?: ClientLite[] } | ClientLite[]>("/api/clients/?limit=1000"),
  );
  const clients = useMemo<ClientLite[]>(
    () => (Array.isArray(clientsResp) ? clientsResp : (clientsResp?.results ?? [])),
    [clientsResp],
  );

  const [step, setStep] = useState(0);
  // Overrides of sim-derived defaults (avoids copying fetched data into state).
  const [clientOverride, setClientOverride] = useState<string | null>(null);
  const [nameOverride, setNameOverride] = useState<string | null>(null);
  const [qtyOverride, setQtyOverride] = useState<Record<string, number>>({});
  const [sectionOverride, setSectionOverride] = useState<Record<string, boolean>>({});
  const [language, setLanguage] = useState("fr");
  const [expiration, setExpiration] = useState("");
  const [aiInstructions, setAiInstructions] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<GenResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clientId = clientOverride ?? sim?.client_ids?.[0] ?? "";
  const projectName = nameOverride ?? (sim?.project_name || sim?.label || "");
  const qty = (sku: string) => qtyOverride[sku] ?? 1;
  const sectionOn = (key: string) => sectionOverride[key] ?? true;

  if (!simulationId) return <Notice text="Paramètre simulation_id manquant." />;
  if (simError) return <Notice text="Simulation introuvable." />;
  if (sim && (sim.status !== "finalized" || sim.simulation_type !== "project")) {
    return <Notice text="La génération projet requiert une simulation finalisée de type projet." />;
  }

  const quantities = Object.fromEntries(
    (sim?.lines ?? []).map((l) => [l.product_sku, qty(l.product_sku)]),
  );
  const sectionsConfig = Object.fromEntries(SECTIONS.map((s) => [s.key, sectionOn(s.key)]));

  const canNext =
    (step === 0 && !!clientId && projectName.trim() !== "") ||
    (step === 1 && Object.values(quantities).some((q) => q > 0)) ||
    (step === 2 && expiration !== "") ||
    step === 3 ||
    step === 4;

  const runGeneration = async (offerRetryId?: string) => {
    setError(null);
    setSubmitting(true);
    try {
      const { task_id } = offerRetryId
        ? await postJson<{ task_id: string }>(`/api/offers/${offerRetryId}/regenerate/`)
        : await postJson<{ task_id: string }>(
            `/api/simulations/${simulationId}/generate-project-offer/`,
            {
              client_id: clientId,
              project_name: projectName,
              quantities,
              language,
              expiration_date: expiration,
              ai_instructions: aiInstructions,
              sections_config: sectionsConfig,
            },
          );
      setResult(await pollGeneration(task_id));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Échec de la génération.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Result / loading screens ──
  if (submitting) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <Loader2 className="mb-4 animate-spin text-[#E07200]" size={40} />
        <p className="font-medium text-slate-700">Génération du devis Gamma…</p>
        <p className="mt-1 text-sm text-slate-400">
          Argumentaires IA puis mise en page — 1 à 3 min.
        </p>
      </div>
    );
  }
  if (result) {
    const ok = result.generation_status === "ready";
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center py-24 text-center">
        <div
          className={cn(
            "mb-4 flex h-12 w-12 items-center justify-center rounded-full",
            ok ? "bg-green-100" : "bg-red-100",
          )}
        >
          {ok ? (
            <Check className="text-green-600" size={26} />
          ) : (
            <AlertTriangle className="text-red-600" size={24} />
          )}
        </div>
        {ok ? (
          <>
            <p className="font-semibold text-slate-800">Devis projet généré</p>
            {result.gamma_url && (
              <a
                href={result.gamma_url}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[#E07200] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#C56400]"
              >
                Ouvrir dans Gamma <ExternalLink size={15} />
              </a>
            )}
            <button
              onClick={() => router.push("/offers")}
              className="mt-3 text-sm text-slate-500 hover:text-slate-700"
            >
              Voir les offres
            </button>
          </>
        ) : (
          <>
            <p className="font-semibold text-slate-800">Échec de la génération Gamma</p>
            <p className="mt-1 max-w-md text-sm text-slate-500">{result.error}</p>
            <button
              onClick={() => runGeneration(result.offer_id)}
              className="mt-4 rounded-lg bg-[#E07200] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#C56400]"
            >
              Réessayer
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-semibold text-slate-900">Nouvelle offre projet (devis Gamma)</h1>
      <p className="mb-6 mt-0.5 text-sm text-slate-500">Depuis « {sim?.label ?? "…"} ».</p>

      <Stepper step={step} />

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="min-h-[300px] rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-sm">
        {step === 0 && (
          <Section title="Client & projet">
            <div className="flex max-w-md flex-col gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Client *</label>
                <select
                  value={clientId}
                  onChange={(e) => setClientOverride(e.target.value)}
                  className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#E07200]/30"
                >
                  <option value="">— Sélectionner —</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Nom du projet *
                </label>
                <input
                  value={projectName}
                  onChange={(e) => setNameOverride(e.target.value)}
                  className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#E07200]/30"
                />
              </div>
            </div>
          </Section>
        )}

        {step === 1 && (
          <Section title="Quantités par SKU" hint="Quantités prévues pour le projet.">
            <div className="overflow-hidden rounded-lg border border-[#E2E8F0]">
              <table className="w-full text-sm">
                <thead className="bg-[#F5F7FA] text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">SKU</th>
                    <th className="px-3 py-2 text-left">Désignation</th>
                    <th className="px-3 py-2 text-right">Quantité</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {(sim?.lines ?? []).map((l) => (
                    <tr key={l.id}>
                      <td className="px-3 py-2 font-medium text-slate-700">{l.product_sku}</td>
                      <td className="px-3 py-2 text-slate-600">{l.product_name}</td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min={0}
                          value={qty(l.product_sku)}
                          onChange={(e) =>
                            setQtyOverride((q) => ({
                              ...q,
                              [l.product_sku]: Number(e.target.value),
                            }))
                          }
                          className="w-24 rounded-lg border border-[#E2E8F0] px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-[#E07200]/30"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {step === 2 && (
          <Section title="Langue & validité">
            <div className="flex max-w-md flex-col gap-4">
              <div className="flex gap-3">
                {LANGUAGES.map((l) => (
                  <button
                    key={l.code}
                    type="button"
                    onClick={() => setLanguage(l.code)}
                    className={cn(
                      "rounded-lg border px-5 py-2.5 text-sm font-medium",
                      language === l.code
                        ? "border-[#E07200] bg-[#E07200] text-white"
                        : "border-[#E2E8F0] text-slate-600 hover:bg-slate-50",
                    )}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Date d&apos;expiration *
                </label>
                <input
                  type="date"
                  value={expiration}
                  onChange={(e) => setExpiration(e.target.value)}
                  className="w-full max-w-xs rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#E07200]/30"
                />
              </div>
            </div>
          </Section>
        )}

        {step === 3 && (
          <Section title="Sections du devis" hint="Les 5 sections fixes du devis Gamma.">
            <div className="flex flex-col gap-2">
              {SECTIONS.map((s) => (
                <label
                  key={s.key}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={sectionOn(s.key)}
                    onChange={() =>
                      setSectionOverride((o) => ({ ...o, [s.key]: !sectionOn(s.key) }))
                    }
                    className="accent-[#E07200]"
                  />
                  {s.label}
                </label>
              ))}
            </div>
          </Section>
        )}

        {step === 4 && (
          <Section title="Instructions IA" hint="Orientent les argumentaires générés (OpenAI).">
            <textarea
              value={aiInstructions}
              onChange={(e) => setAiInstructions(e.target.value)}
              rows={6}
              placeholder="Ex : insister sur la conformité CPR, la garantie 30 ans, et l'expérience datacenter."
              className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#E07200]/30"
            />
            <p className="mt-3 text-xs text-slate-500">
              {Object.values(quantities).filter((q) => q > 0).length} SKU · {language.toUpperCase()}{" "}
              · {SECTIONS.filter((s) => sectionOn(s.key)).length} sections
            </p>
          </Section>
        )}
      </div>

      <div className="mt-5 flex justify-between">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          className="rounded-lg border border-[#E2E8F0] px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
        >
          Précédent
        </button>
        {step < STEPS.length - 1 ? (
          <button
            type="button"
            onClick={() => setStep((s) => s + 1)}
            disabled={!canNext}
            className="rounded-lg bg-[#E07200] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#C56400] disabled:opacity-40"
          >
            Suivant
          </button>
        ) : (
          <button
            type="button"
            onClick={() => runGeneration()}
            className="rounded-lg bg-[#E07200] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#C56400]"
          >
            Générer le devis
          </button>
        )}
      </div>
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      {STEPS.map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          <div
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold",
              i < step
                ? "bg-green-500 text-white"
                : i === step
                  ? "bg-[#E07200] text-white"
                  : "bg-slate-100 text-slate-400",
            )}
          >
            {i < step ? <Check size={14} /> : i + 1}
          </div>
          <span
            className={cn("text-xs", i === step ? "font-medium text-slate-800" : "text-slate-400")}
          >
            {s}
          </span>
          {i < STEPS.length - 1 && <div className="h-px w-5 bg-slate-200" />}
        </div>
      ))}
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
      {hint && <p className="mb-3 text-xs text-slate-400">{hint}</p>}
      <div className={hint ? "" : "mt-3"}>{children}</div>
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <div className="p-6">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        {text}
      </div>
    </div>
  );
}

export default function NewProjectOfferPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-400">Chargement…</div>}>
      <ProjectWizard />
    </Suspense>
  );
}
