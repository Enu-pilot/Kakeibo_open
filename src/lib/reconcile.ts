import {
  emptyKindTotals,
  netBalance,
  type AggregateSplit,
  type KindTotals,
} from "@/lib/aggregate-core";
import { KIND_ORDER } from "@/lib/category-kind";
import { toYearMonth } from "@/lib/aggregate-core";

/**
 * 請求シートから読んだ集計と、アプリのデータの集計を突き合わせる。
 *
 * 中項目は「大項目名 + 中項目名」で突き合わせる。シート版はアプリに無い中項目
 * （入金を収入側へ回した先など）をその場限りで作るため、id では一致しないことがある。
 * 名前で突き合わせれば、取り込みで同じ名前の中項目が作られたときに一致する。
 *
 * 円は整数だが、浮動小数の誤差で
 * 0 にならない差分が出ないよう銭単位で丸めてから比べる。
 */

const round = (value: number) => Math.round(value * 100) / 100;

export type ReconcileMonth = {
  month: string;
  sheet: KindTotals;
  db: KindTotals;
  /** シート − アプリ */
  diff: KindTotals;
  sheetNet: number;
  dbNet: number;
  netDiff: number;
  matched: boolean;
};

export type ReconcileCategoryDiff = {
  month: string;
  majorName: string;
  categoryName: string;
  sheet: number;
  db: number;
  diff: number;
};

export type Reconciliation = {
  months: ReconcileMonth[];
  /** 差分のある中項目だけを挙げる。一致していれば空になる。 */
  categoryDiffs: ReconcileCategoryDiff[];
  matched: boolean;
  /** シートにしか無い月。アプリに取り込まれていない月を見つけるため。 */
  monthsOnlyInSheet: string[];
};

function totalsByMonth(splits: AggregateSplit[]) {
  const map = new Map<string, KindTotals>();
  for (const split of splits) {
    const month = toYearMonth(split.date);
    const totals = map.get(month) ?? emptyKindTotals();
    totals[split.major.kind] += split.amount;
    map.set(month, totals);
  }
  return map;
}

type CategoryCell = {
  month: string;
  majorName: string;
  categoryName: string;
  amount: number;
};

function categoryByMonth(splits: AggregateSplit[]) {
  const map = new Map<string, CategoryCell>();
  for (const split of splits) {
    const month = toYearMonth(split.date);
    const key = `${month}\u0000${split.major.name}\u0000${split.categoryName}`;
    const cell = map.get(key) ?? {
      month,
      majorName: split.major.name,
      categoryName: split.categoryName,
      amount: 0,
    };
    cell.amount += split.amount;
    map.set(key, cell);
  }
  return map;
}

export function reconcile(
  sheetSplits: AggregateSplit[],
  dbSplits: AggregateSplit[],
  months: string[],
): Reconciliation {
  const sheetTotals = totalsByMonth(sheetSplits);
  const dbTotals = totalsByMonth(dbSplits);

  const rows: ReconcileMonth[] = months.map((month) => {
    const sheet = sheetTotals.get(month) ?? emptyKindTotals();
    const db = dbTotals.get(month) ?? emptyKindTotals();
    const diff = emptyKindTotals();
    for (const kind of KIND_ORDER) {
      diff[kind] = round(sheet[kind] - db[kind]);
    }
    const sheetNet = round(netBalance(sheet));
    const dbNet = round(netBalance(db));
    return {
      month,
      sheet,
      db,
      diff,
      sheetNet,
      dbNet,
      netDiff: round(sheetNet - dbNet),
      matched: KIND_ORDER.every((kind) => diff[kind] === 0),
    };
  });

  const sheetCells = categoryByMonth(sheetSplits);
  const dbCells = categoryByMonth(dbSplits);
  const targetMonths = new Set(months);
  const categoryDiffs: ReconcileCategoryDiff[] = [];

  for (const key of new Set([...sheetCells.keys(), ...dbCells.keys()])) {
    const sheetCell = sheetCells.get(key);
    const dbCell = dbCells.get(key);
    const cell = sheetCell ?? dbCell;
    if (!cell || !targetMonths.has(cell.month)) continue;
    const sheet = round(sheetCell?.amount ?? 0);
    const db = round(dbCell?.amount ?? 0);
    const diff = round(sheet - db);
    if (diff === 0) continue;
    categoryDiffs.push({
      month: cell.month,
      majorName: cell.majorName,
      categoryName: cell.categoryName,
      sheet,
      db,
      diff,
    });
  }

  categoryDiffs.sort(
    (a, b) =>
      a.month.localeCompare(b.month) || Math.abs(b.diff) - Math.abs(a.diff),
  );

  // アプリに 1 件も無い月は「まだ取り込んでいない」ことが多いので、別に挙げる
  const monthsOnlyInSheet = months.filter(
    (month) => sheetTotals.has(month) && !dbTotals.has(month),
  );

  return {
    months: rows,
    categoryDiffs,
    matched: rows.every((row) => row.matched),
    monthsOnlyInSheet,
  };
}
