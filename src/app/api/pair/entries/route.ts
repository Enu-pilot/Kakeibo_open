import { handle } from "@/lib/api";
import { withChanges } from "@/lib/db/store";
import { createPairEntry } from "@/lib/pair-household";
import { pairEntrySchema } from "@/app/api/pair/schema";

/**
 * 二人の明細を 1 件登録し、本体の家計簿（明細・内訳）にも同じ規則で書く。
 * 本体に書けなかったとき（書き込み先が無いなど）は明細だけ登録し、warning で知らせる。
 */
export async function POST(request: Request) {
  return handle(async () => {
    const input = pairEntrySchema.parse(await request.json());
    return withChanges((tx, db) => createPairEntry(tx, db, input));
  });
}
