import type { CategoryKind, Transaction, TransactionSplit } from "@/lib/db/types";
import type { Snapshot } from "@/lib/db/store";
import { byDateDesc, categoryResolver, splitsByTransaction } from "@/lib/db/queries";
import { isoDate, monthStart } from "@/lib/aggregate";

export type TransactionFilters = {
  /** "2026-08" 形式。指定するとその月に絞り込む。 */
  month?: string;
  /** "2026" 形式。month が無いときに年で絞り込む。 */
  year?: string;
  from?: string;
  to?: string;
  majorId?: string;
  categoryId?: string;
  kind?: CategoryKind;
  paymentMethodId?: string;
  /** 費目の id。"none" は費目が付いていない内訳 */
  costTypeId?: string;
  q?: string;
  /** 明細の ID（「二人」ページから本体の明細へ飛ぶとき） */
  id?: string;
};

export function parseFilters(params: URLSearchParams): TransactionFilters {
  const get = (key: string) => params.get(key)?.trim() || undefined;
  return {
    month: get("month"),
    year: get("year"),
    from: get("from"),
    to: get("to"),
    majorId: get("majorId"),
    categoryId: get("categoryId"),
    kind: get("kind") as CategoryKind | undefined,
    paymentMethodId: get("paymentMethodId"),
    costTypeId: get("costTypeId"),
    q: get("q"),
    id: get("id"),
  };
}

/** 絞り込み条件を [from, to) の日付範囲にする */
export function resolveRange(filters: TransactionFilters) {
  if (filters.month) {
    const [year, month] = filters.month.split("-").map(Number);
    if (year && month) {
      return { from: monthStart(year, month), to: monthStart(year, month + 1) };
    }
  }
  if (filters.year) {
    const year = Number(filters.year);
    if (year) return { from: monthStart(year, 1), to: monthStart(year + 1, 1) };
  }
  if (filters.from || filters.to) {
    return {
      from: filters.from ? new Date(`${filters.from}T00:00:00.000Z`) : new Date(0),
      to: filters.to
        ? new Date(new Date(`${filters.to}T00:00:00.000Z`).getTime() + 86400000)
        : new Date("9999-12-31T00:00:00.000Z"),
    };
  }
  return null;
}

/** 全角・半角、大文字・小文字の違いを無視して検索するための正規化 */
function fold(text: string) {
  return text.normalize("NFKC").toLowerCase();
}

/**
 * 内訳にかかるカテゴリ・費目の条件。条件が無ければ null。
 * 明細一覧では「どれか 1 つの内訳が合えばその明細を出す」、
 * 絞り込み合計では「合う内訳の金額だけを足す」ために使う。
 * カテゴリと費目の条件は「同じ内訳」にかける。別々の内訳で満たしても、
 * クロス集計のマス（旅行かつ食費）とは一致しないため。
 */
function splitMatcher(db: Snapshot, filters: TransactionFilters) {
  const checks: ((split: TransactionSplit) => boolean)[] = [];
  if (filters.categoryId) {
    const id = filters.categoryId;
    checks.push((split) => split.categoryId === id);
  } else if (filters.majorId || filters.kind) {
    const resolve = categoryResolver(db);
    checks.push((split) => {
      const found = resolve(split.categoryId);
      if (!found) return false;
      if (filters.majorId && found.major.id !== filters.majorId) return false;
      if (filters.kind && found.major.kind !== filters.kind) return false;
      return true;
    });
  }
  if (filters.costTypeId) {
    const id = filters.costTypeId === "none" ? null : filters.costTypeId;
    checks.push((split) => (split.costTypeId ?? null) === id);
  }
  if (checks.length === 0) return null;
  return (split: TransactionSplit) => checks.every((check) => check(split));
}

/**
 * 絞り込み条件に合う明細（日付の新しい順）と、絞り込み合計を返す。
 *
 * 合計はカテゴリ条件に合う「内訳」だけを足す。分割した明細を中項目で絞ったとき、
 * 総額ではなくその内訳ぶんが出るようにするため（総額を足すと二重に見える）。
 */
export function filterTransactions(db: Snapshot, filters: TransactionFilters) {
  const range = resolveRange(filters);
  const [fromIso, toIso] = range ? [isoDate(range.from), isoDate(range.to)] : [null, null];
  const matchSplit = splitMatcher(db, filters);
  const splits = splitsByTransaction(db);
  const q = filters.q ? fold(filters.q) : null;

  const matched: Transaction[] = [];
  let sum = 0;
  for (const tx of db.transactions) {
    if (fromIso && (tx.date < fromIso || tx.date >= toIso!)) continue;
    if (filters.id && tx.id !== filters.id) continue;
    if (filters.paymentMethodId && tx.paymentMethodId !== filters.paymentMethodId) continue;
    if (q && !fold(tx.description).includes(q) && !fold(tx.memo ?? "").includes(q)) continue;

    const own = splits.get(tx.id) ?? [];
    if (matchSplit && !own.some(matchSplit)) continue;

    matched.push(tx);
    for (const split of own) {
      if (!matchSplit || matchSplit(split)) sum += split.amount;
    }
  }
  matched.sort(byDateDesc);
  return { transactions: matched, sum: Math.round(sum * 100) / 100 };
}
