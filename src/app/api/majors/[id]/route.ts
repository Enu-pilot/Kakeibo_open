import { z } from "zod";
import { handle, badRequest, notFound } from "@/lib/api";
import { now, withChanges } from "@/lib/db/store";
import { CATEGORY_KINDS } from "@/lib/db/types";

const patchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  kind: z.enum(CATEGORY_KINDS).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  sortOrder: z.number().int().optional(),
  /** 使途。null で未設定に戻す */
  purposeId: z.string().min(1).nullable().optional(),
});

export async function PATCH(request: Request, ctx: RouteContext<"/api/majors/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const input = patchSchema.parse(await request.json());
    return withChanges((tx, db) => {
      if (!db.majors.some((m) => m.id === id)) throw notFound("大項目が見つかりません");
      if (input.name && db.majors.some((m) => m.id !== id && m.name === input.name)) {
        throw badRequest("同じ名前の大項目が既にあります");
      }
      if (input.purposeId && !db.purposes.some((p) => p.id === input.purposeId)) {
        throw badRequest("使途が見つかりません");
      }
      return tx.update("majors", id, { ...input, updatedAt: now() });
    });
  });
}

export async function DELETE(_: Request, ctx: RouteContext<"/api/majors/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    await withChanges((tx, db) => {
      const major = db.majors.find((m) => m.id === id);
      if (!major) throw badRequest("大項目が見つかりません");
      if (major.isSystem) {
        throw badRequest("標準の大項目は削除できません。名前や色は変更できます。");
      }
      if (db.categories.some((c) => c.majorId === id)) {
        throw badRequest("中項目が残っています。先に中項目を移動または削除してください。");
      }
      tx.remove("majors", id);
    });
    return { deleted: true };
  });
}
