import type { CategoryKind } from "@/lib/db/types";
import { KIND_ORDER } from "@/lib/category-kind";

/**
 * 集計の計算だけを持つモジュール。DB にもスプレッドシートにも依存しない。
 *
 * データの読み込み（DB / シート）と計算を分けてあるのは、
 * 同じ集計を別のデータ源に対しても通せるようにするため。
 * 読み込み側は `AggregateSplit[]` の形に揃える責任だけを負う。
 */

export type KindTotals = Record<CategoryKind, number>;

export function emptyKindTotals(): KindTotals {
  return { INCOME: 0, EXPENSE: 0, LIVING: 0, INVESTMENT: 0, ADJUSTMENT: 0 };
}

/**
 * 純残高 = 収入 − 支出 − 生活費 − 投資
 * 帳尻合わせ（チャージ・振替）は資産が口座間を移動するだけなので含めない。
 */
export function netBalance(totals: KindTotals) {
  return totals.INCOME - totals.EXPENSE - totals.LIVING - totals.INVESTMENT;
}

/** 月初(UTC)を返す。月境界はすべてこの関数で作る。 */
export function monthStart(year: number, month: number) {
  return new Date(Date.UTC(year, month - 1, 1));
}

/** [from, to) の範囲で 1 か月ぶんを返す */
export function monthRange(year: number, month: number) {
  return { from: monthStart(year, month), to: monthStart(year, month + 1) };
}

/** Date → "2026-08-03"（明細の日付と文字列で比較するため） */
export function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** Date(UTC) → "2026/08"（まとめ表・推移グラフの月の見出し） */
export function toYearMonth(date: Date) {
  return `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * 集計の入力単位。
 * 明細ではなく「内訳」が単位なのは、1 件の買い物を個人支出ぶんと生活費ぶんに
 * 分けている場合に、それぞれを別の大項目として数える必要があるため。
 */
export type AggregateSplit = {
  date: Date;
  /**
   * その集計種別にとって本来の向きならプラス、逆（払い戻し・精算）ならマイナス。
   * 増減の向きそのものは major.kind が決める。規則は `signFor` を参照。
   */
  amount: number;
  categoryId: string;
  categoryName: string;
  major: { id: string; name: string; kind: CategoryKind; color: string };
  /** 費目。付いていなければ null（クロス集計では「未設定」） */
  costType: { id: string; name: string } | null;
};

/**
 * まとめ表の枠。取引が 1 件も無い大項目・中項目も段として出すために要る。
 * 並び順は読み込み側で整えて渡す（表示順はデータ源の責任）。
 */
export type AggregateMajor = {
  id: string;
  name: string;
  kind: CategoryKind;
  color: string;
  categories: { id: string; name: string }[];
};

/** 集計種別ごとの合計 */
export function sumKindTotals(splits: AggregateSplit[]): KindTotals {
  const totals = emptyKindTotals();
  for (const split of splits) totals[split.major.kind] += split.amount;
  return totals;
}

export type MonthlyPoint = { month: string } & KindTotals & { net: number };

/** 直近 n か月の推移（グラフ用。データが無い月も 0 で埋める） */
export function buildMonthlyTrend(
  splits: AggregateSplit[],
  endYear: number,
  endMonth: number,
  months = 12,
): MonthlyPoint[] {
  const buckets = new Map<string, KindTotals>();
  for (let i = 0; i < months; i++) {
    const d = monthStart(endYear, endMonth - months + 1 + i);
    buckets.set(toYearMonth(d), emptyKindTotals());
  }
  for (const split of splits) {
    const bucket = buckets.get(toYearMonth(split.date));
    if (bucket) bucket[split.major.kind] += split.amount;
  }
  return [...buckets.entries()].map(([month, totals]) => ({
    month,
    ...totals,
    net: netBalance(totals),
  }));
}

export type CategoryBreakdownItem = {
  categoryId: string;
  categoryName: string;
  majorId: string;
  majorName: string;
  majorColor: string;
  kind: CategoryKind;
  amount: number;
};

/** カテゴリ別内訳（内訳グラフ用）。kinds で対象の集計種別を絞る。 */
export function buildCategoryBreakdown(
  splits: AggregateSplit[],
  kinds: CategoryKind[] = ["EXPENSE", "LIVING"],
): CategoryBreakdownItem[] {
  const map = new Map<string, CategoryBreakdownItem>();
  for (const split of splits) {
    const { major } = split;
    if (!kinds.includes(major.kind)) continue;
    const item = map.get(split.categoryId) ?? {
      categoryId: split.categoryId,
      categoryName: split.categoryName,
      majorId: major.id,
      majorName: major.name,
      majorColor: major.color,
      kind: major.kind,
      amount: 0,
    };
    item.amount += split.amount;
    map.set(split.categoryId, item);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

/**
 * 中項目の内訳を大項目ごとに合計する（円グラフ用）。
 * サーバー側の画面からもクライアント側の画面からも呼ぶので、画面部品（"use client"）ではなくここに置く。
 */
export function sumBreakdownByMajor(items: CategoryBreakdownItem[]) {
  const map = new Map<string, { key: string; name: string; value: number }>();
  for (const item of items) {
    const entry = map.get(item.majorId) ?? { key: item.majorId, name: item.majorName, value: 0 };
    entry.value += item.amount;
    map.set(item.majorId, entry);
  }
  return [...map.values()];
}

export type MatrixCell = { month: string; amount: number };
export type MatrixCategoryRow = {
  categoryId: string;
  categoryName: string;
  cells: Record<string, number>;
  total: number;
};
export type MatrixSection = {
  majorId: string;
  majorName: string;
  kind: CategoryKind;
  color: string;
  rows: MatrixCategoryRow[];
  subtotal: Record<string, number>;
  total: number;
};
export type SummaryMatrix = {
  months: string[];
  sections: MatrixSection[];
  /** 集計種別ごとの月次合計 */
  kindTotals: Record<CategoryKind, Record<string, number>>;
  netByMonth: Record<string, number>;
  grandTotal: KindTotals;
};

/**
 * まとめ表（旧「まとめシート」）。
 * 横軸 = 月(yyyy/MM)、縦軸 = 大項目 > 中項目。各段に小計、最下段に純残高を出す。
 */
export function buildSummaryMatrix(
  splits: AggregateSplit[],
  majors: AggregateMajor[],
  startYear: number,
  startMonth: number,
  monthCount: number,
): SummaryMatrix {
  const months = Array.from({ length: monthCount }, (_, i) =>
    toYearMonth(monthStart(startYear, startMonth + i)),
  );

  const sections = new Map<string, MatrixSection>();
  const kindTotals = {} as Record<CategoryKind, Record<string, number>>;
  const grandTotal = emptyKindTotals();

  for (const major of majors) {
    sections.set(major.id, {
      majorId: major.id,
      majorName: major.name,
      kind: major.kind,
      color: major.color,
      rows: major.categories.map((c) => ({
        categoryId: c.id,
        categoryName: c.name,
        cells: Object.fromEntries(months.map((m) => [m, 0])),
        total: 0,
      })),
      subtotal: Object.fromEntries(months.map((m) => [m, 0])),
      total: 0,
    });
  }
  for (const kind of KIND_ORDER) {
    kindTotals[kind] = Object.fromEntries(months.map((m) => [m, 0]));
  }

  for (const split of splits) {
    const month = toYearMonth(split.date);
    const section = sections.get(split.major.id);
    if (!section) continue;
    const line = section.rows.find((r) => r.categoryId === split.categoryId);
    if (line) {
      line.cells[month] = (line.cells[month] ?? 0) + split.amount;
      line.total += split.amount;
    }
    section.subtotal[month] = (section.subtotal[month] ?? 0) + split.amount;
    section.total += split.amount;
    kindTotals[section.kind][month] =
      (kindTotals[section.kind][month] ?? 0) + split.amount;
    grandTotal[section.kind] += split.amount;
  }

  const netByMonth = Object.fromEntries(
    months.map((m) => [
      m,
      netBalance({
        INCOME: kindTotals.INCOME[m] ?? 0,
        EXPENSE: kindTotals.EXPENSE[m] ?? 0,
        LIVING: kindTotals.LIVING[m] ?? 0,
        INVESTMENT: kindTotals.INVESTMENT[m] ?? 0,
        ADJUSTMENT: kindTotals.ADJUSTMENT[m] ?? 0,
      }),
    ]),
  );

  return {
    months,
    sections: [...sections.values()],
    kindTotals,
    netByMonth,
    grandTotal,
  };
}

export type CrossTabColumn = {
  /** 列のキー。費目の id、費目なしは "none" */
  key: string;
  costTypeId: string | null;
  name: string;
};
export type CrossTabCategoryRow = {
  categoryId: string;
  categoryName: string;
  cells: Record<string, number>;
  total: number;
};
export type CrossTabMajorRow = {
  majorId: string;
  majorName: string;
  kind: CategoryKind;
  categories: CrossTabCategoryRow[];
  /** 大項目の小計（列ごと） */
  cells: Record<string, number>;
  total: number;
};
export type CrossTab = {
  columns: CrossTabColumn[];
  majors: CrossTabMajorRow[];
  columnTotals: Record<string, number>;
  total: number;
};

/** 費目が付いていない内訳の列のキー（明細の絞り込み costTypeId=none と同じ） */
export const NO_COST_TYPE = "none";

/**
 * クロス集計: 縦が大項目 > 中項目、横が費目。
 * 「旅行かつ食費」「マラソンかつ交通費」のように、ツリーと費目の掛け合わせで見るためのもの。
 *
 * 費目は 1 つの内訳に 1 つだけなので、行の合計は中項目の合計と、列の合計は費目の合計と一致する。
 * 費目を付けていない内訳は「未設定」の列に入る。
 * 行の並びは majorOrder（設定の並び順）に合わせ、値が 1 つも無い行は出さない。
 */
export function buildCrossTab(
  splits: AggregateSplit[],
  costTypes: { id: string; name: string }[],
  options: {
    kinds?: CategoryKind[];
    majorOrder?: { id: string; categories: { id: string }[] }[];
  } = {},
): CrossTab {
  const kinds = options.kinds ?? ["EXPENSE", "LIVING"];
  const columns: CrossTabColumn[] = costTypes.map((c) => ({ key: c.id, costTypeId: c.id, name: c.name }));
  const columnKeys = new Set(columns.map((c) => c.key));
  const extraColumns: CrossTabColumn[] = [];

  const majors = new Map<string, CrossTabMajorRow>();
  const categoryRows = new Map<string, CrossTabCategoryRow>();
  const columnTotals: Record<string, number> = {};
  let total = 0;

  for (const split of splits) {
    if (!kinds.includes(split.major.kind)) continue;
    const key = split.costType?.id ?? NO_COST_TYPE;
    // アーカイブした費目が過去の内訳に残っている場合も、列として出す
    if (split.costType && !columnKeys.has(key)) {
      columnKeys.add(key);
      extraColumns.push({ key, costTypeId: split.costType.id, name: split.costType.name });
    }

    let major = majors.get(split.major.id);
    if (!major) {
      major = {
        majorId: split.major.id,
        majorName: split.major.name,
        kind: split.major.kind,
        categories: [],
        cells: {},
        total: 0,
      };
      majors.set(split.major.id, major);
    }
    let row = categoryRows.get(split.categoryId);
    if (!row) {
      row = { categoryId: split.categoryId, categoryName: split.categoryName, cells: {}, total: 0 };
      categoryRows.set(split.categoryId, row);
      major.categories.push(row);
    }

    row.cells[key] = (row.cells[key] ?? 0) + split.amount;
    row.total += split.amount;
    major.cells[key] = (major.cells[key] ?? 0) + split.amount;
    major.total += split.amount;
    columnTotals[key] = (columnTotals[key] ?? 0) + split.amount;
    total += split.amount;
  }

  // 浮動小数の誤差で 0.0000001 のような値が残らないよう、銭単位で丸める
  const round = (value: number) => Math.round(value * 100) / 100;
  const roundCells = (cells: Record<string, number>) => {
    for (const k of Object.keys(cells)) cells[k] = round(cells[k]);
  };

  const order = new Map((options.majorOrder ?? []).map((m, i) => [m.id, i]));
  const categoryOrder = new Map(
    (options.majorOrder ?? []).flatMap((m) => m.categories.map((c, i) => [c.id, i] as const)),
  );
  const byOrder = <T>(rank: (item: T) => number | undefined) =>
    (a: { item: T; appearance: number }, b: { item: T; appearance: number }) =>
      (rank(a.item) ?? 1e6 + a.appearance) - (rank(b.item) ?? 1e6 + b.appearance);

  const sorted = [...majors.values()]
    .map((item, appearance) => ({ item, appearance }))
    .sort(byOrder<CrossTabMajorRow>((m) => order.get(m.majorId)))
    .map(({ item: major }) => {
      major.categories = major.categories
        .map((item, appearance) => ({ item, appearance }))
        .sort(byOrder<CrossTabCategoryRow>((row) => categoryOrder.get(row.categoryId)))
        .map(({ item: row }) => {
          roundCells(row.cells);
          row.total = round(row.total);
          return row;
        })
        .filter((row) => Object.values(row.cells).some((v) => v !== 0));
      roundCells(major.cells);
      major.total = round(major.total);
      return major;
    })
    .filter((major) => major.categories.length > 0);

  roundCells(columnTotals);
  return {
    columns: [...columns, ...extraColumns, { key: NO_COST_TYPE, costTypeId: null, name: "未設定" }],
    majors: sorted,
    columnTotals,
    total: round(total),
  };
}
