/**
 * スプレッドシートを DB として読み書きする層。
 *
 * 読み込み:
 *   全タブを 1 回の batchGet でまとめて読み、型つきの配列にする（スナップショット）。
 *   個人の家計簿の規模なら全件をメモリに載せても十分軽い。
 *   サーバーの起動時に 1 回読み込んでおき（src/instrumentation.ts）、画面はその手元の写しから描く。
 *   - 読んでから 30 秒以内: そのまま使う（API を呼ばない）
 *   - 30 秒〜10 分: 手元の写しで即座に描き、裏で読み直す（次の表示から新しい内容になる）
 *   - 10 分より古い・書き込んだ直後: 読み直し終わるまで待つ
 *   こうすると画面は待たされず、Google の回数制限（1 分あたり 60 回）にも当たらない。
 *
 * 書き込み:
 *   withChanges() の中で追加・更新・削除を積み、最後に 1 回の batchUpdate で確定する。
 *   batchUpdate は途中で失敗すると何も適用しないので、明細と内訳が片方だけ書かれることはない。
 *
 * 行番号について:
 *   更新・削除はスプレッドシート上の行番号を指定して行う。行番号は読み込んだ時点のものなので、
 *   書き込みの直前に必ず読み直す（キャッシュを使わない）。スプレッドシート側で同時に行を
 *   挿入・削除されるとずれ得るが、その隙間は 1 秒未満になる。
 */
import { randomUUID } from "node:crypto";
import { SCHEMA, TABLE_ORDER, type ColumnDef } from "@/lib/db/schema";
import { decodeCell, encodeCell, type CellData } from "@/lib/db/codec";
import {
  SheetsError,
  batchGet,
  batchUpdate,
  getSheets,
  quoteSheet,
  type SheetProperties,
} from "@/lib/db/sheets-client";
import type { TableName, Tables } from "@/lib/db/types";

type TableMeta = {
  sheetId: number;
  /** 見出し → 列番号（0 始まり） */
  columnIndex: Map<string, number>;
  /** 見出し行の列数（アプリが知らない列も含む） */
  width: number;
  /** id → グリッド上の行番号（0 始まり。0 が見出し行） */
  rowIndexById: Map<string, number>;
  /** グリッドの総行数と固定行数（全行削除の制約を避けるために使う） */
  rowCount: number;
  frozenRowCount: number;
};

export type Snapshot = { [T in TableName]: Tables[T][] } & {
  meta: { [T in TableName]: TableMeta };
};

/* ------------------------------------------------------------------ */
/* 読み込み                                                            */
/* ------------------------------------------------------------------ */

type Cache = {
  /** at = 読み込みを始めた時刻。loaded = 読み終わって使える状態か */
  snapshot?: { at: number; promise: Promise<Snapshot>; loaded: boolean };
  /** 裏で読み直している最中なら、その処理 */
  refreshing?: Promise<void>;
  sheets?: { at: number; list: SheetProperties[] };
};
// Next.js はルートハンドラと画面を別のモジュールとして読み込むことがあるため、
// キャッシュはモジュール変数ではなく globalThis に置き、書き込み時の破棄が両方に効くようにする
const cache = globalThis as unknown as { __kakeiboSheets?: Cache };
function store(): Cache {
  return (cache.__kakeiboSheets ??= {});
}

/** タブ一覧は滅多に変わらないので長めに覚えておく。見つからないタブがあれば取り直す */
async function sheetList(fresh: boolean): Promise<SheetProperties[]> {
  const c = store();
  if (!fresh && c.sheets && Date.now() - c.sheets.at < 5 * 60_000) {
    const titles = new Set(c.sheets.list.map((s) => s.title));
    if (TABLE_ORDER.every((t) => titles.has(SCHEMA[t].title))) return c.sheets.list;
  }
  const list = await getSheets();
  c.sheets = { at: Date.now(), list };
  return list;
}

async function readSnapshot(fresh: boolean): Promise<Snapshot> {
  const sheets = await sheetList(fresh);
  const byTitle = new Map(sheets.map((s) => [s.title, s]));

  const missing = TABLE_ORDER.filter((t) => !byTitle.has(SCHEMA[t].title));
  if (missing.length > 0) {
    throw new SheetsError(
      `スプレッドシートに「${missing.map((t) => SCHEMA[t].title).join("」「")}」タブがありません。` +
        "npm run db:seed を実行すると作られます。",
      500,
    );
  }

  const values = await batchGet(TABLE_ORDER.map((t) => quoteSheet(SCHEMA[t].title)));

  const snapshot = { meta: {} } as Snapshot;
  TABLE_ORDER.forEach((table, i) => {
    const props = byTitle.get(SCHEMA[table].title)!;
    const { rows, meta } = decodeTable(table, values[i] ?? [], props);
    (snapshot as Record<string, unknown>)[table] = rows;
    (snapshot.meta as Record<string, TableMeta>)[table] = meta;
  });
  return snapshot;
}

function decodeTable(table: TableName, grid: unknown[][], props: SheetProperties) {
  const def = SCHEMA[table];
  const header = (grid[0] ?? []).map((h) => String(h ?? "").trim());
  const columnIndex = new Map<string, number>();
  header.forEach((h, i) => {
    if (h && !columnIndex.has(h)) columnIndex.set(h, i);
  });

  const lacking = def.columns.filter((c) => !columnIndex.has(c.header));
  if (lacking.length > 0) {
    throw new SheetsError(
      `「${def.title}」タブに「${lacking.map((c) => c.header).join("」「")}」列がありません。` +
        "見出しを書き換えた場合は元に戻すか、npm run db:seed で見出しを補ってください。",
      500,
    );
  }

  const idIndex = columnIndex.get(def.columns.find((c) => c.key === "id")!.header)!;
  const rowIndexById = new Map<string, number>();
  const rows: Record<string, unknown>[] = [];
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r] ?? [];
    const id = String(cells[idIndex] ?? "").trim();
    // ID の無い行は、空行か自分用のメモ行として読み飛ばす。重複した ID は先の行を採る
    if (!id || rowIndexById.has(id)) continue;
    const row: Record<string, unknown> = {};
    for (const col of def.columns) {
      row[col.key] = decodeCell(col.type, cells[columnIndex.get(col.header)!] as never);
    }
    rows.push(row);
    rowIndexById.set(id, r);
  }

  const meta: TableMeta = {
    sheetId: props.sheetId,
    columnIndex,
    width: Math.max(header.length, def.columns.length),
    rowIndexById,
    rowCount: props.gridProperties?.rowCount ?? grid.length,
    frozenRowCount: props.gridProperties?.frozenRowCount ?? 0,
  };
  return { rows, meta };
}

/** 読み込みを始め、成功したら「使える写し」として覚える */
function startRead(): Promise<Snapshot> {
  const c = store();
  const entry: NonNullable<Cache["snapshot"]> = {
    at: Date.now(),
    promise: readSnapshot(false),
    loaded: false,
  };
  c.snapshot = entry;
  entry.promise.then(
    () => {
      entry.loaded = true;
    },
    () => {
      // 失敗した読み込みを覚えておかない（次の呼び出しでやり直させる）
      if (store().snapshot === entry) store().snapshot = undefined;
    },
  );
  return entry.promise;
}

/** 手元の写しを返したまま、裏で読み直す。終わったら写しを差し替える */
function refreshInBackground(stale: NonNullable<Cache["snapshot"]>) {
  const c = store();
  if (c.refreshing) return;
  const at = Date.now();
  c.refreshing = readSnapshot(false)
    .then((snapshot) => {
      // 読み直している間に書き込みがあって写しが捨てられていたら、古い結果で上書きしない
      if (store().snapshot === stale) {
        store().snapshot = { at, promise: Promise.resolve(snapshot), loaded: true };
      }
    })
    .catch((error) => {
      // 一時的な失敗なら、手元の写しを使い続けて次の表示でまたやり直す
      console.error("スプレッドシートの読み直しに失敗しました:", error instanceof Error ? error.message : error);
    })
    .finally(() => {
      store().refreshing = undefined;
    });
}

/**
 * 画面表示用の読み込み。手元の写しがあれば使う（ファイル冒頭の説明を参照）。
 * 1 画面を描く間に何度呼ばれても、API は多くて 1 回で済む。
 *
 * SHEETS_CACHE_MS（既定 30 秒）: そのまま使う期間。0 にすると毎回読み直す（テスト用）
 * SHEETS_STALE_MS（既定 10 分）: 裏で読み直しながら古い写しを使ってよい期間
 */
export function loadSnapshot(): Promise<Snapshot> {
  const c = store();
  const freshMs = Number(process.env.SHEETS_CACHE_MS ?? 30_000);
  const staleMs = Number(process.env.SHEETS_STALE_MS ?? 10 * 60_000);
  const current = c.snapshot;
  if (current && freshMs > 0) {
    const age = Date.now() - current.at;
    // 読み込み中のものは待つ（同じ読み込みを二重に走らせない）
    if (age < freshMs || !current.loaded) return current.promise;
    if (age < staleMs) {
      refreshInBackground(current);
      return current.promise;
    }
  }
  return startRead();
}

/** 手元の写しをいつ読み込んだか（画面に「◯時◯分に読み込み」と出す用）。まだ無ければ null */
export function snapshotLoadedAt(): number | null {
  const current = store().snapshot;
  return current?.loaded ? current.at : null;
}

/**
 * 画面用。設定の問題（共有し忘れなど）は投げずに文言として返す。
 * 本番ビルドではサーバー側のエラー文言が画面に出ないため、画面側で受け止めて表示する。
 */
export async function loadSnapshotForPage(): Promise<{ db: Snapshot } | { error: string }> {
  try {
    return { db: await loadSnapshot() };
  } catch (error) {
    if (error instanceof SheetsError) return { error: error.message };
    throw error;
  }
}

/** キャッシュを使わずに読む（行番号を正確に知る必要がある、復元などの処理用） */
export function loadFreshSnapshot(): Promise<Snapshot> {
  return readSnapshot(true);
}

/** 書き込み後や、スプレッドシートを直接直した直後に呼ぶ。次の読み込みは読み直し終わるまで待つ */
export function invalidateSnapshot() {
  store().snapshot = undefined;
}

/**
 * いますぐスプレッドシートから読み直す（画面の「読み直す」ボタン用）。
 * タブ一覧も取り直すので、タブを足した・名前を変えた直後でも拾える。
 */
export async function reloadSnapshot(): Promise<Snapshot> {
  const c = store();
  c.sheets = undefined;
  invalidateSnapshot();
  return startRead();
}

/* ------------------------------------------------------------------ */
/* 書き込み                                                            */
/* ------------------------------------------------------------------ */

export function newId() {
  return randomUUID();
}

export function now() {
  return new Date().toISOString();
}

/**
 * 1 回の書き込みで行う変更の集まり。
 * 変更は手元のスナップショットにも即座に反映するので、同じ処理の中で
 * 「さっき追加した中項目」を探す、といったことがそのままできる。
 */
export class Changes {
  private inserts = new Map<TableName, Map<string, Record<string, unknown>>>();
  private updates = new Map<TableName, Map<string, Set<string>>>();
  private deletes = new Map<TableName, Set<string>>();

  constructor(private readonly snapshot: Snapshot) {}

  insert<T extends TableName>(table: T, row: Tables[T]): Tables[T] {
    const id = (row as { id: string }).id;
    (this.snapshot[table] as Tables[T][]).push(row);
    let map = this.inserts.get(table);
    if (!map) this.inserts.set(table, (map = new Map()));
    map.set(id, row as Record<string, unknown>);
    return row;
  }

  update<T extends TableName>(table: T, id: string, patch: Partial<Tables[T]>): Tables[T] {
    const row = (this.snapshot[table] as { id: string }[]).find((r) => r.id === id);
    if (!row) throw new SheetsError(`${SCHEMA[table].title}に ID ${id} の行がありません`, 404);
    Object.assign(row, patch);
    // 同じ処理で追加した行なら、追加時に最終の値で書かれるので記録は要らない
    if (!this.inserts.get(table)?.has(id)) {
      let map = this.updates.get(table);
      if (!map) this.updates.set(table, (map = new Map()));
      let keys = map.get(id);
      if (!keys) map.set(id, (keys = new Set()));
      for (const key of Object.keys(patch)) keys.add(key);
    }
    return row as Tables[T];
  }

  remove(table: TableName, id: string) {
    const rows = this.snapshot[table] as { id: string }[];
    const index = rows.findIndex((r) => r.id === id);
    if (index >= 0) rows.splice(index, 1);
    if (this.inserts.get(table)?.delete(id)) return;
    this.updates.get(table)?.delete(id);
    let set = this.deletes.get(table);
    if (!set) this.deletes.set(table, (set = new Set()));
    set.add(id);
  }

  /** 積んだ変更を batchUpdate のリクエストにする */
  buildRequests(): unknown[] {
    const updates: unknown[] = [];
    const deletes: unknown[] = [];
    const appends: unknown[] = [];

    for (const [table, byId] of this.updates) {
      const meta = this.snapshot.meta[table];
      const def = SCHEMA[table];
      const rows = this.snapshot[table] as unknown as Record<string, unknown>[];
      for (const [id, keys] of byId) {
        const rowIndex = meta.rowIndexById.get(id);
        const row = rows.find((r) => r.id === id);
        if (rowIndex === undefined || !row) continue;
        for (const key of keys) {
          const col = def.columns.find((c) => c.key === key) as ColumnDef | undefined;
          if (!col) continue;
          const colIndex = meta.columnIndex.get(col.header)!;
          updates.push({
            updateCells: {
              range: {
                sheetId: meta.sheetId,
                startRowIndex: rowIndex,
                endRowIndex: rowIndex + 1,
                startColumnIndex: colIndex,
                endColumnIndex: colIndex + 1,
              },
              rows: [{ values: [encodeCell(col.type, row[key])] }],
              fields: "userEnteredValue",
            },
          });
        }
      }
    }

    for (const [table, ids] of this.deletes) {
      const meta = this.snapshot.meta[table];
      const indexes = [...ids]
        .map((id) => meta.rowIndexById.get(id))
        .filter((i): i is number => i !== undefined)
        // 下の行から消す。上から消すと、後の行の番号がずれて別の行を消してしまう
        .sort((a, b) => b - a);
      if (indexes.length === 0) continue;
      // Sheets は「固定行以外をすべて削除」できないので、そうなる場合は先に空行を 1 行足す
      if (meta.rowCount - meta.frozenRowCount - indexes.length < 1) {
        deletes.push({
          appendDimension: { sheetId: meta.sheetId, dimension: "ROWS", length: 1 },
        });
      }
      for (const index of indexes) {
        deletes.push({
          deleteDimension: {
            range: { sheetId: meta.sheetId, dimension: "ROWS", startIndex: index, endIndex: index + 1 },
          },
        });
      }
    }

    for (const [table, byId] of this.inserts) {
      if (byId.size === 0) continue;
      const meta = this.snapshot.meta[table];
      const def = SCHEMA[table];
      appends.push({
        appendCells: {
          sheetId: meta.sheetId,
          rows: [...byId.values()].map((row) => {
            // アプリが知らない列（自分で足したメモ列など）は空のまま置いておく
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

    // 更新 → 削除 → 追加 の順。更新は読み込んだ時点の行番号を使うので、行がずれる前に済ませる
    return [...updates, ...deletes, ...appends];
  }
}

/**
 * スプレッドシートを読み直してから変更を積み、まとめて 1 回で書き込む。
 *
 *   const created = await withChanges(async (tx, db) => {
 *     return tx.insert("categories", { ... });
 *   });
 */
export async function withChanges<R>(
  fn: (tx: Changes, db: Snapshot) => R | Promise<R>,
): Promise<R> {
  // 書き込みは必ず最新の行番号で行う。キャッシュは使わず、手元専用のコピーを読む
  const snapshot = await readSnapshot(true);
  const tx = new Changes(snapshot);
  const result = await fn(tx, snapshot);
  try {
    await batchUpdate(tx.buildRequests());
  } finally {
    invalidateSnapshot();
  }
  return result;
}
