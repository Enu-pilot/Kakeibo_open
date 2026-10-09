import { handle } from "@/lib/api";
import { reloadSnapshot, snapshotLoadedAt } from "@/lib/db/store";

/**
 * いますぐスプレッドシートから読み直す。
 * スプレッドシートを直接直したあと、30 秒待たずに画面へ反映したいときに使う。
 */
export async function POST() {
  return handle(async () => {
    const db = await reloadSnapshot();
    return { loadedAt: snapshotLoadedAt(), transactions: db.transactions.length };
  });
}
