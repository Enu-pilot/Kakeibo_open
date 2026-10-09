import { handle, notFound } from "@/lib/api";
import { withChanges } from "@/lib/db/store";
import { deleteTransaction } from "@/lib/transactions";

/** 取り込みの取り消し。そのバッチで入った明細を内訳ごとまとめて削除する。 */
export async function DELETE(_: Request, ctx: RouteContext<"/api/import/batches/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    return withChanges((tx, db) => {
      if (!db.batches.some((b) => b.id === id)) throw notFound("取り込み履歴が見つかりません");
      const targets = db.transactions.filter((t) => t.importBatchId === id).map((t) => t.id);
      for (const transactionId of targets) deleteTransaction(tx, db, transactionId);
      tx.remove("batches", id);
      return { deleted: targets.length };
    });
  });
}
