import { z } from "zod";
import { handle, badRequest } from "@/lib/api";
import { withChanges } from "@/lib/db/store";

const schema = z.object({
  /** 並べ替え後の全件の id。渡された順に 0 から振り直す（クロス集計の列順になる） */
  ids: z.array(z.string().min(1)).min(1).max(200),
});

export async function POST(request: Request) {
  return handle(async () => {
    const { ids } = schema.parse(await request.json());
    return withChanges((tx, db) => {
      const known = new Set(db.costTypes.map((c) => c.id));
      if (ids.some((id) => !known.has(id))) {
        throw badRequest("費目が見つかりません。画面を再読み込みしてください。");
      }
      ids.forEach((id, index) => tx.update("costTypes", id, { sortOrder: index }));
      return { reordered: ids.length };
    });
  });
}
