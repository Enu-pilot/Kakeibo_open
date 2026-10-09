"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn, formatYen } from "@/lib/utils";
import type { PurposeTrend, PurposeTrendPoint } from "@/lib/purposes";

/**
 * 使途ごとの月別推移（スモールマルチプル）。使途ごとに 1 枚、月ごとに「入ったお金」と「出たお金」の棒を並べる。
 *   入 = 収入 ＋ 振替で入ったぶん、出 = 支出 ＋ 振替で出たぶん
 * 使途どうしは金額の桁が違う（給料の入る個人と、月数千円の使途）ので、縦軸は使途ごとに取る。
 * 比べるのは同じ使途の中の 入 と 出 の釣り合い。
 */
export function PurposeTrendChart({ data, balances }: { data: PurposeTrend[]; balances: Record<string, number> }) {
  if (data.length === 0) {
    return <p className="py-6 text-center text-sm text-fg-muted">使途がまだありません。「設定」→「使途」で作れます。</p>;
  }
  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted" aria-label="凡例">
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] bg-income" aria-hidden />
          入ったお金（収入＋振替で入ったぶん）
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] bg-expense" aria-hidden />
          出たお金（支出＋振替で出たぶん）
        </li>
      </ul>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {data.map((series) => (
          <Panel key={series.id} series={series} balance={balances[series.id]} />
        ))}
      </div>
      <TrendTable data={data} />
    </div>
  );
}

type Row = PurposeTrendPoint & { in: number; out: number };

function rowsOf(series: PurposeTrend): Row[] {
  return series.points.map((p) => ({ ...p, in: p.income + p.transferIn, out: p.expense + p.transferOut }));
}

function Panel({ series, balance }: { series: PurposeTrend; balance: number | undefined }) {
  const rows = rowsOf(series);
  const totalIn = rows.reduce((s, r) => s + r.in, 0);
  const totalOut = rows.reduce((s, r) => s + r.out, 0);
  const diff = totalIn - totalOut;
  return (
    <section className="rounded-lg border border-border px-3 pb-2 pt-2.5" aria-label={`${series.name} の月別推移`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="text-std-16B-170 text-solid-gray-900">{series.name}</h3>
        {balance !== undefined ? (
          <p className="text-xs text-fg-muted">
            残高 <span className={cn("font-bold text-fg", balance < 0 && "text-expense")}>{formatYen(balance)}</span>
          </p>
        ) : null}
      </div>
      <p className="text-xs text-fg-muted">
        12 か月で 入 {formatYen(totalIn)} ・ 出 {formatYen(totalOut)} ・{" "}
        <span className={cn("font-bold", diff < 0 ? "text-expense" : "text-fg")}>差 {formatYen(diff, { sign: true })}</span>
      </p>
      <div className="mt-1 h-[150px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 6, right: 4, bottom: 0, left: 0 }} barGap={2}>
            <CartesianGrid stroke="var(--color-solid-gray-100)" vertical={false} />
            <XAxis
              dataKey="month"
              tickFormatter={(value: string) => (value.endsWith("/01") ? `${value.slice(2, 4)}/01` : value.slice(5))}
              tick={{ fill: "var(--color-fg-muted)", fontSize: 11 }}
              axisLine={{ stroke: "var(--color-border)" }}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={8}
            />
            <YAxis
              tickFormatter={compactYen}
              tick={{ fill: "var(--color-fg-muted)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={40}
            />
            <Tooltip cursor={{ fill: "var(--color-surface-2)" }} content={<PanelTooltip />} />
            <Bar dataKey="in" name="入" fill="var(--color-income)" radius={[4, 4, 0, 0]} maxBarSize={10} />
            <Bar dataKey="out" name="出" fill="var(--color-expense)" radius={[4, 4, 0, 0]} maxBarSize={10} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

/** 軸の目盛りは短く（1 万円以上は「万」） */
function compactYen(value: number) {
  if (value === 0) return "0";
  if (Math.abs(value) >= 10000) return `${Math.round(value / 1000) / 10}万`;
  return value.toLocaleString("ja-JP");
}

function PanelTooltip({ active, payload, label }: { active?: boolean; payload?: { payload: Row }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const diff = row.in - row.out;
  const lines: { label: string; value: number; color?: string }[] = [
    { label: "収入", value: row.income, color: "var(--color-income)" },
    { label: "振替で入った", value: row.transferIn, color: "var(--color-income)" },
    { label: "支出", value: row.expense, color: "var(--color-expense)" },
    { label: "振替で出た", value: row.transferOut, color: "var(--color-expense)" },
  ];
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1.5 font-medium">{label}</p>
      <ul className="space-y-1">
        {lines
          .filter((l) => l.value !== 0 || l.label === "収入" || l.label === "支出")
          .map((l) => (
            <li key={l.label} className="flex items-center gap-2">
              <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: l.color }} aria-hidden />
              <span className="tabular font-bold">{formatYen(l.value)}</span>
              <span className="ml-auto pl-3 text-fg-muted">{l.label}</span>
            </li>
          ))}
        <li className="flex items-center gap-2 border-t border-border pt-1">
          <span className={cn("tabular font-bold", diff < 0 && "text-expense")}>{formatYen(diff, { sign: true })}</span>
          <span className="ml-auto pl-3 text-fg-muted">差（残高の増減）</span>
        </li>
      </ul>
    </div>
  );
}

/** グラフと同じ数字を表で（ホバーできない場面・読み上げ用） */
function TrendTable({ data }: { data: PurposeTrend[] }) {
  const months = data[0]?.points.map((p) => p.month) ?? [];
  const rows = data.map(rowsOf);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-xs text-fg-muted">数字の表で見る</summary>
      <div className="relative mt-2 overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs">
          <caption className="sr-only">使途ごと・月ごとの入ったお金と出たお金</caption>
          <thead className="text-fg-muted">
            <tr className="border-b border-border text-right">
              <th scope="col" className="sticky-col py-1 pr-2 text-left font-medium">月</th>
              {data.map((s) => (
                <th key={s.id} scope="col" className="px-2 py-1 font-medium" colSpan={2}>
                  {s.name}（入 / 出）
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {months.map((month, i) => (
              <tr key={month} className="text-right">
                <th scope="row" className="sticky-col tabular py-1 pr-2 text-left font-normal">{month}</th>
                {data.map((s, j) => {
                  const r = rows[j][i];
                  return [
                    <td key={`${s.id}-in`} className="tabular px-2 py-1">{formatYen(r.in)}</td>,
                    <td key={`${s.id}-out`} className="tabular px-2 py-1">{formatYen(r.out)}</td>,
                  ];
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
