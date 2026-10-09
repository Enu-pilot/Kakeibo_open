/**
 * 請求シート（GAS 時代）の明細を、アプリのデータに取り込む計画を立てる。
 *
 * 読み方は「シート」画面の集計と同じ（sheet-source.ts）:
 *  - 1 行目のブロック名（メインカード・PayPay など）が決済手段
 *  - 使用先が中項目。使用先の無い行（カードの引き落としなど）は取り込まない（二重計上を防ぐため）
 *  - 入金は決済手段の種類で扱いを決める（inflow.ts）。銀行・現金・電子マネーの受け取りは収入、
 *    カードの返金・電子マネーのチャージは支出から差し引く
 *  - 金額の符号は種別に対する向き（支出側の払い戻しはマイナス）
 *  - 費目は「費目」列があればその値、無ければ店名からルールで決める
 *
 * 何度取り込んでも増えないように、アプリの重複判定キー（日付・利用先・金額・決済手段＋連番）を使う。
 * シートの中で同じ日・同じ店・同じ金額の行が 2 つあれば（同じ日に同じ運賃を 2 回払った等）、
 * 連番 0・1 として 2 件とも取り込む。2 回目の取り込みでは、どちらも「取り込み済み」になる。
 */
import { mapRow } from "@/lib/csv";
import { buildDedupeHash } from "@/lib/dedupe";
import { signFor } from "@/lib/category-kind";
import { inflowCountsAsIncome, toPaymentKind } from "@/lib/inflow";
import { normalizeDescription } from "@/lib/normalize";
import { activeCostTypes } from "@/lib/db/queries";
import {
  buildResolveContext,
  resolveCategory,
  resolveCostType,
  type CategoryDef,
  type MajorDef,
} from "@/lib/sheet-source";
import type { SheetBlock } from "@/lib/sheet-blocks";
import type { Snapshot } from "@/lib/db/store";

export type SheetImportOptions = {
  /** "YYYY-MM"。この月より前は取り込まない */
  fromMonth: string | null;
  /** "YYYY-MM"。この月より後は取り込まない */
  toMonth: string | null;
  /** 使用先に当たる中項目が無いとき、その名前で中項目を作る（作らなければ自動分類ルール → 未分類） */
  createMissingCategories: boolean;
  /** 新しく作る中項目を入れる大項目 */
  newCategoryMajorId: string | null;
};

/** 取り込む 1 行（内訳は 1 件） */
export type PlannedRow = {
  date: string;
  description: string;
  /** 決済手段の名前（ブロック名）。既存に無ければ作る */
  paymentMethodName: string;
  /** 既存の中項目 id。新しく作る場合は null で newCategory を見る */
  categoryId: string | null;
  /** 新しく作る中項目。majorId が null なら、大項目（収入内訳）から作る */
  newCategory: { name: string; majorId: string | null; majorName: string } | null;
  /** 種別に対する向きを付けた金額（払い戻しはマイナス） */
  amount: number;
  costTypeId: string | null;
};

export type SheetImportSummary = {
  /** 取り込む件数 */
  toImport: number;
  /** すでにアプリにある（前に取り込んだ・CSV で入れた）件数 */
  alreadyInApp: number;
  /** 使用先が空で取り込まない件数 */
  noUsage: number;
  /** 日付・金額を読めない、中項目を決められない件数 */
  unreadable: number;
  /** 期間の外で取り込まない件数 */
  outOfRange: number;
  /** 中項目を自動分類ルール・未分類で決めた件数（使用先がそのまま中項目にならなかった） */
  guessed: number;
  /** 入金を収入として数える件数（銀行・現金・電子マネーの受け取り） */
  inflowToIncome: number;
  /** 入金を支出から差し引く件数（カードの返金・電子マネーのチャージなど） */
  netted: number;
  /** 新しく作る中項目。選んだ大項目以外に作るものは「大項目 / 中項目」の形 */
  newCategories: string[];
  /** 新しく作る大項目（収入の受け皿「収入内訳」） */
  newMajors: string[];
  newPaymentMethods: string[];
  /** 取り込む件数の月ごとの内訳 */
  months: { month: string; count: number }[];
};

export type SheetImportPlan = { rows: PlannedRow[]; summary: SheetImportSummary };

export function planSheetImport(
  db: Snapshot,
  blocks: SheetBlock[],
  options: SheetImportOptions,
): SheetImportPlan {
  const majors = new Map(db.majors.filter((m) => !m.archivedAt).map((m) => [m.id, m]));
  const toDef = (m: MajorDef): MajorDef => ({ id: m.id, name: m.name, kind: m.kind, color: m.color, sortOrder: m.sortOrder });
  const categories: CategoryDef[] = db.categories.flatMap((c) => {
    const major = c.archivedAt ? undefined : majors.get(c.majorId);
    return major ? [{ id: c.id, name: c.name, major: toDef(major) }] : [];
  });
  const newMajor = options.createMissingCategories && options.newCategoryMajorId
    ? majors.get(options.newCategoryMajorId)
    : undefined;
  const ctx = {
    ...buildResolveContext(categories, db.rules, [...majors.values()].map(toDef)),
    createUnder: newMajor ? toDef(newMajor) : undefined,
  };
  const costTypes = activeCostTypes(db);

  const methodByName = new Map(db.paymentMethods.map((m) => [normalizeDescription(m.name), m]));
  const existingHashes = new Set(db.transactions.map((t) => t.dedupeHash));
  /** 同じ内容が何回目か（重複判定キーの連番） */
  const occurrences = new Map<string, number>();

  const summary: SheetImportSummary = {
    toImport: 0,
    alreadyInApp: 0,
    noUsage: 0,
    unreadable: 0,
    outOfRange: 0,
    guessed: 0,
    inflowToIncome: 0,
    netted: 0,
    newCategories: [],
    newMajors: [],
    newPaymentMethods: [],
    months: [],
  };
  const newCategories = new Set<string>();
  const newMajors = new Set<string>();
  const newMethods = new Set<string>();
  const monthCounts = new Map<string, number>();
  const rows: PlannedRow[] = [];

  for (const block of blocks) {
    const paymentMethodName = block.name.trim() || "請求シート";
    const method = methodByName.get(normalizeDescription(paymentMethodName));
    const paymentKind = toPaymentKind(method?.kind, paymentMethodName);

    block.table.rows.forEach((raw, index) => {
      const mapped = mapRow(raw, block.mapping, index);
      if (mapped.error || !mapped.date || mapped.amount === null) {
        summary.unreadable += 1;
        return;
      }
      // 使用先の列があるのに空の行は、GAS と同じく取り込まない
      if (block.mapping.usage && !mapped.usage) {
        summary.noUsage += 1;
        return;
      }
      const month = mapped.date.slice(0, 7);
      if ((options.fromMonth && month < options.fromMonth) || (options.toMonth && month > options.toMonth)) {
        summary.outOfRange += 1;
        return;
      }

      // 中項目を決める。入金は収入か差し引きかで、同じ名前でも行き先が変わる
      const toIncome = mapped.isIncome && inflowCountsAsIncome(paymentKind, mapped.description);
      const resolved = resolveCategory(mapped.usage, mapped.description, toIncome, ctx);
      if (!resolved) {
        summary.unreadable += 1;
        return;
      }
      if (resolved.how !== "byUsage") summary.guessed += 1;
      const { category } = resolved;
      const kind = category.major.kind;

      const amount = signFor(kind, mapped.isIncome) * mapped.amount;
      const { costType } = resolveCostType(mapped.costTypeName, mapped.description, costTypes, ctx.rules);

      // 重複判定: このシートの中で何回目の同じ内容かを数え、その連番のキーがアプリにあれば取り込み済み。
      // 決済手段がまだ無い（これから作る）ブロックは、アプリにある明細と重なりようがない
      const base = [mapped.date, normalizeDescription(mapped.description), Math.round(amount * 100), paymentMethodName].join("|");
      const occurrence = occurrences.get(base) ?? 0;
      occurrences.set(base, occurrence + 1);
      if (method) {
        const hash = buildDedupeHash({ date: mapped.date, description: mapped.description, amount, paymentMethodId: method.id, occurrence });
        if (existingHashes.has(hash)) {
          summary.alreadyInApp += 1;
          return;
        }
      } else {
        newMethods.add(paymentMethodName);
      }

      let newCategory: PlannedRow["newCategory"] = null;
      if (category.virtual) {
        newCategory = { name: category.name, majorId: category.major.id || null, majorName: category.major.name };
        if (!newCategory.majorId) newMajors.add(category.major.name);
        newCategories.add(
          newMajor && newCategory.majorId === newMajor.id ? category.name : `${category.major.name} / ${category.name}`,
        );
      }
      if (mapped.isIncome) {
        if (toIncome && kind === "INCOME") summary.inflowToIncome += 1;
        else summary.netted += 1;
      }

      rows.push({
        date: mapped.date,
        description: mapped.description,
        paymentMethodName,
        categoryId: newCategory ? null : category.id,
        newCategory,
        amount,
        costTypeId: costType?.id ?? null,
      });
      monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);
    });
  }

  summary.toImport = rows.length;
  summary.newCategories = [...newCategories].sort((a, b) => a.localeCompare(b, "ja"));
  summary.newMajors = [...newMajors];
  summary.newPaymentMethods = [...newMethods];
  summary.months = [...monthCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, count]) => ({ month, count }));
  return { rows, summary };
}
