"use client";

import { AlertTriangle } from "lucide-react";
import { CategorySelect } from "@/components/transactions/category-select";
import { CostTypeSelect } from "@/components/transactions/cost-type-select";
import { formatYen } from "@/lib/utils";
import type { MappedRow } from "@/lib/csv";
import type { CostTypeView, MajorWithCategories } from "@/lib/view-types";

const MAX_PREVIEW = 200;

/**
 * 取り込み前の確認・補正テーブル。1 行ずつカテゴリ・費目・入金の扱いを直せる。
 * 入金の行は「収入」か「相殺（支出から差し引く）」かを切り替えられる。
 * 既定は決済手段の種類で決まる（銀行・現金は収入、カードは相殺 など）。
 */
export function PreviewTable({
  rows,
  majors,
  costTypes,
  categoryByRow,
  costTypeByRow,
  incomeByRow,
  onCategoryChange,
  onCostTypeChange,
  onToggleIncome,
}: {
  rows: MappedRow[];
  majors: MajorWithCategories[];
  costTypes: CostTypeView[];
  categoryByRow: Record<number, string>;
  costTypeByRow: Record<number, string | null>;
  /** 入金の行を収入として数えるか（入金でない行は持たない） */
  incomeByRow: Record<number, boolean>;
  onCategoryChange: (rowIndex: number, categoryId: string) => void;
  onCostTypeChange: (rowIndex: number, costTypeId: string | null) => void;
  onToggleIncome: (rowIndex: number) => void;
}) {
  const shown = rows.slice(0, MAX_PREVIEW);
  const errorCount = rows.filter((row) => row.error).length;

  return (
    <div className="space-y-2">
      {errorCount > 0 ? (
        <p className="flex items-center gap-1.5 text-xs text-fg-muted">
          <AlertTriangle size={14} className="text-living" aria-hidden />
          {errorCount} 行は日付・金額を読み取れませんでした。この行は取り込まれません。
        </p>
      ) : null}

      <div className="relative max-h-[28rem] overflow-auto rounded-xl border border-border">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="sticky top-0 bg-surface-2">
            <tr className="text-left text-xs text-fg-muted">
              <th className="px-3 py-2 font-medium">日付</th>
              <th className="px-3 py-2 font-medium">利用先</th>
              <th className="px-3 py-2 text-right font-medium">金額</th>
              <th className="px-3 py-2 font-medium">カテゴリ</th>
              <th className="px-3 py-2 font-medium">費目</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-surface">
            {shown.map((row) => (
              <tr key={row.rowIndex} className={row.error ? "opacity-60" : undefined}>
                <td className="tabular whitespace-nowrap px-3 py-1.5 text-xs">
                  {row.date?.replace(/-/g, "/") ?? "-"}
                </td>
                <td className="max-w-[20rem] px-3 py-1.5">
                  <p className="truncate">{row.description || "-"}</p>
                  {row.usage ? (
                    <p className="truncate text-xs text-fg-muted">
                      使用先: {row.usage}
                    </p>
                  ) : null}
                  {row.error ? (
                    <p className="text-xs text-expense">{row.error}</p>
                  ) : null}
                </td>
                <td className="tabular whitespace-nowrap px-3 py-1.5 text-right">
                  {row.amount === null ? (
                    "-"
                  ) : (
                    <>
                      {formatYen(row.amount)}
                      {row.isIncome && !row.error ? (
                        <button
                          type="button"
                          onClick={() => onToggleIncome(row.rowIndex)}
                          className="ml-1 rounded border border-solid-gray-420 bg-white px-1.5 text-xs hover:bg-solid-gray-50"
                          title="押すと「収入にする」と「支出から差し引く」を切り替えます"
                          aria-label={`${row.description} の入金の扱い: ${incomeByRow[row.rowIndex] ? "収入" : "差し引き"}（押すと切り替え）`}
                        >
                          {incomeByRow[row.rowIndex] ? (
                            <span className="text-income">入金 → 収入</span>
                          ) : (
                            <span className="text-fg-muted">入金 → 差し引き</span>
                          )}
                        </button>
                      ) : null}
                      {row.personalAmount !== null || row.livingAmount !== null ? (
                        <p className="text-xs text-fg-muted">
                          個人 {formatYen(row.personalAmount ?? 0)} / 生活費{" "}
                          {formatYen(row.livingAmount ?? 0)}
                        </p>
                      ) : null}
                    </>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  {row.error ? (
                    <span className="text-xs text-fg-muted">-</span>
                  ) : (
                    <CategorySelect
                      majors={majors}
                      value={categoryByRow[row.rowIndex] ?? ""}
                      onChange={(categoryId) => onCategoryChange(row.rowIndex, categoryId)}
                      className="w-44"
                    />
                  )}
                </td>
                <td className="px-3 py-1.5">
                  {row.error ? (
                    <span className="text-xs text-fg-muted">-</span>
                  ) : (
                    <CostTypeSelect
                      costTypes={costTypes}
                      value={costTypeByRow[row.rowIndex] ?? null}
                      onChange={(costTypeId) => onCostTypeChange(row.rowIndex, costTypeId)}
                      className="w-28"
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length > MAX_PREVIEW ? (
        <p className="text-xs text-fg-muted">
          先頭 {MAX_PREVIEW} 行のみ表示しています（取り込みは全 {rows.length} 行が対象です）。
        </p>
      ) : null}
    </div>
  );
}
