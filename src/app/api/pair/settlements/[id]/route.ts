import { handle } from "@/lib/api";
import { withChanges } from "@/lib/db/store";
import { undoPairSettlement } from "@/lib/pair-household";

/** 精算を取り消す。明細は未精算に戻り、本体に書いた精算の明細は消える */
export async function DELETE(_: Request, ctx: RouteContext<"/api/pair/settlements/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    return withChanges((tx, db) => ({ settlement: undoPairSettlement(tx, db, id) }));
  });
}
