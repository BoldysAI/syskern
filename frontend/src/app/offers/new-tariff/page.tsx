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
import { Check, GripVertical, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

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
const LANGUAGES: { code: string; label: string }[] = [
  { code: "fr", label: "Français" },
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
];
const STEPS = ["Clients", "Colonnes", "Devise", "Langue", "Validité"];
const DEFAULT_COLUMNS = new Set(["sku_code", "name", "range", "unit_price", "currency"]);

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

async function pollTask(taskId: string): Promise<number> {
  for (let i = 0; i < 60; i++) {
    const data = await getJson<{ status: string; result?: { count: number }; error?: string }>(
      `/api/tasks/${taskId}/`,
    );
    if (data.status === "SUCCESS") return data.result?.count ?? 0;
    if (data.status === "FAILURE") throw new Error(data.error ?? "Génération échouée.");
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Délai de génération dépassé.");
}

// ── Sortable column row ────────────────────────────────────────────────────────

function SortableColumn({
  col,
  onToggle,
}: {
  col: { key: string; label: string; selected: boolean };
  onToggle: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: col.key,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-3 px-3 py-2 bg-white border border-border rounded-lg",
        isDragging && "shadow-lg opacity-80",
      )}
    >
      <button
        type="button"
        className="cursor-grab touch-none text-slate-300 hover:text-slate-500"
        {...attributes}
        {...listeners}
        aria-label="Réordonner"
      >
        <GripVertical size={16} />
      </button>
      <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={col.selected}
          onChange={onToggle}
          className="accent-primary"
        />
        {col.label}
      </label>
    </div>
  );
}

// ── Wizard ─────────────────────────────────────────────────────────────────────

function TariffWizard() {
  const router = useRouter();
  const params = useSearchParams();
  const simulationId = params.get("simulation_id") ?? "";

  const { data: simulation, error: simError } = useSWR<SimulationLite>(
    simulationId ? `sim:${simulationId}` : null,
    () => getJson<SimulationLite>(`/api/simulations/${simulationId}/`),
  );
  const { data: clientsResp } = useSWR("clients:all", () =>
    getJson<{ results?: ClientLite[] } | ClientLite[]>("/api/clients/?limit=1000"),
  );
  const { data: columnOpts } = useSWR("tariff-columns", () =>
    getJson<ColumnOpt[]>("/api/offers/tariff-columns/?lang=fr"),
  );

  const clients = useMemo<ClientLite[]>(
    () => (Array.isArray(clientsResp) ? clientsResp : (clientsResp?.results ?? [])),
    [clientsResp],
  );

  const [step, setStep] = useState(0);
  // Selection/order kept as user *overrides* of derived defaults, so we never
  // copy fetched data into state inside an effect.
  const [clientToggles, setClientToggles] = useState<Record<string, boolean>>({});
  const [columnToggles, setColumnToggles] = useState<Record<string, boolean>>({});
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [currency, setCurrency] = useState("EUR");
  const [language, setLanguage] = useState("fr");
  const [expiration, setExpiration] = useState("");
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
    return <Notice text="Aucune simulation indiquée (paramètre simulation_id manquant)." />;
  }
  if (simError) {
    return <Notice text="Simulation introuvable." />;
  }
  if (
    simulation &&
    (simulation.status !== "finalized" || simulation.simulation_type !== "tariff")
  ) {
    return (
      <Notice text="La génération tarifaire requiert une simulation finalisée de type tarif." />
    );
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
          expiration_date: expiration,
          label,
        },
      );
      const count = await pollTask(task_id);
      setGenCount(count);
      setTimeout(() => router.push(`/offers?generated=${count}`), 1200);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Échec de la génération.");
      setSubmitting(false);
    }
  };

  if (submitting) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        {genCount === null ? (
          <>
            <Loader2 className="mb-4 animate-spin text-warm" size={40} />
            <p className="font-medium text-slate-700">
              Génération de {selectedClientIds.length} offre
              {selectedClientIds.length > 1 ? "s" : ""}…
            </p>
            <p className="mt-1 text-sm text-slate-400">Un fichier Excel par client.</p>
          </>
        ) : (
          <>
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
              <Check className="text-green-600" size={26} />
            </div>
            <p className="font-semibold text-slate-800">{genCount} offre(s) générée(s)</p>
            <p className="mt-1 text-sm text-slate-400">Redirection vers les offres…</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-semibold text-slate-900">Nouvelle offre tarifaire</h1>
      <p className="mb-6 mt-0.5 text-sm text-slate-500">
        Depuis « {simulation?.label ?? "…"} » — un fichier Excel par client.
      </p>

      <Stepper step={step} />

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="min-h-[280px] rounded-xl border border-border bg-white p-5 shadow-sm">
        {step === 0 && (
          <Section title="Clients destinataires" hint="Une offre sera générée par client.">
            {clients.length === 0 ? (
              <p className="text-sm text-slate-400">Aucun client disponible.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {clients.map((c) => (
                  <label
                    key={c.id}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={isClientSelected(c.id)}
                      onChange={() =>
                        setClientToggles((t) => ({ ...t, [c.id]: !isClientSelected(c.id) }))
                      }
                      className="accent-primary"
                    />
                    {c.name}
                  </label>
                ))}
              </div>
            )}
          </Section>
        )}

        {step === 1 && (
          <Section title="Colonnes de l'Excel" hint="Cochez et glissez pour ordonner.">
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
          <Section title="Devise de sortie" hint="Conversion via les taux figés de la simulation.">
            <div className="flex gap-3">
              {CURRENCIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCurrency(c)}
                  className={cn(
                    "rounded-lg border px-5 py-2.5 text-sm font-medium",
                    currency === c
                      ? "border-primary bg-primary text-white"
                      : "border-border text-slate-600 hover:bg-slate-50",
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </Section>
        )}

        {step === 3 && (
          <Section title="Langue de l'offre">
            <div className="flex gap-3">
              {LANGUAGES.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  onClick={() => setLanguage(l.code)}
                  className={cn(
                    "rounded-lg border px-5 py-2.5 text-sm font-medium",
                    language === l.code
                      ? "border-primary bg-primary text-white"
                      : "border-border text-slate-600 hover:bg-slate-50",
                  )}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </Section>
        )}

        {step === 4 && (
          <Section title="Validité & libellé">
            <div className="flex max-w-sm flex-col gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Date d&apos;expiration *
                </label>
                <input
                  type="date"
                  value={expiration}
                  onChange={(e) => setExpiration(e.target.value)}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Libellé (optionnel)
                </label>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={simulation?.label ?? ""}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <p className="text-xs text-slate-500">
                {selectedClientIds.length} offre(s) · {selectedColumnKeys.length} colonne(s) ·{" "}
                {currency} · {language.toUpperCase()}
              </p>
            </div>
          </Section>
        )}
      </div>

      <div className="mt-5 flex justify-between">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          className="rounded-lg border border-border px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
        >
          Précédent
        </button>
        {step < STEPS.length - 1 ? (
          <button
            type="button"
            onClick={() => setStep((s) => s + 1)}
            disabled={!canNext}
            className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-40"
          >
            Suivant
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!canNext}
            className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-40"
          >
            Générer {selectedClientIds.length} offre(s)
          </button>
        )}
      </div>
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <div className="mb-5 flex items-center gap-2">
      {STEPS.map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          <div
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold",
              i < step
                ? "bg-green-500 text-white"
                : i === step
                  ? "bg-primary text-white"
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
          {i < STEPS.length - 1 && <div className="h-px w-6 bg-slate-200" />}
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

export default function NewTariffOfferPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-400">Chargement…</div>}>
      <TariffWizard />
    </Suspense>
  );
}
