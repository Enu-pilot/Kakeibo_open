import type { CategoryKind } from "@/lib/db/types";

/**
 * 種別のメタ情報。
 * 画面での呼び方は、まとめシートの運用に合わせて「個人収入 / 個人支出 / 投資 / 帳尻合わせ / 生活費」にしている。
 * 大項目の名前はユーザーが自由に付けられるが、集計の計算はこの kind が決める。
 */
export const KIND_META: Record<
  CategoryKind,
  { label: string; description: string; color: string; netSign: -1 | 0 | 1 }
> = {
  INCOME: {
    label: "個人収入",
    description: "給料・補助・人から受け取ったお金など、外から入ってきたお金。純残高にプラスで効く。",
    color: "#197a4b",
    netSign: 1,
  },
  EXPENSE: {
    label: "個人支出",
    description: "自分のための支出。純残高にマイナスで効く。",
    color: "#ce0000",
    netSign: -1,
  },
  LIVING: {
    label: "生活費",
    description: "家族関係・共通費など、支出と分けて追いたい生活コスト。",
    color: "#a58000",
    netSign: -1,
  },
  INVESTMENT: {
    label: "投資",
    description: "株式・NISA・積立など。消費ではないが手元資金は減る。",
    color: "#8843e1",
    netSign: -1,
  },
  ADJUSTMENT: {
    label: "帳尻合わせ",
    description:
      "電子マネーチャージ・口座間振替など。資産が動かないため集計から除外する。",
    color: "#767676",
    netSign: 0,
  },
};

/** 画面に並べる順。まとめシートと同じく 個人収入 → 個人支出 → 投資 → 帳尻合わせ → 生活費 */
export const KIND_ORDER: CategoryKind[] = [
  "INCOME",
  "EXPENSE",
  "INVESTMENT",
  "ADJUSTMENT",
  "LIVING",
];

export function kindLabel(kind: CategoryKind) {
  return KIND_META[kind].label;
}

/**
 * 金額の符号を決める。
 *
 * 内訳の金額は「その集計種別にとって本来の向きならプラス、逆ならマイナス」で持つ。
 *   収入系:   入金がプラス、出金（取り消し・返納）がマイナス
 *   それ以外: 出金がプラス、入金（払い戻し・精算）がマイナス
 * こうしておくと、払い戻しはその中項目から差し引かれ、集計は単純な足し算で済む。
 * 取込・シート読み取り・手入力のすべてがこの規則に従う。
 */
export function signFor(kind: CategoryKind, moneyIn: boolean): 1 | -1 {
  return (kind === "INCOME") === moneyIn ? 1 : -1;
}
