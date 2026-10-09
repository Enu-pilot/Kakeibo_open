import { z } from "zod";
import { handle, badRequest, notFound } from "@/lib/api";
import { now, withChanges } from "@/lib/db/store";

const patchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  kind: z.enum(["CARD", "EMONEY", "CASH", "BANK"]).optional(),
  sortOrder: z.number().int().optional(),
  /** 残高を追う対象にするか */
  trackBalance: z.boolean().optional(),
  /** 起点残高。マイナス残高（借越）もありうるので符号は制限しない。 */
  openingBalance: z.number().optional(),
  /** 起点残高の基準日。null にすると全期間の明細を対象にする。 */
  openingBalanceAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/payment-methods/[id]">,
) {
  return handle(async () => {
    const { id } = await ctx.params;
    const input = patchSchema.parse(await request.json());
    return withChanges((tx, db) => {
      if (!db.paymentMethods.some((m) => m.id === id)) throw notFound("決済手段が見つかりません");
      if (input.name && db.paymentMethods.some((m) => m.id !== id && m.name === input.name)) {
        throw badRequest("同じ名前の決済手段が既にあります");
      }
      return tx.update("paymentMethods", id, input);
    });
  });
}

export async function DELETE(_: Request, ctx: RouteContext<"/api/payment-methods/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    return withChanges((tx, db) => {
      if (!db.paymentMethods.some((m) => m.id === id)) throw notFound("決済手段が見つかりません");
      // 移動先としてだけ使われている決済手段も、消すと過去の残高移動が壊れる
      const used = db.transactions.filter(
        (t) => t.paymentMethodId === id || t.transferToId === id,
      ).length;
      if (used > 0) {
        tx.update("paymentMethods", id, { archivedAt: now() });
        return { archived: true, transactions: used };
      }
      tx.remove("paymentMethods", id);
      return { deleted: true };
    });
  });
}
