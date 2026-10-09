import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * デジタル庁デザインシステムの文字スタイル（text-std-16N-170 など）を「文字の大きさ」として扱わせる。
 * 教えないと文字色（text-solid-gray-900 など）と同じ種類だと見なされ、片方が消されてしまう。
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: [(value: string) => /^(dsp|std|dns|oln|mono)-\d+[BN]-\d+$/.test(value)] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 1234567 -> "¥1,234,567" */
export function formatYen(value: number, opts?: { sign?: boolean }) {
  const sign = opts?.sign && value > 0 ? "+" : "";
  return `${sign}${new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(value)}`;
}

/** 1234567 -> "1,234,567" （表の中で使う記号なし表記） */
export function formatNumber(value: number) {
  if (value === 0) return "-";
  return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(value);
}

/** Date -> "2026-08-30"（date型カラム / input[type=date] 用） */
export function toDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** "2026-08-30" -> Date(UTC 00:00)。ローカルタイムゾーンによる日付ズレを防ぐ。 */
export function fromDateInput(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}
