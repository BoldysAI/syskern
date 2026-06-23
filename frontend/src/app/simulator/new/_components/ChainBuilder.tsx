"use client";

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
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { LocationSelectField } from "@/components/LocationSelectField";
import type { TransportMode } from "@/lib/api";
import { cn } from "@/lib/utils";
import { localizeLabel } from "@/lib/transport-modes";
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
  "w-full px-2 py-1.5 text-sm border border-[#E2E8F0] rounded-md focus:outline-none focus:ring-2 focus:ring-[#E07200]/30 focus:border-[#E07200]";

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
}: {
  transport: TransportDraft;
  modes: TransportMode[];
  onChange: (t: TransportDraft) => void;
  onRemove: () => void;
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
        "flex gap-2 p-3 border border-[#E2E8F0] rounded-lg bg-white",
        isDragging && "opacity-60 shadow-md"
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="touch-none text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing"
        aria-label="Réordonner ce transport"
      >
        <GripVertical size={18} />
      </button>

      <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-2">
        <div className="col-span-2 sm:col-span-1">
          <select
            value={transport.transport_mode_code}
            onChange={(e) => {
              const mode = modes.find((m) => m.code === e.target.value);
              set({
                transport_mode_code: e.target.value,
                category: mode?.category ?? transport.category,
              });
            }}
            className={fieldCls}
            aria-label="Mode de transport"
          >
            <option value="">Mode…</option>
            {modes.map((m) => (
              <option key={m.id} value={m.code}>
                {localizeLabel(m.label, m.code)}
              </option>
            ))}
          </select>
        </div>
        <input
          value={transport.global_cost}
          onChange={(e) => set({ global_cost: e.target.value })}
          placeholder="Coût global"
          inputMode="decimal"
          className={fieldCls}
          aria-label="Coût global"
        />
        <select
          value={transport.currency}
          onChange={(e) => set({ currency: e.target.value })}
          className={fieldCls}
          aria-label="Devise"
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          value={transport.pallet_count}
          onChange={(e) => set({ pallet_count: e.target.value })}
          placeholder="Palettes"
          inputMode="numeric"
          className={fieldCls}
          aria-label="Nombre de palettes"
        />
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

      <button
        type="button"
        onClick={onRemove}
        className="text-slate-400 hover:text-red-500 self-start p-1"
        aria-label="Supprimer ce transport"
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}

export function ChainBuilder({ title, chain, isPurchase, transportModes, onChange }: Props) {
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

  const addTransport = () =>
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
        },
      ],
    });

  const updateTransport = (uidKey: string, t: TransportDraft) =>
    onChange({
      ...chain,
      transports: chain.transports.map((x) => (x.uid === uidKey ? t : x)),
    });

  const removeTransport = (uidKey: string) =>
    onChange({ ...chain, transports: chain.transports.filter((x) => x.uid !== uidKey) });

  return (
    <div className="border border-[#E2E8F0] rounded-xl bg-white shadow-sm p-4 flex flex-col gap-4">
      <h3 className="text-sm font-bold text-slate-800">{title}</h3>

      {isPurchase && (
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={chain.copper_variation}
              onChange={(e) => onChange({ ...chain, copper_variation: e.target.checked })}
              className="w-4 h-4 rounded border-slate-300 accent-[#E07200]"
            />
            Variation cuivre
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={chain.currency_conversion}
              onChange={(e) => onChange({ ...chain, currency_conversion: e.target.checked })}
              className="w-4 h-4 rounded border-slate-300 accent-[#E07200]"
            />
            Conversion en EUR
          </label>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          Transports {chain.transports.length > 0 && `(${chain.transports.length})`}
        </span>
        {chain.transports.length === 0 ? (
          <p className="text-sm text-slate-400">Aucun transport. Ajoutez-en si nécessaire.</p>
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
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
        <button
          type="button"
          onClick={addTransport}
          className="flex items-center gap-1.5 self-start px-3 py-1.5 text-sm font-medium text-[#C56400] border border-[#E07200]/40 rounded-lg hover:bg-[#FFF3E0]"
        >
          <Plus size={15} />
          Transport
        </button>
      </div>

      <div className="flex flex-col gap-2 border-t border-[#F1F5F9] pt-3">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={chain.customs.enabled}
            onChange={(e) =>
              onChange({ ...chain, customs: { ...chain.customs, enabled: e.target.checked } })
            }
            className="w-4 h-4 rounded border-slate-300 accent-[#E07200]"
          />
          Douane
        </label>
        {chain.customs.enabled && (
          <div className="pl-6">
            <label className="mb-1 block text-xs font-semibold text-slate-600">
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
            <p className="mt-1 text-[11px] text-slate-400">
              Majoration en pourcentage sur le prix d&apos;entrée (ex. 5 % → prix × 1,05).
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
