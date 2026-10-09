import type { CategoryKind } from "@/lib/db/types";

/**
 * グラフの系列色は CSS 変数で持つ。
 * ライト/ダークで別々に検証した値が globals.css に入っており、
 * 変数を参照することでテーマ切替に自動で追従する。
 */
export const KIND_VAR: Record<CategoryKind, string> = {
  INCOME: "var(--color-income)",
  EXPENSE: "var(--color-expense)",
  LIVING: "var(--color-living)",
  INVESTMENT: "var(--color-investment)",
  ADJUSTMENT: "var(--color-adjustment)",
};
