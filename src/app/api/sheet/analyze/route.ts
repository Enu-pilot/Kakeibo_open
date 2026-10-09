import { handle } from "@/lib/api";
import { loadSnapshot } from "@/lib/db/store";
import {
  buildCategoryBreakdown,
  buildCrossTab,
  buildMonthlyTrend,
  monthStart,
  sumKindTotals,
  toYearMonth,
  type AggregateSplit,
} from "@/lib/aggregate-core";
import { getSplits } from "@/lib/aggregate";
import { billingSourceSchema, readBillingSource } from "@/lib/billing-source";
import { reconcile } from "@/lib/reconcile";
import { buildSheetSplits, type CategoryDef, type MajorDef } from "@/lib/sheet-source";
import { toPaymentKind, type PaymentKind } from "@/lib/inflow";
import { normalizeDescription } from "@/lib/normalize";
import { activeCostTypes, byOrderThenName, toCostTypeView } from "@/lib/db/queries";
import { thisMonthInTokyo } from "@/lib/today";

/** 月ごとの内訳を返す上限。古い月まで全部返すと応答が膨らむため。 */
const MAX_MONTHS = 24;
/** 画面に出す行単位の警告の上限 */
const MAX_ISSUES = 50;

/**
 * 請求シートを読み、集計とアプリのデータとの突合を返す。
 *
 * この経路は読み取り専用で、アプリのデータにも請求シートにも何も書かない。
 * カテゴリの定義（中項目 → 大項目 → 種別）・費目・決済手段の種類と自動分類ルールだけをアプリのデータから借りる。
 */
export async function POST(request: Request) {
  return handle(async () => {
    const { blocks, warnings } = await readBillingSource(billingSourceSchema.parse(await request.json()));

    const db = await loadSnapshot();
    const majorList: MajorDef[] = db.majors
      .filter((m) => !m.archivedAt)
      .sort(byOrderThenName)
      .map((m) => ({ id: m.id, name: m.name, kind: m.kind, color: m.color, sortOrder: m.sortOrder }));
    const majors = new Map(majorList.map((m) => [m.id, m]));
    const activeCategories = db.categories.filter((c) => !c.archivedAt).sort(byOrderThenName);
    const categories: CategoryDef[] = activeCategories.flatMap((c) => {
      const major = majors.get(c.majorId);
      return major ? [{ id: c.id, name: c.name, major }] : [];
    });
    const rules = db.rules.filter((rule) => rule.enabled);
    const costTypes = activeCostTypes(db).map(toCostTypeView);
    // ブロック名と同じ名前の決済手段が登録されていれば、その種類で入金の扱いを決める
    const paymentKinds = new Map<string, PaymentKind>(
      db.paymentMethods.map((m) => [normalizeDescription(m.name), toPaymentKind(m.kind, m.name)]),
    );

    const result = buildSheetSplits(blocks, categories, rules, { paymentKinds, costTypes, majors: majorList });

    // クロス集計の行の並びは、設定の大項目・中項目の並びに合わせる
    const majorOrder = majorList.map((major) => ({
      id: major.id,
      categories: activeCategories.filter((c) => c.majorId === major.id).map((c) => ({ id: c.id })),
    }));
    const crossTab = (splits: AggregateSplit[]) => buildCrossTab(splits, costTypes, { majorOrder });

    const months = [...new Set(result.splits.map((s) => toYearMonth(s.date)))]
      .sort()
      .slice(-MAX_MONTHS);

    const byMonth = new Map<string, AggregateSplit[]>();
    for (const split of result.splits) {
      const key = toYearMonth(split.date);
      const list = byMonth.get(key);
      if (list) list.push(split);
      else byMonth.set(key, [split]);
    }
    const monthly: Record<
      string,
      {
        totals: ReturnType<typeof sumKindTotals>;
        breakdown: ReturnType<typeof buildCategoryBreakdown>;
        crossTab: ReturnType<typeof buildCrossTab>;
      }
    > = {};
    for (const month of months) {
      const splits = byMonth.get(month) ?? [];
      monthly[month] = {
        totals: sumKindTotals(splits),
        breakdown: buildCategoryBreakdown(splits, ["EXPENSE", "LIVING"]),
        crossTab: crossTab(splits),
      };
    }

    // 推移は「データのある最後の月」を右端にして 12 か月ぶん
    const last = months[months.length - 1];
    const [endYear, endMonth] = last
      ? last.split("/").map(Number)
      : [thisMonthInTokyo().year, thisMonthInTokyo().month];
    const trend = buildMonthlyTrend(result.splits, endYear, endMonth, 12);

    // 突合: シートに出てくる月の範囲だけアプリのデータを集め、同じ形に揃えて比べる
    let reconciliation = null;
    if (months.length > 0) {
      const [fy, fm] = months[0].split("/").map(Number);
      const from = monthStart(fy, fm);
      const to = monthStart(endYear, endMonth + 1);
      const dbSplits = getSplits(db, from, to);
      reconciliation = reconcile(
        result.splits.filter((s) => s.date >= from && s.date < to),
        dbSplits,
        months,
      );
    }

    return {
      warnings,
      blocks: result.blocks,
      resolution: result.resolution,
      issues: result.issues.slice(0, MAX_ISSUES),
      issueCount: result.issues.length,
      months,
      monthly,
      trend,
      splitCount: result.splits.length,
      reconciliation,
      /** 読み込んだ期間全体のクロス集計 */
      crossTab: crossTab(result.splits.filter((s) => months.includes(toYearMonth(s.date)))),
    };
  });
}
