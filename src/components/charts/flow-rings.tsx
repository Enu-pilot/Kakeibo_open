"use client";

import { useEffect, useRef, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { cn, formatYen } from "@/lib/utils";
import type { FlowRings, RingItem } from "@/lib/purposes";

/** 色を付ける区分の数。これを超えたぶんは「その他」にまとめる（輪 1 つにつき 6 区分＋貯金まで） */
const MAX_SHADED = 5;
/** 金額の大きい順に濃い。値はデザインシステムの色から選び、dataviz の検証（--ordinal）を通したもの */
const INNER = ["--pie-in-1", "--pie-in-2", "--pie-in-3", "--pie-in-4", "--pie-in-5"].map((n) => `var(${n})`);
const OUTER = ["--pie-1", "--pie-2", "--pie-3", "--pie-4", "--pie-5"].map((n) => `var(${n})`);
const OTHER_COLOR = "var(--pie-other)";
const SAVINGS_COLOR = "var(--pie-savings)";
/** 外側の輪で、扇の外に「名前 ¥金額」を出す下限（これより小さい扇は一覧と吹き出しで読む） */
const LABEL_MIN_SHARE = 0.07;
/** これより狭い枠では扇の外のラベルを出さない（はみ出して切れるため。金額は下の一覧で読める） */
const LABEL_MIN_WIDTH = 440;

type Slice = RingItem & { color: string; folded: RingItem[]; ring: "inner" | "outer" };

export type FlowRingsView = { id: string; name: string; rings: FlowRings };

/**
 * 二重円グラフ。内側 = 入ってきたお金の内訳、外側 = 使ったお金の内訳（中項目ごと）。表示は割合ではなく金額。
 * 2 つの輪の合計をそろえるため、使ったお金が多い月は内側に「貯金から」、残った月は外側に「貯金へ」を足す。
 * 使途を選ぶと、その使途だけの入り（振替で入ったぶんを含む）と使い道（振替で出したぶんを含む）になる。
 */
export function FlowRingsChart({ views }: { views: FlowRingsView[] }) {
  const [selected, setSelected] = useState(views[0]?.id ?? "");
  const box = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= LABEL_MIN_WIDTH));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const view = views.find((v) => v.id === selected) ?? views[0];
  if (!view) return null;
  const { rings } = view;
  const inner = toSlices(rings.inner, INNER, "inner");
  const outer = toSlices(rings.outer, OUTER, "outer");
  const total = outer.reduce((s, x) => s + x.value, 0);
  const diff = rings.income - rings.expense;

  return (
    <div ref={box} className="space-y-3">
      {views.length > 1 ? (
        <div role="tablist" aria-label="使途で絞り込む" className="flex flex-wrap gap-1">
          {views.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={v.id === view.id}
              onClick={() => setSelected(v.id)}
              className={cn(
                "rounded-full border px-3 py-0.5 text-xs",
                v.id === view.id
                  ? "border-key-900 bg-key-900 font-bold text-white"
                  : "border-solid-gray-420 bg-white text-solid-gray-800 hover:bg-solid-gray-50",
              )}
            >
              {v.name}
            </button>
          ))}
        </div>
      ) : null}

      {total > 0 ? (
        <div className="relative h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart margin={{ top: 12, right: 12, bottom: 12, left: 12 }}>
              <Pie
                data={inner}
                dataKey="value"
                nameKey="name"
                startAngle={90}
                endAngle={-270}
                innerRadius="34%"
                outerRadius="50%"
                stroke="var(--color-surface)"
                strokeWidth={2}
                isAnimationActive={false}
              >
                {inner.map((slice) => (
                  <Cell key={slice.key} fill={slice.color} />
                ))}
              </Pie>
              <Pie
                data={outer}
                dataKey="value"
                nameKey="name"
                startAngle={90}
                endAngle={-270}
                innerRadius="54%"
                outerRadius="70%"
                stroke="var(--color-surface)"
                strokeWidth={2}
                isAnimationActive={false}
                labelLine={false}
                label={wide ? (props) => renderSliceLabel(props, total) : false}
              >
                {outer.map((slice) => (
                  <Cell key={slice.key} fill={slice.color} />
                ))}
              </Pie>
              <Tooltip content={<SliceTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          {/* 穴の中: その期間の差し引き */}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-xs text-fg-muted">{diff >= 0 ? "残った" : "足りない"}</span>
            <span className={cn("text-sm font-bold", diff < 0 && "text-expense")}>{formatYen(Math.abs(diff))}</span>
          </div>
        </div>
      ) : (
        <p className="py-10 text-center text-sm text-fg-muted">この月の入ったお金・使ったお金はありません</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <RingList title="内側: 入ってきたお金" total={rings.income} slices={inner} />
        <RingList title="外側: 使ったお金" total={rings.expense} slices={outer} />
      </div>
      {rings.negatives.length > 0 ? (
        <div className="text-xs text-fg-muted">
          <p>払い戻しで差し引きマイナスになった中項目（円には含めていません）</p>
          <ul>
            {rings.negatives.map((n) => (
              <li key={n.key} className="flex gap-2">
                <span>{n.name}</span>
                <span className="tabular ml-auto">{formatYen(n.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** 大きい順に濃い色を付け、6 つ目以降を「その他」にまとめる。貯金の区分は最後に置く */
function toSlices(items: RingItem[], shades: string[], ring: "inner" | "outer"): Slice[] {
  const regular = items.filter((i) => !i.savings);
  const savings = items.filter((i) => i.savings);
  const fold = regular.length > MAX_SHADED + 1;
  const shown = fold ? regular.slice(0, MAX_SHADED) : regular;
  const rest = fold ? regular.slice(MAX_SHADED) : [];
  // 区分が少ないときは薄い側の段から使う（1 つだけの輪がほぼ黒の塊にならないように）。
  // 並びは常に「大きいほど濃い」
  const offset = shades.length - shown.length;
  const slices: Slice[] = shown.map((item, i) => ({ ...item, color: shades[offset + i], folded: [], ring }));
  if (rest.length > 0) {
    slices.push({
      key: `${ring}-other`,
      name: "その他",
      detail: `${rest.length} 件`,
      value: rest.reduce((s, i) => s + i.value, 0),
      color: OTHER_COLOR,
      folded: rest,
      ring,
    });
  }
  for (const item of savings) slices.push({ ...item, color: SAVINGS_COLOR, folded: [], ring });
  return slices;
}

/** 円と同じ内容の一覧（色に頼らず名前と金額で読める） */
function RingList({ title, total, slices }: { title: string; total: number; slices: Slice[] }) {
  return (
    <div>
      <p className="mb-1 flex items-baseline justify-between text-xs font-bold text-solid-gray-800">
        <span>{title}</span>
        <span className="tabular">{formatYen(total)}</span>
      </p>
      <ul className="space-y-0.5 text-xs">
        {slices.flatMap((slice) => [
          <li key={slice.key} className="flex items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-[2px] border border-solid-gray-420"
              style={{ background: slice.color }}
              aria-hidden
            />
            <span className={cn("truncate", slice.savings && "font-bold")}>{slice.name}</span>
            {slice.detail && !slice.savings && slice.folded.length === 0 ? (
              <span className="hidden shrink-0 text-fg-muted sm:inline">{slice.detail}</span>
            ) : null}
            <span className="tabular ml-auto shrink-0">{formatYen(slice.value)}</span>
          </li>,
          ...slice.folded.map((item) => (
            <li key={`${slice.key}:${item.key}`} className="flex items-center gap-2 pl-[1.125rem] text-fg-muted">
              <span className="truncate">{item.name}</span>
              <span className="tabular ml-auto shrink-0">{formatYen(item.value)}</span>
            </li>
          )),
        ])}
      </ul>
    </div>
  );
}


/** Recharts は key 入りの props を渡してくる。key を展開に混ぜると React が警告するので、直接渡す */
function renderSliceLabel(props: object, total: number) {
  const { key, ...rest } = props as { key?: React.Key };
  return <SliceLabel key={key} {...rest} total={total} />;
}

/** 外側の扇の外に「名前 ¥金額」を出す。文字は系列色ではなくインク色 */
function SliceLabel(props: {
  cx?: number;
  cy?: number;
  midAngle?: number;
  outerRadius?: number;
  name?: string;
  value?: number;
  payload?: Slice;
  total: number;
}) {
  const { cx = 0, cy = 0, midAngle = 0, outerRadius = 0, name, value = 0, total, payload } = props;
  const share = total > 0 ? value / total : 0;
  // 貯金へ は大事な数字なので、少し小さくても出す
  if (share < (payload?.savings ? 0.03 : LABEL_MIN_SHARE)) return null;
  const radian = Math.PI / 180;
  const r = outerRadius + 10;
  const x = cx + r * Math.cos(-midAngle * radian);
  const y = cy + r * Math.sin(-midAngle * radian);
  const anchor = x >= cx ? "start" : "end";
  return (
    <text x={x} y={y} textAnchor={anchor} dominantBaseline="central" fontSize={12}>
      <tspan x={x} dy="-0.6em" fill="var(--color-fg-muted)">
        {name}
      </tspan>
      <tspan x={x} dy="1.2em" fill="var(--color-fg)" fontWeight={700}>
        {formatYen(value)}
      </tspan>
    </text>
  );
}

function SliceTooltip({ active, payload }: { active?: boolean; payload?: { value: number; payload: Slice }[] }) {
  if (!active || !payload?.length) return null;
  const slice = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="tabular text-sm font-bold">{formatYen(slice.value)}</p>
      <p>{slice.name}</p>
      <p className="text-fg-muted">
        {slice.ring === "inner" ? "入ってきたお金" : "使ったお金"}
        {slice.folded.length > 0 ? `・${slice.folded.length} 件の中項目をまとめています` : slice.detail ? `・${slice.detail}` : ""}
      </p>
    </div>
  );
}
