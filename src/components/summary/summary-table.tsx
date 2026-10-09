"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight, Download } from "lucide-react";
import { Button } from "@/components/ui";
import { KIND_META, KIND_ORDER } from "@/lib/category-kind";
import { KIND_VAR } from "@/lib/chart-colors";
import { formatNumber } from "@/lib/utils";
import type { SummaryMatrix } from "@/lib/aggregate";

/**
 * 旧「まとめシート」に相当する表。
 * 列 = 月、行 = 大項目 > 中項目。大項目ごとに小計、最下段に種別合計と純残高を出す。
 */
export function SummaryTable({ matrix }: { matrix: SummaryMatrix }) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggle = (majorId: string) =>
    setCollapsed((prev) => ({ ...prev, [majorId]: !prev[majorId] }));

  const grandNet = matrix.months.reduce(
    (sum, month) => sum + (matrix.netByMonth[month] ?? 0),
    0,
  );

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => downloadCsv(matrix)}>
          <Download size={14} />
          CSV で書き出す
        </Button>
      </div>

      <div className="relative overflow-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-xs text-fg-muted">
              <th className="sticky-col min-w-[11rem] px-3 py-2 text-left font-medium">
                項目
              </th>
              {matrix.months.map((month) => (
                <th key={month} className="tabular px-3 py-2 text-right font-medium">
                  {month.slice(5)}月
                </th>
              ))}
              <th className="tabular px-3 py-2 text-right font-medium">合計</th>
            </tr>
          </thead>

          <tbody>
            {matrix.sections.map((section) => {
              const isCollapsed = collapsed[section.majorId];
              return (
                <Fragment key={section.majorId}>
                  <tr className="border-t border-border bg-surface-2/50 font-medium">
                    <th className="sticky-col px-3 py-2 text-left">
                      <button
                        type="button"
                        onClick={() => toggle(section.majorId)}
                        className="flex items-center gap-1.5 text-sm"
                      >
                        {isCollapsed ? (
                          <ChevronRight size={14} aria-hidden />
                        ) : (
                          <ChevronDown size={14} aria-hidden />
                        )}
                        <span
                          className="size-2 rounded-[2px]"
                          style={{ background: KIND_VAR[section.kind] }}
                          aria-hidden
                        />
                        {section.majorName}
                        <span className="text-xs font-normal text-fg-muted">
                          {KIND_META[section.kind].label}
                        </span>
                      </button>
                    </th>
                    {matrix.months.map((month) => (
                      <td key={month} className="tabular px-3 py-2 text-right">
                        {formatNumber(section.subtotal[month] ?? 0)}
                      </td>
                    ))}
                    <td className="tabular px-3 py-2 text-right">
                      {formatNumber(section.total)}
                    </td>
                  </tr>

                  {!isCollapsed &&
                    section.rows.map((row) => (
                      <tr
                        key={row.categoryId}
                        className="border-t border-border text-fg-muted hover:bg-surface-2"
                      >
                        <td className="sticky-col px-3 py-1.5 pl-9 text-left">
                          {row.categoryName}
                        </td>
                        {matrix.months.map((month) => {
                          const value = row.cells[month] ?? 0;
                          return (
                            <td
                              key={month}
                              className="tabular px-3 py-1.5 text-right"
                            >
                              {value === 0 ? (
                                "-"
                              ) : (
                                <Link
                                  href={`/transactions?month=${month.replace("/", "-")}&categoryId=${row.categoryId}`}
                                  className="hover:text-accent hover:underline"
                                >
                                  {formatNumber(value)}
                                </Link>
                              )}
                            </td>
                          );
                        })}
                        <td className="tabular px-3 py-1.5 text-right font-medium text-fg">
                          {formatNumber(row.total)}
                        </td>
                      </tr>
                    ))}
                </Fragment>
              );
            })}
          </tbody>

          <tfoot className="border-t-2 border-border">
            {KIND_ORDER.map((kind) => (
              <tr key={kind} className="text-xs">
                <th className="sticky-col px-3 py-1.5 text-left font-medium">
                  {KIND_META[kind].label} 合計
                </th>
                {matrix.months.map((month) => (
                  <td key={month} className="tabular px-3 py-1.5 text-right">
                    {formatNumber(matrix.kindTotals[kind][month] ?? 0)}
                  </td>
                ))}
                <td className="tabular px-3 py-1.5 text-right font-medium">
                  {formatNumber(matrix.grandTotal[kind])}
                </td>
              </tr>
            ))}
            <tr className="border-t border-border bg-surface-2 text-sm font-semibold">
              <th className="sticky-col px-3 py-2 text-left">純残高</th>
              {matrix.months.map((month) => {
                const value = matrix.netByMonth[month] ?? 0;
                return (
                  <td
                    key={month}
                    className={`tabular px-3 py-2 text-right ${value < 0 ? "text-expense" : ""}`}
                  >
                    {formatNumber(value)}
                  </td>
                );
              })}
              <td
                className={`tabular px-3 py-2 text-right ${grandNet < 0 ? "text-expense" : ""}`}
              >
                {formatNumber(grandNet)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-xs text-fg-muted">
        純残高 = 収入 − 支出 − 生活費 − 投資。
        帳尻合わせ（チャージ・振替）は資産が口座間を移動するだけなので純残高には含めていません。
      </p>
    </div>
  );
}

/** 表をそのまま CSV に落とす（Excel で開けるよう BOM 付き UTF-8） */
function downloadCsv(matrix: SummaryMatrix) {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const lines: string[] = [];
  lines.push(["項目", ...matrix.months, "合計"].map(escape).join(","));

  for (const section of matrix.sections) {
    lines.push(
      [
        section.majorName,
        ...matrix.months.map((month) => String(section.subtotal[month] ?? 0)),
        String(section.total),
      ]
        .map(escape)
        .join(","),
    );
    for (const row of section.rows) {
      lines.push(
        [
          `  ${row.categoryName}`,
          ...matrix.months.map((month) => String(row.cells[month] ?? 0)),
          String(row.total),
        ]
          .map(escape)
          .join(","),
      );
    }
  }

  for (const kind of KIND_ORDER) {
    lines.push(
      [
        `${KIND_META[kind].label} 合計`,
        ...matrix.months.map((month) => String(matrix.kindTotals[kind][month] ?? 0)),
        String(matrix.grandTotal[kind]),
      ]
        .map(escape)
        .join(","),
    );
  }

  lines.push(
    [
      "純残高",
      ...matrix.months.map((month) => String(matrix.netByMonth[month] ?? 0)),
      String(
        matrix.months.reduce((sum, month) => sum + (matrix.netByMonth[month] ?? 0), 0),
      ),
    ]
      .map(escape)
      .join(","),
  );

  const blob = new Blob(["﻿" + lines.join("\r\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `まとめ_${matrix.months[0].replace("/", "")}-${matrix.months.at(-1)?.replace("/", "")}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
