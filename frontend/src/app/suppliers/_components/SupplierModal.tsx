"use client";

import { useState } from "react";
import { mutate } from "swr";
import { AppModal } from "@/components/AppModal";
import { FormField } from "@/components/FormField";
import { OptionSelect } from "@/components/OptionSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { INCOTERMS_FALLBACK } from "@/lib/incoterms";
import { createSupplierEntity, updateSupplier, type Supplier } from "@/lib/api";

const CURRENCY_OPTIONS = [
  { value: "EUR", label: "EUR" },
  { value: "USD", label: "USD" },
  { value: "RMB", label: "RMB" },
] as const;

const NO_INCOTERM = "__none__";
const INCOTERM_OPTIONS = [
  { value: NO_INCOTERM, label: "Aucun" },
  ...INCOTERMS_FALLBACK.map((i) => ({ value: i.code, label: i.code })),
];

function slugifyCode(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase()
    .slice(0, 64);
}

export function SupplierModal({
  supplier,
  open,
  onClose,
}: {
  supplier?: Supplier;
  open: boolean;
  onClose: () => void;
}) {
  const isEdit = Boolean(supplier);
  const [name, setName] = useState(supplier?.name ?? "");
  const [code, setCode] = useState(supplier?.code ?? "");
  const [codeTouched, setCodeTouched] = useState(isEdit);
  const [currency, setCurrency] = useState(supplier?.currency_default ?? "RMB");
  const [incoterm, setIncoterm] = useState(supplier?.incoterm_default || NO_INCOTERM);
  const [factoryCode, setFactoryCode] = useState(supplier?.factory_code_default ?? "");
  const [location, setLocation] = useState(supplier?.location ?? "");
  const [notes, setNotes] = useState(supplier?.notes ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleNameChange = (value: string) => {
    setName(value);
    if (!codeTouched) setCode(slugifyCode(value));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const payload = {
        name: name.trim(),
        code: code.trim(),
        currency_default: currency,
        incoterm_default: incoterm === NO_INCOTERM ? "" : incoterm,
        factory_code_default: factoryCode.trim(),
        location: location.trim(),
        notes: notes.trim(),
      };
      if (supplier) {
        await updateSupplier(supplier.id, payload);
      } else {
        await createSupplierEntity(payload);
      }
      await mutate("suppliers");
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppModal
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={supplier ? "Modifier le fournisseur" : "Nouveau fournisseur"}
      size="lg"
    >
      {error && (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Nom" required>
            <Input required value={name} onChange={(e) => handleNameChange(e.target.value)} />
          </FormField>
          <FormField label="Code" required hint="Identifiant court unique">
            <Input
              required
              value={code}
              onChange={(e) => {
                setCodeTouched(true);
                setCode(e.target.value.toUpperCase());
              }}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Devise par défaut">
            <OptionSelect
              value={currency}
              onValueChange={(v) => setCurrency(v as Supplier["currency_default"])}
              options={CURRENCY_OPTIONS}
            />
          </FormField>
          <FormField label="Incoterm par défaut">
            <OptionSelect value={incoterm} onValueChange={setIncoterm} options={INCOTERM_OPTIONS} />
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Code usine par défaut">
            <Input value={factoryCode} onChange={(e) => setFactoryCode(e.target.value)} />
          </FormField>
          <FormField label="Localisation">
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Ville / pays"
            />
          </FormField>
        </div>

        <FormField label="Notes">
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormField>

        <div className="flex gap-3 pt-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={loading} className="flex-1">
            {loading ? "Enregistrement…" : supplier ? "Mettre à jour" : "Créer"}
          </Button>
        </div>
      </form>
    </AppModal>
  );
}
