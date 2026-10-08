"use client";

import { SealCheck } from "@phosphor-icons/react";
import { CatalogSidebar } from "@/app/catalog/_components/CatalogSidebar";
import { FilterSection } from "@/components/FilterSection";
import { FilterCheckboxGroup } from "@/components/FilterCheckboxGroup";
import type { CatalogFilters } from "@/lib/api";
import { useUiTranslate } from "@/lib/use-ui-translate";
import type { MessageKey } from "@/lib/i18n";

const STATUS_OPTIONS = [
  { value: "ok", label: "simulator.status.ok" },
  { value: "warning", label: "simulator.status.warnings" },
  { value: "error", label: "simulator.status.errors" },
] as const satisfies readonly { value: string; label: MessageKey }[];

export type LineStatusFilterKey = (typeof STATUS_OPTIONS)[number]["value"];

interface Props {
  filters: CatalogFilters;
  onChange: (filters: CatalogFilters) => void;
  statusIn: LineStatusFilterKey[];
  onStatusInChange: (statuses: LineStatusFilterKey[]) => void;
}

export function SimulationLineStatusFilterSection({
  statusIn,
  onStatusInChange,
}: Pick<Props, "statusIn" | "onStatusInChange">) {
  const t = useUiTranslate();
  return (
    <FilterSection title={t("simulator.filters.calcStatus")} icon={SealCheck} activeCount={statusIn.length}>
      <FilterCheckboxGroup
        options={STATUS_OPTIONS.map((o) => ({ value: o.value, label: t(o.label) }))}
        selected={statusIn}
        onChange={(next) => onStatusInChange(next as LineStatusFilterKey[])}
      />
    </FilterSection>
  );
}

/** Catalogue filters + simulation-specific calculation status — same shell as `/catalog`. */
export function SimulationLinesFilterSidebar({
  filters,
  onChange,
  statusIn,
  onStatusInChange,
}: Props) {
  return (
    <>
      <SimulationLineStatusFilterSection
        statusIn={statusIn}
        onStatusInChange={onStatusInChange}
      />
      <CatalogSidebar
        filters={filters}
        onChange={onChange}
        savedFilters={[]}
        onSaveFilter={() => {}}
        onApplyFilter={() => {}}
        onDeleteFilter={() => {}}
      />
    </>
  );
}
