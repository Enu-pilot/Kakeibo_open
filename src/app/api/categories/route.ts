import { z } from "zod";
import { handle, badRequest } from "@/lib/api";
import { loadSnapshot, newId, now, withChanges } from "@/lib/db/store";
import { majorsWithCategories } from "@/lib/db/queries";

/** 大項目 > 中項目のツリーを返す */
export async function GET() {
  return handle(async () => majorsWithCategories(await loadSnapshot()));
}

const createSchema = z.object({
  name: z.string().trim().min(1, "中項目名を入力してください"),
  majorId: z.string().min(1),
  sortOrder: z.number().int().optional(),
});

export async function POST(request: Request) {
  return handle(async () => {
    const input = createSchema.parse(await request.json());
    return withChanges((tx, db) => {
      if (!db.majors.some((m) => m.id === input.majorId)) throw badRequest("大項目が見つかりません");
      if (db.categories.some((c) => c.majorId === input.majorId && c.name === input.name)) {
        throw badRequest("同じ名前の中項目が既にあります");
      }
      const timestamp = now();
      return tx.insert("categories", {
        id: newId(),
        name: input.name,
        majorId: input.majorId,
        sortOrder: input.sortOrder ?? 0,
        archivedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });
  });
}
