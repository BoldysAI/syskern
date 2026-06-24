"use client";

import { useState } from "react";
import { CircleNotch, Warning } from "@phosphor-icons/react";
import { deleteAttribute, type AttributeRegistry } from "@/lib/api";
import { AppModal } from "@/components/AppModal";
import { FormField } from "@/components/FormField";
import { AppIcon } from "@/components/AppIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Explicit delete confirmation (CDC §4.1.4). Shows how many
 * product_attribute_values will be cascade-deleted and requires the operator
 * to retype the attribute `code` before deletion is enabled.
 */
export default function DeleteAttributeDialog({
  attribute,
  onClose,
  onDeleted,
}: {
  attribute: AttributeRegistry;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const count = attribute.value_count ?? 0;
  const matches = confirmText === attribute.code;

  const handleDelete = async () => {
    if (!matches) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteAttribute(attribute.id);
      onDeleted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suppression échouée.");
      setDeleting(false);
    }
  };

  return (
    <AppModal open onOpenChange={(open) => !open && onClose()} title="Supprimer l'attribut">
      {error && (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="mb-4 flex gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
        <AppIcon icon={Warning} size="md" className="mt-0.5 shrink-0 text-destructive" />
        <div className="text-sm text-destructive">
          <p className="font-semibold">Cette action est irréversible.</p>
          <p className="mt-1">
            L&apos;attribut <span className="font-mono font-semibold">{attribute.code}</span> et{" "}
            <span className="font-semibold">
              {count} valeur{count > 1 ? "s" : ""}
            </span>{" "}
            de produit associée{count > 1 ? "s" : ""} seront supprimée{count > 1 ? "s" : ""} en
            cascade.
          </p>
        </div>
      </div>

      <FormField
        label={`Saisissez le code ${attribute.code} pour confirmer`}
        htmlFor="confirm-code"
      >
        <Input
          id="confirm-code"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          className="font-mono"
          placeholder={attribute.code}
          autoFocus
        />
      </FormField>

      <div className="flex gap-3 pt-5">
        <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
          Annuler
        </Button>
        <Button
          type="button"
          variant="destructive"
          className="flex-1"
          onClick={handleDelete}
          disabled={!matches || deleting}
        >
          {deleting && <AppIcon icon={CircleNotch} size="sm" className="animate-spin" />}
          Supprimer définitivement
        </Button>
      </div>
    </AppModal>
  );
}
