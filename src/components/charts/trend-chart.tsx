"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MonthlyPoint } from "@/lib/aggregate";
import { formatYen } from "@/lib/utils";
import { KIND_META } from "@/lib/category-kind";

/**
 * 月別推移。
 *  左の棒 = 収入、右の積み上げ棒 = 支出 + 生活費 + 投資（＝出ていくお金の合計）。
 *  折れ線 = 純残高。合成値なので系列色を増やさずインク色で描く。
 *  帳尻合わせは純資産を動かさないためこのグラフには出さない。
 */
export function TrendChart({ data }: { data: MonthlyPoint[] }) {
  return (
    <div className="h-[280px] w-full sm:h-[320px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid
            stroke="var(--color-solid-gray-200)"
            strokeDasharray="2 4"
            vertical={false}
          />
          <XAxis
            dataKey="month"
            /* 1 月だけ年を出して、年をまたいだことが読み取れるようにする */
            tickFormatter={(value: string) =>
              value.endsWith("/01") ? `${value.slice(2, 4)}/01` : value.slice(5)
            }
            tick={{ fill: "var(--color-fg-muted)", fontSize: 12 }}
            axisLine={{ stroke: "var(--color-border)" }}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(value: number) =>
              value === 0 ? "0" : `${Math.round(value / 10000)}万`
            }
            tick={{ fill: "var(--color-fg-muted)", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={44}
          />
          <Tooltip
            cursor={{ fill: "var(--color-surface-2)" }}
            content={<TrendTooltip />}
          />
          <Legend verticalAlign="bottom" height={28} content={<TrendLegend />} />
          <Bar
            dataKey="INCOME"
            name={KIND_META.INCOME.label}
            fill="var(--color-income)"
            radius={[4, 4, 0, 0]}
            maxBarSize={18}
          />
          <Bar
            dataKey="EXPENSE"
            name={KIND_META.EXPENSE.label}
            stackId="out"
            fill="var(--color-expense)"
            stroke="var(--color-surface)"
            strokeWidth={2}
            maxBarSize={18}
          />
          <Bar
            dataKey="LIVING"
            name="生活費"
            stackId="out"
            fill="var(--color-living)"
            stroke="var(--color-surface)"
            strokeWidth={2}
            maxBarSize={18}
          />
          <Bar
            dataKey="INVESTMENT"
            name="投資"
            stackId="out"
            fill="var(--color-investment)"
            stroke="var(--color-surface)"
            strokeWidth={2}
            radius={[4, 4, 0, 0]}
            maxBarSize={18}
          />
          <Line
            type="monotone"
            dataKey="net"
            name="純残高"
            stroke="var(--color-net)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, stroke: "var(--color-surface)", strokeWidth: 2 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** 凡例は積み上げ順に引きずられないよう、意味の順で自前に並べる */
const LEGEND_ITEMS = [
  { label: KIND_META.INCOME.label, color: "var(--color-income)", shape: "square" as const },
  { label: KIND_META.EXPENSE.label, color: "var(--color-expense)", shape: "square" as const },
  { label: "生活費", color: "var(--color-living)", shape: "square" as const },
  { label: "投資", color: "var(--color-investment)", shape: "square" as const },
  { label: "純残高", color: "var(--color-net)", shape: "line" as const },
];

function TrendLegend() {
  return (
    <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-fg-muted">
      {LEGEND_ITEMS.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span
            className={item.shape === "line" ? "h-0.5 w-3.5 rounded-full" : "size-2.5 rounded-[2px]"}
            style={{ background: item.color }}
            aria-hidden
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

type TooltipPayload = {
  name: string;
  value: number;
  color?: string;
  dataKey?: string | number;
};

function TrendTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1.5 font-medium">{label}</p>
      <ul className="space-y-1">
        {payload.map((item) => (
          <li key={String(item.dataKey)} className="flex items-center gap-2">
            <span
              className="size-2 shrink-0 rounded-[2px]"
              style={{ background: item.color }}
              aria-hidden
            />
            <span className="text-fg-muted">{item.name}</span>
            <span className="tabular ml-auto font-medium">
              {formatYen(item.value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
