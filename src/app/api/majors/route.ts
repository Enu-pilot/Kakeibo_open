import { z } from "zod";
import { handle, badRequest } from "@/lib/api";
import { newId, now, withChanges } from "@/lib/db/store";
import { CATEGORY_KINDS } from "@/lib/db/types";

const createSchema = z.object({
  name: z.string().trim().min(1, "大項目名を入力してください"),
  kind: z.enum(CATEGORY_KINDS),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "色は #rrggbb 形式で指定してください")
    .optional(),
  sortOrder: z.number().int().optional(),
  /** 使途。省略・null なら未設定 */
  purposeId: z.string().min(1).nullable().optional(),
});

export async function POST(request: Request) {
  return handle(async () => {
    const input = createSchema.parse(await request.json());
    return withChanges((tx, db) => {
      if (db.majors.some((m) => m.name === input.name)) {
        throw badRequest("同じ名前の大項目が既にあります");
      }
      if (input.purposeId && !db.purposes.some((p) => p.id === input.purposeId)) {
        throw badRequest("使途が見つかりません");
      }
      const timestamp = now();
      return tx.insert("majors", {
        id: newId(),
        name: input.name,
        kind: input.kind,
        color: input.color ?? "#767676",
        sortOrder: input.sortOrder ?? 0,
        isSystem: false,
        purposeId: input.purposeId ?? null,
        archivedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });
  });
}
