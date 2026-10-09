import { z } from "zod";
import { handle, notFound } from "@/lib/api";
import { now, withChanges } from "@/lib/db/store";
import { planFields, validatePlan } from "@/lib/plan-input";

const patchSchema = z.object(planFields).partial();

export async function PATCH(request: Request, ctx: RouteContext<"/api/plans/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const input = patchSchema.parse(await request.json());
    return withChanges((tx, db) => {
      const current = db.plans.find((p) => p.id === id);
      if (!current) throw notFound("予定が見つかりません");
      validatePlan(db, { ...current, ...input });
      return tx.update("plans", id, {
        ...input,
        ...(input.memo !== undefined ? { memo: input.memo || null } : {}),
        updatedAt: now(),
      });
    });
  });
}

export async function DELETE(_: Request, ctx: RouteContext<"/api/plans/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    await withChanges((tx, db) => {
      if (!db.plans.some((p) => p.id === id)) throw notFound("予定が見つかりません");
      tx.remove("plans", id);
    });
    return { deleted: true };
  });
}
