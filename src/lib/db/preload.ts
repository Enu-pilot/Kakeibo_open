import { loadSnapshot, reloadSnapshot } from "@/lib/db/store";
import { ensureSheets } from "@/lib/db/init";
import { getSheets } from "@/lib/db/sheets-client";
import { SCHEMA } from "@/lib/db/schema";

/** 起動を待たせる上限。Google に繋がらないときに、いつまでも起動しないのを避ける */
const TIMEOUT_MS = 20_000;

/**
 * 起動時の読み込み。失敗しても起動は止めない（画面に直し方を出すため）。
 * 結果はターミナルに 1 行で出す。
 */
export async function preloadSnapshot() {
  const started = Date.now();
  try {
    const db = await withTimeout(loadOrUpgrade());
    console.log(
      `✓ スプレッドシートを読み込みました（明細 ${db.transactions.length} 件・中項目 ${db.categories.length} 件・予定 ${db.plans.length} 件、${Date.now() - started} ms）`,
    );
  } catch (error) {
    console.warn(
      "⚠ 起動時にスプレッドシートを読み込めませんでした。画面を開くと直し方が表示されます。\n  " +
        (error instanceof Error ? error.message.split("\n")[0] : String(error)),
    );
  }
}

function withTimeout<T>(promise: Promise<T>) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${TIMEOUT_MS / 1000} 秒以内に読み込めませんでした`)), TIMEOUT_MS),
    ),
  ]);
}

/**
 * アプリの版が上がってタブや列が増えたとき（費目の表など）は、起動時に足りないものだけを足す。
 * 既存の行・列には触らない（npm run db:seed の前半と同じ処理）。
 * 「明細」タブがあるスプレッドシート（このアプリ用のもの）に限る。
 * 取り違えた別のスプレッドシートに勝手にタブを作らないため。
 */
async function loadOrUpgrade() {
  try {
    return await loadSnapshot();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/タブがありません|列がありません/.test(message)) throw error;
    const titles = new Set((await getSheets()).map((s) => s.title));
    if (!titles.has(SCHEMA.transactions.title)) throw error;
    const result = await ensureSheets();
    const added = [...result.createdTabs.map((t) => `${t} タブ`), ...result.addedHeaders];
    console.log(`✓ 新しい版に合わせてスプレッドシートを補いました: ${added.join("、")}`);
    return reloadSnapshot();
  }
}
