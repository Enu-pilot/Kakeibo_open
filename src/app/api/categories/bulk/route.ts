import { z } from "zod";
import { handle } from "@/lib/api";
import { newId, now, withChanges } from "@/lib/db/store";
import { applyBulkCategories } from "@/lib/bulk-categories";
import { KIND_META } from "@/lib/category-kind";
import { CATEGORY_KINDS } from "@/lib/db/types";

const schema = z.object({
  majors: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        kind: z.enum(CATEGORY_KINDS),
        categories: z.array(z.string().trim().min(1)).max(500),
      }),
    )
    .min(1, "作成する項目がありません")
    .max(100),
});

/**
 * まとめシートの項目一覧から、大項目・中項目をまとめて作る。
 * 中身は `applyBulkCategories`。作成はすべて 1 回の書き込みにまとめるので、
 * 途中で失敗しても一部の項目だけができる、ということは起きない。
 */
export async function POST(request: Request) {
  return handle(async () => {
    const { majors } = schema.parse(await request.json());

    return withChanges((tx, db) => {
      const timestamp = now();
      // 同じ書き込みの中で作った大項目も、続く中項目の作成で見えるようにする
      const createdMajors: typeof db.majors = [];
      return applyBulkCategories(
        {
          listMajors: async () => [...db.majors, ...createdMajors],
          createMajor: async (data) => {
            const major = tx.insert("majors", {
              id: newId(),
              name: data.name,
              kind: data.kind,
              color: KIND_META[data.kind].color,
              sortOrder: data.sortOrder,
              isSystem: false,
              purposeId: null,
              archivedAt: null,
              createdAt: timestamp,
              updatedAt: timestamp,
            });
            createdMajors.push(major);
            return major;
          },
          listCategories: async (majorIds) =>
            db.categories.filter((c) => majorIds.includes(c.majorId)),
          createCategories: async (rows) => {
            for (const row of rows) {
              tx.insert("categories", {
                id: newId(),
                name: row.name,
                majorId: row.majorId,
                sortOrder: row.sortOrder,
                archivedAt: null,
                createdAt: timestamp,
                updatedAt: timestamp,
              });
            }
          },
          restoreCategories: async (ids) => {
            for (const id of ids) tx.update("categories", id, { archivedAt: null, updatedAt: timestamp });
          },
        },
        majors,
      );
    });
  });
}
