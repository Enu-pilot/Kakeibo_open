import Link from "next/link";
import { Fragment } from "react";
import { KIND_VAR } from "@/lib/chart-colors";
import { cn, formatNumber } from "@/lib/utils";
import type { CrossTab } from "@/lib/aggregate-core";

export type CrossTabHref = (target: {
  majorId?: string;
  categoryId?: string;
  /** 費目の id。費目なしは "none"。合計列は undefined */
  costTypeId?: string;
}) => string | null;

/**
 * クロス集計表（大項目 > 中項目 × 費目）。
 * 大項目の行に小計、最下段に費目ごとの合計を出す。
 * cellHref を渡すと、マスから該当する明細の一覧へ飛べる（シート画面はアプリに明細が無いので渡さない）。
 */
export function CrossTabTable({
  data,
  cellHref,
}: {
  data: CrossTab;
  cellHref?: CrossTabHref;
}) {
  if (data.majors.length === 0) {
    return (
      <p className="py-8 text-center text-xs text-fg-muted">
        この期間の支出・生活費はまだありません
      </p>
    );
  }

  return (
    <div className="relative overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-xs" style={{ minWidth: 220 + data.columns.length * 84 }}>
        <thead className="bg-surface-2 text-fg-muted">
          <tr>
            <th className="sticky left-0 z-10 bg-surface-2 px-2 py-1.5 text-left font-medium">
              大項目 / 中項目
            </th>
            {data.columns.map((column) => (
              <th key={column.key} className="whitespace-nowrap px-2 py-1.5 text-right font-medium">
                {column.name}
              </th>
            ))}
            <th className="px-2 py-1.5 text-right font-medium">合計</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {data.majors.map((major) => (
            <Fragment key={major.majorId}>
              <tr className="bg-surface-2/50">
                <th className="sticky left-0 z-10 bg-surface-2 px-2 py-1 text-left font-medium">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="size-2 shrink-0 rounded-[2px]"
                      style={{ background: KIND_VAR[major.kind] }}
                      aria-hidden
                    />
                    {major.majorName}
                  </span>
                </th>
                {data.columns.map((column) => (
                  <Cell
                    key={column.key}
                    value={major.cells[column.key]}
                    strong
                    href={
                      cellHref?.({ majorId: major.majorId, costTypeId: column.key }) ?? null
                    }
                  />
                ))}
                <Cell
                  value={major.total}
                  strong
                  href={cellHref?.({ majorId: major.majorId }) ?? null}
                />
              </tr>
              {major.categories.map((row) => (
                <tr key={row.categoryId}>
                  <th className="sticky left-0 z-10 bg-surface px-2 py-1 pl-5 text-left font-normal">
                    {row.categoryName}
                  </th>
                  {data.columns.map((column) => (
                    <Cell
                      key={column.key}
                      value={row.cells[column.key]}
                      href={
                        cellHref?.({ categoryId: row.categoryId, costTypeId: column.key }) ??
                        null
                      }
                    />
                  ))}
                  <Cell
                    value={row.total}
                    href={cellHref?.({ categoryId: row.categoryId }) ?? null}
                  />
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
        <tfoot className="border-t-2 border-border font-semibold">
          <tr>
            <th className="sticky left-0 z-10 bg-surface px-2 py-1.5 text-left">合計</th>
            {data.columns.map((column) => (
              <Cell
                key={column.key}
                value={data.columnTotals[column.key]}
                strong
                href={cellHref?.({ costTypeId: column.key }) ?? null}
              />
            ))}
            <Cell value={data.total} strong href={null} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** 1 マス。0 は「-」にし、リンク先があれば数字から明細へ飛べるようにする */
function Cell({
  value,
  href,
  strong,
}: {
  value: number | undefined;
  href: string | null;
  strong?: boolean;
}) {
  const text = formatNumber(value ?? 0);
  return (
    <td
      className={cn(
        "tabular whitespace-nowrap px-2 py-1 text-right",
        !value && "text-fg-muted",
        strong && "font-medium",
      )}
    >
      {href && value ? (
        <Link href={href} className="link">
          {text}
        </Link>
      ) : (
        text
      )}
    </td>
  );
}
