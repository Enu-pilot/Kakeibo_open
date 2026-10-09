import { z } from "zod";
import { handle, badRequest, notFound } from "@/lib/api";
import { now, withChanges } from "@/lib/db/store";

const patchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  openingBalance: z.number().finite().optional(),
  /** 起点日 "YYYY-MM-DD"。null なら全期間を数える */
  openingBalanceAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "起点日は YYYY-MM-DD の形で入力してください")
    .nullable()
    .optional(),
});

export async function PATCH(request: Request, ctx: RouteContext<"/api/purposes/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const input = patchSchema.parse(await request.json());
    return withChanges((tx, db) => {
      if (!db.purposes.some((p) => p.id === id)) throw notFound("使途が見つかりません");
      if (input.name && db.purposes.some((p) => p.id !== id && p.name === input.name)) {
        throw badRequest(`「${input.name}」という使途が既にあります`);
      }
      return tx.update("purposes", id, input);
    });
  });
}

/**
 * 大項目や振替で使っている使途は消さずにアーカイブする（過去の振替の記録を壊さないため）。
 * アーカイブした使途の大項目は「未設定」として数える。使われていなければ削除する。
 */
export async function DELETE(_: Request, ctx: RouteContext<"/api/purposes/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    return withChanges((tx, db) => {
      if (!db.purposes.some((p) => p.id === id)) throw notFound("使途が見つかりません");
      const majors = db.majors.filter((m) => m.purposeId === id).length;
      const transfers = db.purposeTransfers.filter((t) => t.fromPurposeId === id || t.toPurposeId === id).length;
      if (majors + transfers > 0) {
        tx.update("purposes", id, { archivedAt: now() });
        return { archived: true, majors, transfers };
      }
      tx.remove("purposes", id);
      return { deleted: true };
    });
  });
}
