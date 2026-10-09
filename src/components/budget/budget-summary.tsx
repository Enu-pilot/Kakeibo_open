import { cn, formatYen } from "@/lib/utils";
import { KIND_VAR } from "@/lib/chart-colors";
import type { BudgetReport } from "@/lib/budget";
import type { KindTotals } from "@/lib/aggregate";

const outgoing = (t: KindTotals) => t.EXPENSE + t.LIVING + t.INVESTMENT;

/** 予実の見出し。実績を大きく、予と月末見込みを添える */
export function BudgetSummary({ report }: { report: BudgetReport }) {
  const past = report.phase === "past";
  const forecastLabel = past ? "確定" : "月末見込み";
  return (
    <section
      aria-label="予実のまとめ"
      className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4"
    >
      <Tile
        label="収入"
        color={KIND_VAR.INCOME}
        value={report.actual.INCOME}
        lines={[
          ["予", report.target.INCOME],
          ...(past ? [] : [[forecastLabel, report.forecast.INCOME] as [string, number]]),
        ]}
      />
      <Tile
        label="支出・生活費・投資"
        color={KIND_VAR.EXPENSE}
        value={outgoing(report.actual)}
        lines={[
          ["予", outgoing(report.target)],
          ...(past ? [] : [[forecastLabel, outgoing(report.forecast)] as [string, number]]),
        ]}
      />
      <Tile
        label={past ? "純残高" : "純残高（月末見込み）"}
        value={past ? report.net.actual : report.net.forecast}
        lines={[
          ["予", report.net.target],
          ...(past ? [] : [["いまの実績", report.net.actual] as [string, number]]),
        ]}
        emphasis
      />
      <Tile
        label={past ? "使わずに済んだ予算" : "予算・予定の残り"}
        value={report.remainingBudget}
        note={
          report.overCount > 0
            ? `予算を超えた中項目が ${report.overCount} 件`
            : "予算を超えた中項目はありません"
        }
        warn={report.overCount > 0}
      />
    </section>
  );
}

function Tile({
  label,
  value,
  color,
  lines = [],
  note,
  emphasis,
  warn,
}: {
  label: string;
  value: number;
  color?: string;
  lines?: [string, number][];
  note?: string;
  emphasis?: boolean;
  warn?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-solid-gray-420 bg-white px-4 py-3",
        emphasis && "border-2 border-key-900",
      )}
    >
      <div className="mb-1 flex items-center gap-1.5">
        {color ? (
          <span className="size-2 rounded-[2px]" style={{ background: color }} aria-hidden />
        ) : null}
        <p className="text-xs font-bold text-solid-gray-800">{label}</p>
      </div>
      <p className={cn("tabular text-xl font-semibold", value < 0 && "text-expense")}>
        {formatYen(value)}
      </p>
      {lines.map(([name, amount]) => (
        <p key={name} className="tabular mt-0.5 flex justify-between gap-2 text-xs text-fg-muted">
          <span>{name}</span>
          <span className={cn(amount < 0 && "text-expense")}>{formatYen(amount)}</span>
        </p>
      ))}
      {note ? (
        <p className={cn("mt-0.5 text-xs", warn ? "text-expense" : "text-fg-muted")}>{note}</p>
      ) : null}
    </div>
  );
}
