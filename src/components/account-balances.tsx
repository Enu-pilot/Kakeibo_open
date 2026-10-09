import Link from "next/link";
import { cn, formatYen } from "@/lib/utils";
import type { AccountBalance } from "@/lib/balances";

const KIND_LABEL: Record<string, string> = {
  CARD: "クレジットカード",
  EMONEY: "電子マネー",
  CASH: "現金",
  BANK: "銀行口座",
};

/**
 * 口座残高の一覧。
 * 集計（純残高）とは別で、帳尻合わせを口座間の残高移動として数えたうえでの
 * 「いま口座にいくらあるか」を出す。
 */
export function AccountBalances({ accounts }: { accounts: AccountBalance[] }) {
  const total = accounts.reduce((sum, account) => sum + account.balance, 0);
  const unassigned = accounts.reduce(
    (sum, account) => sum + account.unassignedTransfers,
    0,
  );

  return (
    <div className="space-y-2.5">
      <ul className="divide-y divide-border">
        {accounts.map((account) => (
          <li
            key={account.id}
            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2 first:pt-0"
          >
            <div>
              <p className="text-sm">{account.name}</p>
              <p className="text-xs text-fg-muted">
                {KIND_LABEL[account.kind] ?? account.kind}
                {account.openingBalanceAt
                  ? ` ・ ${account.openingBalanceAt.replace(/-/g, "/")} 起点`
                  : null}
              </p>
            </div>
            <p
              className={cn(
                "tabular text-sm font-semibold",
                account.balance < 0 && "text-expense",
              )}
            >
              {formatYen(account.balance)}
            </p>
          </li>
        ))}
      </ul>

      <div className="flex items-baseline justify-between border-t border-border pt-2">
        <p className="text-xs text-fg-muted">合計</p>
        <p
          className={cn(
            "tabular text-base font-semibold",
            total < 0 && "text-expense",
          )}
        >
          {formatYen(total)}
        </p>
      </div>

      {unassigned > 0 ? (
        <p className="text-xs text-fg-muted">
          移動先が未設定の帳尻合わせが {unassigned} 件あります。どちらの口座へ移したのか
          決まらないため残高に反映していません。
          <Link
            href="/transactions?kind=ADJUSTMENT"
            className="ml-1 link"
          >
            明細で設定する
          </Link>
        </p>
      ) : null}
    </div>
  );
}
