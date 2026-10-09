import { handle } from "@/lib/api";
import { getAccountBalances } from "@/lib/balances";
import { loadSnapshot } from "@/lib/db/store";

/** 残高を追う決済手段の現在残高。ダッシュボードと設定画面が読む。 */
export async function GET() {
  return handle(async () => ({ accounts: getAccountBalances(await loadSnapshot()) }));
}
