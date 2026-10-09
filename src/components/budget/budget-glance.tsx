import Link from "next/link";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { cn, formatYen } from "@/lib/utils";
import type { BudgetReport } from "@/lib/budget";

/** ダッシュボード用の予実カード。詳しくは /budget で見る */
export function BudgetGlance({
  report,
  month,
}: {
  report: BudgetReport | null;
  month: string;
}) {
  const href = `/budget?month=${month}` as const;

  if (!report) {
    return (
      <p className="text-xs text-fg-muted">
        給料日や家賃などの予定、中項目ごとの予算を登録すると、ここに月末の見込みが出ます。
        <Link href={href} className="ml-1 link">
          予実を設定する
        </Link>
      </p>
    );
  }

  const past = report.phase === "past";
  const upcoming = report.plans.filter((p) => p.status !== "done").slice(0, 4);
  const overRows = report.sections
    .flatMap((s) => s.rows)
    .filter((r) => r.over)
    .sort((a, b) => (a.difference ?? 0) - (b.difference ?? 0))
    .slice(0, 3);

  return (
    <Card>
      <CardHeader className="flex items-baseline justify-between">
        <CardTitle>予実（{Number(month.slice(5))}月）</CardTitle>
        <Link href={href} className="text-xs link">
          詳しく見る
        </Link>
      </CardHeader>
      <CardBody className="grid gap-4 sm:grid-cols-3">
        <div>
          <p className="text-xs text-fg-muted">{past ? "純残高" : "純残高（月末見込み）"}</p>
          <p
            className={cn(
              "tabular text-xl font-semibold",
              (past ? report.net.actual : report.net.forecast) < 0 && "text-expense",
            )}
          >
            {formatYen(past ? report.net.actual : report.net.forecast)}
          </p>
          <p className="tabular text-xs text-fg-muted">予 {formatYen(report.net.target)}</p>
        </div>

        <div>
          <p className="text-xs text-fg-muted">{past ? "使わずに済んだ予算" : "予算・予定の残り"}</p>
          <p className="tabular text-xl font-semibold">{formatYen(report.remainingBudget)}</p>
          {overRows.length > 0 ? (
            <ul className="mt-0.5 space-y-0.5 text-xs text-expense">
              {overRows.map((row) => (
                <li key={row.categoryId} className="tabular">
                  {row.categoryName} {formatYen(-(row.difference ?? 0))} 超過
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-fg-muted">予算を超えた中項目はありません</p>
          )}
        </div>

        <div>
          <p className="text-xs text-fg-muted">
            {past ? "明細が見つからなかった予定" : "これからの予定"}
          </p>
          {upcoming.length === 0 ? (
            <p className="mt-1 text-sm text-fg-muted">
              {report.plans.length === 0 ? "この月の予定はありません" : "すべて済みです"}
            </p>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {upcoming.map((occ) => (
                <li key={occ.planId} className="tabular flex justify-between gap-2 text-sm">
                  <span className={cn("truncate", occ.status === "late" && "text-expense")}>
                    {Number(occ.date.slice(5, 7))}/{Number(occ.date.slice(8))} {occ.name}
                  </span>
                  <span>
                    {occ.kind === "INCOME" ? "+" : ""}
                    {formatYen(occ.planned)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
