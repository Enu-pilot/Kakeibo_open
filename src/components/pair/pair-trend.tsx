"use client";

import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatYen } from "@/lib/utils";
import type { PairNames, PairPageData } from "@/lib/pair-view";

const OWNER = "var(--pair-owner)";
const PARTNER = "var(--pair-partner)";

type Row = PairPageData["trend"][number] & { label: string };

/**
 * 二人の支出の月別推移。月ごとの総額を「自分の負担」と「相手の負担」に積み上げる。
 * 棒の上に総額、下に同じ数字の表を置く（相手の負担の色は面とのコントラストが低いため）。
 */
export function PairTrendChart({ trend, names }: { trend: PairPageData["trend"]; names: PairNames }) {
  const rows: Row[] = trend.map((t) => ({ ...t, label: `${Number(t.key.slice(5))}月` }));
  const hasData = rows.some((r) => r.total > 0);
  return (
    <div className="space-y-2">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted" aria-label="凡例">
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px]" style={{ background: OWNER }} aria-hidden />
          {names.OWNER}の負担
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px]" style={{ background: PARTNER }} aria-hidden />
          {names.PARTNER}の負担
        </li>
      </ul>
      {hasData ? (
        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 18, right: 4, bottom: 0, left: 0 }} barCategoryGap="28%">
              <CartesianGrid vertical={false} stroke="var(--color-border)" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} interval="preserveStartEnd" minTickGap={8} />
              <YAxis
                tickLine={false}
                axisLine={false}
                fontSize={11}
                width={48}
                tickFormatter={(v: number) => (v >= 10000 ? `${Math.round(v / 1000) / 10}万` : String(v))}
              />
              <Tooltip cursor={{ fill: "var(--color-surface-2)" }} content={<TrendTooltip names={names} />} />
              <Bar dataKey="ownerShare" stackId="s" fill={OWNER} stroke="var(--color-surface)" strokeWidth={1} isAnimationActive={false} />
              <Bar
                dataKey="partnerShare"
                stackId="s"
                fill={PARTNER}
                stroke="var(--color-surface)"
                strokeWidth={1}
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
              >
                <LabelList
                  dataKey="total"
                  position="top"
                  fontSize={10}
                  fill="var(--color-fg-muted)"
                  formatter={(v: unknown) => (Number(v) > 0 ? `${Math.round(Number(v) / 100) / 10}千` : "")}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="py-6 text-center text-sm text-fg-muted">この 12 か月の二人の明細はありません</p>
      )}
      <details className="text-xs">
        <summary className="cursor-pointer text-fg-muted">表で見る</summary>
        <div className="mt-1 overflow-x-auto">
          <table className="w-full min-w-[420px]">
            <caption className="sr-only">二人の支出の月別推移</caption>
            <thead className="text-fg-muted">
              <tr className="border-b border-border text-left">
                <th scope="col" className="py-1 pr-2 font-medium">月</th>
                <th scope="col" className="px-2 py-1 text-right font-medium">合計</th>
                <th scope="col" className="px-2 py-1 text-right font-medium">{names.OWNER}の負担</th>
                <th scope="col" className="px-2 py-1 text-right font-medium">{names.PARTNER}の負担</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="tabular py-1 pr-2">{r.key.replace("-", "/")}</td>
                  <td className="tabular px-2 py-1 text-right">{formatYen(r.total)}</td>
                  <td className="tabular px-2 py-1 text-right">{formatYen(r.ownerShare)}</td>
                  <td className="tabular px-2 py-1 text-right">{formatYen(r.partnerShare)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function TrendTooltip({ active, payload, names }: { active?: boolean; payload?: { payload: Row }[]; names: PairNames }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="font-bold">{row.key.replace("-", "/")}</p>
      <p className="tabular">合計 {formatYen(row.total)}</p>
      <p className="tabular">
        {names.OWNER} {formatYen(row.ownerShare)} ・ {names.PARTNER} {formatYen(row.partnerShare)}
      </p>
    </div>
  );
}
