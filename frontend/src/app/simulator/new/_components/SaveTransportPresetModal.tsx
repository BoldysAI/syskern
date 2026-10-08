"use client";

import { useState } from "react";
import { CircleNotch } from "@phosphor-icons/react";
import { mutate as globalMutate } from "swr";
import { AppModal } from "@/components/AppModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createTransportPreset } from "@/lib/api";
import { humanizeApiError } from "@/lib/humanize-errors";
import {
  transportDraftToPresetPayload,
} from "@/lib/transport-presets";
import type { TransportDraft } from "./wizard-draft";
import { toast } from "sonner";
import { useUiTranslate } from "@/lib/use-ui-translate";

interface Props {
  open: boolean;
  transport: TransportDraft | null;
  isPurchase: boolean;
  onClose: () => void;
}

export function SaveTransportPresetModal({ open, transport, isPurchase, onClose }: Props) {
  const t = useUiTranslate();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    if (saving) return;
    setName("");
    setError(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transport) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("simulator.preset.nameRequired"));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await createTransportPreset(
        transportDraftToPresetPayload(
          transport,
          trimmed,
          transport.currency || (isPurchase ? "USD" : "EUR"),
        ),
      );
      await globalMutate(
        (key) => Array.isArray(key) && key[0] === "transport-presets",
        undefined,
        { revalidate: true },
      );
      toast.success(t("simulator.preset.saved"));
      setName("");
      setError(null);
      onClose();
    } catch (err) {
      const msg = humanizeApiError(err, t("simulator.saveFailed"));
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppModal
      open={open}
      onOpenChange={(v) => !v && handleClose()}
      title={t("simulator.preset.save")}
      size="md"
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {t("simulator.preset.help")}
        </p>
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted-foreground">{t("simulator.preset.name")}</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("simulator.preset.namePlaceholder")}
            autoFocus
            required
          />
        </div>
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        <div className="flex gap-3 pt-1">
          <Button type="button" variant="outline" className="flex-1" onClick={handleClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" className="flex-1" disabled={saving || !transport}>
            {saving ? (
              <>
                <CircleNotch size={16} className="animate-spin" />
                {t("simulator.saving")}
              </>
            ) : (
              t("common.save")
            )}
          </Button>
        </div>
      </form>
    </AppModal>
  );
}
