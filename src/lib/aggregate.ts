import type { CategoryKind } from "@/lib/db/types";
import type { Snapshot } from "@/lib/db/store";
import { activeCostTypes, byOrderThenName, categoryResolver, indexById } from "@/lib/db/queries";
import {
  type AggregateMajor,
  type AggregateSplit,
  buildCategoryBreakdown,
  buildCrossTab,
  buildMonthlyTrend,
  buildSummaryMatrix,
  isoDate,
  monthStart,
  sumKindTotals,
} from "@/lib/aggregate-core";

/**
 * スプレッドシート（アプリのデータ）を読んで集計する層。計算そのものは `aggregate-core` にあり、
 * ここは「スナップショットから `AggregateSplit[]` に揃える」ことだけを担う。
 * 請求シートを読む側（`sheet-source`）も同じ形に揃えて同じ計算を通す。
 */

export {
  emptyKindTotals,
  isoDate,
  monthRange,
  monthStart,
  netBalance,
  toYearMonth,
} from "@/lib/aggregate-core";
export type {
  CategoryBreakdownItem,
  CrossTab,
  KindTotals,
  MatrixCategoryRow,
  MatrixCell,
  MatrixSection,
  MonthlyPoint,
  SummaryMatrix,
} from "@/lib/aggregate-core";

/**
 * 集計は明細ではなく「内訳」を単位に行う。
 * 1 件の買い物を個人支出ぶんと生活費ぶんに分けている場合、
 * それぞれが別の大項目として数えられる必要があるため。
 *
 * 明細や中項目が見つからない内訳（スプレッドシートで行を消した場合など）は、
 * 日付も集計種別も決まらないので数えない。
 */
function loadSplits(db: Snapshot, from: Date, to: Date): AggregateSplit[] {
  const [fromIso, toIso] = [isoDate(from), isoDate(to)];
  const transactions = indexById(db.transactions);
  const resolve = categoryResolver(db);
  const costTypes = indexById(db.costTypes);
  const rows: AggregateSplit[] = [];
  for (const split of db.splits) {
    const tx = transactions.get(split.transactionId);
    if (!tx || tx.date < fromIso || tx.date >= toIso) continue;
    const found = resolve(split.categoryId);
    if (!found) continue;
    rows.push({
      date: new Date(`${tx.date}T00:00:00.000Z`),
      amount: split.amount,
      categoryId: found.category.id,
      categoryName: found.category.name,
      major: {
        id: found.major.id,
        name: found.major.name,
        kind: found.major.kind,
        color: found.major.color,
      },
      costType: pickCostType(costTypes.get(split.costTypeId ?? "")),
    });
  }
  return rows;
}

function pickCostType(costType: { id: string; name: string } | undefined) {
  return costType ? { id: costType.id, name: costType.name } : null;
}

/** まとめ表の枠。取引が 1 件も無い大項目も表に出すためマスタから作る。 */
function loadMajors(db: Snapshot): AggregateMajor[] {
  return db.majors
    .filter((m) => !m.archivedAt)
    .sort(byOrderThenName)
    .map((major) => ({
      id: major.id,
      name: major.name,
      kind: major.kind,
      color: major.color,
      categories: db.categories
        .filter((c) => c.majorId === major.id && !c.archivedAt)
        .sort(byOrderThenName)
        .map((c) => ({ id: c.id, name: c.name })),
    }));
}

/**
 * 内訳をそのまま返す。集計済みの数字ではなく内訳同士を比べたい用途
 * （請求シートとの突合）のために公開している。
 */
export function getSplits(db: Snapshot, from: Date, to: Date) {
  return loadSplits(db, from, to);
}

/** 指定期間の集計種別ごとの合計 */
export function getKindTotals(db: Snapshot, from: Date, to: Date) {
  return sumKindTotals(loadSplits(db, from, to));
}

/** 直近 n か月の推移（グラフ用。データが無い月も 0 で埋める） */
export function getMonthlyTrend(db: Snapshot, endYear: number, endMonth: number, months = 12) {
  const from = monthStart(endYear, endMonth - months + 1);
  const to = monthStart(endYear, endMonth + 1);
  return buildMonthlyTrend(loadSplits(db, from, to), endYear, endMonth, months);
}

/** 指定期間のカテゴリ別内訳（内訳グラフ用）。kinds で対象の集計種別を絞る。 */
export function getCategoryBreakdown(
  db: Snapshot,
  from: Date,
  to: Date,
  kinds: CategoryKind[] = ["EXPENSE", "LIVING"],
) {
  return buildCategoryBreakdown(loadSplits(db, from, to), kinds);
}

/**
 * まとめ表（旧「まとめシート」）。
 * 横軸 = 月(yyyy/MM)、縦軸 = 大項目 > 中項目。各段に小計、最下段に純残高を出す。
 */
export function getSummaryMatrix(
  db: Snapshot,
  startYear: number,
  startMonth: number,
  monthCount: number,
) {
  const from = monthStart(startYear, startMonth);
  const to = monthStart(startYear, startMonth + monthCount);
  return buildSummaryMatrix(loadSplits(db, from, to), loadMajors(db), startYear, startMonth, monthCount);
}

/**
 * クロス集計（大項目 > 中項目 × 費目）。期間はまとめ表と同じ指定のしかた。
 * 支出と生活費（お金を使った側）だけを対象にする。
 */
export function getCrossTab(db: Snapshot, startYear: number, startMonth: number, monthCount: number) {
  const from = monthStart(startYear, startMonth);
  const to = monthStart(startYear, startMonth + monthCount);
  return buildCrossTab(loadSplits(db, from, to), activeCostTypes(db), { majorOrder: loadMajors(db) });
}
