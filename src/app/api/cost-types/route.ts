import { z } from "zod";
import { handle, badRequest } from "@/lib/api";
import { loadSnapshot, newId, now, withChanges } from "@/lib/db/store";
import { activeCostTypes, toCostTypeView } from "@/lib/db/queries";

/** 費目の一覧（アーカイブ済みは除く。並び順はクロス集計の列の順） */
export async function GET() {
  return handle(async () => activeCostTypes(await loadSnapshot()).map(toCostTypeView));
}

const createSchema = z.object({
  name: z.string().trim().min(1, "費目名を入力してください"),
});

export async function POST(request: Request) {
  return handle(async () => {
    const { name } = createSchema.parse(await request.json());
    return withChanges((tx, db) => {
      const exists = db.costTypes.find((c) => c.name === name);
      if (exists && !exists.archivedAt) throw badRequest("同じ名前の費目が既にあります");
      // 消した（アーカイブした）費目と同じ名前なら、作り直さずに戻す
      if (exists) return tx.update("costTypes", exists.id, { archivedAt: null });
      return tx.insert("costTypes", {
        id: newId(),
        name,
        sortOrder: Math.max(-1, ...db.costTypes.map((c) => c.sortOrder)) + 1,
        archivedAt: null,
        createdAt: now(),
      });
    });
  });
}
