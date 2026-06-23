"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Plus, Calculator, Clock, FileCheck, Archive, GitCompare, Bookmark } from "lucide-react";
import { getSimulations, type Simulation } from "@/lib/api";
import { cn } from "@/lib/utils";

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-slate-200 rounded", className)} />;
}

function StatusBadge({ status, dirty }: { status: Simulation["status"]; dirty?: boolean }) {
  const map = {
    finalized: { label: "Finalisé", cls: "bg-green-100 text-green-700", Icon: FileCheck },
    archived: { label: "Archivé", cls: "bg-slate-100 text-slate-500", Icon: Archive },
    draft: { label: "Brouillon", cls: "bg-amber-100 text-amber-700", Icon: Clock },
  } as const;
  const { label, cls, Icon } = map[status] ?? map.draft;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold", cls)}>
        <Icon size={11} />
        {label}
      </span>
      {dirty && status === "draft" && (
        <span className="inline-flex w-2 h-2 rounded-full bg-orange-400" title="Recalcul nécessaire" />
      )}
    </span>
  );
}

const COLS = ["Nom", "Type", "Lignes", "Statut", "Dernier calcul", "Modifié"];

export default function SimulatorPage() {
  const router = useRouter();
  const [includeArchived, setIncludeArchived] = useState(false);
  const { data: simulations, isLoading, error } = useSWR<Simulation[]>(
    ["simulations", includeArchived],
    () => getSimulations({ includeArchived })
  );

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Simulations</h1>
          {!isLoading && simulations && (
            <p className="text-sm text-slate-500 mt-0.5">
              {simulations.length} simulation{simulations.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 accent-[#E07200]"
            />
            Inclure les archivées
          </label>
          <button
            onClick={() => router.push("/simulator/compare")}
            className="flex items-center gap-2 px-4 py-2.5 border border-[#E2E8F0] text-slate-700 text-sm font-medium rounded-lg transition-colors hover:bg-slate-50"
          >
            <GitCompare size={16} />
            Comparer
          </button>
          <button
            onClick={() => router.push("/simulator/compare?aside=saved")}
            className="flex items-center gap-2 px-3 py-2.5 border border-[#E2E8F0] text-slate-500 text-sm rounded-lg transition-colors hover:bg-slate-50"
            title="Comparaisons enregistrées"
          >
            <Bookmark size={16} />
          </button>
          <button
            onClick={() => router.push("/simulator/new")}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#E07200] hover:bg-[#C56400] text-white text-sm font-semibold rounded-lg transition-colors shadow-sm"
          >
            <Plus size={16} />
            Nouvelle simulation
          </button>
        </div>
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-sm overflow-hidden">
        {error ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3">
            <Calculator size={40} className="text-slate-200" />
            <p className="text-sm">Impossible de charger les simulations.</p>
            <p className="text-xs text-slate-300">{error?.message}</p>
          </div>
        ) : isLoading ? (
          <table className="w-full">
            <thead className="bg-[#F5F7FA] border-b border-[#E2E8F0]">
              <tr>
                {COLS.map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {COLS.map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : !simulations?.length ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400 gap-4">
            <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center">
              <Calculator size={28} className="text-slate-300" />
            </div>
            <div className="text-center">
              <p className="font-medium text-slate-600">Aucune simulation</p>
              <p className="text-sm mt-1">
                Créez votre première simulation en cliquant sur &ldquo;Nouvelle simulation&rdquo;.
              </p>
            </div>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-[#F5F7FA] border-b border-[#E2E8F0]">
              <tr>
                {COLS.map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {simulations.map((sim) => (
                <tr
                  key={sim.id}
                  onClick={() => router.push(`/simulator/${sim.id}`)}
                  className="hover:bg-[#FFF3E0] cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3 text-sm font-semibold text-slate-800">
                    {sim.label}
                    {sim.project_name && (
                      <span className="block text-xs font-normal text-slate-400">{sim.project_name}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {sim.simulation_type === "tariff" ? "Tarif" : "Projet"}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">{sim.line_count}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={sim.status} dirty={sim.is_dirty} />
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500">
                    {sim.last_calculated_at
                      ? new Date(sim.last_calculated_at).toLocaleDateString("fr-FR", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500">
                    {new Date(sim.updated_at).toLocaleDateString("fr-FR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
