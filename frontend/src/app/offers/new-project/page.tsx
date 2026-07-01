"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Warning, Check, ArrowSquareOut, CircleNotch } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { FormField } from "@/components/FormField";
import { FilterSelect } from "@/components/FilterSelect";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DocumentPicker } from "@/components/DocumentPicker";

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
  const [clientOverride, setClientOverride] = useState<string | null>(null);
  const [nameOverride, setNameOverride] = useState<string | null>(null);
  const [qtyOverride, setQtyOverride] = useState<Record<string, number>>({});
  const [sectionOverride, setSectionOverride] = useState<Record<string, boolean>>({});
  const [language, setLanguage] = useState("fr");
  const [expiration, setExpiration] = useState("");
  const [aiInstructions, setAiInstructions] = useState("");
  const [attachedDocIds, setAttachedDocIds] = useState<string[]>([]);

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
              attached_document_ids: attachedDocIds,
            },
          );
      setResult(await pollGeneration(task_id));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Échec de la génération.");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitting) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <CircleNotch className="mb-4 animate-spin text-warm" size={40} />
        <p className="font-medium text-foreground">Génération du devis Gamma…</p>
        <p className="mt-1 text-sm text-muted-foreground">
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
            ok ? "bg-brand-green/10" : "bg-destructive/10",
          )}
        >
          {ok ? (
            <Check className="text-brand-green" size={26} weight="bold" />
          ) : (
            <Warning className="text-destructive" size={24} weight="duotone" />
          )}
        </div>
        {ok ? (
          <>
            <p className="font-semibold text-foreground">Devis projet généré</p>
            {result.gamma_url && (
              <a
                href={result.gamma_url}
                target="_blank"
                rel="noreferrer"
                className={cn(buttonVariants(), "mt-3 inline-flex gap-2")}
              >
                Ouvrir dans Gamma
                <ArrowSquareOut size={15} weight="duotone" />
              </a>
            )}
            <Button
              variant="ghost"
              onClick={() => router.push("/offers")}
              className="mt-3 text-muted-foreground"
            >
              Voir les offres
            </Button>
          </>
        ) : (
          <>
            <p className="font-semibold text-foreground">Échec de la génération Gamma</p>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">{result.error}</p>
            <Button onClick={() => runGeneration(result.offer_id)} className="mt-4">
              Réessayer
            </Button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-semibold text-foreground">Nouvelle offre projet (devis Gamma)</h1>
      <p className="mb-6 mt-0.5 text-sm text-muted-foreground">Depuis « {sim?.label ?? "…"} ».</p>

      <Stepper step={step} />

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card className="min-h-[300px] p-5">
        {step === 0 && (
          <Section title="Client & projet">
            <div className="flex max-w-md flex-col gap-4">
              <FormField label="Client" required>
                <FilterSelect
                  value={clientId}
                  onChange={(v) => setClientOverride(v)}
                  placeholder="— Sélectionner —"
                  options={clients.map((c) => ({ value: c.id, label: c.name }))}
                />
              </FormField>
              <FormField label="Nom du projet" required>
                <Input value={projectName} onChange={(e) => setNameOverride(e.target.value)} />
              </FormField>
            </div>
          </Section>
        )}

        {step === 1 && (
          <Section title="Quantités par SKU" hint="Quantités prévues pour le projet.">
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">SKU</th>
                    <th className="px-3 py-2 text-left">Désignation</th>
                    <th className="px-3 py-2 text-right">Quantité</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(sim?.lines ?? []).map((l) => (
                    <tr key={l.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2 font-medium text-foreground">{l.product_sku}</td>
                      <td className="px-3 py-2 text-muted-foreground">{l.product_name}</td>
                      <td className="px-3 py-2 text-right">
                        <Input
                          type="number"
                          min={0}
                          value={qty(l.product_sku)}
                          onChange={(e) =>
                            setQtyOverride((q) => ({
                              ...q,
                              [l.product_sku]: Number(e.target.value),
                            }))
                          }
                          className="ml-auto w-24 text-right font-data"
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
                  <Button
                    key={l.code}
                    type="button"
                    variant={language === l.code ? "default" : "outline"}
                    onClick={() => setLanguage(l.code)}
                  >
                    {l.label}
                  </Button>
                ))}
              </div>
              <FormField label="Date d'expiration" required>
                <Input
                  type="date"
                  value={expiration}
                  onChange={(e) => setExpiration(e.target.value)}
                  className="max-w-xs"
                />
              </FormField>
            </div>
          </Section>
        )}

        {step === 3 && (
          <Section title="Sections du devis" hint="Les 5 sections fixes du devis Gamma.">
            <div className="flex flex-col gap-2">
              {SECTIONS.map((s) => (
                <label
                  key={s.key}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted/50"
                >
                  <Checkbox
                    checked={sectionOn(s.key)}
                    onCheckedChange={() =>
                      setSectionOverride((o) => ({ ...o, [s.key]: !sectionOn(s.key) }))
                    }
                  />
                  {s.label}
                </label>
              ))}
            </div>
          </Section>
        )}

        {step === 4 && (
          <Section title="Instructions IA" hint="Orientent les argumentaires générés (OpenAI).">
            <Textarea
              value={aiInstructions}
              onChange={(e) => setAiInstructions(e.target.value)}
              rows={6}
              placeholder="Ex : insister sur la conformité CPR, la garantie 30 ans, et l'expérience datacenter."
            />
            <div className="mt-4">
              <FormField label="Documents joints (bibliothèque → PDF fusionné)">
                <DocumentPicker selected={attachedDocIds} onChange={setAttachedDocIds} />
              </FormField>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {Object.values(quantities).filter((q) => q > 0).length} SKU · {language.toUpperCase()}{" "}
              · {SECTIONS.filter((s) => sectionOn(s.key)).length} sections
              {attachedDocIds.length > 0 ? ` · ${attachedDocIds.length} doc(s)` : ""}
            </p>
          </Section>
        )}
      </Card>

      <div className="mt-5 flex justify-between">
        <Button
          type="button"
          variant="outline"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
        >
          Précédent
        </Button>
        {step < STEPS.length - 1 ? (
          <Button type="button" onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
            Suivant
          </Button>
        ) : (
          <Button type="button" onClick={() => runGeneration()}>
            Générer le devis
          </Button>
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
                ? "bg-brand-green text-white"
                : i === step
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {i < step ? <Check size={14} weight="bold" /> : i + 1}
          </div>
          <span
            className={cn(
              "text-xs",
              i === step ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {s}
          </span>
          {i < STEPS.length - 1 && <div className="h-px w-5 bg-border" />}
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
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {hint && <p className="mb-3 text-xs text-muted-foreground">{hint}</p>}
      <div className={hint ? "" : "mt-3"}>{children}</div>
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <div className="p-6">
      <div className="rounded-lg border border-warm/30 bg-warm/10 p-4 text-sm text-warm">
        {text}
      </div>
    </div>
  );
}

export default function NewProjectOfferPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Chargement…</div>}>
      <ProjectWizard />
    </Suspense>
  );
}
