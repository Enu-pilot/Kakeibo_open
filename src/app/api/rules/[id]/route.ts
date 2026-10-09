import { z } from "zod";
import { handle, badRequest, notFound } from "@/lib/api";
import { now, withChanges } from "@/lib/db/store";
import { MATCH_TYPES } from "@/lib/db/types";

const patchSchema = z.object({
  keyword: z.string().trim().min(1).optional(),
  matchType: z.enum(MATCH_TYPES).optional(),
  /** null で外せる。ただし中項目と費目の両方が空になる変更は受け付けない */
  categoryId: z.string().min(1).nullable().optional(),
  costTypeId: z.string().min(1).nullable().optional(),
  priority: z.number().int().min(0).max(999).optional(),
  enabled: z.boolean().optional(),
});

export async function PATCH(request: Request, ctx: RouteContext<"/api/rules/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const input = patchSchema.parse(await request.json());
    return withChanges((tx, db) => {
      const current = db.rules.find((r) => r.id === id);
      if (!current) throw notFound("ルールが見つかりません");
      const keyword = input.keyword ?? current.keyword;
      const matchType = input.matchType ?? current.matchType;
      if (matchType === "REGEX") {
        try {
          new RegExp(keyword);
        } catch {
          throw badRequest("正規表現として解釈できません");
        }
      }
      if (db.rules.some((r) => r.id !== id && r.keyword === keyword && r.matchType === matchType)) {
        throw badRequest("同じキーワード・マッチ方式のルールが既にあります");
      }
      const categoryId = input.categoryId === undefined ? current.categoryId : input.categoryId;
      const costTypeId = input.costTypeId === undefined ? current.costTypeId : input.costTypeId;
      if (!categoryId && !costTypeId) {
        throw badRequest("中項目と費目の両方を空にはできません。不要ならルールを削除してください");
      }
      return tx.update("rules", id, { ...input, updatedAt: now() });
    });
  });
}

export async function DELETE(_: Request, ctx: RouteContext<"/api/rules/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    await withChanges((tx, db) => {
      if (!db.rules.some((r) => r.id === id)) throw notFound("ルールが見つかりません");
      tx.remove("rules", id);
    });
    return { deleted: true };
  });
}
