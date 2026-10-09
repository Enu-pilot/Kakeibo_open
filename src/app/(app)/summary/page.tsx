import { Suspense } from "react";
import { getCrossTab, getSummaryMatrix, monthStart } from "@/lib/aggregate";
import { loadSnapshotForPage } from "@/lib/db/store";
import { SetupError } from "@/components/setup-error";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { CrossTabTable } from "@/components/summary/cross-tab-table";
import { SummaryTable } from "@/components/summary/summary-table";
import { SummaryRangePicker } from "@/components/summary/range-picker";
import { thisMonthInTokyo } from "@/lib/today";

export const dynamic = "force-dynamic";

/** 表示範囲: 指定年の 1〜12 月、または直近 12 か月 */
function resolveRange(year: string | undefined, mode: string | undefined) {
  const now = thisMonthInTokyo();
  if (mode === "recent") {
    const start = new Date(Date.UTC(now.year, now.month - 1 - 11, 1));
    return {
      startYear: start.getUTCFullYear(),
      startMonth: start.getUTCMonth() + 1,
      monthCount: 12,
      mode: "recent" as const,
      year: now.year,
    };
  }
  const target = year && /^\d{4}$/.test(year) ? Number(year) : now.year;
  return {
    startYear: target,
    startMonth: 1,
    monthCount: 12,
    mode: "year" as const,
    year: target,
  };
}

export default async function SummaryPage({ searchParams }: PageProps<"/summary">) {
  const params = await searchParams;
  const range = resolveRange(
    typeof params.year === "string" ? params.year : undefined,
    typeof params.mode === "string" ? params.mode : undefined,
  );

  const loaded = await loadSnapshotForPage();
  if ("error" in loaded) return <SetupError message={loaded.error} />;

  const matrix = getSummaryMatrix(loaded.db, range.startYear, range.startMonth, range.monthCount);
  const crossTab = getCrossTab(loaded.db, range.startYear, range.startMonth, range.monthCount);

  // クロス集計のマスから明細一覧へ飛ぶときの期間（明細の絞り込みは to を含む）
  const from = monthStart(range.startYear, range.startMonth).toISOString().slice(0, 10);
  const to = new Date(
    monthStart(range.startYear, range.startMonth + range.monthCount).getTime() - 86400000,
  )
    .toISOString()
    .slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-std-28B-150 text-solid-gray-900">まとめ</h1>
          <p className="text-xs text-fg-muted">
            横軸が月、縦軸が大項目 &gt; 中項目。各段の小計と純残高をその場で計算しています。
          </p>
        </div>
        <Suspense fallback={null}>
          <SummaryRangePicker year={range.year} mode={range.mode} />
        </Suspense>
      </div>

      <SummaryTable matrix={matrix} />

      <Card>
        <CardHeader>
          <CardTitle>クロス集計（中項目 × 費目）</CardTitle>
          <p className="text-xs text-fg-muted">
            同じ期間の個人支出・生活費を、中項目と費目の掛け合わせで集計しています（旅行かつ食費、など）。
            費目は明細の内訳ごとに付けます。数字を押すと該当する明細の一覧へ移ります。
          </p>
        </CardHeader>
        <CardBody>
          <CrossTabTable
            data={crossTab}
            cellHref={({ majorId, categoryId, costTypeId }) => {
              const query = new URLSearchParams({ from, to });
              if (categoryId) query.set("categoryId", categoryId);
              else if (majorId) query.set("majorId", majorId);
              if (costTypeId) query.set("costTypeId", costTypeId);
              return `/transactions?${query.toString()}`;
            }}
          />
        </CardBody>
      </Card>
    </div>
  );
}
