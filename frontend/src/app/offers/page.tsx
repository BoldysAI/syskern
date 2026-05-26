import { FileText } from "lucide-react";

export default function OffersPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Offres</h1>
        <p className="text-sm text-slate-500 mt-0.5">Gestion des offres commerciales</p>
      </div>
      <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-sm flex flex-col items-center justify-center py-24 gap-4 text-slate-400">
        <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center">
          <FileText size={28} className="text-slate-300" />
        </div>
        <div className="text-center">
          <p className="font-medium text-slate-600">Module à venir</p>
          <p className="text-sm mt-1">La gestion des offres sera disponible prochainement.</p>
        </div>
      </div>
    </div>
  );
}
