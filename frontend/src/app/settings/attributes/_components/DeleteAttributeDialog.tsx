"use client";

import { useState } from "react";
import { CircleNotch, Warning } from "@phosphor-icons/react";
import { deleteAttribute, type AttributeRegistry } from "@/lib/api";
import { AppModal } from "@/components/AppModal";
import { FormField } from "@/components/FormField";
import { AppIcon } from "@/components/AppIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUiTranslate } from "@/lib/use-ui-translate";

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
  const t = useUiTranslate();
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
      setError(err instanceof Error ? err.message : t("settings.deleteFailedDot"));
      setDeleting(false);
    }
  };

  return (
    <AppModal open onOpenChange={(open) => !open && onClose()} title={t("settings.attributes.deleteTitle")}>
      {error && (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="mb-4 flex gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
        <AppIcon icon={Warning} size="md" className="mt-0.5 shrink-0 text-destructive" />
        <div className="text-sm text-destructive">
          <p className="font-semibold">{t("settings.attributes.deleteIrreversible")}</p>
          <p className="mt-1">
            {t("settings.attributes.deleteLead")}{" "}
            <span className="font-mono font-semibold">{attribute.code}</span>{" "}
            {t("settings.attributes.deleteJoin")}{" "}
            <span className="font-semibold">
              {t(
                count > 1
                  ? "settings.attributes.valueCountOther"
                  : "settings.attributes.valueCountOne",
                { count },
              )}
            </span>{" "}
            {t(
              count > 1
                ? "settings.attributes.deleteTailOther"
                : "settings.attributes.deleteTailOne",
            )}
          </p>
        </div>
      </div>

      <FormField
        label={t("settings.attributes.confirmCode", { code: attribute.code })}
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
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          variant="destructive"
          className="flex-1"
          onClick={handleDelete}
          disabled={!matches || deleting}
        >
          {deleting && <AppIcon icon={CircleNotch} size="sm" className="animate-spin" />}
          {t("settings.attributes.deleteForever")}
        </Button>
      </div>
    </AppModal>
  );
}
