import { z } from "zod";
import { handle, badRequest } from "@/lib/api";
import { now, withChanges } from "@/lib/db/store";

const schema = z.object({
  /** 並べ替え後の全件の id。渡された順に 0 から振り直す。 */
  ids: z.array(z.string().min(1)).min(1).max(500),
});

/**
 * 大項目の並び順をまとめて振り直す。
 * まとめ表のブロック順がこの並び順なので、1 件ずつ更新すると途中経過で順序が崩れる。
 * そのため全件の並びを受け取り、1 回の書き込みで振り直す。
 */
export async function POST(request: Request) {
  return handle(async () => {
    const { ids } = schema.parse(await request.json());
    return withChanges((tx, db) => {
      const known = new Set(db.majors.map((m) => m.id));
      if (ids.some((id) => !known.has(id))) {
        throw badRequest("大項目が見つかりません。画面を再読み込みしてください。");
      }
      const timestamp = now();
      ids.forEach((id, index) => tx.update("majors", id, { sortOrder: index, updatedAt: timestamp }));
      return { reordered: ids.length };
    });
  });
}
