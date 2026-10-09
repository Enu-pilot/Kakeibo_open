import type { Snapshot } from "@/lib/db/store";
import type { PaymentMethod } from "@/lib/db/types";
import { byOrderThenName, categoryResolver, splitsByTransaction } from "@/lib/db/queries";

/**
 * 口座残高。
 *
 * 集計（純残高）は「収入 − 支出 − 生活費 − 投資」で、帳尻合わせを除外している（要件 決定 3）。
 * 残高はそれとは別の問いで、「いま口座にいくらあるか」を出す。
 * チャージや口座振替は純資産こそ動かさないが、口座の中身は確実に動くので、
 * 残高では帳尻合わせを移動元・移動先のある「残高移動」として数える。
 *
 * 残高 = 起点残高
 *      + 収入の内訳
 *      − 支出・生活費・投資の内訳
 *      − 移動先を設定した帳尻合わせの内訳（出ていくぶん）
 *      + 自分を移動先とする帳尻合わせの内訳（入ってくるぶん）
 *
 * 移動先が未設定の帳尻合わせは、どちらの向きの移動か決まらないため残高に効かせない。
 * 未設定の件数は返り値に含めるので、画面で「移動先を設定してください」と促せる。
 */
export type AccountBalance = {
  id: string;
  name: string;
  kind: string;
  /** 起点残高 */
  openingBalance: number;
  /** 起点残高の基準日（"2026-08-01"）。null なら全期間が対象。 */
  openingBalanceAt: string | null;
  /** 起点残高に明細を足し引きした現在残高 */
  balance: number;
  /** 内訳（画面で「何がいくら効いたか」を出すため） */
  income: number;
  spending: number;
  transferIn: number;
  transferOut: number;
  /** 移動先が未設定で残高に反映できなかった帳尻合わせの件数 */
  unassignedTransfers: number;
};

type BalanceAccumulator = Omit<AccountBalance, "balance">;

function emptyAccumulator(method: PaymentMethod): BalanceAccumulator {
  return {
    id: method.id,
    name: method.name,
    kind: method.kind,
    openingBalance: method.openingBalance,
    openingBalanceAt: method.openingBalanceAt,
    income: 0,
    spending: 0,
    transferIn: 0,
    transferOut: 0,
    unassignedTransfers: 0,
  };
}

/**
 * 残高を追う決済手段について、現在残高を計算する。
 * 起点日より前の明細は「起点残高に既に含まれている」とみなして数えない。
 */
export function getAccountBalances(db: Snapshot): AccountBalance[] {
  const methods = db.paymentMethods
    .filter((m) => !m.archivedAt && m.trackBalance)
    .sort(byOrderThenName);
  if (methods.length === 0) return [];

  const accounts = new Map(methods.map((m) => [m.id, emptyAccumulator(m)]));
  const resolve = categoryResolver(db);
  const splits = splitsByTransaction(db);

  // 対象は「この決済手段で払った明細」と「この決済手段へ移した明細」の両方。
  const transactions = db.transactions.filter(
    (t) =>
      (t.paymentMethodId && accounts.has(t.paymentMethodId)) ||
      (t.transferToId && accounts.has(t.transferToId)),
  );

  for (const transaction of transactions) {
    let income = 0;
    let spending = 0;
    let adjustment = 0;
    for (const split of splits.get(transaction.id) ?? []) {
      const found = resolve(split.categoryId);
      if (!found) continue; // 中項目が消えた内訳は種別が決まらないので数えない
      const amount = split.amount;
      const kind = found.major.kind;
      if (kind === "INCOME") income += amount;
      else if (kind === "ADJUSTMENT") adjustment += amount;
      else spending += amount; // EXPENSE / LIVING / INVESTMENT
    }

    const source = transaction.paymentMethodId
      ? accounts.get(transaction.paymentMethodId)
      : undefined;
    if (source && withinRange(transaction.date, source.openingBalanceAt)) {
      source.income += income;
      source.spending += spending;
      if (adjustment > 0) {
        if (transaction.transferToId) source.transferOut += adjustment;
        else source.unassignedTransfers += 1;
      }
    }

    if (adjustment > 0 && transaction.transferToId) {
      const destination = accounts.get(transaction.transferToId);
      if (destination && withinRange(transaction.date, destination.openingBalanceAt)) {
        destination.transferIn += adjustment;
      }
    }
  }

  return [...accounts.values()].map((account) => ({
    ...account,
    balance:
      account.openingBalance +
      account.income -
      account.spending +
      account.transferIn -
      account.transferOut,
  }));
}

/** 起点日が設定されていれば、その日以降の明細だけを数える */
function withinRange(date: string, openingBalanceAt: string | null) {
  if (!openingBalanceAt) return true;
  return date >= openingBalanceAt;
}
