"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatYen } from "@/lib/utils";

/** 色を付ける大項目の数。これを超えたぶんは「その他」にまとめる（円は 6 区分まで） */
const MAX_SHADED = 5;
const SHADES = ["--pie-1", "--pie-2", "--pie-3", "--pie-4", "--pie-5"].map(
  (name) => `var(${name})`,
);
const OTHER_COLOR = "var(--pie-other)";
/** これより小さい扇形には横のラベルを出さない（ぶつかるため）。金額は下の一覧で読める */
const LABEL_MIN_SHARE = 0.07;

type Slice = { key: string; name: string; value: number; color: string; folded: number };

/**
 * 大項目ごとの支出の円グラフ。表示するのは割合ではなく金額。
 *
 * 色は 1 色の濃淡で、大きい大項目ほど濃い。どの大項目かは扇形の横の名前と下の一覧で示す。
 * 上位 5 つを超えるぶんは「その他」にまとめ、円は 6 区分までにする。
 * 払い戻しが支出を上回ってマイナスになった大項目は、円に描けないので一覧の下に分けて出す。
 */
export function MajorPie({ data }: { data: { key: string; name: string; value: number }[] }) {
  const positives = data.filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  const negatives = data.filter((d) => d.value < 0);
  const total = positives.reduce((sum, d) => sum + d.value, 0);

  if (positives.length === 0 && negatives.length === 0) {
    return (
      <p className="py-10 text-center text-xs text-fg-muted">この月のデータがありません</p>
    );
  }

  const fold = positives.length > MAX_SHADED + 1;
  const shown = fold ? positives.slice(0, MAX_SHADED) : positives;
  const rest = fold ? positives.slice(MAX_SHADED) : [];
  const slices: Slice[] = shown.map((d, i) => ({
    ...d,
    color: SHADES[Math.min(i, SHADES.length - 1)],
    folded: 0,
  }));
  if (rest.length > 0) {
    slices.push({
      key: "other",
      name: "その他",
      value: rest.reduce((sum, d) => sum + d.value, 0),
      color: OTHER_COLOR,
      folded: rest.length,
    });
  }
  const colorOf = new Map(slices.map((s) => [s.key, s.color]));

  return (
    <div className="space-y-3">
      {total > 0 ? (
        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <Pie
                data={slices}
                dataKey="value"
                nameKey="name"
                startAngle={90}
                endAngle={-270}
                outerRadius="68%"
                stroke="var(--color-surface)"
                strokeWidth={2}
                isAnimationActive={false}
                labelLine={false}
                label={(props) => renderSliceLabel(props, total)}
              >
                {slices.map((slice) => (
                  <Cell key={slice.key} fill={slice.color} />
                ))}
              </Pie>
              <Tooltip content={<SliceTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      ) : null}

      {/* 円と同じ内容の一覧。色に頼らず、名前と金額で読める（表の代わり） */}
      <ul className="space-y-1 text-xs">
        {positives.map((d) => (
          <li key={d.key} className="flex items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-[3px] border border-border"
              style={{ background: colorOf.get(d.key) ?? OTHER_COLOR }}
              aria-hidden
            />
            <span className="truncate">{d.name}</span>
            {!colorOf.has(d.key) ? (
              <span className="shrink-0 text-xs text-fg-muted">（その他）</span>
            ) : null}
            <span className="tabular ml-auto shrink-0 font-medium">{formatYen(d.value)}</span>
          </li>
        ))}
        {positives.length > 1 ? (
          <li className="flex items-center gap-2 border-t border-border pt-1 text-fg-muted">
            <span>合計</span>
            <span className="tabular ml-auto">{formatYen(total)}</span>
          </li>
        ) : null}
        {negatives.length > 0 ? (
          <li className="pt-1 text-fg-muted">
            <p className="mb-0.5 text-xs">払い戻しで差し引きマイナス（円には含めていません）</p>
            {negatives.map((d) => (
              <p key={d.key} className="flex items-center gap-2">
                <span className="truncate">{d.name}</span>
                <span className="tabular ml-auto">{formatYen(d.value)}</span>
              </p>
            ))}
          </li>
        ) : null}
      </ul>
    </div>
  );
}


/** Recharts は key 入りの props を渡してくる。key を展開に混ぜると React が警告するので、直接渡す */
function renderSliceLabel(props: object, total: number) {
  const { key, ...rest } = props as { key?: React.Key };
  return <SliceLabel key={key} {...rest} total={total} />;
}

/** 扇形の外側に「名前 金額」を出す。文字は系列色ではなくインク色 */
function SliceLabel(props: {
  cx?: number;
  cy?: number;
  midAngle?: number;
  outerRadius?: number;
  name?: string;
  value?: number;
  total: number;
}) {
  const { cx = 0, cy = 0, midAngle = 0, outerRadius = 0, name, value = 0, total } = props;
  if (total <= 0 || value / total < LABEL_MIN_SHARE) return null;
  const radian = Math.PI / 180;
  const r = outerRadius + 10;
  const x = cx + r * Math.cos(-midAngle * radian);
  const y = cy + r * Math.sin(-midAngle * radian);
  const anchor = x >= cx ? "start" : "end";
  return (
    <text x={x} y={y} textAnchor={anchor} dominantBaseline="central" className="text-xs">
      <tspan x={x} dy="-0.6em" fill="var(--color-fg-muted)">
        {name}
      </tspan>
      <tspan x={x} dy="1.2em" fill="var(--color-fg)" className="tabular font-medium">
        {formatYen(value)}
      </tspan>
    </text>
  );
}

function SliceTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { name: string; value: number; payload: Slice }[];
}) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="font-medium">{item.name}</p>
      <p className="tabular">{formatYen(item.value)}</p>
      {item.payload.folded > 0 ? (
        <p className="text-fg-muted">{item.payload.folded} 件の大項目をまとめています</p>
      ) : null}
    </div>
  );
}
