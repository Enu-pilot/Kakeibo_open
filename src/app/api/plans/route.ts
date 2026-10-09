import { z } from "zod";
import { handle } from "@/lib/api";
import { newId, now, withChanges } from "@/lib/db/store";
import { planFields, validatePlan } from "@/lib/plan-input";

const schema = z.object({
  ...planFields,
  paymentMethodId: planFields.paymentMethodId.default(null),
  transferToId: planFields.transferToId.default(null),
  startMonth: planFields.startMonth.default(null),
  endMonth: planFields.endMonth.default(null),
  enabled: planFields.enabled.default(true),
  memo: planFields.memo.default(null),
});

/** 毎月の予定（給料・家賃など）を追加する */
export async function POST(request: Request) {
  return handle(async () => {
    const input = schema.parse(await request.json());
    return withChanges((tx, db) => {
      validatePlan(db, input);
      const timestamp = now();
      return tx.insert("plans", {
        id: newId(),
        ...input,
        memo: input.memo || null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });
  });
}
