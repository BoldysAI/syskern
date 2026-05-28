"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Loader2 } from "lucide-react";
import { createSimulation, type SimulationType } from "@/lib/api";

function pctToDecimal(pct: string): string {
  const n = parseFloat(pct);
  return Number.isFinite(n) ? (n / 100).toFixed(4) : "0.0000";
}

export default function NewSimulationPage() {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [type, setType] = useState<SimulationType>("tariff");
  const [projectName, setProjectName] = useState("");
  const [mixPct, setMixPct] = useState("0");
  const [symeaPct, setSymeaPct] = useState("6");
  const [syskernPct, setSyskernPct] = useState("20");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const sim = await createSimulation({
        label: label.trim(),
        simulation_type: type,
        project_name: type === "project" ? projectName.trim() : "",
        stock_purchase_mix_pct: parseInt(mixPct, 10) || 0,
        symea_margin_rate: pctToDecimal(symeaPct),
        syskern_margin_rate: pctToDecimal(syskernPct),
      });
      router.push(`/simulator/${sim.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Création échouée");
      setSaving(false);
    }
  };

  const inputCls =
    "w-full px-3 py-2 text-sm border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#E07200]/30 focus:border-[#E07200]";
  const labelCls = "block text-xs font-semibold text-slate-600 mb-1.5";

  return (
    <div className="p-6 max-w-2xl">
      <Link
        href="/simulator"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-4"
      >
        <ChevronLeft size={16} />
        Retour aux simulations
      </Link>

      <h1 className="text-xl font-semibold text-slate-900 mb-6">Nouvelle simulation</h1>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="bg-white border border-[#E2E8F0] rounded-xl shadow-sm p-6 flex flex-col gap-5"
      >
        <div>
          <label className={labelCls}>Libellé *</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="ex. Tarif Q2 2026"
            required
            className={inputCls}
          />
        </div>

        <div>
          <label className={labelCls}>Type *</label>
          <div className="flex gap-2">
            {(["tariff", "project"] as SimulationType[]).map((t) => (
              <button
                type="button"
                key={t}
                onClick={() => setType(t)}
                className={
                  "flex-1 py-2 text-sm font-medium rounded-lg border transition-colors " +
                  (type === t
                    ? "border-[#E07200] bg-[#FFF3E0] text-[#C56400]"
                    : "border-[#E2E8F0] text-slate-600 hover:bg-slate-50")
                }
              >
                {t === "tariff" ? "Tarif" : "Projet"}
              </button>
            ))}
          </div>
        </div>

        {type === "project" && (
          <div>
            <label className={labelCls}>Nom du projet</label>
            <input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="ex. Datacenter Lyon"
              className={inputCls}
            />
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>Mix stock/achat (%)</label>
            <input
              type="number"
              min={0}
              max={100}
              value={mixPct}
              onChange={(e) => setMixPct(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Marge Symea (%)</label>
            <input
              type="number"
              min={0}
              max={99}
              step="0.1"
              value={symeaPct}
              onChange={(e) => setSymeaPct(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Marge Syskern (%)</label>
            <input
              type="number"
              min={0}
              max={99}
              step="0.1"
              value={syskernPct}
              onChange={(e) => setSyskernPct(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <Link
            href="/simulator"
            className="flex-1 text-center py-2.5 text-sm border border-[#E2E8F0] rounded-lg hover:bg-slate-50 transition-colors text-slate-600"
          >
            Annuler
          </Link>
          <button
            type="submit"
            disabled={saving || !label.trim()}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm bg-[#E07200] hover:bg-[#C56400] text-white rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving && <Loader2 size={15} className="animate-spin" />}
            {saving ? "Création…" : "Créer la simulation"}
          </button>
        </div>
      </form>
    </div>
  );
}
