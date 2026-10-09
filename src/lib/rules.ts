import type { MatchType } from "@/lib/db/types";
import { normalizeDescription } from "@/lib/normalize";

export type RuleLike = {
  id: string;
  keyword: string;
  matchType: MatchType;
  /** 中項目を決めるルールなら入っている */
  categoryId: string | null;
  /** 費目を決めるルールなら入っている（中項目と両方持つこともある） */
  costTypeId?: string | null;
  priority: number;
  enabled: boolean;
};

const SPECIFICITY: Record<MatchType, number> = {
  EXACT: 0,
  STARTS_WITH: 1,
  REGEX: 2,
  CONTAINS: 3,
};

/**
 * 評価順を決める。
 * priority 昇順 → マッチ方式が限定的なもの順 → キーワードが長いもの順。
 * 「スーパー〇〇 = 食費」のような具体的な学習ルールが、
 * 「〇〇 = 雑費」のような広いルールより先に効くようにするため。
 */
export function sortRules<T extends RuleLike>(rules: T[]): T[] {
  return [...rules].sort(
    (a, b) =>
      a.priority - b.priority ||
      SPECIFICITY[a.matchType] - SPECIFICITY[b.matchType] ||
      b.keyword.length - a.keyword.length,
  );
}

const SMALL_KANA: Record<string, string> = {
  ァ: "ア", ィ: "イ", ゥ: "ウ", ェ: "エ", ォ: "オ", ッ: "ツ", ャ: "ヤ", ュ: "ユ", ョ: "ヨ", ヮ: "ワ",
};

/**
 * ルールの照合用に表記ゆれをさらに吸収する（重複判定キーには使わない）。
 * カード明細は「セブン－イレブン」「フアミリ―マ―ト」「ブツキング・ドツトコム」「ファ－ストキャビン」のように、
 * 長音をハイフンやダッシュで書いたり、小さい仮名を大きく書いたりするため、どちらも同じ形にそろえる。
 */
export function foldForMatch(text: string) {
  return normalizeDescription(text)
    .replace(/[-\u2010-\u2015\u2212\u2500\u2501ー]/g, "ー")
    .replace(/[ァィゥェォッャュョヮ]/g, (c) => SMALL_KANA[c]);
}

function matches(description: string, rule: RuleLike) {
  if (rule.matchType === "REGEX") {
    try {
      return new RegExp(rule.keyword, "i").test(description);
    } catch {
      return false; // 壊れた正規表現は無視する
    }
  }
  const haystack = foldForMatch(description);
  const needle = foldForMatch(rule.keyword);
  if (!needle) return false;
  if (rule.matchType === "EXACT") return haystack === needle;
  if (rule.matchType === "STARTS_WITH") return haystack.startsWith(needle);
  return haystack.includes(needle);
}

/**
 * 中項目を決める。中項目を持つルールのうち、最初にマッチしたものを返す。
 * 費目だけのルール（セブン → 食費 など）はここでは見ない。
 */
export function classify<T extends RuleLike>(
  description: string,
  rules: T[],
): (T & { categoryId: string }) | null {
  for (const rule of sortRules(rules)) {
    if (!rule.enabled || !rule.categoryId) continue;
    if (matches(description, rule)) return rule as T & { categoryId: string };
  }
  return null;
}

/**
 * 費目を決める。費目を持つルールのうち、最初にマッチしたものの費目を返す。
 * 中項目とは別に評価するので、「中項目は使用先で決まり、費目は店名で決まる」が両立する。
 */
export function classifyCostType<T extends RuleLike>(
  description: string,
  rules: T[],
): string | null {
  for (const rule of sortRules(rules)) {
    if (!rule.enabled || !rule.costTypeId) continue;
    if (matches(description, rule)) return rule.costTypeId;
  }
  return null;
}
