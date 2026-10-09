/**
 * スプレッドシートの中身を JSON に書き出す。
 *   npm run db:backup
 *
 * backups/kakeibo-YYYYMMDD-HHmm.json に保存し、最新 30 世代を残す（BACKUP_KEEP で変更可）。
 * 日常の取り消しは Google の版履歴で足りるので、これは Google の外に置く控えとして使う。
 */
import "dotenv/config";
import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadFreshSnapshot } from "@/lib/db/store";
import { toBackup } from "@/lib/db/backup";
import { SheetsError } from "@/lib/db/sheets-client";

const KEEP = Number(process.env.BACKUP_KEEP ?? 30);
const DIR = process.env.BACKUP_DIR ?? "backups";

function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

async function main() {
  const backup = toBackup(await loadFreshSnapshot());
  mkdirSync(DIR, { recursive: true });
  const file = join(DIR, `kakeibo-${stamp()}.json`);
  // 家計データそのものなので、所有者だけが読めるようにする
  writeFileSync(file, JSON.stringify(backup, null, 2), { mode: 0o600 });

  const old = readdirSync(DIR)
    .filter((name) => /^kakeibo-\d{8}-\d{4}\.json$/.test(name))
    .sort()
    .slice(0, -KEEP);
  for (const name of old) unlinkSync(join(DIR, name));

  const t = backup.tables;
  console.log(`${file} に保存しました（明細 ${t.transactions.length} 件 / 内訳 ${t.splits.length} 件）`);
  if (old.length > 0) console.log(`古い ${old.length} 件を削除しました（最新 ${KEEP} 件を保持）`);
  console.log(
    "このファイルは外付けドライブなど、Google と Codespace の外にもコピーしてください。" +
      "Codespace を消すとこのフォルダも一緒に消えます。",
  );
}

main().catch((error) => {
  console.error(error instanceof SheetsError ? error.message : error);
  process.exit(1);
});
