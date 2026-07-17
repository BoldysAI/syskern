"use client";

import { useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { CircleNotch, PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import { useConfirm } from "@/components/ConfirmProvider";
import { AppModal } from "@/components/AppModal";
import { AppIcon } from "@/components/AppIcon";
import { FormField } from "@/components/FormField";
import { OptionSelect } from "@/components/OptionSelect";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createTransportPreset,
  deleteTransportPreset,
  listTransportModes,
  listTransportPresets,
  updateTransportPreset,
  type TransportMode,
  type TransportPreset,
} from "@/lib/api";
import { toast } from "sonner";

const TRANSPORT_CATEGORIES = [
  { value: "maritime", label: "Maritime" },
  { value: "road", label: "Route" },
  { value: "air", label: "Aérien" },
  { value: "rail", label: "Ferroviaire" },
] as const;

const CURRENCIES = ["EUR", "USD", "RMB"] as const;

function ActiveBadge({ active }: { active: boolean }) {
  return <StatusBadge variant={active ? "success" : "draft"}>{active ? "Oui" : "Non"}</StatusBadge>;
}

function TransportPresetModal({
  preset,
  transportModes,
  onClose,
}: {
  preset?: TransportPreset;
  transportModes: TransportMode[];
  onClose: () => void;
}) {
  const [name, setName] = useState(preset?.name ?? "");
  const [modeCode, setModeCode] = useState(preset?.transport_mode_code ?? "");
  const [category, setCategory] = useState<TransportPreset["category"]>(
    preset?.category ?? "maritime",
  );
  const [globalCost, setGlobalCost] = useState(preset?.global_cost ?? "");
  const [currency, setCurrency] = useState(preset?.currency ?? "USD");
  const [palletCount, setPalletCount] = useState(preset?.pallet_count ?? "");
  const [fromLocation, setFromLocation] = useState(preset?.from_location ?? "");
  const [toLocation, setToLocation] = useState(preset?.to_location ?? "");
  const [displayOrder, setDisplayOrder] = useState(preset?.display_order?.toString() ?? "0");
  const [isActive, setIsActive] = useState(preset?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeModes = transportModes.filter((m) => m.is_active);

  const onModeChange = (code: string) => {
    setModeCode(code);
    const mode = activeModes.find((m) => m.code === code);
    if (mode) {
      setCategory(mode.category);
      if (!palletCount && mode.default_pallet_capacity != null) {
        setPalletCount(String(mode.default_pallet_capacity));
      }
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload: Partial<TransportPreset> = {
      name: name.trim(),
      transport_mode_code: modeCode.trim().toUpperCase(),
      category,
      global_cost: globalCost.trim(),
      currency,
      pallet_count: palletCount.trim(),
      from_location: fromLocation.trim(),
      to_location: toLocation.trim(),
      display_order: displayOrder ? parseInt(displayOrder, 10) : 0,
      is_active: isActive,
    };
    try {
      if (preset) await updateTransportPreset(preset.id, payload);
      else await createTransportPreset(payload);
      await globalMutate("transport-presets");
      await globalMutate(
        (key) => Array.isArray(key) && key[0] === "transport-presets",
        undefined,
        { revalidate: true },
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
      setSaving(false);
    }
  };

  return (
    <AppModal
      open
      onOpenChange={(open) => !open && onClose()}
      title={preset ? "Modifier le preset transport" : "Nouveau preset transport"}
      size="lg"
    >
      {error && (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <form onSubmit={submit} className="flex flex-col gap-4">
        <FormField label="Nom" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </FormField>
        <FormField label="Ordre d'affichage">
          <Input
            type="number"
            value={displayOrder}
            onChange={(e) => setDisplayOrder(e.target.value)}
            min={0}
            className="max-w-[8rem]"
          />
        </FormField>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Mode de transport" required>
            <OptionSelect
              value={modeCode}
              onValueChange={onModeChange}
              options={activeModes.map((m) => ({
                value: m.code,
                label: m.label?.fr ? `${m.code} — ${m.label.fr}` : m.code,
              }))}
              placeholder="Sélectionner…"
            />
          </FormField>
          <FormField label="Catégorie" required>
            <OptionSelect
              value={category}
              onValueChange={(v) => setCategory(v as TransportPreset["category"])}
              options={[...TRANSPORT_CATEGORIES]}
            />
          </FormField>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FormField label="Coût global">
            <Input value={globalCost} onChange={(e) => setGlobalCost(e.target.value)} inputMode="decimal" />
          </FormField>
          <FormField label="Devise" required>
            <OptionSelect
              value={currency}
              onValueChange={setCurrency}
              options={CURRENCIES.map((c) => ({ value: c, label: c }))}
            />
          </FormField>
          <FormField label="Palettes">
            <Input value={palletCount} onChange={(e) => setPalletCount(e.target.value)} inputMode="numeric" />
          </FormField>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Origine">
            <Input value={fromLocation} onChange={(e) => setFromLocation(e.target.value)} />
          </FormField>
          <FormField label="Destination">
            <Input value={toLocation} onChange={(e) => setToLocation(e.target.value)} />
          </FormField>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="transport-preset-active"
            checked={isActive}
            onCheckedChange={(v) => setIsActive(v === true)}
          />
          <Label htmlFor="transport-preset-active" className="text-sm font-normal">
            Actif
          </Label>
        </div>
        <div className="flex gap-3 pt-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={saving} className="flex-1">
            {saving && <AppIcon icon={CircleNotch} size="sm" className="animate-spin" />}
            {preset ? "Mettre à jour" : "Créer"}
          </Button>
        </div>
      </form>
    </AppModal>
  );
}

export default function TabTransportPresets() {
  const confirm = useConfirm();
  const { data: presets, isLoading, error } = useSWR<TransportPreset[]>("transport-presets", () =>
    listTransportPresets(),
  );
  const { data: transportModes } = useSWR<TransportMode[]>("transport-modes", () =>
    listTransportModes(),
  );
  const [editing, setEditing] = useState<TransportPreset | "new" | null>(null);

  const handleDelete = async (preset: TransportPreset) => {
    const ok = await confirm({
      title: "Supprimer le preset transport",
      description: `Supprimer « ${preset.name} » ?`,
      confirmLabel: "Supprimer",
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteTransportPreset(preset.id);
      await globalMutate("transport-presets");
      await globalMutate(
        (key) => Array.isArray(key) && key[0] === "transport-presets",
        undefined,
        { revalidate: true },
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Suppression échouée");
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Modèles de legs transport partagés (chaînes PA et PV). Créez vos presets ici ou depuis une
          simulation (icône signet sur un transport). Modifiables après insertion dans une chaîne.
        </p>
        <Button onClick={() => setEditing("new")}>
          <AppIcon icon={Plus} size="sm" />
          Nouveau preset
        </Button>
      </div>

      <Card className="overflow-hidden py-0">
        {error ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Impossible de charger.</div>
        ) : isLoading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Chargement…</div>
        ) : !presets?.length ? (
          <div className="py-12 text-center text-muted-foreground">
            <p className="text-sm">Aucun preset transport. Créez-en un pour accélérer les chaînes PA/PV.</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="border-b border-border bg-muted/50">
              <tr>
                {["Nom", "Mode", "Palettes", "Coût", "Actif", ""].map((h) => (
                  <th
                    key={h}
                    className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {presets.map((p) => (
                <tr key={p.id} className="hover:bg-muted/30">
                  <td className="max-w-[220px] truncate px-4 py-2.5 text-sm font-medium text-foreground" title={p.name}>
                    {p.name}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-sm text-muted-foreground">{p.transport_mode_code}</td>
                  <td className="px-4 py-2.5 text-sm text-muted-foreground">{p.pallet_count || "—"}</td>
                  <td className="px-4 py-2.5 text-sm text-muted-foreground">
                    {p.global_cost ? `${p.global_cost} ${p.currency}` : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <ActiveBadge active={p.is_active} />
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <Button variant="ghost" size="icon-sm" onClick={() => setEditing(p)} title="Modifier">
                        <AppIcon icon={PencilSimple} size="sm" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => void handleDelete(p)}
                        title="Supprimer"
                      >
                        <AppIcon icon={Trash} size="sm" className="text-muted-foreground" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {editing !== null && transportModes && (
        <TransportPresetModal
          preset={editing === "new" ? undefined : editing}
          transportModes={transportModes}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
