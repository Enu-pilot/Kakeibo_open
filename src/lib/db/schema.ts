/**
 * スプレッドシートの構造（どのタブに、どの見出しの列があるか）。
 *
 * 設計方針:
 *  - タブ名と見出しは日本語にする。スプレッドシートを直接開いて読めることが、
 *    Sheets を DB に選んだ理由そのものなので。
 *  - 列は位置ではなく「見出しの文字列」で探す。スプレッドシート側で列を並べ替えたり、
 *    自分用のメモ列を足したりしても壊れないようにするため。知らない見出しの列は読み飛ばし、
 *    書き込みでも触らない。
 *  - 見出しを書き換えると、その列はアプリから見えなくなる（空として扱われる）。
 */
import {
  CATEGORY_KINDS,
  MATCH_TYPES,
  PAIR_ROLES,
  PAIR_TAGS,
  PAIR_SYNC,
  SHARE_MODES,
  TRANSACTION_SOURCES,
  type TableName,
  type Tables,
} from "@/lib/db/types";

/**
 * 列の型。スプレッドシートとの読み書きで値をどう変換するかを決める。
 *  - date:      "YYYY-MM-DD"。手入力された日付セル（2026/8/3 など）も読める
 *  - timestamp: ISO 8601 の日時
 *  - json:      JSON 文字列で保存する構造データ
 */
export type ColumnType =
  | "string"
  | "nullableString"
  | "number"
  | "int"
  | "boolean"
  | "date"
  | "nullableDate"
  | "timestamp"
  | "nullableTimestamp"
  | "nullableMonth"
  | "json"
  | { enum: readonly string[]; fallback: string };

export type ColumnDef<K extends string = string> = {
  key: K;
  header: string;
  type: ColumnType;
};

export type TableDef<T extends TableName> = {
  /** スプレッドシート上のタブ名 */
  title: string;
  columns: ColumnDef<Extract<keyof Tables[T], string>>[];
};

/** id 列はどの表でも先頭に置く（見出しは「ID」。LINE連携だけは「LINEユーザーID」） */
const id = { key: "id", header: "ID", type: "string" } as const;

export const SCHEMA: { [T in TableName]: TableDef<T> } = {
  transactions: {
    title: "明細",
    columns: [
      id,
      { key: "date", header: "日付", type: "date" },
      { key: "description", header: "利用先", type: "string" },
      { key: "amount", header: "金額", type: "number" },
      { key: "memo", header: "メモ", type: "nullableString" },
      { key: "paymentMethodId", header: "決済手段ID", type: "nullableString" },
      { key: "transferToId", header: "移動先ID", type: "nullableString" },
      {
        key: "source",
        header: "入力経路",
        type: { enum: TRANSACTION_SOURCES, fallback: "MANUAL" },
      },
      { key: "receiptUrl", header: "レシートURL", type: "nullableString" },
      { key: "dedupeHash", header: "重複判定キー", type: "string" },
      { key: "importBatchId", header: "取込ID", type: "nullableString" },
      { key: "createdAt", header: "作成日時", type: "timestamp" },
      { key: "updatedAt", header: "更新日時", type: "timestamp" },
      // 二人の時の区分（割り勘 / 自分だけ / 精算の記録）。アプリの中だけで使う。LINE ボットはこの列を知らない
      { key: "pairTag", header: "二人の区分", type: { enum: [...PAIR_TAGS, ""], fallback: "" } },
    ],
  },
  splits: {
    title: "内訳",
    columns: [
      id,
      { key: "transactionId", header: "明細ID", type: "string" },
      { key: "categoryId", header: "中項目ID", type: "string" },
      { key: "amount", header: "金額", type: "number" },
      { key: "sortOrder", header: "並び順", type: "int" },
      { key: "costTypeId", header: "費目ID", type: "nullableString" },
    ],
  },
  majors: {
    title: "大項目",
    columns: [
      id,
      { key: "name", header: "名前", type: "string" },
      {
        key: "kind",
        header: "集計種別",
        type: { enum: CATEGORY_KINDS, fallback: "EXPENSE" },
      },
      { key: "color", header: "色", type: "string" },
      { key: "sortOrder", header: "並び順", type: "int" },
      { key: "isSystem", header: "標準", type: "boolean" },
      { key: "archivedAt", header: "アーカイブ日時", type: "nullableTimestamp" },
      { key: "createdAt", header: "作成日時", type: "timestamp" },
      { key: "updatedAt", header: "更新日時", type: "timestamp" },
      { key: "purposeId", header: "使途ID", type: "nullableString" },
    ],
  },
  categories: {
    title: "中項目",
    columns: [
      id,
      { key: "name", header: "名前", type: "string" },
      { key: "majorId", header: "大項目ID", type: "string" },
      { key: "sortOrder", header: "並び順", type: "int" },
      { key: "archivedAt", header: "アーカイブ日時", type: "nullableTimestamp" },
      { key: "createdAt", header: "作成日時", type: "timestamp" },
      { key: "updatedAt", header: "更新日時", type: "timestamp" },
    ],
  },
  costTypes: {
    title: "費目",
    columns: [
      id,
      { key: "name", header: "名前", type: "string" },
      { key: "sortOrder", header: "並び順", type: "int" },
      { key: "archivedAt", header: "アーカイブ日時", type: "nullableTimestamp" },
      { key: "createdAt", header: "作成日時", type: "timestamp" },
    ],
  },
  paymentMethods: {
    title: "決済手段",
    columns: [
      id,
      { key: "name", header: "名前", type: "string" },
      { key: "kind", header: "種別", type: "string" },
      { key: "sortOrder", header: "並び順", type: "int" },
      { key: "trackBalance", header: "残高を追う", type: "boolean" },
      { key: "openingBalance", header: "起点残高", type: "number" },
      { key: "openingBalanceAt", header: "起点日", type: "nullableDate" },
      { key: "archivedAt", header: "アーカイブ日時", type: "nullableTimestamp" },
      { key: "createdAt", header: "作成日時", type: "timestamp" },
    ],
  },
  rules: {
    title: "分類ルール",
    columns: [
      id,
      { key: "keyword", header: "キーワード", type: "string" },
      {
        key: "matchType",
        header: "判定方式",
        type: { enum: MATCH_TYPES, fallback: "CONTAINS" },
      },
      { key: "categoryId", header: "中項目ID", type: "nullableString" },
      { key: "costTypeId", header: "費目ID", type: "nullableString" },
      { key: "priority", header: "優先度", type: "int" },
      { key: "isLearned", header: "学習", type: "boolean" },
      { key: "enabled", header: "有効", type: "boolean" },
      { key: "hitCount", header: "ヒット数", type: "int" },
      { key: "createdAt", header: "作成日時", type: "timestamp" },
      { key: "updatedAt", header: "更新日時", type: "timestamp" },
    ],
  },
  presets: {
    title: "取込プリセット",
    columns: [
      id,
      { key: "name", header: "名前", type: "string" },
      { key: "encoding", header: "文字コード", type: "string" },
      { key: "skipRows", header: "読み飛ばし行数", type: "int" },
      { key: "mapping", header: "列マッピング", type: "json" },
      { key: "defaultPaymentMethodId", header: "既定の決済手段ID", type: "nullableString" },
      { key: "createdAt", header: "作成日時", type: "timestamp" },
      { key: "updatedAt", header: "更新日時", type: "timestamp" },
    ],
  },
  budgets: {
    title: "予算",
    columns: [
      id,
      { key: "categoryId", header: "中項目ID", type: "string" },
      // 空欄なら毎月の既定。"2026-09" ならその月だけの上書き
      { key: "month", header: "月", type: "nullableMonth" },
      { key: "amount", header: "金額", type: "number" },
      { key: "createdAt", header: "作成日時", type: "timestamp" },
      { key: "updatedAt", header: "更新日時", type: "timestamp" },
    ],
  },
  plans: {
    title: "予定",
    columns: [
      id,
      { key: "name", header: "名前", type: "string" },
      { key: "categoryId", header: "中項目ID", type: "string" },
      { key: "amount", header: "金額", type: "number" },
      { key: "day", header: "日", type: "int" },
      { key: "paymentMethodId", header: "決済手段ID", type: "nullableString" },
      { key: "transferToId", header: "移動先ID", type: "nullableString" },
      { key: "startMonth", header: "開始月", type: "nullableMonth" },
      { key: "endMonth", header: "終了月", type: "nullableMonth" },
      { key: "enabled", header: "有効", type: "boolean" },
      { key: "memo", header: "メモ", type: "nullableString" },
      { key: "createdAt", header: "作成日時", type: "timestamp" },
      { key: "updatedAt", header: "更新日時", type: "timestamp" },
    ],
  },
  purposes: {
    title: "使途",
    columns: [
      id,
      { key: "name", header: "名前", type: "string" },
      { key: "sortOrder", header: "並び順", type: "int" },
      { key: "openingBalance", header: "起点残高", type: "number" },
      { key: "openingBalanceAt", header: "起点日", type: "nullableDate" },
      { key: "archivedAt", header: "アーカイブ日時", type: "nullableTimestamp" },
      { key: "createdAt", header: "作成日時", type: "timestamp" },
    ],
  },
  purposeTransfers: {
    title: "使途振替",
    columns: [
      id,
      { key: "date", header: "日付", type: "date" },
      { key: "fromPurposeId", header: "振替元使途ID", type: "string" },
      { key: "toPurposeId", header: "振替先使途ID", type: "string" },
      { key: "amount", header: "金額", type: "number" },
      { key: "memo", header: "メモ", type: "nullableString" },
      { key: "createdAt", header: "作成日時", type: "timestamp" },
    ],
  },
  // ---- 二人の家計簿 LINE（GAS）と共有するタブ。見出しは GAS の gas/Config.js と一字一句同じ ----
  pairEntries: {
    title: "二人の明細",
    columns: [
      id,
      { key: "date", header: "日付", type: "date" },
      { key: "description", header: "内容", type: "string" },
      { key: "amount", header: "金額", type: "number" },
      { key: "payer", header: "支払者", type: { enum: PAIR_ROLES, fallback: "OWNER" } },
      { key: "mode", header: "負担方法", type: { enum: SHARE_MODES, fallback: "CUSTOM" } },
      { key: "ownerShare", header: "オーナー負担", type: "number" },
      { key: "partnerShare", header: "パートナー負担", type: "number" },
      { key: "costTypeId", header: "費目ID", type: "nullableString" },
      { key: "categoryId", header: "中項目ID", type: "nullableString" },
      { key: "methodId", header: "決済手段ID", type: "nullableString" },
      { key: "memo", header: "メモ", type: "nullableString" },
      { key: "settlementId", header: "精算ID", type: "nullableString" },
      { key: "sync", header: "家計簿反映", type: { enum: [...PAIR_SYNC, ""], fallback: "" } },
      { key: "householdTxId", header: "家計簿明細ID", type: "nullableString" },
      { key: "originalCategoryId", header: "取込元の中項目ID", type: "nullableString" },
      { key: "createdBy", header: "登録者", type: { enum: PAIR_ROLES, fallback: "OWNER" } },
      { key: "createdAt", header: "作成日時", type: "timestamp" },
      { key: "updatedAt", header: "更新日時", type: "timestamp" },
      { key: "deletedAt", header: "削除日時", type: "nullableTimestamp" },
    ],
  },
  pairSettlements: {
    title: "二人の精算",
    columns: [
      id,
      { key: "date", header: "日付", type: "date" },
      { key: "payer", header: "支払者", type: { enum: PAIR_ROLES, fallback: "PARTNER" } },
      { key: "amount", header: "金額", type: "number" },
      { key: "count", header: "件数", type: "int" },
      { key: "methodId", header: "決済手段ID", type: "nullableString" },
      { key: "householdTxIds", header: "家計簿明細ID", type: "nullableString" },
      { key: "memo", header: "メモ", type: "nullableString" },
      { key: "createdBy", header: "登録者", type: { enum: PAIR_ROLES, fallback: "OWNER" } },
      { key: "canceledAt", header: "取消日時", type: "nullableTimestamp" },
      { key: "createdAt", header: "作成日時", type: "timestamp" },
      { key: "kind", header: "種別", type: "nullableString" },
    ],
  },
  lineUsers: {
    title: "LINE連携",
    columns: [
      // このタブだけ ID 列が無く、LINE のユーザー ID で行を見分ける
      { key: "id", header: "LINEユーザーID", type: "string" },
      { key: "role", header: "役割", type: "string" },
      { key: "displayName", header: "表示名", type: "string" },
      { key: "registeredAt", header: "登録日時", type: "nullableTimestamp" },
    ],
  },
  batches: {
    title: "取込履歴",
    columns: [
      id,
      { key: "fileName", header: "ファイル名", type: "string" },
      { key: "presetName", header: "プリセット名", type: "nullableString" },
      { key: "importedCount", header: "取込件数", type: "int" },
      { key: "skippedCount", header: "スキップ件数", type: "int" },
      { key: "createdAt", header: "作成日時", type: "timestamp" },
    ],
  },
};

/**
 * タブの並び順。スプレッドシートを開いたとき、よく見る明細が左に来るようにする。
 * 初期化時にこの順でタブを作る。
 */
export const TABLE_ORDER: TableName[] = [
  "transactions",
  "splits",
  "plans",
  "budgets",
  "purposeTransfers",
  "purposes",
  "majors",
  "categories",
  "costTypes",
  "paymentMethods",
  "rules",
  "presets",
  "batches",
  "pairEntries",
  "pairSettlements",
  "lineUsers",
];
