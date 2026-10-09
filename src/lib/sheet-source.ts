import type { CategoryKind } from "@/lib/db/types";
import type { AggregateSplit } from "@/lib/aggregate-core";
import { signFor } from "@/lib/category-kind";
import { mapRow } from "@/lib/csv";
import {
  INCOME_FALLBACK_MAJOR,
  inferPaymentKind,
  inflowCountsAsIncome,
  type PaymentKind,
} from "@/lib/inflow";
import { normalizeDescription } from "@/lib/normalize";
import { classify, classifyCostType, type RuleLike } from "@/lib/rules";
import type { SheetBlock } from "@/lib/sheet-blocks";

/**
 * 請求シートのブロックを、集計に通せる `AggregateSplit[]` に変換する層。
 *
 * この経路は **読み取り専用**で、アプリのデータにも請求シートにも何も書かない。
 * ただし「その中項目がどの大項目・どの種別か」はシートに書かれていないので、
 * カテゴリの定義だけはアプリのものを借りる（定義を二重管理しないため）。
 * アプリに無い中項目が要るとき（入金を収入側へ回す先など）は、その場限りの仮の中項目を作って数える。
 */

export type MajorDef = {
  id: string;
  name: string;
  kind: CategoryKind;
  color: string;
  sortOrder: number;
};

export type CategoryDef = {
  id: string;
  name: string;
  major: MajorDef;
  /**
   * アプリにまだ無い、その場限りの中項目。取り込むときはこの名前・大項目で作る。
   * major.id が空なら、大項目（収入内訳）もまだ無い。
   */
  virtual?: true;
};

/** 中項目をどう決めたか。推測がどれだけ混ざっているかを画面に出すために数える。 */
export type ResolutionCounts = {
  /** 使用先の名前がそのまま中項目にあった */
  byUsage: number;
  /** 使用先では決まらず、自動分類ルールで決めた */
  byRule: number;
  /** どちらでも決まらず「未分類」に寄せた */
  byFallback: number;
  /** 中項目を決められなかった（集計に入らない） */
  unresolved: number;
  /**
   * 使用先が空で、集計に入れなかった行。
   * GAS のまとめは使用先で集計するので、使用先の無い行（カードの引き落としなど）は数えない。
   * 数えるとカードの利用額と引き落とし額が二重に計上される。
   */
  noUsage: number;
  /** 本来と逆向きの金額（カードの返金・電子マネーのチャージなど）で、差し引いて集計した行 */
  netted: number;
  /** 銀行・現金・電子マネーの受け取りの入金を、収入として数えた行 */
  inflowToIncome: number;
};

export type SheetRowIssue = {
  block: string;
  /** ブロック内での明細の行番号（1 始まり） */
  row: number;
  description: string;
  reason: string;
};

export type BlockStat = {
  name: string;
  /** 決済手段の種類（入金の扱いを決める） */
  paymentKind: PaymentKind;
  /** 読み取った明細行の数 */
  rows: number;
  /** 集計に入った数 */
  used: number;
  firstDate: string | null;
  lastDate: string | null;
  /** 列の読み取りで引っかかった点 */
  issues: string[];
};

export type SheetReadResult = {
  splits: AggregateSplit[];
  blocks: BlockStat[];
  resolution: ResolutionCounts;
  issues: SheetRowIssue[];
};

export type SheetSourceOptions = {
  /** 決済手段の名前（正規化済み）→ 種類（アプリの登録）。無いブロックは名前から推測する */
  paymentKinds?: Map<string, PaymentKind>;
  costTypes?: { id: string; name: string }[];
  /** 中項目を 1 つも持たない大項目も、大項目名での一致に使う */
  majors?: MajorDef[];
};

export type Resolved = { category: CategoryDef; how: "byUsage" | "byRule" | "byFallback" };

/** 仮の受け皿「収入内訳」の色（アプリに大項目が無いときだけ使う） */
const VIRTUAL_COLOR = "#197a4b";

/** 同名の中項目が複数の大項目にぶら下がり得るので、名前 → 候補の配列で持つ */
export function indexByName(categories: CategoryDef[]) {
  const byName = new Map<string, CategoryDef[]>();
  for (const category of categories) {
    const key = normalizeDescription(category.name);
    const list = byName.get(key);
    if (list) list.push(category);
    else byName.set(key, [category]);
  }
  // 候補が複数あるときは大項目の並び順が先のものを既定にする
  for (const list of byName.values()) {
    list.sort((a, b) => a.major.sortOrder - b.major.sortOrder);
  }
  return byName;
}

export type ResolveContext = {
  byName: Map<string, CategoryDef[]>;
  byId: Map<string, CategoryDef>;
  majorsByName: Map<string, MajorDef>;
  rules: RuleLike[];
  /**
   * 使用先に当たる中項目が無い出金・差し引きの行を、この大項目の下に同じ名前で作って入れる
   * （請求シートの取り込みで「中項目を作る」を選んだとき）。無ければルール・未分類で決める。
   */
  createUnder?: MajorDef;
};

/** 中項目の定義・大項目・ルールから、resolveCategory に渡す索引を作る */
export function buildResolveContext(
  categories: CategoryDef[],
  rules: RuleLike[],
  majors?: MajorDef[],
): ResolveContext {
  const majorList = majors ?? [...new Map(categories.map((c) => [c.major.id, c.major])).values()];
  return {
    byName: indexByName(categories),
    byId: new Map(categories.map((c) => [c.id, c])),
    majorsByName: new Map(majorList.map((m) => [normalizeDescription(m.name), m])),
    rules: rules.filter((rule) => rule.enabled),
  };
}

/** アプリに無い中項目を、その場限りで作る。突合は大項目名・中項目名で突き合わせる */
function virtualCategory(major: MajorDef, name: string): CategoryDef {
  return { id: `virtual:${major.name}:${name}`, name, major, virtual: true };
}

/**
 * 使用先（＝中項目名）と内容から中項目を決める。
 *
 * 同じ名前の中項目が、支出側と収入側の両方にあることがある
 * （「インターン / 2024夏インターン費用」と「交通費支給（インターン）/ 2024夏インターン費用」）。
 * お金の向きで選び分ける:
 *   - 収入として数える入金 → 収入側の同名項目。無ければ、資産の移動（投資・帳尻合わせ）の同名項目、
 *     それも無ければ、使用先と同じ名前の大項目の下、さらに無ければ「収入内訳」の下に同じ名前で入れる
 *   - それ以外（出金、差し引きの入金） → 収入以外の同名項目
 */
export function resolveCategory(
  usage: string | null,
  description: string,
  toIncome: boolean,
  ctx: ResolveContext,
): Resolved | null {
  if (usage) {
    const candidates = ctx.byName.get(normalizeDescription(usage)) ?? [];
    const income = candidates.filter((c) => c.major.kind === "INCOME");
    const transfer = candidates.filter(
      (c) => c.major.kind === "ADJUSTMENT" || c.major.kind === "INVESTMENT",
    );
    const nonIncome = candidates.filter((c) => c.major.kind !== "INCOME");

    if (toIncome) {
      if (income.length > 0) return { category: income[0], how: "byUsage" };
      if (transfer.length > 0) return { category: transfer[0], how: "byUsage" };
    } else if (nonIncome.length > 0) {
      // GAS からの引き継ぎ: 使用先に「投資」が含まれるなら投資の大項目に寄せる
      if (usage.includes("投資")) {
        const investment = nonIncome.find((c) => c.major.kind === "INVESTMENT");
        if (investment) return { category: investment, how: "byUsage" };
      }
      if (nonIncome.length === 1) return { category: nonIncome[0], how: "byUsage" };
      // 同名が複数の大項目にある（生活費/食費 と 支出/食費 など）。
      // 内容から決まるならそれを優先し、決まらなければ並び順が先の大項目にする。
      const ruled = classify(description, ctx.rules);
      const hit = ruled ? nonIncome.find((c) => c.id === ruled.categoryId) : undefined;
      return { category: hit ?? nonIncome[0], how: "byUsage" };
    } else if (candidates.length > 0) {
      return { category: candidates[0], how: "byUsage" };
    }

    // 使用先が大項目の名前と同じ（使用先「給料」→ 大項目「給料」）なら、その大項目の同名の中項目に入れる
    const major = ctx.majorsByName.get(normalizeDescription(usage));
    if (major) return { category: virtualCategory(major, usage.trim()), how: "byUsage" };

    // 収入として数える入金で、同じ名前の収入項目が無いものは「収入内訳」に同じ名前で入れる
    if (toIncome) {
      const fallbackMajor = ctx.majorsByName.get(normalizeDescription(INCOME_FALLBACK_MAJOR)) ?? {
        id: "",
        name: INCOME_FALLBACK_MAJOR,
        kind: "INCOME" as const,
        color: VIRTUAL_COLOR,
        sortOrder: 9999,
      };
      return { category: virtualCategory(fallbackMajor, usage.trim()), how: "byUsage" };
    }

    if (ctx.createUnder) return { category: virtualCategory(ctx.createUnder, usage.trim()), how: "byUsage" };
  }

  const ruled = classify(description, ctx.rules);
  const byRule = ruled ? ctx.byId.get(ruled.categoryId) : undefined;
  if (byRule) return { category: byRule, how: "byRule" };

  const fallback = ctx.byName.get(normalizeDescription("未分類"))?.[0];
  if (fallback) return { category: fallback, how: "byFallback" };

  return null;
}

/** 費目: 「費目」列の値が設定の費目名に当たればそれ、無ければ店名からルールで決める */
export function resolveCostType(
  costTypeName: string | null,
  description: string,
  costTypes: { id: string; name: string }[],
  rules: RuleLike[],
): { costType: { id: string; name: string } | null; unknownName: string | null } {
  if (costTypeName) {
    const hit = costTypes.find((c) => normalizeDescription(c.name) === normalizeDescription(costTypeName));
    if (hit) return { costType: hit, unknownName: null };
  }
  const ruled = classifyCostType(description, rules);
  return {
    costType: costTypes.find((c) => c.id === ruled) ?? null,
    unknownName: costTypeName,
  };
}

/** ブロック群を集計の入力に変換する。データの置き場には触らない純粋な変換。 */
export function buildSheetSplits(
  blocks: SheetBlock[],
  categories: CategoryDef[],
  rules: RuleLike[],
  options: SheetSourceOptions = {},
): SheetReadResult {
  const ctx = buildResolveContext(categories, rules, options.majors);
  const costTypes = options.costTypes ?? [];

  const splits: AggregateSplit[] = [];
  const stats: BlockStat[] = [];
  const issues: SheetRowIssue[] = [];
  const resolution: ResolutionCounts = {
    byUsage: 0,
    byRule: 0,
    byFallback: 0,
    unresolved: 0,
    noUsage: 0,
    netted: 0,
    inflowToIncome: 0,
  };

  for (const block of blocks) {
    const paymentKind = options.paymentKinds?.get(normalizeDescription(block.name)) ?? inferPaymentKind(block.name);
    let used = 0;
    let firstDate: string | null = null;
    let lastDate: string | null = null;

    block.table.rows.forEach((row, index) => {
      const mapped = mapRow(row, block.mapping, index);
      const rowNumber = index + 1;

      if (mapped.error || !mapped.date || mapped.amount === null) {
        issues.push({
          block: block.name,
          row: rowNumber,
          description: mapped.description,
          reason: mapped.error ?? "日付か金額を読み取れません",
        });
        return;
      }

      // 使用先の列があるのに空の行は、GAS と同じく集計しない
      if (block.mapping.usage && !mapped.usage) {
        resolution.noUsage += 1;
        return;
      }

      const toIncome = mapped.isIncome && inflowCountsAsIncome(paymentKind, mapped.description);
      const resolved = resolveCategory(mapped.usage, mapped.description, toIncome, ctx);
      if (!resolved) {
        resolution.unresolved += 1;
        issues.push({
          block: block.name,
          row: rowNumber,
          description: mapped.description,
          reason: mapped.usage
            ? `使用先「${mapped.usage}」に当たる中項目がありません`
            : "中項目を決められませんでした",
        });
        return;
      }

      resolution[resolved.how] += 1;
      const { category } = resolved;

      // 金額の符号はアプリの明細と同じ規則（signFor）。収入として数える入金は収入側の項目に入るのでプラス、
      // カードの返金やチャージは支出側の項目に入るのでマイナスになり、その項目から差し引かれる
      // （GAS のまとめもそう集計している）。
      const sign = signFor(category.major.kind, mapped.isIncome);
      if (sign < 0) resolution.netted += 1;
      if (toIncome && category.major.kind === "INCOME") resolution.inflowToIncome += 1;

      const { costType, unknownName } = resolveCostType(
        mapped.costTypeName,
        mapped.description,
        costTypes,
        ctx.rules,
      );
      if (unknownName) {
        issues.push({
          block: block.name,
          row: rowNumber,
          description: mapped.description,
          reason: `費目「${unknownName}」が設定にありません`,
        });
      }

      splits.push({
        date: new Date(`${mapped.date}T00:00:00.000Z`),
        amount: sign * mapped.amount,
        categoryId: category.id,
        categoryName: category.name,
        major: {
          id: category.major.id || `virtual-major:${category.major.name}`,
          name: category.major.name,
          kind: category.major.kind,
          color: category.major.color,
        },
        costType,
      });

      used += 1;
      if (!firstDate || mapped.date < firstDate) firstDate = mapped.date;
      if (!lastDate || mapped.date > lastDate) lastDate = mapped.date;
    });

    stats.push({
      name: block.name,
      paymentKind,
      rows: block.table.rows.length,
      used,
      firstDate,
      lastDate,
      issues: block.issues,
    });
  }

  return { splits, blocks: stats, resolution, issues };
}
