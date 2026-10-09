import { handle } from "@/lib/api";
import { loadSnapshot } from "@/lib/db/store";
import { buildPairPage } from "@/lib/pair-view";
import { resolveMonthParam } from "@/lib/today";

/** 「二人」ページと同じ集計（未精算・月の集計・明細・精算・突き合わせ・イベント別） */
export async function GET(request: Request) {
  return handle(async () => {
    const month = resolveMonthParam(new URL(request.url).searchParams.get("month"));
    return buildPairPage(await loadSnapshot(), month.key);
  });
}
