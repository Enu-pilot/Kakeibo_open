import { createHash } from "node:crypto";
import { normalizeDescription } from "@/lib/normalize";

/** 日付・利用先・金額・決済手段の 4 点で重複を判定する */
export function buildDedupeHash(input: {
  /** "YYYY-MM-DD" */
  date: string;
  description: string;
  amount: number;
  paymentMethodId?: string | null;
  /** 同一内容を意図的に複数登録するときの連番 */
  occurrence?: number;
}) {
  const key = [
    input.date,
    normalizeDescription(input.description),
    Math.round(input.amount * 100),
    input.paymentMethodId ?? "",
    input.occurrence && input.occurrence > 0 ? `#${input.occurrence}` : "",
  ].join("|");
  return createHash("sha256").update(key).digest("hex");
}
