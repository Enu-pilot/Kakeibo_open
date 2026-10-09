import { z } from "zod";
import { handle, badRequest, notFound } from "@/lib/api";
import { now, withChanges } from "@/lib/db/store";

const patchSchema = z.object({
  name: z.string().trim().min(1).optional(),
});

export async function PATCH(request: Request, ctx: RouteContext<"/api/cost-types/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const input = patchSchema.parse(await request.json());
    return withChanges((tx, db) => {
      if (!db.costTypes.some((c) => c.id === id)) throw notFound("費目が見つかりません");
      if (input.name && db.costTypes.some((c) => c.id !== id && c.name === input.name)) {
        throw badRequest(`「${input.name}」という費目が既にあります`);
      }
      return tx.update("costTypes", id, input);
    });
  });
}

/**
 * 使用中の費目は消さずにアーカイブする（過去の集計を壊さないため）。
 * 使われていなければ削除する。その費目を付けるルールからは費目だけを外し、
 * 費目しか決めていなかったルールは意味が無くなるので一緒に消す。
 */
export async function DELETE(_: Request, ctx: RouteContext<"/api/cost-types/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    return withChanges((tx, db) => {
      if (!db.costTypes.some((c) => c.id === id)) throw notFound("費目が見つかりません");
      const used = db.splits.filter((s) => s.costTypeId === id).length;
      if (used > 0) {
        tx.update("costTypes", id, { archivedAt: now() });
        return { archived: true, splits: used };
      }
      for (const rule of db.rules.filter((r) => r.costTypeId === id)) {
        if (rule.categoryId) tx.update("rules", rule.id, { costTypeId: null, updatedAt: now() });
        else tx.remove("rules", rule.id);
      }
      tx.remove("costTypes", id);
      return { deleted: true };
    });
  });
}
