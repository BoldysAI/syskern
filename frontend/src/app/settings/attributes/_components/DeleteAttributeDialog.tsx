"use client";

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { deleteAttribute, type AttributeRegistry } from "@/lib/api";
import { cn } from "@/lib/utils";
import Modal from "./Modal";

const inputCls =
  "w-full px-3 py-2 text-sm border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400 font-mono";

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
    <Modal title="Supprimer l'attribut" onClose={onClose}>
      {error && (
        <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex gap-3 p-3 bg-red-50 border border-red-200 rounded-lg mb-4">
        <AlertTriangle size={20} className="text-red-500 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-red-700">
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

      <label className="block text-xs font-semibold text-slate-600 mb-1.5">
        Saisissez le code <span className="font-mono text-slate-800">{attribute.code}</span> pour
        confirmer
      </label>
      <input
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        className={inputCls}
        placeholder={attribute.code}
        autoFocus
      />

      <div className="flex gap-3 pt-5">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 py-2.5 text-sm border border-[#E2E8F0] rounded-lg hover:bg-slate-50 text-slate-600"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={!matches || deleting}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-2.5 text-sm rounded-lg font-semibold text-white",
            "bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          {deleting && <Loader2 size={14} className="animate-spin" />}
          Supprimer définitivement
        </button>
      </div>
    </Modal>
  );
}
