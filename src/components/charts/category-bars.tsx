"use client";

import Link from "next/link";
import { formatYen } from "@/lib/utils";
import type { CategoryBreakdownItem } from "@/lib/aggregate";
import { KIND_VAR } from "@/lib/chart-colors";

/**
 * 中項目の内訳。金額の大小を読む用途なので、角度ではなく長さで比較できる横棒にする。
 * 色は所属する大項目の色をそのまま使い、値は直接ラベルで出す。
 *
 * シート版（/sheet）からも使う。あちらの明細は DB に無いので、
 * 明細へのドリルダウンは `linkToTransactions` で外せるようにしてある。
 */
export function CategoryBars({
  items,
  month,
  limit = 10,
  linkToTransactions = true,
}: {
  items: CategoryBreakdownItem[];
  month: string;
  limit?: number;
  linkToTransactions?: boolean;
}) {
  // 払い戻しが購入を上回った中項目は差し引きでマイナスになる。
  // 長さで比べる棒には載せられないので、棒とは分けて一覧で出す。
  const negatives = items.filter((item) => item.amount < 0);
  const positives = items.filter((item) => item.amount > 0);

  if (positives.length === 0 && negatives.length === 0) {
    return (
      <p className="py-8 text-center text-xs text-fg-muted">
        この月の支出・生活費はまだありません
      </p>
    );
  }

  const shown = positives.slice(0, limit);
  const rest = positives.slice(limit);
  const restTotal = rest.reduce((sum, item) => sum + item.amount, 0);
  const max = Math.max(...shown.map((item) => item.amount), restTotal, 1);

  return (
    <ul className="space-y-2">
      {shown.map((item) => (
        <li key={item.categoryId}>
          <Row
            href={
              linkToTransactions
                ? `/transactions?month=${month}&categoryId=${item.categoryId}`
                : null
            }
          >
            <div className="mb-1 flex items-baseline gap-2 text-xs">
              <span className="truncate">{item.categoryName}</span>
              <span className="shrink-0 text-xs text-fg-muted">
                {item.majorName}
              </span>
              <span className="tabular ml-auto shrink-0 font-medium">
                {formatYen(item.amount)}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(2, (item.amount / max) * 100)}%`,
                  background: KIND_VAR[item.kind],
                }}
              />
            </div>
          </Row>
        </li>
      ))}
      {rest.length > 0 ? (
        <li className="px-1 pt-1 text-xs text-fg-muted">
          ほか {rest.length} 件
          <span className="tabular ml-2">{formatYen(restTotal)}</span>
        </li>
      ) : null}
      {negatives.length > 0 ? (
        <li className="border-t border-border px-1 pt-2 text-xs text-fg-muted">
          <p className="mb-1">払い戻しで差し引きマイナス</p>
          <ul className="space-y-0.5">
            {negatives.map((item) => (
              <li key={item.categoryId} className="flex items-baseline gap-2">
                <span className="truncate">{item.categoryName}</span>
                <span className="shrink-0 text-xs">{item.majorName}</span>
                <span className="tabular ml-auto shrink-0">{formatYen(item.amount)}</span>
              </li>
            ))}
          </ul>
        </li>
      ) : null}
    </ul>
  );
}

/** リンクにする / しないだけが違うので、行の見た目はここに 1 つだけ持つ。 */
function Row({
  href,
  children,
}: {
  href: string | null;
  children: React.ReactNode;
}) {
  const className = "group block rounded-md px-1 py-0.5";
  if (!href) return <div className={className}>{children}</div>;
  return (
    <Link href={href} className={`${className} hover:bg-surface-2`}>
      {children}
    </Link>
  );
}
