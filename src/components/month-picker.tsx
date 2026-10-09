"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui";

/** 月を 1 つ選ぶコントロール。URL の ?month=YYYY-MM を書き換える。 */
export function MonthPicker({ month }: { month: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function go(next: string) {
    const query = new URLSearchParams(params.toString());
    query.set("month", next);
    router.push(`${pathname}?${query.toString()}`);
  }

  function shift(delta: number) {
    const [year, m] = month.split("-").map(Number);
    const date = new Date(Date.UTC(year, m - 1 + delta, 1));
    go(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  }

  return (
    <div className="flex items-center gap-1">
      <Button size="sm" variant="ghost" onClick={() => shift(-1)} aria-label="前の月">
        <ChevronLeft size={16} />
      </Button>
      <input
        type="month"
        value={month}
        onChange={(e) => e.target.value && go(e.target.value)}
        className="h-8 rounded-lg border border-border bg-surface px-2 text-sm tabular"
        aria-label="表示する月"
      />
      <Button size="sm" variant="ghost" onClick={() => shift(1)} aria-label="次の月">
        <ChevronRight size={16} />
      </Button>
    </div>
  );
}
