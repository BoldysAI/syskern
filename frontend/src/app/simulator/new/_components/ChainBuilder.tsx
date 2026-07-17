"use client";

import { useState } from "react";
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
import { DotsSixVertical, BookmarkSimple, Plus, Trash } from "@phosphor-icons/react";
import { FilterSelect } from "@/components/FilterSelect";
import { LocationSelectField } from "@/components/LocationSelectField";
import type { TransportMode } from "@/lib/api";
import { listTransportPresets } from "@/lib/api";
import { cn } from "@/lib/utils";
import { localizeLabel } from "@/lib/transport-modes";
import {
  canSaveTransportAsPreset,
  presetToTransportDraft,
} from "@/lib/transport-presets";
import { SaveTransportPresetModal } from "./SaveTransportPresetModal";
import type { ChainDraft, TransportDraft } from "./wizard-draft";

interface Props {
  title: string;
  chain: ChainDraft;
  isPurchase: boolean;
  transportModes: TransportMode[];
  onChange: (chain: ChainDraft) => void;
}

const CURRENCIES = ["EUR", "USD", "RMB"];

const fieldCls =
  "w-full px-2 py-1.5 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary";

function uid(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : String(Math.random());
}

function SortableTransport({
  transport,
  modes,
  onChange,
  onRemove,
  onSaveAsPreset,
}: {
  transport: TransportDraft;
  modes: TransportMode[];
  onChange: (t: TransportDraft) => void;
  onRemove: () => void;
  onSaveAsPreset?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: transport.uid,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  const set = (patch: Partial<TransportDraft>) => onChange({ ...transport, ...patch });

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex gap-2 p-3 border border-border rounded-lg bg-card",
        isDragging && "opacity-60 shadow-md"
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="touch-none text-muted-foreground/60 hover:text-muted-foreground cursor-grab active:cursor-grabbing"
        aria-label="Réordonner ce transport"
      >
        <DotsSixVertical size={18} />
      </button>

      <div className="min-w-0 flex-1 space-y-2">
        <FilterSelect
          value={transport.transport_mode_code}
          onChange={(code) => {
            const mode = modes.find((m) => m.code === code);
            set({
              transport_mode_code: code,
              category: mode?.category ?? transport.category,
              pallet_count:
                transport.pallet_count ||
                (mode?.default_pallet_capacity != null
                  ? String(mode.default_pallet_capacity)
                  : transport.pallet_count),
            });
          }}
          placeholder="Mode…"
          options={modes.map((m) => ({
            value: m.code,
            label: localizeLabel(m.label, m.code),
          }))}
          compact
          className="w-full"
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <input
            value={transport.global_cost}
            onChange={(e) => set({ global_cost: e.target.value })}
            placeholder="Coût global"
            inputMode="decimal"
            className={fieldCls}
            aria-label="Coût global"
          />
          <FilterSelect
            value={transport.currency}
            onChange={(currency) => set({ currency })}
            placeholder="Devise"
            options={CURRENCIES.map((c) => ({ value: c, label: c }))}
            compact
            className="w-full"
          />
          <input
            value={transport.pallet_count}
            onChange={(e) => set({ pallet_count: e.target.value })}
            placeholder="Palettes"
            inputMode="numeric"
            className={cn(fieldCls, "col-span-2 sm:col-span-1")}
            aria-label="Nombre de palettes"
          />
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <LocationSelectField
            value={transport.from_location}
            onChange={(from_location) => set({ from_location })}
            ariaLabel="Origine"
            emptyLabel="De"
            inputClassName={fieldCls}
          />
          <LocationSelectField
            value={transport.to_location}
            onChange={(to_location) => set({ to_location })}
            ariaLabel="Destination"
            emptyLabel="À"
            inputClassName={fieldCls}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1 self-start">
        {onSaveAsPreset && canSaveTransportAsPreset(transport) && (
          <button
            type="button"
            onClick={onSaveAsPreset}
            className="text-muted-foreground hover:text-primary p-1"
            aria-label="Enregistrer comme preset"
            title="Enregistrer comme preset"
          >
            <BookmarkSimple size={16} />
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          className="text-muted-foreground hover:text-red-500 p-1"
          aria-label="Supprimer ce transport"
        >
          <Trash size={16} />
        </button>
      </div>
    </div>
  );
}

export function ChainBuilder({ title, chain, isPurchase, transportModes, onChange }: Props) {
  const [presetPick, setPresetPick] = useState("");
  const [savePresetTransport, setSavePresetTransport] = useState<TransportDraft | null>(null);
  const { data: presets = [] } = useSWR(["transport-presets"], () =>
    listTransportPresets({ activeOnly: true }),
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = chain.transports.findIndex((t) => t.uid === active.id);
    const newIndex = chain.transports.findIndex((t) => t.uid === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onChange({ ...chain, transports: arrayMove(chain.transports, oldIndex, newIndex) });
  };

  const addTransport = (draft: Partial<TransportDraft> = {}) =>
    onChange({
      ...chain,
      transports: [
        ...chain.transports,
        {
          uid: uid(),
          transport_mode_code: "",
          category: "",
          global_cost: "",
          currency: isPurchase ? "USD" : "EUR",
          pallet_count: "",
          from_location: "",
          to_location: "",
          ...draft,
        },
      ],
    });

  const applyPreset = (presetId: string) => {
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) return;
    addTransport(presetToTransportDraft(preset));
    setPresetPick("");
  };

  const updateTransport = (uidKey: string, t: TransportDraft) =>
    onChange({
      ...chain,
      transports: chain.transports.map((x) => (x.uid === uidKey ? t : x)),
    });

  const removeTransport = (uidKey: string) =>
    onChange({ ...chain, transports: chain.transports.filter((x) => x.uid !== uidKey) });

  return (
    <div className="border border-border rounded-xl bg-card shadow-sm p-4 flex flex-col gap-4">
      <h3 className="text-sm font-bold text-foreground">{title}</h3>

      {isPurchase && (
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={chain.copper_variation}
              onChange={(e) => onChange({ ...chain, copper_variation: e.target.checked })}
              className="w-4 h-4 rounded border-border accent-primary"
            />
            Variation cuivre
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={chain.currency_conversion}
              onChange={(e) => onChange({ ...chain, currency_conversion: e.target.checked })}
              className="w-4 h-4 rounded border-border accent-primary"
            />
            Conversion en EUR
          </label>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Transport
        </span>
        <div className="flex flex-wrap gap-2">
          {(["detailed", "coefficient"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() =>
                onChange({
                  ...chain,
                  transportPricingMode: mode,
                })
              }
              className={cn(
                "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
                chain.transportPricingMode === mode
                  ? "border-primary bg-accent text-accent-foreground"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {mode === "detailed" ? "Modules détaillés" : "Coefficient"}
            </button>
          ))}
        </div>

        {chain.transportPricingMode === "coefficient" ? (
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <label className="mb-1 block text-xs font-semibold text-muted-foreground">
              Coefficient multiplicateur (×)
            </label>
            <input
              value={chain.transportCoefficient}
              onChange={(e) => onChange({ ...chain, transportCoefficient: e.target.value })}
              placeholder="ex. 1,05"
              inputMode="decimal"
              className={fieldCls}
              aria-label="Coefficient transport"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Alternative aux transports détaillés : le prix est multiplié par ce coefficient dans
              la chaîne {isPurchase ? "PA" : "PV"}.
            </p>
          </div>
        ) : (
          <>
            <span className="text-xs text-muted-foreground">
              Transports {chain.transports.length > 0 && `(${chain.transports.length})`}
            </span>
            {chain.transports.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aucun transport. Ajoutez-en si nécessaire.
              </p>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={chain.transports.map((t) => t.uid)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="flex flex-col gap-2">
                    {chain.transports.map((t) => (
                      <SortableTransport
                        key={t.uid}
                        transport={t}
                        modes={transportModes}
                        onChange={(next) => updateTransport(t.uid, next)}
                        onRemove={() => removeTransport(t.uid)}
                        onSaveAsPreset={() => setSavePresetTransport(t)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => addTransport()}
                className="flex items-center gap-1.5 rounded-lg border border-primary bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Plus size={15} />
                Ajouter un transport
              </button>
              {presets.length > 0 && (
                <FilterSelect
                  value={presetPick}
                  onChange={(value) => {
                    setPresetPick(value);
                    if (value) applyPreset(value);
                  }}
                  placeholder="Preset transport…"
                  options={presets.map((p) => ({ value: p.id, label: p.name }))}
                  compact
                  className="min-w-[12rem] flex-1 sm:flex-none"
                />
              )}
            </div>
          </>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-[#F1F5F9] pt-3">
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={chain.customs.enabled}
            onChange={(e) =>
              onChange({ ...chain, customs: { ...chain.customs, enabled: e.target.checked } })
            }
            className="w-4 h-4 rounded border-border accent-primary"
          />
          Douane
        </label>
        {chain.customs.enabled && (
          <div className="pl-6">
            <label className="mb-1 block text-xs font-semibold text-muted-foreground">
              Taux de douane (%)
            </label>
            <input
              value={chain.customs.rate_pct}
              onChange={(e) =>
                onChange({ ...chain, customs: { ...chain.customs, rate_pct: e.target.value } })
              }
              placeholder="Ex. 5 pour +5 %"
              inputMode="decimal"
              className={fieldCls}
              aria-label="Taux de douane en pourcentage"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Majoration en pourcentage sur le prix d&apos;entrée (ex. 5 % → prix × 1,05).
            </p>
          </div>
        )}
      </div>

      <SaveTransportPresetModal
        open={savePresetTransport != null}
        transport={savePresetTransport}
        isPurchase={isPurchase}
        onClose={() => setSavePresetTransport(null)}
      />
    </div>
  );
}
