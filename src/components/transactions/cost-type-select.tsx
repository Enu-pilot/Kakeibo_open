"use client";

import { Select } from "@/components/ui";
import type { CostTypeView } from "@/lib/view-types";

/** 費目の選択。空は「未設定」で、クロス集計では未設定の列に入る。 */
export function CostTypeSelect({
  costTypes,
  value,
  onChange,
  className,
  emptyLabel = "費目なし",
  ariaLabel = "費目",
}: {
  costTypes: CostTypeView[];
  value: string | null;
  onChange: (costTypeId: string | null) => void;
  className?: string;
  emptyLabel?: string;
  ariaLabel?: string;
}) {
  // アーカイブした費目が付いた内訳でも、今の値を失わずに表示する
  const known = value === null || costTypes.some((c) => c.id === value);
  return (
    <Select
      className={className}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      aria-label={ariaLabel}
    >
      <option value="">{emptyLabel}</option>
      {known ? null : <option value={value}>（使わなくなった費目）</option>}
      {costTypes.map((costType) => (
        <option key={costType.id} value={costType.id}>
          {costType.name}
        </option>
      ))}
    </Select>
  );
}
