"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/ui";

export function SummaryRangePicker({
  year,
  mode,
}: {
  year: number;
  mode: "year" | "recent";
}) {
  const router = useRouter();
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 8 }, (_, i) => thisYear - i);

  return (
    <div className="flex items-center gap-2">
      <Select
        className="w-36"
        value={mode === "recent" ? "recent" : String(year)}
        onChange={(e) => {
          const value = e.target.value;
          router.push(
            value === "recent" ? "/summary?mode=recent" : `/summary?year=${value}`,
          );
        }}
        aria-label="表示範囲"
      >
        <option value="recent">直近 12 か月</option>
        {years.map((y) => (
          <option key={y} value={y}>
            {y} 年（1〜12月）
          </option>
        ))}
      </Select>
    </div>
  );
}
