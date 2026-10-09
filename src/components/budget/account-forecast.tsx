import { cn, formatYen } from "@/lib/utils";
import type { AccountForecast } from "@/lib/budget";

/** 口座ごとの「今の残高」と「その月末の見込み」 */
export function AccountForecastList({
  accounts,
  monthLabel,
}: {
  accounts: AccountForecast[];
  monthLabel: string;
}) {
  const current = accounts.reduce((sum, a) => sum + a.current, 0);
  const forecast = accounts.reduce((sum, a) => sum + a.forecast, 0);

  return (
    <div className="space-y-2.5">
      <ul className="divide-y divide-border">
        {accounts.map((account) => (
          <li key={account.id} className="py-2 first:pt-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="text-sm">{account.name}</p>
              <p className="tabular text-sm">
                <span className="text-fg-muted">{formatYen(account.current)} → </span>
                <span className={cn("font-semibold", account.forecast < 0 && "text-expense")}>
                  {formatYen(account.forecast)}
                </span>
              </p>
            </div>
            {account.pending.length > 0 ? (
              <ul className="mt-1 space-y-0.5">
                {account.pending.map((item, i) => (
                  <li
                    key={`${item.date}-${item.name}-${i}`}
                    className="tabular flex justify-between gap-2 text-xs text-fg-muted"
                  >
                    <span>
                      {Number(item.date.slice(5, 7))}/{Number(item.date.slice(8))} {item.name}
                    </span>
                    <span>{formatYen(item.amount, { sign: true })}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="flex items-baseline justify-between border-t border-border pt-2">
        <p className="text-xs text-fg-muted">合計（{monthLabel}末の見込み）</p>
        <p className="tabular text-base">
          <span className="text-xs text-fg-muted">{formatYen(current)} → </span>
          <span className={cn("font-semibold", forecast < 0 && "text-expense")}>{formatYen(forecast)}</span>
        </p>
      </div>
      <p className="text-xs text-fg-muted">
        まだ明細が来ていない予定のうち、口座を指定したものだけを足し引きしています。
        予算（食費など）はどの口座から出るか決まらないため含めていません。
      </p>
    </div>
  );
}
