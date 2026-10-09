import { z } from "zod";
import { handle, badRequest, notFound } from "@/lib/api";
import { now, withChanges } from "@/lib/db/store";

const patchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  majorId: z.string().min(1).optional(),
  sortOrder: z.number().int().optional(),
});

export async function PATCH(request: Request, ctx: RouteContext<"/api/categories/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const input = patchSchema.parse(await request.json());
    return withChanges((tx, db) => {
      const current = db.categories.find((c) => c.id === id);
      if (!current) throw notFound("中項目が見つかりません");
      const majorId = input.majorId ?? current.majorId;
      const name = input.name ?? current.name;
      const moving = majorId !== current.majorId;
      if (moving && !db.majors.some((m) => m.id === majorId)) {
        throw badRequest("移動先の大項目が見つかりません");
      }
      // 中項目は (大項目, 名前) で一意。移動や改名で衝突しないか先に確かめる
      if (db.categories.some((c) => c.id !== id && c.majorId === majorId && c.name === name)) {
        throw badRequest(
          moving ? `「${name}」は移動先の大項目に既にあります。` : "同じ名前の中項目が既にあります",
        );
      }
      // 移した先では末尾に置く。元の並び順をそのまま持ち込むと順序が入り乱れるため
      const sortOrder = moving
        ? Math.max(-1, ...db.categories.filter((c) => c.majorId === majorId).map((c) => c.sortOrder)) + 1
        : input.sortOrder;
      return tx.update("categories", id, {
        ...input,
        ...(sortOrder !== undefined ? { sortOrder } : {}),
        updatedAt: now(),
      });
    });
  });
}

/** 使用中の中項目は削除せずアーカイブする（過去の集計を壊さないため） */
export async function DELETE(_: Request, ctx: RouteContext<"/api/categories/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    return withChanges((tx, db) => {
      if (!db.categories.some((c) => c.id === id)) throw notFound("中項目が見つかりません");
      const used = db.splits.filter((s) => s.categoryId === id).length;
      if (used > 0) {
        tx.update("categories", id, { archivedAt: now(), updatedAt: now() });
        return { archived: true, splits: used };
      }
      const rules = db.rules.filter((r) => r.categoryId === id).length;
      if (rules > 0) {
        throw badRequest(
          `この中項目を使っている分類ルールが ${rules} 件あります。先にルールを変更してください。`,
        );
      }
      tx.remove("categories", id);
      return { deleted: true };
    });
  });
}
