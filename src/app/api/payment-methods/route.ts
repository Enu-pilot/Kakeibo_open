import { z } from "zod";
import { handle, badRequest } from "@/lib/api";
import { loadSnapshot, newId, now, withChanges } from "@/lib/db/store";
import { activePaymentMethods } from "@/lib/db/queries";

export async function GET() {
  return handle(async () => activePaymentMethods(await loadSnapshot()));
}

const createSchema = z.object({
  name: z.string().trim().min(1, "決済手段名を入力してください"),
  kind: z.enum(["CARD", "EMONEY", "CASH", "BANK"]).default("CARD"),
  sortOrder: z.number().int().optional(),
});

export async function POST(request: Request) {
  return handle(async () => {
    const input = createSchema.parse(await request.json());
    return withChanges((tx, db) => {
      if (db.paymentMethods.some((m) => m.name === input.name)) {
        throw badRequest("同じ名前の決済手段が既にあります");
      }
      return tx.insert("paymentMethods", {
        id: newId(),
        name: input.name,
        kind: input.kind,
        sortOrder: input.sortOrder ?? 0,
        // 口座・現金・電子マネーは残高そのものなので既定で追う。
        // カードは残高ではなく利用額なので追わない。
        trackBalance: input.kind !== "CARD",
        openingBalance: 0,
        openingBalanceAt: null,
        archivedAt: null,
        createdAt: now(),
      });
    });
  });
}
