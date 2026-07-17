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

interface Props {
  open: boolean;
  transport: TransportDraft | null;
  isPurchase: boolean;
  onClose: () => void;
}

export function SaveTransportPresetModal({ open, transport, isPurchase, onClose }: Props) {
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
      setError("Indiquez un nom pour ce preset.");
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
      toast.success("Preset transport enregistré.");
      setName("");
      setError(null);
      onClose();
    } catch (err) {
      const msg = humanizeApiError(err, "Enregistrement échoué.");
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
      title="Enregistrer comme preset"
      size="md"
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Ce transport sera disponible dans la liste des presets pour toutes les chaînes PA et PV.
        </p>
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted-foreground">Nom</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ex. Conteneur 40′ — import Chine"
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
            Annuler
          </Button>
          <Button type="submit" className="flex-1" disabled={saving || !transport}>
            {saving ? (
              <>
                <CircleNotch size={16} className="animate-spin" />
                Enregistrement…
              </>
            ) : (
              "Enregistrer"
            )}
          </Button>
        </div>
      </form>
    </AppModal>
  );
}
