"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { CategorySelect } from "@/components/transactions/category-select";
import { CostTypeSelect } from "@/components/transactions/cost-type-select";
import { formatYen } from "@/lib/utils";
import type { CostTypeView, MajorWithCategories } from "@/lib/view-types";

export type SplitDraft = { categoryId: string; amount: string; costTypeId: string | null };

export function splitTotal(splits: SplitDraft[]) {
  return splits.reduce((sum, split) => sum + (Number(split.amount) || 0), 0);
}

/**
 * 内訳エディタ。
 * 1 件の買い物を「個人支出ぶん」と「生活費ぶん」に分けるためのもので、
 * 分けない明細は 1 行のまま使う。
 *
 * 金額はその中項目の本来の向きならプラス、払い戻しならマイナスで入力する
 * （例: 支出の中項目への返金は −3,000）。
 */
export function SplitEditor({
  splits,
  majors,
  costTypes,
  onChange,
  compact,
}: {
  splits: SplitDraft[];
  majors: MajorWithCategories[];
  costTypes: CostTypeView[];
  onChange: (splits: SplitDraft[]) => void;
  compact?: boolean;
}) {
  const total = splitTotal(splits);
  const isSplit = splits.length > 1;

  function update(index: number, patch: Partial<SplitDraft>) {
    onChange(splits.map((split, i) => (i === index ? { ...split, ...patch } : split)));
  }

  /**
   * 分割を始めるとき、2 行目は「生活費」大項目の同名中項目を初期値にする。
   * 同じ用途の支出を個人ぶんと生活費ぶんに割るのが元々の運用なので、
   * 中項目は揃っているのが既定として自然。
   */
  function addSplit() {
    const living = majors.find((major) => major.kind === "LIVING");
    const currentName = majors
      .flatMap((major) => major.categories)
      .find((category) => category.id === splits[0]?.categoryId)?.name;
    const sameName = living?.categories.find((c) => c.name === currentName);
    onChange([
      ...splits,
      {
        categoryId: sameName?.id ?? living?.categories[0]?.id ?? "",
        amount: "",
        // 生活費と分けても、お金の種類（食費など）は元の内訳と同じことが多い
        costTypeId: splits[0]?.costTypeId ?? null,
      },
    ]);
  }

  return (
    <div className="space-y-1.5">
      {splits.map((split, index) => (
        <div key={index} className="flex flex-wrap items-center gap-1.5">
          <CategorySelect
            majors={majors}
            value={split.categoryId}
            onChange={(categoryId) => update(index, { categoryId })}
            className={compact ? "h-8 w-44" : "w-full"}
          />
          <Input
            type="number"
            title="払い戻しはマイナスで入力します"
            className={compact ? "tabular h-8 w-24 text-right" : "tabular w-28 text-right"}
            value={split.amount}
            onChange={(e) => update(index, { amount: e.target.value })}
            aria-label={`内訳 ${index + 1} の金額`}
          />
          <CostTypeSelect
            costTypes={costTypes}
            value={split.costTypeId}
            onChange={(costTypeId) => update(index, { costTypeId })}
            className={compact ? "h-8 w-28" : "w-32"}
            ariaLabel={`内訳 ${index + 1} の費目`}
          />
          {isSplit ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onChange(splits.filter((_, i) => i !== index))}
              aria-label={`内訳 ${index + 1} を削除`}
            >
              <Trash2 size={13} />
            </Button>
          ) : null}
        </div>
      ))}

      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={addSplit} type="button">
          <Plus size={13} />
          生活費と分ける
        </Button>
        {isSplit ? (
          <span className="tabular text-xs text-fg-muted">
            合計 {formatYen(total)}
          </span>
        ) : null}
      </div>
    </div>
  );
}
