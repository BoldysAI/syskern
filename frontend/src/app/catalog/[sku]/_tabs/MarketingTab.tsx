"use client";

import { useUiTranslate } from "@/lib/use-ui-translate";
import { AttributeSection } from "./AttributeSection";

export function MarketingTab() {
  const t = useUiTranslate();
  return (
    <div className="flex flex-col gap-6">
      <AttributeSection
        category="marketing"
        title={t("catalog.marketing.attrs")}
        emptyLabel={t("catalog.marketing.empty")}
      />
    </div>
  );
}
