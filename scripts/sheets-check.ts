/**
 * スプレッドシートとの接続を順に確かめる。
 *   npm run sheets:check
 *
 * 繋がらないときに、どこで止まっているか（設定・鍵・共有・API の有効化・見出し）と
 * 何をすれば直るかを表示する。最後にデータの整合性も確かめる。
 */
import "dotenv/config";
import {
  SheetsError,
  getSheets,
  loadServiceAccount,
  spreadsheetId,
} from "@/lib/db/sheets-client";
import { loadSnapshot } from "@/lib/db/store";
import { SCHEMA, TABLE_ORDER } from "@/lib/db/schema";
import { checkIntegrity } from "@/lib/db/integrity";

const ok = (text: string) => console.log(`  ✓ ${text}`);
const step = (n: number, text: string) => console.log(`\n[${n}/4] ${text}`);

async function main() {
  step(1, "設定を確認");
  const id = spreadsheetId();
  ok(`スプレッドシート ID: ${id}`);
  const account = loadServiceAccount();
  ok(`サービスアカウント: ${account.client_email}`);
  console.log("    ↑ スプレッドシートの「共有」に、このアドレスを「編集者」で追加してください。");

  step(2, "Google にログインしてスプレッドシートを開く");
  const sheets = await getSheets();
  ok(`開けました（タブ ${sheets.length} 個）`);

  step(3, "タブと見出しを確認");
  const titles = new Set(sheets.map((s) => s.title));
  const missing = TABLE_ORDER.filter((t) => !titles.has(SCHEMA[t].title));
  if (missing.length > 0) {
    console.log(`  ✗ 「${missing.map((t) => SCHEMA[t].title).join("」「")}」タブがありません。`);
    console.log("    npm run db:seed を実行すると作られます。");
    process.exit(1);
  }
  const db = await loadSnapshot();
  ok(
    `見出しは揃っています（明細 ${db.transactions.length} 件 / 内訳 ${db.splits.length} 件 / ` +
      `中項目 ${db.categories.length} 件 / ルール ${db.rules.length} 件）`,
  );

  step(4, "データの整合性を確認");
  const issues = checkIntegrity(db);
  if (issues.length === 0) {
    ok("問題はありません");
  } else {
    console.log(`  ⚠ ${issues.length} 件の食い違いがあります（アプリは動きますが、該当する行は集計から外れます）:`);
    for (const issue of issues.slice(0, 30)) {
      console.log(`    - [${issue.tab}] ${issue.message}  (ID: ${issue.id})`);
    }
    if (issues.length > 30) console.log(`    … ほか ${issues.length - 30} 件`);
  }
  console.log("\n接続できています。");
}

main().catch((error) => {
  console.error("");
  console.error(`  ✗ ${error instanceof SheetsError ? error.message : error}`);
  process.exit(1);
});
