import { z } from "zod";
import { handle, badRequest } from "@/lib/api";
import { now, withChanges } from "@/lib/db/store";

const schema = z.object({
  /** 同じ大項目に属する中項目の、並べ替え後の全件の id */
  ids: z.array(z.string().min(1)).min(1).max(500),
});

/**
 * 中項目の並び順をまとめて振り直す（大項目の並べ替えと同じ考え方）。
 * 1 回の書き込みにまとめるので、途中経過で順序が崩れることはない。
 */
export async function POST(request: Request) {
  return handle(async () => {
    const { ids } = schema.parse(await request.json());
    return withChanges((tx, db) => {
      const known = new Set(db.categories.map((c) => c.id));
      if (ids.some((id) => !known.has(id))) {
        throw badRequest("中項目が見つかりません。画面を再読み込みしてください。");
      }
      const timestamp = now();
      ids.forEach((id, index) => tx.update("categories", id, { sortOrder: index, updatedAt: timestamp }));
      return { reordered: ids.length };
    });
  });
}
