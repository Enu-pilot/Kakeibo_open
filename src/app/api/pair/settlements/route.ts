import { z } from "zod";
import { handle } from "@/lib/api";
import { withChanges } from "@/lib/db/store";
import { settlePair } from "@/lib/pair-household";

const settleSchema = z.object({
  ids: z.array(z.string()).min(1, "精算する明細を選んでください").optional(),
  amount: z.number().int().min(0, "精算額は 0 円以上で入れてください").nullable().optional(),
  methodId: z.string().nullable().optional(),
  memo: z.string().max(200).nullable().optional(),
});

/** 未精算の明細をまとめて精算する。本体には口座間の移動（と、金額を直した差）として書く */
export async function POST(request: Request) {
  return handle(async () => {
    const input = settleSchema.parse(await request.json());
    return withChanges((tx, db) => settlePair(tx, db, input));
  });
}
