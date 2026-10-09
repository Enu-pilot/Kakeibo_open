import { z } from "zod";
import { handle } from "@/lib/api";
import { withChanges } from "@/lib/db/store";
import { setPairEntriesCategory } from "@/lib/pair-household";

const schema = z.object({
  ids: z.array(z.string().min(1)).min(1, "明細を選んでください").max(1000),
  /** 大項目「パートナー」配下の中項目。null で既定に戻す */
  categoryId: z.string().min(1).nullable(),
});

/** 二人の明細の中項目（イベント）をまとめて付ける */
export async function POST(request: Request) {
  return handle(async () => {
    const { ids, categoryId } = schema.parse(await request.json());
    return withChanges((tx, db) => setPairEntriesCategory(tx, db, ids, categoryId));
  });
}
