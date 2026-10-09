import { handle } from "@/lib/api";
import { withChanges } from "@/lib/db/store";
import { deletePairEntry, updatePairEntry } from "@/lib/pair-household";
import { pairEntrySchema } from "@/app/api/pair/schema";

/** 二人の明細を直す。本体の明細・内訳は消して書き直す（カード取込の明細は内訳を戻してから分け直す） */
export async function PATCH(request: Request, ctx: RouteContext<"/api/pair/entries/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const input = pairEntrySchema.partial().parse(await request.json());
    return withChanges((tx, db) => updatePairEntry(tx, db, id, input));
  });
}

/** 二人の明細を消す（行は残して削除日時を入れる）。本体に書いた明細も消す */
export async function DELETE(_: Request, ctx: RouteContext<"/api/pair/entries/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    return withChanges((tx, db) => ({ entry: deletePairEntry(tx, db, id) }));
  });
}
