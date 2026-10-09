/**
 * スプレッドシートのセル値と、アプリの値の相互変換。
 *
 * 読み込みは valueRenderOption=UNFORMATTED_VALUE（数値は数値のまま）と
 * dateTimeRenderOption=FORMATTED_STRING（日付セルは表示どおりの文字列）で行う。
 * そのためセルの値は string / number / boolean / undefined のどれかで届く。
 *
 * 書き込みは値の種類ごとに stringValue / numberValue / boolValue を明示する。
 * 利用先に "=IMPORTXML(...)" のような文字列が来ても、式として解釈されず
 * 文字列のまま保存される（CSV 由来の文字列を式として実行させないため）。
 */
import type { ColumnType } from "@/lib/db/schema";

export type CellValue = string | number | boolean | undefined | null;

/** Sheets API の CellData（書き込みに使う部分だけ） */
export type CellData = {
  userEnteredValue?:
    | { stringValue: string }
    | { numberValue: number }
    | { boolValue: boolean };
};

/** スプレッドシートの日付シリアル値の起点（1899-12-30） */
const SHEETS_EPOCH = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

function isBlank(value: CellValue) {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

/** 手入力された日付の書き方をいくつか受け付け、"YYYY-MM-DD" にそろえる */
export function normalizeDate(value: CellValue): string | null {
  if (isBlank(value)) return null;
  if (typeof value === "number") {
    // 表示形式が日付でないセルに入った日付はシリアル値で届く
    const d = new Date(SHEETS_EPOCH + Math.floor(value) * DAY_MS);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const text = String(value).normalize("NFKC").trim();
  const m =
    text.match(/^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/) ??
    text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  // 2026-02-31 のような存在しない日付は繰り上がるので弾く
  if (d.getUTCMonth() !== month - 1) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * 年月を "YYYY-MM" にそろえる。
 * スプレッドシートに手で 2026-09 と打つと、日付（9 月 1 日）に自動変換されることがある。
 * その場合は日付として届くので、年と月だけを取り出す。
 */
export function normalizeMonth(value: CellValue): string | null {
  if (isBlank(value)) return null;
  if (typeof value === "number") return normalizeDate(value)?.slice(0, 7) ?? null;
  const text = String(value).normalize("NFKC").trim();
  const m = text.match(/^(\d{4})[-/年.]?(\d{1,2})(?:月|[-/.]\d{1,2}日?)?$/);
  if (!m) return normalizeDate(text)?.slice(0, 7) ?? null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return `${m[1]}-${String(month).padStart(2, "0")}`;
}

function normalizeTimestamp(value: CellValue): string | null {
  if (isBlank(value)) return null;
  if (typeof value === "number") {
    const d = new Date(SHEETS_EPOCH + value * DAY_MS);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const text = String(value).trim();
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? text : d.toISOString();
}

/** "¥1,234" や全角数字も数値として読む。読めなければ 0 */
function toNumber(value: CellValue): number {
  if (typeof value === "number") return Math.round(value * 100) / 100;
  if (isBlank(value)) return 0;
  const cleaned = String(value).normalize("NFKC").replace(/[¥,\s円]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function toBoolean(value: CellValue): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (isBlank(value)) return false;
  return /^(true|1|yes|y|はい|✓|○)$/i.test(String(value).trim());
}

/** セルの値を列の型に合わせて読む */
export function decodeCell(type: ColumnType, value: CellValue): unknown {
  if (typeof type === "object") {
    const text = isBlank(value) ? "" : String(value).trim();
    return type.enum.includes(text) ? text : type.fallback;
  }
  switch (type) {
    case "string":
      return isBlank(value) ? "" : String(value).trim();
    case "nullableString":
      return isBlank(value) ? null : String(value).trim();
    case "number":
      return toNumber(value);
    case "int":
      return Math.trunc(toNumber(value));
    case "boolean":
      return toBoolean(value);
    case "date":
      return normalizeDate(value) ?? "";
    case "nullableDate":
      return normalizeDate(value);
    case "timestamp":
      return normalizeTimestamp(value) ?? "";
    case "nullableTimestamp":
      return normalizeTimestamp(value);
    case "nullableMonth":
      return normalizeMonth(value);
    case "json": {
      if (isBlank(value)) return {};
      try {
        const parsed = JSON.parse(String(value));
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch {
        return {};
      }
    }
  }
}

/** アプリの値をセルに書く形にする。null は空セルにする */
export function encodeCell(type: ColumnType, value: unknown): CellData {
  if (value === null || value === undefined) return {};
  if (type === "json") return { userEnteredValue: { stringValue: JSON.stringify(value) } };
  if (typeof value === "boolean") return { userEnteredValue: { boolValue: value } };
  if (typeof value === "number") return { userEnteredValue: { numberValue: value } };
  return { userEnteredValue: { stringValue: String(value) } };
}
