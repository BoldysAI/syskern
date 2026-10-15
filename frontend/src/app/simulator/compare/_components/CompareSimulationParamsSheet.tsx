"use client";

import { SimulationParamsSheet } from "@/app/simulator/_components/SimulationParamsSheet";
import type { SimulationStatus } from "@/lib/api";
import { useUiTranslate } from "@/lib/use-ui-translate";

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
  const t = useUiTranslate();
  return (
    <SimulationParamsSheet
      simulationId={simulationId}
      simulationLabel={simulationLabel}
      simulationStatus={simulationStatus}
      open={open}
      onClose={onClose}
      onSaved={onSaved}
      duplicateLabelSuffix={t("simulator.params.compareSuffix")}
      finalizedForkDescription={t("simulator.params.compareFork", { name: simulationLabel })}
      finalizedBanner={
        <>
          {t("simulator.params.archivedLead")}
          <strong>{t("simulator.params.finalizedInline")}</strong>
          {t("simulator.params.compareFinalizedMid")}
          <strong>{t("simulator.params.newDraft")}</strong>
          {t("simulator.params.compareFinalizedEnd")}
        </>
      }
    />
  );
}
