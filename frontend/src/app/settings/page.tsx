import { Settings } from "lucide-react";

export default function SettingsPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Paramètres</h1>
        <p className="text-sm text-slate-500 mt-0.5">Configuration de la plateforme</p>
      </div>
      <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-sm flex flex-col items-center justify-center py-24 gap-4 text-slate-400">
        <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center">
          <Settings size={28} className="text-slate-300" />
        </div>
        <div className="text-center">
          <p className="font-medium text-slate-600">Paramètres système</p>
          <p className="text-sm mt-1">Configuration des paramètres marché et intégrations.</p>
        </div>
      </div>
    </div>
  );
}
