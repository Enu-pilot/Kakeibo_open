import { z } from "zod";
import { handle, badRequest } from "@/lib/api";
import { withChanges } from "@/lib/db/store";

const schema = z.object({
  /** 並べ替え後の全件の id。渡された順に 0 から振り直す */
  ids: z.array(z.string().min(1)).min(1).max(100),
});

export async function POST(request: Request) {
  return handle(async () => {
    const { ids } = schema.parse(await request.json());
    return withChanges((tx, db) => {
      const known = new Set(db.purposes.map((p) => p.id));
      if (ids.some((id) => !known.has(id))) {
        throw badRequest("使途が見つかりません。画面を再読み込みしてください。");
      }
      ids.forEach((id, index) => tx.update("purposes", id, { sortOrder: index }));
      return { reordered: ids.length };
    });
  });
}
