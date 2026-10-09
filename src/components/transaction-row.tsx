import type { CategoryKind } from "@/lib/db/types";
import { KIND_VAR } from "@/lib/chart-colors";
import { formatYen } from "@/lib/utils";

export type TransactionRowData = {
  id: string;
  date: string;
  description: string;
  amount: number;
  splits: {
    categoryName: string;
    majorName: string;
    kind: CategoryKind;
    amount: number;
  }[];
  paymentMethodName: string | null;
};

/** ダッシュボードの「直近の登録」用の読み取り専用行 */
export function TransactionRow({
  transaction,
}: {
  transaction: TransactionRowData;
}) {
  const isSplit = transaction.splits.length > 1;

  return (
    <li className="flex items-center gap-3 px-4 py-2.5 text-sm">
      <span className="tabular w-[4.5rem] shrink-0 text-xs text-fg-muted">
        {transaction.date.slice(5).replace("-", "/")}
      </span>
      <span className="min-w-0 flex-1 truncate">{transaction.description}</span>
      <span className="hidden shrink-0 flex-col items-end gap-0.5 text-xs text-fg-muted sm:flex">
        {transaction.splits.map((split, index) => (
          <span key={index} className="flex items-center gap-1.5">
            <span
              className="size-2 rounded-[2px]"
              style={{ background: KIND_VAR[split.kind] }}
              aria-hidden
            />
            {split.majorName} / {split.categoryName}
            {isSplit ? (
              <span className="tabular">{formatYen(split.amount)}</span>
            ) : null}
          </span>
        ))}
      </span>
      {transaction.paymentMethodName ? (
        <span className="hidden w-24 shrink-0 truncate text-right text-xs text-fg-muted md:block">
          {transaction.paymentMethodName}
        </span>
      ) : null}
      <span className="tabular w-24 shrink-0 text-right font-medium">
        {formatYen(transaction.amount)}
      </span>
    </li>
  );
}
