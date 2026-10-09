import { z } from "zod";
import { handle, badRequest } from "@/lib/api";
import { loadSnapshot, newId, now, withChanges } from "@/lib/db/store";
import { byOrderThenName } from "@/lib/db/queries";

/** 使途の一覧（アーカイブ済みは除く。並び順がダッシュボードの並び） */
export async function GET() {
  return handle(async () => (await loadSnapshot()).purposes.filter((p) => !p.archivedAt).sort(byOrderThenName));
}

const createSchema = z.object({
  name: z.string().trim().min(1, "使途の名前を入力してください"),
});

export async function POST(request: Request) {
  return handle(async () => {
    const { name } = createSchema.parse(await request.json());
    return withChanges((tx, db) => {
      const exists = db.purposes.find((p) => p.name === name);
      if (exists && !exists.archivedAt) throw badRequest("同じ名前の使途が既にあります");
      // 消した（アーカイブした）使途と同じ名前なら、作り直さずに戻す
      if (exists) return tx.update("purposes", exists.id, { archivedAt: null });
      return tx.insert("purposes", {
        id: newId(),
        name,
        sortOrder: Math.max(-1, ...db.purposes.map((p) => p.sortOrder)) + 1,
        openingBalance: 0,
        openingBalanceAt: null,
        archivedAt: null,
        createdAt: now(),
      });
    });
  });
}
