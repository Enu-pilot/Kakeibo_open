import { Badge } from "@/components/ui";
import { cn, formatYen } from "@/lib/utils";
import type { PurposeBalance } from "@/lib/purposes";

/**
 * 使途ごとの残高と、その月のやりくり。
 * 「残高の中でやりくりできているか」を一目で見られるよう、残高がマイナスの使途に「不足」、
 * その月に残高を減らした（収入＋振替で入ったぶんより使った）使途に「取り崩し」を付ける。
 * accountTotal を渡すと、口座残高の合計との差（どの使途にも割り当てていないお金）も出す。
 */
export function PurposeBalances({
  purposes,
  monthLabel,
  accountTotal,
}: {
  purposes: PurposeBalance[];
  /** "2026/10" */
  monthLabel: string;
  accountTotal?: number | null;
}) {
  if (purposes.length === 0) {
    return <p className="text-sm text-fg-muted">使途がまだありません。「設定」→「使途」で作れます。</p>;
  }
  const total = purposes.reduce((sum, p) => sum + p.balance, 0);
  const gap = accountTotal === undefined || accountTotal === null ? null : Math.round((accountTotal - total) * 100) / 100;

  return (
    <div className="space-y-2">
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <caption className="sr-only">使途ごとの残高と、{monthLabel} の収入・支出・振替</caption>
          <thead className="text-xs text-fg-muted">
            <tr className="border-b border-border text-right">
              <th scope="col" className="sticky-col py-1.5 pr-3 text-left font-medium">使途</th>
              <th scope="col" className="px-2 py-1.5 font-medium">残高</th>
              <th scope="col" className="px-2 py-1.5 font-medium">{monthLabel} 収入</th>
              <th scope="col" className="px-2 py-1.5 font-medium">支出</th>
              <th scope="col" className="px-2 py-1.5 font-medium">振替</th>
              <th scope="col" className="py-1.5 pl-2 font-medium">増減</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {purposes.map((p) => {
              const transfer = p.month.transferIn - p.month.transferOut;
              const change = p.month.income - p.month.expense + transfer;
              return (
                <tr key={p.id}>
                  <th scope="row" className="sticky-col py-2 pr-3 text-left font-normal">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {p.name}
                      {p.balance < 0 ? <Badge tone="red">不足</Badge> : change < 0 ? <Badge tone="yellow">取り崩し</Badge> : null}
                    </span>
                    {p.openingBalanceAt ? (
                      <span className="block text-xs text-fg-muted">{p.openingBalanceAt.replace(/-/g, "/")} 起点</span>
                    ) : null}
                  </th>
                  <td className={cn("tabular px-2 py-2 text-right font-bold", p.balance < 0 && "text-expense")}>
                    {formatYen(p.balance)}
                  </td>
                  <td className="tabular px-2 py-2 text-right">{formatYen(p.month.income)}</td>
                  <td className="tabular px-2 py-2 text-right">{formatYen(p.month.expense)}</td>
                  <td className="tabular px-2 py-2 text-right text-fg-muted">
                    {transfer === 0 ? "-" : formatYen(transfer, { sign: true })}
                  </td>
                  <td className={cn("tabular py-2 pl-2 text-right", change < 0 && "text-expense")}>
                    {formatYen(change, { sign: true })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <dl className="flex flex-wrap justify-end gap-x-6 gap-y-1 border-t border-border pt-2 text-xs text-fg-muted">
        <div className="flex gap-2">
          <dt>使途の合計</dt>
          <dd className={cn("tabular font-bold text-fg", total < 0 && "text-expense")}>{formatYen(total)}</dd>
        </div>
        {gap !== null ? (
          <>
            <div className="flex gap-2">
              <dt>口座残高の合計</dt>
              <dd className="tabular font-bold text-fg">{formatYen(accountTotal!)}</dd>
            </div>
            <div className="flex gap-2">
              <dt>どの使途にも入っていないお金</dt>
              <dd className={cn("tabular font-bold", gap < 0 ? "text-expense" : "text-fg")}>{formatYen(gap, { sign: true })}</dd>
            </div>
          </>
        ) : null}
      </dl>
      {gap !== null && gap !== 0 ? (
        <p className="text-xs text-fg-muted">
          口座残高との差は、起点残高の割り振り残しや、カードで使ってまだ口座から引き落とされていないぶんなどです。
          「設定」→「使途」の起点残高で調整できます。
        </p>
      ) : null}
    </div>
  );
}
