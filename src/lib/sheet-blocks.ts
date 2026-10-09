import { guessMapping, type ColumnMapping, type ParsedTable } from "@/lib/csv";

/**
 * GAS で使っていた「請求YYYY」シートを読むためのパーサ。
 *
 * このシートはカードごとの明細が **横に並ぶ**。1 ブロックの形は次のとおり。
 *
 * ```
 *  1行目  メインカード                                     PayPay
 *  2行目  ご利用者 カテゴリ 日時 内容 … 金額 … 使用先 │空│ 日時 … 金額 使用先 │空│
 *         └──────── 1 ブロック ────────┘        └──── 次のブロック ────┘
 * ```
 *
 * カードごとに列数も列名もばらばらだが、**どのブロックにも
 * `日時` / `内容` / `金額` / `使用先` の 4 列が必ずある**。
 * この 4 列だけを契約とみなし、間に挟まる列（支払区分・残高など）は読み飛ばす。
 *
 * ブロックの切れ目は `使用先` 列。その右の空列を挟んで次のブロックが始まる。
 */

/** どのブロックにも必ずある 4 列。ここだけを読む。 */
const CANONICAL = {
  date: "日時",
  description: "内容",
  amount: "金額",
  usage: "使用先",
} as const;

/** 入金列を持つのは口座系だけ。あれば入金として扱う。 */
const DEPOSIT_HEADERS = ["お預入れ", "お預入", "入金金額", "入金"];

export type SheetBlock = {
  /** 1 行目のブロック名。決済手段として使う。 */
  name: string;
  /** 貼り付けたデータ内での列範囲（0 始まり）。UI で位置を示すのに使う。 */
  startColumn: number;
  endColumn: number;
  table: ParsedTable;
  mapping: ColumnMapping;
  /** このブロックの読み取りで引っかかった点。画面にそのまま出す。 */
  issues: string[];
};

export type BillingSheet = {
  blocks: SheetBlock[];
  /** シート全体に対する注意。ブロック名の取り違えなど。 */
  warnings: string[];
};

function cells(line: string) {
  return line.split("\t");
}

function clean(value: string | undefined) {
  return (value ?? "").replace(/^"|"$/g, "").trim();
}

/** NFKC で正規化して比較する（`ＰａｙＰａｙ` と `PayPay` を別物にしないため） */
function sameHeader(a: string, b: string) {
  return a.normalize("NFKC").toLowerCase() === b.normalize("NFKC").toLowerCase();
}

/** 使用先より右に置いてもよい任意の列 */
const TRAILING_HEADERS = ["費目"];

/**
 * ブロック内のヘッダー名を、列のキーとして使える形に整える。
 * 空ヘッダーや同名ヘッダーがあるとキーが衝突して列を取り違えるため、
 * 位置を含んだ名前に振り直す。
 */
function uniqueHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((header, index) => {
    const base = clean(header) || `列${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });
}

/**
 * ブロックの列マッピングを決める。
 *
 * 4 列は名前が決まっているので**完全一致を最優先**する。
 * CSV 取込と同じ推測（`guessMapping`）に任せると、カードによっては
 * `ご利用金額(￥)` が `金額` より先に当たってしまい、GAS が集計に使っていた
 * `金額` 列ではないほうを読んでしまう。
 */
function resolveMapping(headers: string[]): {
  mapping: ColumnMapping;
  issues: string[];
} {
  const issues: string[] = [];
  const exact = (name: string) => headers.find((h) => sameHeader(h, name));
  const guessed = guessMapping(headers);

  const pick = (key: keyof typeof CANONICAL) => {
    const hit = exact(CANONICAL[key]);
    if (hit) return hit;
    const fallback = guessed[key];
    if (fallback) {
      issues.push(`「${CANONICAL[key]}」列が無いため「${fallback}」で代用しました`);
      return fallback;
    }
    return undefined;
  };

  const date = pick("date");
  const description = pick("description");
  const amount = pick("amount");
  const usage = pick("usage");

  for (const [key, value] of Object.entries({ date, description, amount })) {
    if (!value) {
      issues.push(
        `「${CANONICAL[key as keyof typeof CANONICAL]}」列が見つかりません`,
      );
    }
  }

  const amountIn = DEPOSIT_HEADERS.map((name) => exact(name)).find(Boolean);
  // 費目列は任意。ブロックに「費目」列を足しておけば、その値を費目として使う
  const costType = exact("費目");

  return {
    mapping: {
      date: date ?? "",
      description: description ?? "",
      amount: amount ?? "",
      amountIn,
      usage,
      costType,
      amountSign: "positive-expense",
    },
    issues,
  };
}

/**
 * ブロック名を割り当てる。
 *
 * 1 行目のブロック名はブロックの先頭列に置かれるが、コピー&貼り付けでは
 * 末尾の空セルが落ちて列がずれることがある。そのため位置の完全一致ではなく、
 * **まだ使っていない名前のうちブロック先頭に最も近いもの**を採る。
 */
function assignNames(
  blocks: { start: number; end: number }[],
  nameRow: string[] | null,
): { names: string[]; warnings: string[] } {
  const warnings: string[] = [];
  if (!nameRow) {
    return {
      names: blocks.map((_, i) => `ブロック${i + 1}`),
      warnings: ["1 行目にブロック名が見つかりませんでした"],
    };
  }

  const candidates = nameRow
    .map((value, index) => ({ name: clean(value), index }))
    .filter((entry) => entry.name);

  if (candidates.length !== blocks.length) {
    warnings.push(
      `1 行目のブロック名が ${candidates.length} 個、検出したブロックが ${blocks.length} 個です。` +
        `決済手段の対応が合っているか確認してください`,
    );
  }

  const used = new Set<number>();
  const names = blocks.map((block, i) => {
    let best: { name: string; index: number } | null = null;
    for (const candidate of candidates) {
      if (used.has(candidate.index)) continue;
      if (candidate.index > block.end) continue;
      if (
        !best ||
        Math.abs(candidate.index - block.start) < Math.abs(best.index - block.start)
      ) {
        best = candidate;
      }
    }
    if (!best) return `ブロック${i + 1}`;
    used.add(best.index);
    return best.name;
  });

  return { names, warnings };
}

/** 貼り付けたタブ区切りテキストを読む。中身は `parseBillingGrid` と同じ。 */
export function parseBillingSheet(text: string): BillingSheet {
  return parseBillingGrid(text.replace(/\r\n?/g, "\n").split("\n").map(cells));
}

/**
 * 請求シートを、カードごとのブロックに切り分ける。
 * 1 行目にブロック名、2 行目にヘッダー、3 行目以降が明細という並びを前提にする。
 *
 * 貼り付け（テキスト）と Sheets API（2 次元配列）の両方から使う。
 * API は末尾の空セルを落とすため、行ごとに長さが違っても読めるようにしてある。
 */
export function parseBillingGrid(grid: string[][]): BillingSheet {
  const lines = [...grid];
  const isEmpty = (row: string[]) => row.every((cell) => clean(cell) === "");
  while (lines.length > 0 && isEmpty(lines[lines.length - 1])) lines.pop();
  if (lines.length === 0) return { blocks: [], warnings: ["データが空です"] };

  // ヘッダー行は「使用先」を含む最初の行。その 1 つ上がブロック名の行。
  const headerIndex = lines.findIndex((row) =>
    row.some((cell) => sameHeader(clean(cell), CANONICAL.usage)),
  );
  if (headerIndex < 0) {
    return {
      blocks: [],
      warnings: [
        "「使用先」列が見つかりません。ブロックの区切りが判定できないため、" +
          "1 行目のブロック名とヘッダー行を含めて貼り付けてください",
      ],
    };
  }

  const headerRow = lines[headerIndex];
  const nameRow = headerIndex > 0 ? lines[headerIndex - 1] : null;
  const dataRows = lines.slice(headerIndex + 1);

  // 「使用先」がブロックの右端（右隣の「費目」列は含める）。その次の空列を挟んで次のブロックが始まる。
  const boundaries = headerRow
    .map((cell, index) => ({ cell: clean(cell), index }))
    .filter((entry) => sameHeader(entry.cell, CANONICAL.usage))
    .map((entry) => entry.index);

  const ranges: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const usageIndex of boundaries) {
    let start = cursor;
    // ブロック間の区切りは空列 1 つだが、数が違っても読めるように読み飛ばす
    while (start < usageIndex && clean(headerRow[start]) === "") start += 1;
    // 「費目」列は使用先の右隣に足してもよい。次のブロックの列と取り違えないよう、このブロックに含める
    let end = usageIndex;
    while (TRAILING_HEADERS.some((name) => sameHeader(clean(headerRow[end + 1]), name))) end += 1;
    ranges.push({ start, end });
    cursor = end + 1;
  }

  const { names, warnings } = assignNames(ranges, nameRow);

  const blocks = ranges.map((range, i) => {
    const headers = uniqueHeaders(
      headerRow.slice(range.start, range.end + 1).map((h) => clean(h)),
    );
    const { mapping, issues } = resolveMapping(headers);

    const rows: Record<string, string>[] = [];
    for (const cols of dataRows) {
      const row: Record<string, string> = {};
      let hasValue = false;
      headers.forEach((header, offset) => {
        const value = clean(cols[range.start + offset]);
        row[header] = value;
        if (value) hasValue = true;
      });
      if (hasValue) rows.push(row);
    }

    return {
      name: names[i],
      startColumn: range.start,
      endColumn: range.end,
      table: { headers, rows },
      mapping,
      issues,
    };
  });

  return { blocks, warnings };
}
