"use client";

import useSWR from "swr";
import { Plus, Calculator, Clock, FileCheck } from "lucide-react";
import { getSimulations, type Simulation } from "@/lib/api";
import { cn } from "@/lib/utils";

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-slate-200 rounded", className)} />;
}

function StatusBadge({ status }: { status: Simulation["status"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold",
        status === "finalized"
          ? "bg-green-100 text-green-700"
          : "bg-slate-100 text-slate-600"
      )}
    >
      {status === "finalized" ? (
        <FileCheck size={11} />
      ) : (
        <Clock size={11} />
      )}
      {status === "finalized" ? "Finalisé" : "Brouillon"}
    </span>
  );
}

export default function SimulatorPage() {
  const { data: simulations, isLoading, error } = useSWR<Simulation[]>(
    "simulations",
    getSimulations
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
        <button className="flex items-center gap-2 px-4 py-2.5 bg-[#E07200] hover:bg-[#C56400] text-white text-sm font-semibold rounded-lg transition-colors shadow-sm">
          <Plus size={16} />
          Nouvelle simulation
        </button>
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
                {["Nom", "Date", "Lignes", "Status", "PA moyen", "Dernière modif"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 6 }).map((_, j) => (
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
                {["Nom", "Date", "Lignes", "Status", "PA moyen", "Dernière modif"].map((h) => (
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
                  className="hover:bg-[#FFF3E0] cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3 text-sm font-semibold text-slate-800">
                    {sim.name}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500">
                    {new Date(sim.created_at).toLocaleDateString("fr-FR")}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {sim.line_count ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={sim.status} />
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-slate-800">
                    {sim.avg_pa != null
                      ? `${sim.avg_pa.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500">
                    {new Date(sim.updated_at).toLocaleDateString("fr-FR", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
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
