import { z } from "zod";
import { handle, badRequest } from "@/lib/api";
import { newId, now, withChanges } from "@/lib/db/store";
import { checkSplitRefs, createTransaction, dedupeIndex, validateSplits } from "@/lib/transactions";

const splitSchema = z.object({
  categoryId: z.string().min(1),
  amount: z.number().refine((value) => value !== 0, "金額が 0 円です"),
  costTypeId: z.string().min(1).nullable().optional(),
});

const rowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().trim().min(1),
  memo: z.string().nullable().optional(),
  /** 個人支出ぶん・生活費ぶんのように、1 行を複数の大項目へ分けられる */
  splits: z.array(splitSchema).min(1),
  paymentMethodId: z.string().nullable().optional(),
});

const schema = z.object({
  fileName: z.string().default("import.csv"),
  presetName: z.string().nullable().optional(),
  rows: z.array(rowSchema).min(1, "取り込む行がありません").max(5000),
  /** 重複判定に引っかかった行も強制的に登録する */
  allowDuplicate: z.boolean().default(false),
});

/**
 * CSV の取り込みを確定する。
 * 全行を 1 回の書き込みにまとめるので、途中で失敗しても一部の行だけが入ることはない。
 */
export async function POST(request: Request) {
  return handle(async () => {
    const input = schema.parse(await request.json());

    for (const row of input.rows) {
      const invalid = validateSplits(row.splits);
      if (invalid) throw badRequest(`${row.description}: ${invalid}`);
    }

    return withChanges((tx, db) => {
      const broken = checkSplitRefs(db, input.rows.flatMap((row) => row.splits));
      if (broken) throw badRequest(broken);

      const batch = tx.insert("batches", {
        id: newId(),
        fileName: input.fileName,
        presetName: input.presetName ?? null,
        importedCount: 0,
        skippedCount: 0,
        createdAt: now(),
      });

      // 同じ CSV の中の重複も見つけられるよう、判定キーの集合は 1 つを使い回す
      const hashes = dedupeIndex(db);
      let imported = 0;
      const skipped: { description: string; date: string }[] = [];

      for (const row of input.rows) {
        const created = createTransaction(
          tx,
          db,
          {
            date: row.date,
            description: row.description,
            memo: row.memo ?? null,
            splits: row.splits,
            paymentMethodId: row.paymentMethodId ?? null,
            source: "CSV",
            importBatchId: batch.id,
          },
          { allowDuplicate: input.allowDuplicate, hashes },
        );
        if (created) imported++;
        else skipped.push({ description: row.description, date: row.date });
      }

      tx.update("batches", batch.id, { importedCount: imported, skippedCount: skipped.length });

      return { batchId: batch.id, imported, skipped: skipped.length, skippedRows: skipped };
    });
  });
}
