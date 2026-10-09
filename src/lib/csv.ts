import Papa from "papaparse";
import Encoding from "encoding-japanese";

export type ColumnMapping = {
  /** 取引日の列名 */
  date: string;
  /** 利用先・内容の列名 */
  description: string;
  /** 金額の列名 */
  amount: string;
  /** 支出を分けて持つカード用（任意）。amount が空のときこちらを使う。 */
  amountOut?: string;
  /** 入金列（任意）。値があれば収入としてマイナス符号を反転する。 */
  amountIn?: string;
  /** メモ・備考の列名（任意） */
  memo?: string;
  /** 決済手段の列名（任意）。無い場合はプリセットの既定値を使う。 */
  paymentMethod?: string;
  /**
   * 使用先 / イベント列（任意）。
   * 「帰省」「結婚式」のように、その支出が何のためのものかを表す列。
   * 指定するとこの値が中項目になり、無い中項目は取り込み時に作られる。
   */
  usage?: string;
  /** 個人支出ぶんの金額列（任意）。生活費列と組み合わせて 1 行を 2 つに分ける。 */
  personalAmount?: string;
  /** 生活費ぶんの金額列（任意）。 */
  livingAmount?: string;
  /** 費目の列（任意）。値が費目名と一致すれば、その費目を付ける。 */
  costType?: string;
  /**
   * 金額列の符号の意味。
   *  - "positive-expense": 正の数が支出（多くのカード明細）
   *  - "negative-expense": 負の数が支出（銀行の入出金明細など）
   */
  amountSign: "positive-expense" | "negative-expense";
};

export type CsvEncoding = "auto" | "UTF8" | "SJIS";

export type ParsedTable = { headers: string[]; rows: Record<string, string>[] };

/** Shift_JIS / UTF-8(BOM 付き含む) を判別してテキストに変換する */
export function decodeCsv(buffer: ArrayBuffer, encoding: CsvEncoding = "auto") {
  const bytes = new Uint8Array(buffer);
  const from = encoding === "auto" ? "AUTO" : encoding;
  const text = Encoding.convert(bytes, {
    to: "UNICODE",
    from: from as "AUTO" | "UTF8" | "SJIS",
    type: "string",
  });
  return text.replace(/^﻿/, "");
}

/** ヘッダー行の前に説明行があるカード明細のため skipRows を受ける */
export function parseCsv(text: string, skipRows = 0): ParsedTable {
  const body =
    skipRows > 0 ? text.split(/\r?\n/).slice(skipRows).join("\n") : text;
  const result = Papa.parse<Record<string, string>>(body, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  const headers = (result.meta.fields ?? []).filter((h) => h.length > 0);
  const rows = (result.data ?? []).filter((row) =>
    headers.some((h) => (row[h] ?? "").trim().length > 0),
  );
  return { headers, rows };
}

const DATE_HINTS = [
  "利用日",
  "ご利用日",
  "取引日",
  "日時",
  "日付",
  "使用日",
  "支払日",
  "date",
];
const DESC_HINTS = [
  "利用先",
  "ご利用先",
  "利用店名",
  "ご利用店名・商品名",
  "内容",
  "店舗名",
  "摘要",
  "取引内容",
  "description",
  "支払先",
];
const AMOUNT_HINTS = [
  "利用金額",
  "ご利用金額",
  "支払金額",
  "お支払金額",
  "出金金額",
  "お引出し",
  "お引出",
  "支払い金額",
  "金額",
  "amount",
];
const IN_HINTS = ["入金金額", "お預入れ", "お預り金額", "入金"];
const MEMO_HINTS = ["備考", "メモ", "摘要2", "memo", "note"];
const METHOD_HINTS = ["支払方法", "決済手段", "カード", "支払い方法", "種別"];
const USAGE_HINTS = ["使用先", "用途", "イベント", "目的", "項目"];
const PERSONAL_HINTS = ["自己負担額", "自己負担", "個人支出", "個人", "自分"];
const LIVING_HINTS = [
  "家計負担",
  "生活費",
  "家族支出",
  "家族",
  "共通費",
  "共通",
];

function findHeader(headers: string[], hints: string[]) {
  const normalized = headers.map((h) => h.normalize("NFKC").toLowerCase());
  for (const hint of hints) {
    const h = hint.normalize("NFKC").toLowerCase();
    const exact = normalized.findIndex((n) => n === h);
    if (exact >= 0) return headers[exact];
  }
  for (const hint of hints) {
    const h = hint.normalize("NFKC").toLowerCase();
    const partial = normalized.findIndex((n) => n.includes(h));
    if (partial >= 0) return headers[partial];
  }
  return undefined;
}

/** ヘッダー名から列マッピングを推測する（ユーザーが画面で直せる前提の初期値） */
export function guessMapping(headers: string[]): Partial<ColumnMapping> {
  const amountIn = findHeader(headers, IN_HINTS);
  return {
    date: findHeader(headers, DATE_HINTS),
    description: findHeader(headers, DESC_HINTS),
    amount: findHeader(headers, AMOUNT_HINTS),
    amountIn,
    memo: findHeader(headers, MEMO_HINTS),
    paymentMethod: findHeader(headers, METHOD_HINTS),
    usage: findHeader(headers, USAGE_HINTS),
    personalAmount: findHeader(headers, PERSONAL_HINTS),
    livingAmount: findHeader(headers, LIVING_HINTS),
    costType: findHeader(headers, ["費目"]),
    amountSign: "positive-expense",
  };
}

/** "1,234", "¥1,234", "△1,234", "(1,234)", "1234円" などを数値にする */
export function parseAmount(raw: string): number | null {
  if (!raw) return null;
  let text = raw.normalize("NFKC").trim();
  if (!text) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (/^[-−▲△]/.test(text)) {
    negative = true;
    text = text.replace(/^[-−▲△]\s*/, "");
  }
  const cleaned = text.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/** "2026/8/30", "2026-08-30", "2026年8月30日", "20260830", "8/30" を Date(UTC) にする */
export function parseDate(raw: string, fallbackYear?: number): Date | null {
  if (!raw) return null;
  const text = raw.normalize("NFKC").trim();
  if (!text) return null;

  const ymd = text.match(/^(\d{4})[\/\-年.](\d{1,2})[\/\-月.](\d{1,2})/);
  if (ymd) return makeDate(+ymd[1], +ymd[2], +ymd[3]);

  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return makeDate(+compact[1], +compact[2], +compact[3]);

  const md = text.match(/^(\d{1,2})[\/\-月.](\d{1,2})/);
  if (md && fallbackYear) return makeDate(fallbackYear, +md[1], +md[2]);

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return makeDate(
      parsed.getFullYear(),
      parsed.getMonth() + 1,
      parsed.getDate(),
    );
  }
  return null;
}

function makeDate(year: number, month: number, day: number) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date;
}

export type MappedRow = {
  rowIndex: number;
  date: string | null;
  description: string;
  /** 常に正の絶対値。isIncome が向きを持つ。 */
  amount: number | null;
  isIncome: boolean;
  memo: string | null;
  paymentMethodName: string | null;
  /** 使用先 / イベント名。中項目として使う。 */
  usage: string | null;
  /**
   * 個人支出ぶん。生活費ぶんと分けて持っている明細のみ。
   * 支出をプラスとする符号付き（マイナスは払い戻し）。
   */
  personalAmount: number | null;
  /** 生活費ぶん。符号の向きは personalAmount と同じ。 */
  livingAmount: number | null;
  /** 費目列の値（費目名）。列が無いか空なら null */
  costTypeName: string | null;
  error: string | null;
};

/** 1 行を列マッピングに沿って取引データへ変換する */
export function mapRow(
  row: Record<string, string>,
  mapping: ColumnMapping,
  rowIndex: number,
): MappedRow {
  const rawDate = (row[mapping.date] ?? "").trim();
  const description = (row[mapping.description] ?? "").trim();
  const rawAmount = (row[mapping.amount] ?? "").trim();
  const rawAmountIn = mapping.amountIn ? (row[mapping.amountIn] ?? "").trim() : "";

  const date = parseDate(rawDate, new Date().getFullYear());
  const outValue = parseAmount(rawAmount);
  const inValue = rawAmountIn ? parseAmount(rawAmountIn) : null;

  let signed: number | null = null;
  let isIncome = false;

  if (inValue !== null && inValue !== 0) {
    signed = Math.abs(inValue);
    isIncome = true;
  } else if (outValue !== null && outValue !== 0) {
    const expenseIsPositive = mapping.amountSign === "positive-expense";
    const asExpense = expenseIsPositive ? outValue : -outValue;
    // asExpense > 0 なら支出、< 0 なら入金（返金・キャッシュバック等）
    isIncome = asExpense < 0;
    signed = Math.abs(asExpense);
  }

  // 個人支出ぶん・生活費ぶんが別列にある明細は、その 2 列が金額の内訳になる
  const direction = mapping.amountSign === "positive-expense" ? 1 : -1;
  const personalAmount = readOptionalAmount(row, mapping.personalAmount, direction);
  const livingAmount = readOptionalAmount(row, mapping.livingAmount, direction);
  const hasSplitColumns = personalAmount !== null || livingAmount !== null;
  if (hasSplitColumns) {
    // 2 列の合計が明細の金額。合計がマイナスなら払い戻しの明細になる。
    const total = (personalAmount ?? 0) + (livingAmount ?? 0);
    signed = Math.abs(total);
    isIncome = total < 0;
  }

  let error: string | null = null;
  if (!date) error = `日付を読み取れません: "${rawDate}"`;
  else if (!description) error = "利用先が空です";
  else if (signed === null || signed === 0)
    error = hasSplitColumns
      ? "個人支出と生活費の合計が 0 です"
      : `金額を読み取れません: "${rawAmount}"`;

  return {
    rowIndex,
    date: date ? date.toISOString().slice(0, 10) : null,
    description,
    amount: signed,
    isIncome,
    memo: mapping.memo ? (row[mapping.memo] ?? "").trim() || null : null,
    paymentMethodName: mapping.paymentMethod
      ? (row[mapping.paymentMethod] ?? "").trim() || null
      : null,
    usage: mapping.usage ? (row[mapping.usage] ?? "").trim() || null : null,
    personalAmount,
    livingAmount,
    costTypeName: mapping.costType ? (row[mapping.costType] ?? "").trim() || null : null,
    error,
  };
}

/**
 * 値が入っている列だけを金額として読む。空欄は「その内訳なし」を意味する。
 * 支出をプラスとする向きに揃えて返す（払い戻しはマイナスのまま残す）。
 */
function readOptionalAmount(
  row: Record<string, string>,
  column: string | undefined,
  direction: 1 | -1,
) {
  if (!column) return null;
  const raw = (row[column] ?? "").trim();
  if (!raw) return null;
  const value = parseAmount(raw);
  if (value === null || value === 0) return null;
  return value * direction;
}
