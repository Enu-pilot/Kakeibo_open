/**
 * JSON のバックアップからスプレッドシートを復元する。
 *   npm run db:restore                          # 最新のバックアップから
 *   npm run db:restore backups/kakeibo-....json # ファイルを指定して
 *
 * スプレッドシートの今の中身は置き換わるため、確認を挟む（--yes で省略）。
 * 間違えて流しても、Google の版履歴（ファイル → 変更履歴）から戻せる。
 */
import "dotenv/config";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseBackup, restoreBackup } from "@/lib/db/backup";
import { SheetsError, spreadsheetId } from "@/lib/db/sheets-client";

const DIR = process.env.BACKUP_DIR ?? "backups";
const args = process.argv.slice(2);
const skipConfirm = args.includes("--yes");
const given = args.find((a) => !a.startsWith("--"));

function latestBackup() {
  if (!existsSync(DIR)) return null;
  const files = readdirSync(DIR).filter((n) => /^kakeibo-\d{8}-\d{4}\.json$/.test(n)).sort();
  return files.length > 0 ? join(DIR, files[files.length - 1]) : null;
}

async function main() {
  const file = given ?? latestBackup();
  if (!file) throw new Error(`バックアップが見つかりません（${DIR}/）。先に npm run db:backup を実行してください。`);
  if (!existsSync(file)) throw new Error(`ファイルがありません: ${file}`);

  const backup = parseBackup(readFileSync(file, "utf8"));
  const target = spreadsheetId();

  if (!skipConfirm) {
    console.log(`復元元 : ${file}（${backup.exportedAt} に作成、明細 ${backup.tables.transactions.length} 件）`);
    console.log(`復元先 : スプレッドシート ${target}`);
    if (backup.spreadsheetId !== target) {
      console.log("※ バックアップを取ったスプレッドシートとは別のものに復元します。");
    }
    console.log("復元先の今の中身は置き換わります（Google の版履歴からは戻せます）。");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question("続けますか？ yes と入力: ");
    rl.close();
    if (answer.trim() !== "yes") {
      console.log("中止しました。");
      return;
    }
  }

  const counts = await restoreBackup(backup);
  console.log(`${file} から復元しました:`, counts);
}

main().catch((error) => {
  console.error(error instanceof SheetsError || error instanceof Error ? error.message : error);
  process.exit(1);
});
