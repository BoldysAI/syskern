"use client";

import { SimulationParamsSheet } from "@/app/simulator/_components/SimulationParamsSheet";
import type { SimulationStatus } from "@/lib/api";

interface Props {
  simulationId: string | null;
  simulationLabel: string;
  simulationStatus: SimulationStatus | null;
  open: boolean;
  onClose: () => void;
  onSaved: (result: { sourceId: string; effectiveId: string }) => void;
}

export function CompareSimulationParamsSheet({
  simulationId,
  simulationLabel,
  simulationStatus,
  open,
  onClose,
  onSaved,
}: Props) {
  return (
    <SimulationParamsSheet
      simulationId={simulationId}
      simulationLabel={simulationLabel}
      simulationStatus={simulationStatus}
      open={open}
      onClose={onClose}
      onSaved={onSaved}
      duplicateLabelSuffix="(comparaison)"
      finalizedForkDescription={`La simulation « ${simulationLabel} » est finalisée et ne peut pas être modifiée directement. Enregistrer créera une nouvelle simulation en mode brouillon avec les paramètres saisis, qui remplacera cette colonne dans la comparaison. La simulation d'origine reste inchangée.`}
      finalizedBanner={
        <>
          Cette simulation est <strong>finalisée</strong>. Toute modification créera une{" "}
          <strong>nouvelle simulation en brouillon</strong> à partir de vos paramètres, qui
          remplacera cette colonne dans la comparaison. L&apos;original reste intact.
        </>
      }
    />
  );
}
