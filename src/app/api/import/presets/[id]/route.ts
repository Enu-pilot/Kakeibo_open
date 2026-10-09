import { handle, notFound } from "@/lib/api";
import { withChanges } from "@/lib/db/store";

export async function DELETE(_: Request, ctx: RouteContext<"/api/import/presets/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    await withChanges((tx, db) => {
      if (!db.presets.some((p) => p.id === id)) throw notFound("プリセットが見つかりません");
      tx.remove("presets", id);
    });
    return { deleted: true };
  });
}
