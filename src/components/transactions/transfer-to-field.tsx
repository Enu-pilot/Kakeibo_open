"use client";

import { Select } from "@/components/ui";
import type { SplitDraft } from "@/components/transactions/split-editor";
import type { MajorWithCategories, PaymentMethodView } from "@/lib/view-types";

/**
 * 選んだ中項目のどれかが帳尻合わせ（チャージ・振替）かどうか。
 * 帳尻合わせは資産が口座間を移動するだけなので集計には効かないが、
 * 口座残高は確実に動く。移動先を持てるのはこの種別の明細だけ。
 */
export function hasAdjustmentSplit(
  splits: SplitDraft[],
  majors: MajorWithCategories[],
) {
  const adjustmentCategoryIds = new Set(
    majors
      .filter((major) => major.kind === "ADJUSTMENT")
      .flatMap((major) => major.categories.map((category) => category.id)),
  );
  return splits.some((split) => adjustmentCategoryIds.has(split.categoryId));
}

/**
 * 帳尻合わせの移動先を選ぶ欄。
 * 帳尻合わせの内訳が無いときは何も出さない（移動先を持つ意味がないため）。
 */
export function TransferToField({
  splits,
  majors,
  paymentMethods,
  value,
  sourceId,
  onChange,
  className,
}: {
  splits: SplitDraft[];
  majors: MajorWithCategories[];
  paymentMethods: PaymentMethodView[];
  value: string;
  /** 移動元。自分自身への移動は選べないようにするため受け取る。 */
  sourceId: string;
  onChange: (transferToId: string) => void;
  className?: string;
}) {
  if (!hasAdjustmentSplit(splits, majors)) return null;

  return (
    <div className={className ?? "mt-1"}>
      <Select
        className="h-8 w-32"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="移動先"
      >
        <option value="">移動先を選ぶ</option>
        {paymentMethods
          .filter((method) => method.id !== sourceId)
          .map((method) => (
            <option key={method.id} value={method.id}>
              → {method.name}
            </option>
          ))}
      </Select>
      <p className="mt-1 max-w-[12rem] text-xs text-fg-muted">
        {value
          ? "この金額が移動元から出て移動先に入ります。"
          : "移動先を選ぶと口座残高に反映されます。"}
      </p>
    </div>
  );
}
