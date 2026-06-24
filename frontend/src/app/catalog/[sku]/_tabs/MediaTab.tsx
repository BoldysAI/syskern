"use client";

import { ImageIcon } from "lucide-react";

export function MediaTab() {
  return (
    <div className="bg-white border border-dashed border-border rounded-xl p-12 flex flex-col items-center justify-center gap-3 text-center shadow-sm">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
        <ImageIcon size={26} className="text-slate-400" />
      </div>
      <p className="text-sm font-semibold text-slate-600">Médias</p>
      <span className="inline-flex px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-semibold">
        Disponible en MVP2
      </span>
      <p className="text-xs text-slate-400 max-w-xs">
        La gestion des images et documents produits sera disponible dans une prochaine version.
      </p>
    </div>
  );
}
