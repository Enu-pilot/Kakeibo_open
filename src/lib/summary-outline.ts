import type { CategoryKind } from "@/lib/db/types";
import { normalizeDescription } from "@/lib/normalize";

/**
 * まとめシートの項目一覧（2 列）を読んで、大項目 > 中項目の構成を起こすパーサ。
 *
 * ```
 *  支出          ★支出合計          ← 種別のブロック
 *  インターン 計   --- 小計 ---       ← 大項目の宣言
 *  インターン      2024夏インターン費用 ← 中項目（左列が所属する大項目）
 * ```
 *
 * `★XX合計` が種別の段、`--- 小計 ---` が大項目の段、
 * それ以外の行は中項目で、**左列がその行の属する大項目**を表す。
 * 並び順はそのまま表示順に使うため、現れた順を保つ。
 *
 * まとめシートは 2 列の組が**左右に並ぶ**ことがある（左に支出、右に収入・投資・生活費など）。
 * `★` で始まるセルのある列を組の右列とみなして組を切り出し、左の組から順に読む。
 */

/** ブロック名から種別を引く。GAS のブロック名をそのまま受ける。 */
const KIND_BY_BLOCK: { names: string[]; kind: CategoryKind }[] = [
  { names: ["収入"], kind: "INCOME" },
  { names: ["給料", "給与"], kind: "INCOME" },
  { names: ["支出"], kind: "EXPENSE" },
  { names: ["生活費"], kind: "LIVING" },
  { names: ["投資"], kind: "INVESTMENT" },
  { names: ["帳尻合わせ", "帳尻", "チャージ関連"], kind: "ADJUSTMENT" },
];

export type OutlineMajor = {
  name: string;
  kind: CategoryKind;
  /** 種別を ★ の行から決められたか。決められなければ画面で選んでもらう。 */
  kindResolved: boolean;
  categories: string[];
};

export type SummaryOutline = {
  majors: OutlineMajor[];
  warnings: string[];
};

function clean(value: string | undefined) {
  return (value ?? "").replace(/^"|"$/g, "").trim();
}

function kindOf(blockName: string): CategoryKind | null {
  const key = normalizeDescription(blockName);
  if (!key) return null;
  for (const entry of KIND_BY_BLOCK) {
    if (entry.names.some((name) => normalizeDescription(name) === key)) {
      return entry.kind;
    }
  }
  // 「◯◯収入」「◯◯支出」のような派生名も拾う
  for (const entry of KIND_BY_BLOCK) {
    if (entry.names.some((name) => key.includes(normalizeDescription(name)))) {
      return entry.kind;
    }
  }
  return null;
}

/** `★支出合計` → `支出` */
function blockNameFromTotal(right: string) {
  return right.replace(/^★/, "").replace(/合計$/, "").trim();
}

/** `インターン 計` → `インターン` */
function majorNameFromSubtotal(left: string) {
  return left.replace(/\s*計$/, "").trim();
}

function isTotalRow(right: string) {
  return right.startsWith("★");
}

function isSubtotalRow(right: string) {
  return /^-{2,}.*小計.*-{2,}$/.test(right) || right === "小計";
}

/**
 * 貼り付けたテキストを 2 列の組の並びにする。
 * `★` で始まるセルが現れる列を組の右列とし、その 1 つ左を左列とする。
 * `★` が 1 つも無ければ、先頭の 2 列を 1 組として読む。
 */
function splitPanels(text: string): [string, string][] {
  const grid = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.split("\t"));

  const totalColumns = new Set<number>();
  for (const row of grid) {
    row.forEach((cell, column) => {
      if (column > 0 && clean(cell).startsWith("★")) totalColumns.add(column);
    });
  }
  const rightColumns = totalColumns.size > 0 ? [...totalColumns].sort((a, b) => a - b) : [1];

  const pairs: [string, string][] = [];
  for (const right of rightColumns) {
    for (const row of grid) pairs.push([row[right - 1] ?? "", row[right] ?? ""]);
    // 組の切れ目。前の組の最後の大項目を次の組に持ち越さないよう、空行を挟む
    pairs.push(["", ""]);
  }
  return pairs;
}

export function parseSummaryOutline(text: string): SummaryOutline {
  const warnings: string[] = [];

  const majors: OutlineMajor[] = [];
  const byName = new Map<string, OutlineMajor>();

  let currentKind: CategoryKind | null = null;
  let currentBlock = "";
  /** 直前に `--- 小計 ---` で宣言された大項目名。左列が空の行の受け皿。 */
  let declaredMajor = "";
  /** 小計行を経ずに作られた大項目。あとでまとめて注意を出す。 */
  const withoutSubtotal: string[] = [];

  const ensureMajor = (name: string) => {
    const key = normalizeDescription(name);
    const found = byName.get(key);
    if (found) return found;
    const major: OutlineMajor = {
      name,
      kind: currentKind ?? "EXPENSE",
      kindResolved: currentKind !== null,
      categories: [],
    };
    majors.push(major);
    byName.set(key, major);
    return major;
  };

  for (const [rawLeft, rawRight] of splitPanels(text)) {
    const left = clean(rawLeft);
    const right = clean(rawRight);
    if (!left && !right) continue;

    if (isTotalRow(right)) {
      currentBlock = left || blockNameFromTotal(right);
      currentKind = kindOf(currentBlock);
      declaredMajor = "";
      if (!currentKind) {
        warnings.push(
          `「${currentBlock || right}」の種別が分かりませんでした。画面で選んでください`,
        );
      }
      continue;
    }

    if (isSubtotalRow(right)) {
      const name = majorNameFromSubtotal(left);
      if (!name) {
        warnings.push("小計の行に大項目名がありません");
        continue;
      }
      declaredMajor = name;
      ensureMajor(name);
      continue;
    }

    // 右列が空の行は項目ではない（1 行目の「年月」の見出しなど）
    if (!right) continue;

    // ここまで来たら中項目の行。左列がその行の属する大項目。
    const majorName = left || declaredMajor || currentBlock;
    if (!majorName) {
      warnings.push(`「${right}」がどの大項目に属するか分かりませんでした`);
      continue;
    }
    if (!byName.has(normalizeDescription(majorName))) {
      withoutSubtotal.push(majorName);
    }
    const major = ensureMajor(majorName);

    const exists = major.categories.some(
      (name) => normalizeDescription(name) === normalizeDescription(right),
    );
    if (exists) {
      warnings.push(`「${majorName}」に「${right}」が重複しています。1 つにまとめます`);
      continue;
    }
    major.categories.push(right);
  }

  if (withoutSubtotal.length > 0) {
    warnings.push(
      `小計の行が無いため、行の左列から大項目にしました: ${[...new Set(withoutSubtotal)].join("、")}`,
    );
  }

  return { majors, warnings };
}
