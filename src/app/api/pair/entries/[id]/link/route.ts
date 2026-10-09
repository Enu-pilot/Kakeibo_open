import { z } from "zod";
import { handle } from "@/lib/api";
import { withChanges } from "@/lib/db/store";
import { linkPairEntry, unlinkPairEntry } from "@/lib/pair-household";

const linkSchema = z.object({ transactionId: z.string().min(1, "家計簿の明細を選んでください") });

/**
 * 二人の明細を家計簿の明細に結び付ける。
 * 過去分の取込はどの明細かを覚えるだけ。それ以外は取込の明細を自分の負担と立替に分ける（LINE で書いた明細は消す）
 */
export async function POST(request: Request, ctx: RouteContext<"/api/pair/entries/[id]/link">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const { transactionId } = linkSchema.parse(await request.json());
    return withChanges((tx, db) => linkPairEntry(tx, db, id, transactionId));
  });
}

/** 結び付けを外す */
export async function DELETE(_: Request, ctx: RouteContext<"/api/pair/entries/[id]/link">) {
  return handle(async () => {
    const { id } = await ctx.params;
    return withChanges((tx, db) => unlinkPairEntry(tx, db, id));
  });
}
