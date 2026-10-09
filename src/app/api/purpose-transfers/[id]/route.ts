import { handle, notFound } from "@/lib/api";
import { withChanges } from "@/lib/db/store";

export async function DELETE(_: Request, ctx: RouteContext<"/api/purpose-transfers/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    return withChanges((tx, db) => {
      if (!db.purposeTransfers.some((t) => t.id === id)) throw notFound("振替が見つかりません");
      tx.remove("purposeTransfers", id);
      return { deleted: true };
    });
  });
}
