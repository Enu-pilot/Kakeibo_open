import { Suspense } from "react";
import { loadSnapshotForPage } from "@/lib/db/store";
import { SetupError } from "@/components/setup-error";
import { PairDashboard } from "@/components/pair/pair-dashboard";
import { buildPairPage } from "@/lib/pair-view";
import { resolveMonthParam, todayInTokyo } from "@/lib/today";

export const dynamic = "force-dynamic";

/**
 * 二人（パートナー）との支出を自分用に管理・確認するページ。
 * データは LINE ボット（GAS）と共有する「二人の明細」「二人の精算」タブ。
 */
export default async function PairPage({ searchParams }: PageProps<"/pair">) {
  const loaded = await loadSnapshotForPage();
  if ("error" in loaded) return <SetupError message={loaded.error} />;
  const params = await searchParams;
  const month = resolveMonthParam(params.month);
  const data = buildPairPage(loaded.db, month.key);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-std-28B-150 text-solid-gray-900">二人</h1>
        <p className="text-xs text-fg-muted">
          {data.names.PARTNER}との支出（LINE ボットと同じ「二人の明細」）。ここで登録・修正・精算すると、家計簿にも LINE と同じ規則で反映されます。
          自分の支出に数えるのは自分の負担だけで、{data.names.PARTNER}の分は立替（帳尻合わせ）と口座「彼女精算」で持ちます。
        </p>
        {data.partnerUnregistered ? (
          <p className="mt-1 text-xs text-fg-muted">相手がまだ LINE で登録していないので、呼び名は「相手」と出ます。</p>
        ) : null}
      </div>
      <Suspense>
        <PairDashboard data={data} today={todayInTokyo()} />
      </Suspense>
    </div>
  );
}
