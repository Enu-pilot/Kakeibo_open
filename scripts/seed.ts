/**
 * スプレッドシートを家計簿の DB として使えるようにする。
 *   npm run db:seed
 *
 * タブと見出しを作り、大項目・中項目・決済手段・分類ルールの初期データを入れる。
 * 何度実行しても安全（無いものだけを足す）。
 */
import "dotenv/config";
import { ensureSheets, seed } from "@/lib/db/init";
import { SheetsError } from "@/lib/db/sheets-client";

async function main() {
  const ensured = await ensureSheets();
  if (ensured.createdTabs.length > 0) {
    console.log(`タブを作りました: ${ensured.createdTabs.join("・")}`);
  }
  if (ensured.addedHeaders.length > 0) {
    console.log(`欠けていた見出しを足しました: ${ensured.addedHeaders.join("、")}`);
  }
  if (ensured.removedDefault) console.log("空の「シート1」を削除しました。");

  const { added, totals } = await seed();
  const addedTotal = added.majors + added.categories + added.costTypes + added.paymentMethods + added.rules;
  console.log(
    addedTotal > 0
      ? `初期データを追加しました: 使途 ${added.purposes} / 大項目 ${added.majors} / 中項目 ${added.categories} / 費目 ${added.costTypes} / 決済手段 ${added.paymentMethods} / ルール ${added.rules}`
      : "初期データは揃っていたので、追加したものはありません。",
  );
  console.log("現在の件数:", totals);
}

main().catch((error) => {
  console.error("");
  console.error(error instanceof SheetsError ? error.message : error);
  process.exit(1);
});
