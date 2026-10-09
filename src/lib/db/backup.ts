/**
 * スプレッドシートの中身を JSON に書き出す／JSON から書き戻す。
 *
 * 日常の「誤って消した」は Google スプレッドシートの版履歴（ファイル → 変更履歴）で戻せる。
 * こちらは、Google アカウントに入れなくなった場合などに備えた、Google の外に置く控え。
 */
import { SCHEMA, TABLE_ORDER } from "@/lib/db/schema";
import { encodeCell, type CellData } from "@/lib/db/codec";
import { batchUpdate, spreadsheetId } from "@/lib/db/sheets-client";
import { invalidateSnapshot, loadFreshSnapshot, type Snapshot } from "@/lib/db/store";
import { ensureSheets } from "@/lib/db/init";
import type { TableName } from "@/lib/db/types";

export const BACKUP_FORMAT = "kakeibo-backup";
export const BACKUP_VERSION = 1;

export type Backup = {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  spreadsheetId: string;
  tables: { [T in TableName]: Record<string, unknown>[] };
};

export function toBackup(db: Snapshot): Backup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    spreadsheetId: spreadsheetId(),
    // 行の型は表ごとに違うが、JSON にすればどれも「キーと値の組」なので、まとめて扱う
    tables: Object.fromEntries(TABLE_ORDER.map((t) => [t, db[t]])) as unknown as Backup["tables"],
  };
}

/** 壊れた・別物のファイルを流し込まないよう、形だけは確かめる */
export function parseBackup(text: string): Backup {
  let data: Partial<Backup>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("バックアップファイルを JSON として読めません。");
  }
  if (data.format !== BACKUP_FORMAT) throw new Error("家計簿のバックアップファイルではありません。");
  if (data.version !== BACKUP_VERSION) {
    throw new Error(`対応していないバックアップの版です（${data.version}）。`);
  }
  if (!data.tables || typeof data.tables !== "object") {
    throw new Error("バックアップに表のデータがありません。");
  }
  for (const table of TABLE_ORDER) {
    // 後から増えた表（予算・予定など）が無い古いバックアップは、その表を空として扱う
    if (!(table in data.tables)) {
      (data.tables as Record<string, unknown>)[table] = [];
      continue;
    }
    const rows = data.tables[table];
    if (!Array.isArray(rows) || rows.some((r) => !r || typeof r !== "object" || !("id" in r))) {
      throw new Error(`バックアップの「${SCHEMA[table].title}」が壊れています。`);
    }
  }
  return data as Backup;
}

/**
 * スプレッドシートの全タブを、バックアップの内容で置き換える。
 * 全タブぶんを 1 回の batchUpdate で行うので、途中で失敗しても何も変わらない。
 * 見出し行は残し、2 行目以降を入れ替える（自分で足したメモ列の値は消える）。
 */
export async function restoreBackup(backup: Backup) {
  await ensureSheets();
  const db = await loadFreshSnapshot();
  const requests: unknown[] = [];

  for (const table of TABLE_ORDER) {
    const meta = db.meta[table];
    const def = SCHEMA[table];

    if (meta.rowCount > 1) {
      // 「固定行以外をすべて削除」はできないので、空行を 1 行足してから見出しより下を消す
      requests.push({ appendDimension: { sheetId: meta.sheetId, dimension: "ROWS", length: 1 } });
      requests.push({
        deleteDimension: {
          range: { sheetId: meta.sheetId, dimension: "ROWS", startIndex: 1, endIndex: meta.rowCount },
        },
      });
    }

    const rows = backup.tables[table];
    if (rows.length === 0) continue;
    requests.push({
      appendCells: {
        sheetId: meta.sheetId,
        rows: rows.map((row) => {
          const values: CellData[] = Array.from({ length: meta.width }, () => ({}));
          for (const col of def.columns) {
            values[meta.columnIndex.get(col.header)!] = encodeCell(col.type, row[col.key]);
          }
          return { values };
        }),
        fields: "userEnteredValue",
      },
    });
  }

  try {
    await batchUpdate(requests);
  } finally {
    invalidateSnapshot();
  }
  return Object.fromEntries(TABLE_ORDER.map((t) => [SCHEMA[t].title, backup.tables[t].length]));
}
