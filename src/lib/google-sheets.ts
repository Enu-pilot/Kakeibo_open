/**
 * 請求シート（GAS 時代のスプレッドシート）を読むための入口。
 *
 * 接続はアプリのデータと同じサービスアカウント（src/lib/db/sheets-client.ts）を使い、
 * 読み取り専用のスコープでトークンを取る。請求シートはこのアドレスに「閲覧者」で共有するので、
 * 権限の面でもスコープの面でも、アプリから請求シートを書き換えることはできない。
 */
import { loadServiceAccount } from "@/lib/db/sheets-client";

export { fetchSheetGrid, SheetsError } from "@/lib/db/sheets-client";

/** サービスアカウントの鍵が設定されているか（未設定なら /sheet は貼り付けだけで使う） */
export function isSheetsConfigured() {
  try {
    loadServiceAccount();
    return true;
  } catch {
    return false;
  }
}

/** 既定で開く請求シートの ID（URL でもよい）。画面でも変えられる */
export function defaultSpreadsheetId() {
  return (process.env.BILLING_SHEET_ID ?? process.env.SHEETS_SPREADSHEET_ID ?? "").trim();
}
