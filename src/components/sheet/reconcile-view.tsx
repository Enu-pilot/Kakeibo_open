"use client";

import { CheckCircle2, AlertTriangle } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { KIND_META, KIND_ORDER } from "@/lib/category-kind";
import { cn, formatYen } from "@/lib/utils";
import type { Reconciliation } from "@/lib/reconcile";

/** 差分の表記。0 は「-」にして、ずれている所だけが目に入るようにする。 */
function Diff({ value, title }: { value: number; title: string }) {
  return (
    <td
      className={cn(
        "tabular py-1.5 text-right",
        value === 0 ? "text-fg-muted" : "font-medium text-living",
      )}
      title={title}
    >
      {value === 0 ? "-" : formatYen(value, { sign: true })}
    </td>
  );
}

/**
 * 請求シートとアプリのデータの突合。差分は「シート − アプリ」。
 * プラスはシートにだけある（アプリに取り込まれていない）お金、
 * マイナスはアプリにだけある（シートに無い）お金を意味する。
 */
export function ReconcileView({ data }: { data: Reconciliation }) {
  const mismatched = data.months.filter((row) => !row.matched);

  return (
    <Card>
      <CardHeader>
        <CardTitle>アプリのデータとの突合</CardTitle>
        <p className="text-xs text-fg-muted">
          同じ月をシートとアプリでそれぞれ集計し、差分（シート − アプリ）を出しています。
          プラスはシートにだけある金額、マイナスはアプリにだけある金額です。
        </p>
      </CardHeader>
      <CardBody className="space-y-4">
        {data.matched ? (
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <CheckCircle2 size={16} className="text-income" aria-hidden />
            {data.months.length} か月すべてで一致しました
          </p>
        ) : (
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <AlertTriangle size={16} className="text-living" aria-hidden />
            {data.months.length} か月中 {mismatched.length} か月に差分があります
          </p>
        )}

        {data.monthsOnlyInSheet.length > 0 ? (
          <p className="text-xs text-fg-muted">
            アプリに明細が 1 件も無い月: {data.monthsOnlyInSheet.join("、")}
            （まだ取り込んでいない可能性があります）
          </p>
        ) : null}

        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[620px] text-xs">
            <thead className="text-fg-muted">
              <tr className="border-b border-border">
                <th className="py-1.5 text-left font-medium">月</th>
                {KIND_ORDER.map((kind) => (
                  <th key={kind} className="py-1.5 text-right font-medium">
                    {KIND_META[kind].label}
                  </th>
                ))}
                <th className="py-1.5 text-right font-medium">純残高</th>
              </tr>
            </thead>
            <tbody>
              {data.months.map((row) => (
                <tr key={row.month} className="border-b border-border/60">
                  <td className="py-1.5">
                    {row.month}
                    {row.matched ? null : (
                      <span className="ml-1.5 text-living" aria-label="差分あり">
                        ●
                      </span>
                    )}
                  </td>
                  {KIND_ORDER.map((kind) => (
                    <Diff
                      key={kind}
                      value={row.diff[kind]}
                      title={`シート ${formatYen(row.sheet[kind])} / アプリ ${formatYen(row.db[kind])}`}
                    />
                  ))}
                  <Diff
                    value={row.netDiff}
                    title={`シート ${formatYen(row.sheetNet)} / アプリ ${formatYen(row.dbNet)}`}
                  />
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {data.categoryDiffs.length > 0 ? (
          <div>
            <p className="mb-1.5 text-xs font-medium">差分のある中項目</p>
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[520px] text-xs">
                <thead className="text-fg-muted">
                  <tr className="border-b border-border">
                    <th className="py-1.5 text-left font-medium">月</th>
                    <th className="py-1.5 text-left font-medium">中項目</th>
                    <th className="py-1.5 text-right font-medium">シート</th>
                    <th className="py-1.5 text-right font-medium">アプリ</th>
                    <th className="py-1.5 text-right font-medium">差分</th>
                  </tr>
                </thead>
                <tbody>
                  {data.categoryDiffs.map((item) => (
                    <tr
                      key={`${item.month}-${item.majorName}-${item.categoryName}`}
                      className="border-b border-border/60"
                    >
                      <td className="py-1.5">{item.month}</td>
                      <td className="py-1.5">
                        {item.categoryName}
                        <span className="ml-1.5 text-xs text-fg-muted">
                          {item.majorName}
                        </span>
                      </td>
                      <td className="tabular py-1.5 text-right">
                        {formatYen(item.sheet)}
                      </td>
                      <td className="tabular py-1.5 text-right">{formatYen(item.db)}</td>
                      <td className="tabular py-1.5 text-right font-medium text-living">
                        {formatYen(item.diff, { sign: true })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
