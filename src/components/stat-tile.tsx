import { cn, formatYen } from "@/lib/utils";

/**
 * 見出し数値。金額はインク色で出し、色は左のドットだけが担う。
 * （色そのものに意味を持たせると色覚特性のある読み手に伝わらないため）
 */
export function StatTile({
  label,
  value,
  color,
  hint,
  emphasis,
}: {
  label: string;
  value: number;
  color?: string;
  hint?: string;
  emphasis?: boolean;
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
          <span
            className="size-2 rounded-[2px]"
            style={{ background: color }}
            aria-hidden
          />
        ) : null}
        <p className="text-xs font-bold text-solid-gray-800">{label}</p>
      </div>
      <p
        className={cn(
          "tabular font-semibold",
          emphasis ? "text-2xl" : "text-xl",
          value < 0 && "text-expense",
        )}
      >
        {formatYen(value)}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-fg-muted">{hint}</p> : null}
    </div>
  );
}
