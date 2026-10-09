/**
 * スナップショットから画面用のデータを組み立てる共通処理。
 *
 * Postgres では外部キーが「内訳は必ず存在する中項目を指す」ことを保証していたが、
 * スプレッドシートは手で行を消せるので、その保証が無い。参照先が見つからない場合も
 * 落ちずに「不明」として表示し、集計からは外す（npm run sheets:check で一覧できる）。
 */
import type { Snapshot } from "@/lib/db/store";
import type {
  Category,
  CostType,
  MajorCategory,
  PaymentMethod,
  Transaction,
} from "@/lib/db/types";
import type {
  CostTypeView,
  MajorWithCategories,
  PaymentMethodView,
  PurposeView,
  TransactionView,
} from "@/lib/view-types";

/** 並び順 → 名前 の順に並べる（大項目・中項目・決済手段で共通） */
export function byOrderThenName<T extends { sortOrder: number; name: string }>(a: T, b: T) {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ja");
}

export function indexById<T extends { id: string }>(rows: T[]) {
  return new Map(rows.map((row) => [row.id, row]));
}

/** 大項目 > 中項目のツリー（アーカイブ済みは除く） */
export function majorsWithCategories(db: Snapshot): MajorWithCategories[] {
  const categoriesByMajor = new Map<string, Category[]>();
  for (const category of db.categories) {
    if (category.archivedAt) continue;
    const list = categoriesByMajor.get(category.majorId) ?? [];
    list.push(category);
    categoriesByMajor.set(category.majorId, list);
  }
  return db.majors
    .filter((major) => !major.archivedAt)
    .sort(byOrderThenName)
    .map((major) => ({
      id: major.id,
      name: major.name,
      kind: major.kind,
      color: major.color,
      sortOrder: major.sortOrder,
      isSystem: major.isSystem,
      purposeId: major.purposeId,
      categories: (categoriesByMajor.get(major.id) ?? [])
        .sort(byOrderThenName)
        .map((c) => ({ id: c.id, name: c.name, sortOrder: c.sortOrder })),
    }));
}

export function activePaymentMethods(db: Snapshot): PaymentMethod[] {
  return db.paymentMethods.filter((m) => !m.archivedAt).sort(byOrderThenName);
}

export function toPaymentMethodView(method: PaymentMethod): PaymentMethodView {
  return {
    id: method.id,
    name: method.name,
    kind: method.kind,
    trackBalance: method.trackBalance,
    openingBalance: method.openingBalance,
    openingBalanceAt: method.openingBalanceAt,
  };
}

/** 使途（アーカイブ済みは除く）。並び順がダッシュボードの並び */
export function activePurposes(db: Snapshot): PurposeView[] {
  return db.purposes
    .filter((p) => !p.archivedAt)
    .sort(byOrderThenName)
    .map((p) => ({ id: p.id, name: p.name, openingBalance: p.openingBalance, openingBalanceAt: p.openingBalanceAt }));
}

/** 費目（アーカイブ済みは除く）。並び順がクロス集計の列の順 */
export function activeCostTypes(db: Snapshot): CostType[] {
  return db.costTypes.filter((c) => !c.archivedAt).sort(byOrderThenName);
}

export function toCostTypeView(costType: CostType): CostTypeView {
  return { id: costType.id, name: costType.name };
}

const UNKNOWN_MAJOR: Pick<MajorCategory, "id" | "name" | "kind" | "color"> = {
  id: "",
  name: "不明",
  kind: "EXPENSE",
  color: "#767676",
};

/**
 * 中項目 id から「中項目＋大項目」を引く関数を作る。
 * 見つからなければ null（集計からは外す）。
 */
export function categoryResolver(db: Snapshot) {
  const categories = indexById(db.categories);
  const majors = indexById(db.majors);
  return (categoryId: string) => {
    const category = categories.get(categoryId);
    if (!category) return null;
    const major = majors.get(category.majorId);
    if (!major) return null;
    return { category, major };
  };
}

/** 明細 id → 内訳（並び順どおり） */
export function splitsByTransaction(db: Snapshot) {
  const map = new Map<string, Snapshot["splits"]>();
  for (const split of db.splits) {
    const list = map.get(split.transactionId) ?? [];
    list.push(split);
    map.set(split.transactionId, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);
  return map;
}

/**
 * 明細を画面用の形にする。多数の明細をまとめて変換するときは、
 * 先に makeTransactionViewer(db) を作って使い回す（索引を毎回作らないため）。
 */
export function makeTransactionViewer(db: Snapshot) {
  const resolve = categoryResolver(db);
  const splits = splitsByTransaction(db);
  const methods = indexById(db.paymentMethods);
  const costTypes = indexById(db.costTypes);

  return (tx: Transaction): TransactionView => ({
    id: tx.id,
    date: tx.date,
    amount: tx.amount,
    description: tx.description,
    memo: tx.memo,
    paymentMethodId: tx.paymentMethodId,
    source: tx.source,
    splits: (splits.get(tx.id) ?? []).map((split) => {
      const found = resolve(split.categoryId);
      return {
        id: split.id,
        categoryId: split.categoryId,
        costTypeId: split.costTypeId,
        costType: pick(costTypes.get(split.costTypeId ?? "")),
        amount: split.amount,
        category: found
          ? {
              id: found.category.id,
              name: found.category.name,
              major: {
                id: found.major.id,
                name: found.major.name,
                kind: found.major.kind,
                color: found.major.color,
              },
            }
          : { id: split.categoryId, name: "（不明な中項目）", major: UNKNOWN_MAJOR },
      };
    }),
    paymentMethod: pick(methods.get(tx.paymentMethodId ?? "")),
    transferToId: tx.transferToId,
    transferTo: pick(methods.get(tx.transferToId ?? "")),
  });
}

function pick(row: { id: string; name: string } | undefined) {
  return row ? { id: row.id, name: row.name } : null;
}

/** 明細の並び: 日付の新しい順 → 登録の新しい順 */
export function byDateDesc(a: Transaction, b: Transaction) {
  return b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);
}
