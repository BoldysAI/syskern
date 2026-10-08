"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, DotsSixVertical, CircleNotch } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useUiTranslate } from "@/lib/use-ui-translate";
import { FormField } from "@/components/FormField";
import { WizardStepper } from "@/components/WizardStepper";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { DocumentPicker } from "@/components/DocumentPicker";
import { OfferCoverageWarning } from "@/components/OfferCoverageWarning";

// ── Types ────────────────────────────────────────────────────────────────────

interface SimulationLite {
  id: string;
  label: string;
  client_ids: string[];
  simulation_type: string;
  status: string;
}
interface ClientLite {
  id: string;
  name: string;
}
interface ColumnOpt {
  key: string;
  label: string;
}

const CURRENCIES = ["EUR", "USD", "RMB"] as const;
const DEFAULT_COLUMNS = new Set(["sku_code", "name", "range", "unit_price", "currency"]);

// ── Fetch helpers ─────────────────────────────────────────────────────────────

function getCsrfToken(): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(/csrftoken=([^;]+)/);
  return m ? m[1] : "";
}

async function getJson<T>(url: string, loadError: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(loadError);
  return res.json();
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.detail ?? JSON.stringify(data));
  }
  return res.json();
}

async function pollTask(
  taskId: string,
  loadError: string,
  failed: string,
  timeout: string,
): Promise<number> {
  for (let i = 0; i < 60; i++) {
    const data = await getJson<{ status: string; result?: { count: number }; error?: string }>(
      `/api/tasks/${taskId}/`,
      loadError,
    );
    if (data.status === "SUCCESS") return data.result?.count ?? 0;
    if (data.status === "FAILURE") throw new Error(data.error ?? failed);
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(timeout);
}

// ── Sortable column row ────────────────────────────────────────────────────────

function SortableColumn({
  col,
  onToggle,
}: {
  col: { key: string; label: string; selected: boolean };
  onToggle: () => void;
}) {
  const t = useUiTranslate();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: col.key,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2",
        isDragging && "opacity-80 shadow-lg",
      )}
    >
      <button
        type="button"
        className="cursor-grab touch-none text-muted-foreground/50 hover:text-muted-foreground"
        {...attributes}
        {...listeners}
        aria-label={t("offers.tariff.reorder")}
      >
        <DotsSixVertical size={16} />
      </button>
      <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm text-foreground">
        <Checkbox checked={col.selected} onCheckedChange={onToggle} />
        {col.label}
      </label>
    </div>
  );
}

// ── Wizard ─────────────────────────────────────────────────────────────────────

function TariffWizard() {
  const router = useRouter();
  const params = useSearchParams();
  const t = useUiTranslate();
  const simulationId = params.get("simulation_id") ?? "";
  const steps = [
    t("offers.tariff.step.clients"),
    t("offers.tariff.step.columns"),
    t("offers.tariff.step.currency"),
    t("offers.tariff.step.language"),
    t("offers.tariff.step.validity"),
  ];
  const languages = [
    { code: "fr" as const, label: t("offers.language.fr") },
    { code: "en" as const, label: t("offers.language.en") },
    { code: "es" as const, label: t("offers.language.es") },
  ];

  const { data: simulation, error: simError } = useSWR<SimulationLite>(
    simulationId ? `sim:${simulationId}` : null,
    () =>
      getJson<SimulationLite>(`/api/simulations/${simulationId}/`, t("offers.errors.load")),
  );
  const { data: clientsResp } = useSWR("clients:all", () =>
    getJson<{ results?: ClientLite[] } | ClientLite[]>(
      "/api/clients/?limit=1000",
      t("offers.errors.load"),
    ),
  );
  const { data: columnOpts } = useSWR("tariff-columns", () =>
    getJson<ColumnOpt[]>("/api/offers/tariff-columns/?lang=fr", t("offers.errors.load")),
  );

  const clients = useMemo<ClientLite[]>(
    () => (Array.isArray(clientsResp) ? clientsResp : (clientsResp?.results ?? [])),
    [clientsResp],
  );

  const [step, setStep] = useState(0);
  const [clientToggles, setClientToggles] = useState<Record<string, boolean>>({});
  const [columnToggles, setColumnToggles] = useState<Record<string, boolean>>({});
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [currency, setCurrency] = useState("EUR");
  const [language, setLanguage] = useState("fr");
  const [languagePerClient, setLanguagePerClient] = useState(false);
  const [expiration, setExpiration] = useState("");
  const [attachedDocIds, setAttachedDocIds] = useState<string[]>([]);
  const [label, setLabel] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [genCount, setGenCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const defaultClients = useMemo(
    () => new Set(simulation?.client_ids ?? []),
    [simulation?.client_ids],
  );
  const isClientSelected = (id: string) =>
    id in clientToggles ? clientToggles[id] : defaultClients.has(id);
  const selectedClientIds = useMemo(
    () => clients.filter((c) => isClientSelected(c.id)).map((c) => c.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clients, clientToggles, defaultClients],
  );

  const columns = useMemo(() => {
    if (!columnOpts) return [];
    const byKey = new Map(columnOpts.map((c) => [c.key, c]));
    const keys = columnOrder.length ? columnOrder.filter((k) => byKey.has(k)) : [];
    for (const c of columnOpts) if (!keys.includes(c.key)) keys.push(c.key);
    return keys.map((k) => ({
      key: k,
      label: byKey.get(k)!.label,
      selected: k in columnToggles ? columnToggles[k] : DEFAULT_COLUMNS.has(k),
    }));
  }, [columnOpts, columnOrder, columnToggles]);
  const selectedColumnKeys = columns.filter((c) => c.selected).map((c) => c.key);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const keys = columns.map((c) => c.key);
    const oldIndex = keys.indexOf(String(active.id));
    const newIndex = keys.indexOf(String(over.id));
    setColumnOrder(arrayMove(keys, oldIndex, newIndex));
  };

  if (!simulationId) {
    return <Notice text={t("offers.tariff.missingSimulation")} />;
  }
  if (simError) {
    return <Notice text={t("offers.wizard.simulationNotFound")} />;
  }
  if (
    simulation &&
    (simulation.status !== "finalized" || simulation.simulation_type !== "tariff")
  ) {
    return <Notice text={t("offers.tariff.requiresFinalized")} />;
  }

  const canNext =
    (step === 0 && selectedClientIds.length > 0) ||
    (step === 1 && selectedColumnKeys.length > 0) ||
    step === 2 ||
    step === 3 ||
    (step === 4 && expiration !== "");

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const { task_id } = await postJson<{ task_id: string }>(
        `/api/simulations/${simulationId}/generate-tariff-offers/`,
        {
          client_ids: selectedClientIds,
          columns: selectedColumnKeys,
          target_currency: currency,
          language,
          language_per_client: languagePerClient,
          expiration_date: expiration,
          label,
          attached_document_ids: attachedDocIds,
        },
      );
      const count = await pollTask(
        task_id,
        t("offers.errors.load"),
        t("offers.errors.generationFailed"),
        t("offers.errors.generationTimeout"),
      );
      setGenCount(count);
      setTimeout(() => router.push(`/offers?generated=${count}`), 1200);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("offers.errors.generateFailed"));
      setSubmitting(false);
    }
  };

  if (submitting) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        {genCount === null ? (
          <>
            <CircleNotch className="mb-4 animate-spin text-brand-green" size={40} />
            <p className="font-medium text-foreground">
              {selectedClientIds.length > 1
                ? t("offers.tariff.generatingOther", { count: selectedClientIds.length })
                : t("offers.tariff.generatingOne", { count: selectedClientIds.length })}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{t("offers.tariff.perClientFile")}</p>
          </>
        ) : (
          <>
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-green/10">
              <Check className="text-brand-green" size={26} weight="bold" />
            </div>
            <p className="font-semibold text-foreground">
              {t("offers.tariff.generated", { count: genCount })}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{t("offers.tariff.redirecting")}</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-semibold text-foreground">{t("offers.tariff.title")}</h1>
      <p className="mb-6 mt-0.5 text-sm text-muted-foreground">
        {t("offers.tariff.fromSimulation", { label: simulation?.label ?? "…" })}
      </p>

      <WizardStepper
        steps={steps.map((label) => ({ label }))}
        current={step}
        onStepClick={setStep}
      />

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card className="min-h-[280px] p-5">
        {step === 0 && (
          <Section title={t("offers.tariff.recipients")} hint={t("offers.tariff.recipientsHint")}>
            {clients.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("offers.tariff.noClients")}</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {clients.map((c) => (
                  <label
                    key={c.id}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={isClientSelected(c.id)}
                      onCheckedChange={() =>
                        setClientToggles((t) => ({ ...t, [c.id]: !isClientSelected(c.id) }))
                      }
                    />
                    {c.name}
                  </label>
                ))}
              </div>
            )}
          </Section>
        )}

        {step === 1 && (
          <Section title={t("offers.tariff.columns")} hint={t("offers.tariff.columnsHint")}>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext
                items={columns.map((c) => c.key)}
                strategy={verticalListSortingStrategy}
              >
                <div className="flex flex-col gap-1.5">
                  {columns.map((c) => (
                    <SortableColumn
                      key={c.key}
                      col={c}
                      onToggle={() => setColumnToggles((t) => ({ ...t, [c.key]: !c.selected }))}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </Section>
        )}

        {step === 2 && (
          <Section
            title={t("offers.tariff.outputCurrency")}
            hint={t("offers.tariff.outputCurrencyHint")}
          >
            <div className="flex gap-3">
              {CURRENCIES.map((c) => (
                <Button
                  key={c}
                  type="button"
                  variant={currency === c ? "default" : "outline"}
                  onClick={() => setCurrency(c)}
                >
                  {c}
                </Button>
              ))}
            </div>
          </Section>
        )}

        {step === 3 && (
          <Section title={t("offers.tariff.offerLanguage")}>
            <div className="flex flex-col gap-4">
              <label className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/40 p-3">
                <div>
                  <span className="text-sm font-medium text-foreground">
                    {t("offers.tariff.languagePerClient")}
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {t("offers.tariff.languagePerClientHint")}
                  </p>
                </div>
                <Switch checked={languagePerClient} onCheckedChange={setLanguagePerClient} />
              </label>
              <div className="flex gap-3">
                {languages.map((l) => (
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
            </div>
          </Section>
        )}

        {step === 4 && (
          <Section title={t("offers.tariff.validityLabel")}>
            <div className="flex max-w-sm flex-col gap-4">
              <FormField label={t("offers.wizard.expirationDate")} required>
                <Input
                  type="date"
                  value={expiration}
                  onChange={(e) => setExpiration(e.target.value)}
                />
              </FormField>
              <FormField label={t("offers.tariff.labelOptional")}>
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={simulation?.label ?? ""}
                />
              </FormField>
              <FormField label={t("offers.tariff.attachments")}>
                <DocumentPicker selected={attachedDocIds} onChange={setAttachedDocIds} />
              </FormField>
              <OfferCoverageWarning
                simulationId={simulationId}
                body={
                  languagePerClient
                    ? { client_ids: selectedClientIds, language_per_client: true }
                    : { language }
                }
              />
              <p className="text-xs text-muted-foreground">
                {t("offers.tariff.summary", {
                  offers: selectedClientIds.length,
                  columns: selectedColumnKeys.length,
                  currency,
                  language: language.toUpperCase(),
                })}
                {attachedDocIds.length > 0
                  ? t("offers.tariff.summaryDocs", { count: attachedDocIds.length })
                  : ""}
              </p>
            </div>
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
          {t("offers.wizard.previous")}
        </Button>
        {step < steps.length - 1 ? (
          <Button type="button" onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
            {t("offers.wizard.next")}
          </Button>
        ) : (
          <Button type="button" onClick={submit} disabled={!canNext}>
            {t("offers.tariff.generate", { count: selectedClientIds.length })}
          </Button>
        )}
      </div>
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

export default function NewTariffOfferPage() {
  const t = useUiTranslate();
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>}>
      <TariffWizard />
    </Suspense>
  );
}
