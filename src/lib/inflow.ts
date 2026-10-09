import { normalizeDescription } from "@/lib/normalize";

/**
 * 入金（お金が入ってくる行）を「収入」と「差し引き」のどちらで数えるかの規則。
 *
 * 口座ベースで集計するので、外から入ってきたお金は収入にする。
 * 一方、自分の財布の中での移動や、買い物の取り消しは収入ではない。
 *
 * | 決済手段 | 入金の扱い | 例 |
 * |---|---|---|
 * | 銀行・現金 | 収入 | 給料振込、人から受け取った現金 |
 * | 電子マネー | 人から受け取ったものは収入、それ以外は差し引き | PayPay の受け取り / チャージ・ポイント |
 * | クレジットカード | 差し引き（その支出から引く） | 返品・取消 |
 *
 * 取込では行ごとに切り替えられる（自動判定はこの規則で、迷う行は手で直す前提）。
 */

export type PaymentKind = "CARD" | "EMONEY" | "CASH" | "BANK";

/** 決済手段の種類（設定画面で直せる。登録の無い値は名前から推測する） */
export function toPaymentKind(kind: string | null | undefined, name: string): PaymentKind {
  return kind === "CARD" || kind === "EMONEY" || kind === "CASH" || kind === "BANK"
    ? kind
    : inferPaymentKind(name);
}

/** 入金を収入側へ回すとき、同じ名前の収入項目が無ければこの大項目の下に作る */
export const INCOME_FALLBACK_MAJOR = "収入内訳";

const EMONEY_HINTS = ["paypay", "icoca", "suica", "pasmo", "coin", "nanaco", "waon", "edy", "楽天ペイ", "d払い", "au pay", "メルペイ", "電子", "マネー"];
const BANK_HINTS = ["口座", "銀行", "預金", "bank", "ゆうちょ", "信金", "信用金庫"];
const CASH_HINTS = ["現金", "財布", "cash"];

/**
 * 決済手段の名前から種類を推測する。
 * アプリに登録の無い決済手段（請求シートのブロック名）に使う。登録があれば登録の種類が優先。
 */
export function inferPaymentKind(name: string): PaymentKind {
  const key = normalizeDescription(name);
  const has = (hints: string[]) => hints.some((hint) => key.includes(normalizeDescription(hint)));
  if (has(CASH_HINTS)) return "CASH";
  if (has(BANK_HINTS)) return "BANK";
  if (has(EMONEY_HINTS)) return "EMONEY";
  return "CARD";
}

/** 電子マネーで「人から受け取った」入金か。チャージやポイントと見分けるのに使う */
function isReceivedFromSomeone(description: string) {
  const text = description.normalize("NFKC");
  return /受け?取/.test(text) || /送金を受/.test(text);
}

/** 入金の行を、収入として数えるべきか（false なら支出から差し引く） */
export function inflowCountsAsIncome(kind: PaymentKind, description: string) {
  if (kind === "BANK" || kind === "CASH") return true;
  if (kind === "EMONEY") return isReceivedFromSomeone(description);
  return false;
}
