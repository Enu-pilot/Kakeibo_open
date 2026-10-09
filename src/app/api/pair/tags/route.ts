import { z } from "zod";
import { badRequest, handle } from "@/lib/api";
import { now, withChanges } from "@/lib/db/store";
import { PAIR_TAGS } from "@/lib/db/types";

const tagSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "明細を選んでください").max(2000),
  /** null なら区分を外す（未確認に戻す） */
  tag: z.enum(PAIR_TAGS).nullable(),
});

/**
 * 家計簿の明細に「二人の区分」（割り勘 / 自分だけ / 精算の記録）を付ける。
 * 「明細」タブの「二人の区分」列にだけ入り、金額・内訳・集計は変わらない。LINE ボットには見えない。
 */
export async function POST(request: Request) {
  return handle(async () => {
    const { ids, tag } = tagSchema.parse(await request.json());
    return withChanges((tx, db) => {
      const known = new Set(db.transactions.map((t) => t.id));
      const missing = ids.filter((id) => !known.has(id));
      if (missing.length > 0) throw badRequest("見つからない明細があります。画面を再読み込みしてください");
      const timestamp = now();
      for (const id of new Set(ids)) tx.update("transactions", id, { pairTag: tag ?? "", updatedAt: timestamp });
      return { updated: new Set(ids).size };
    });
  });
}
