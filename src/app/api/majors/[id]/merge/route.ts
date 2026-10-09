import { z } from "zod";
import { handle } from "@/lib/api";
import { loadFreshSnapshot, withChanges } from "@/lib/db/store";
import { applyMerge, planMerge } from "@/lib/merge-majors";

const mergeSchema = z.object({
  targetMajorId: z.string().min(1, "まとめ先の大項目を選んでください"),
  /** true なら何を動かすかだけを返し、書き込まない（確認用） */
  dryRun: z.boolean().optional(),
});

/** この大項目を、別の大項目にまとめる（中項目を名前で合わせて付け替え、この大項目はアーカイブする） */
export async function POST(request: Request, ctx: RouteContext<"/api/majors/[id]/merge">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const { targetMajorId, dryRun } = mergeSchema.parse(await request.json());
    if (dryRun) return planMerge(await loadFreshSnapshot(), id, targetMajorId);
    return withChanges((tx, db) => applyMerge(tx, db, id, targetMajorId));
  });
}
