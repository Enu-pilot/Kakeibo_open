import { z } from "zod";
import { handle, badRequest } from "@/lib/api";
import { loadSnapshot, newId, now, withChanges } from "@/lib/db/store";
import { billingSourceSchema, readBillingSource } from "@/lib/billing-source";
import { planSheetImport } from "@/lib/sheet-import";
import { inferPaymentKind } from "@/lib/inflow";
import { KIND_META } from "@/lib/category-kind";
import { createTransaction, dedupeIndex } from "@/lib/transactions";
import { normalizeDescription } from "@/lib/normalize";

/** 1 回に取り込める上限。多すぎるときは期間を区切ってもらう（1 回の書き込みの大きさを抑えるため） */
const MAX_ROWS = 10_000;

const month = z.string().regex(/^\d{4}-\d{2}$/).nullable().default(null);

const schema = z.object({
  source: billingSourceSchema,
  options: z.object({
    fromMonth: month,
    toMonth: month,
    createMissingCategories: z.boolean().default(true),
    newCategoryMajorId: z.string().nullable().default(null),
  }),
  /** true なら書き込まずに、取り込む件数などの見込みだけを返す */
  dryRun: z.boolean().default(true),
});

/**
 * 請求シートの明細をアプリのデータ（スプレッドシート）に取り込む。
 *
 * - 請求シートはサーバーで読み直す（画面から送られた行は信用しない）
 * - 取り込みは 1 回の書き込みで行うので、途中で失敗しても一部だけ入ることはない
 * - 取込履歴に 1 件として残るので、「取込」画面からまとめて取り消せる
 * - もう一度取り込んでも、取り込み済みの行は増えない
 */
export async function POST(request: Request) {
  return handle(async () => {
    const input = schema.parse(await request.json());
    if (input.options.fromMonth && input.options.toMonth && input.options.fromMonth > input.options.toMonth) {
      throw badRequest("開始月が終了月より後になっています。");
    }
    const { blocks } = await readBillingSource(input.source);
    const requireMajor = (db: { majors: { id: string; archivedAt: string | null }[] }) => {
      if (input.options.createMissingCategories && !db.majors.some((m) => m.id === input.options.newCategoryMajorId && !m.archivedAt)) {
        throw badRequest("新しい中項目を入れる大項目を選んでください。");
      }
    };

    if (input.dryRun) {
      const db = await loadSnapshot();
      requireMajor(db);
      return planSheetImport(db, blocks, input.options).summary;
    }

    return withChanges((tx, db) => {
      requireMajor(db);
      // 書き込む直前の最新の状態で計画し直す（プレビューの後に別の取り込みがあっても重ならない）
      const { rows, summary } = planSheetImport(db, blocks, input.options);
      if (rows.length === 0) throw badRequest("取り込む明細がありません（すべて取り込み済みか、期間の外です）。");
      if (rows.length > MAX_ROWS) {
        throw badRequest(`一度に取り込めるのは ${MAX_ROWS.toLocaleString("ja-JP")} 件までです。期間を区切ってください。`);
      }
      const timestamp = now();

      // 足りない決済手段（ブロック名）を作る
      const methodIdByName = new Map(db.paymentMethods.map((m) => [normalizeDescription(m.name), m.id]));
      let methodOrder = Math.max(0, ...db.paymentMethods.map((m) => m.sortOrder)) + 1;
      for (const name of summary.newPaymentMethods) {
        const kind = inferPaymentKind(name);
        const created = tx.insert("paymentMethods", {
          id: newId(),
          name,
          kind,
          sortOrder: methodOrder++,
          trackBalance: kind !== "CARD",
          openingBalance: 0,
          openingBalanceAt: null,
          archivedAt: null,
          createdAt: timestamp,
        });
        methodIdByName.set(normalizeDescription(name), created.id);
      }

      // 収入の受け皿の大項目（収入内訳）が要るなら作る。隠してあれば戻す
      const majorIdByName = new Map<string, string>();
      for (const name of summary.newMajors) {
        const hidden = db.majors.find((m) => m.name === name && m.kind === "INCOME");
        if (hidden) {
          tx.update("majors", hidden.id, { archivedAt: null, updatedAt: timestamp });
          majorIdByName.set(name, hidden.id);
          continue;
        }
        const created = tx.insert("majors", {
          id: newId(),
          name,
          kind: "INCOME",
          color: KIND_META.INCOME.color,
          sortOrder: Math.max(0, ...db.majors.map((m) => m.sortOrder)) + 1,
          isSystem: false,
          purposeId: null,
          archivedAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        majorIdByName.set(name, created.id);
      }

      // 足りない中項目（使用先・入金の行き先）を作る。同じ大項目に隠した同名があれば戻す
      const categoryIdByKey = new Map<string, string>();
      const nextOrder = new Map<string, number>();
      for (const row of rows) {
        if (!row.newCategory) continue;
        const majorId = row.newCategory.majorId ?? majorIdByName.get(row.newCategory.majorName);
        if (!majorId) continue;
        const key = `${majorId}\u0000${row.newCategory.name}`;
        if (categoryIdByKey.has(key)) continue;
        const hidden = db.categories.find((c) => c.majorId === majorId && c.name === row.newCategory!.name);
        if (hidden) {
          tx.update("categories", hidden.id, { archivedAt: null, updatedAt: timestamp });
          categoryIdByKey.set(key, hidden.id);
          continue;
        }
        const order =
          nextOrder.get(majorId) ??
          Math.max(-1, ...db.categories.filter((c) => c.majorId === majorId).map((c) => c.sortOrder)) + 1;
        nextOrder.set(majorId, order + 1);
        const created = tx.insert("categories", {
          id: newId(),
          name: row.newCategory.name,
          majorId,
          sortOrder: order,
          archivedAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        categoryIdByKey.set(key, created.id);
      }
      const categoryIdOf = (row: (typeof rows)[number]) => {
        if (row.categoryId) return row.categoryId;
        if (!row.newCategory) return undefined;
        const majorId = row.newCategory.majorId ?? majorIdByName.get(row.newCategory.majorName);
        return categoryIdByKey.get(`${majorId}\u0000${row.newCategory.name}`);
      };

      const label = "text" in input.source ? "貼り付け" : input.source.sheet.range;
      const batch = tx.insert("batches", {
        id: newId(),
        fileName: `請求シート（${label}）`,
        presetName: null,
        importedCount: 0,
        skippedCount: 0,
        createdAt: timestamp,
      });

      // 同じ内容の行は連番を振って別の明細にする（同じ日に同じ運賃を 2 回払った、など）
      const hashes = dedupeIndex(db);
      let imported = 0;
      for (const row of rows) {
        const categoryId = categoryIdOf(row);
        if (!categoryId) continue;
        const created = createTransaction(
          tx,
          db,
          {
            date: row.date,
            description: row.description,
            memo: null,
            splits: [{ categoryId, amount: row.amount, costTypeId: row.costTypeId }],
            paymentMethodId: methodIdByName.get(normalizeDescription(row.paymentMethodName)) ?? null,
            source: "SHEET",
            importBatchId: batch.id,
          },
          { allowDuplicate: true, hashes },
        );
        if (created) imported++;
      }
      tx.update("batches", batch.id, { importedCount: imported, skippedCount: summary.alreadyInApp });

      return {
        batchId: batch.id,
        imported,
        alreadyInApp: summary.alreadyInApp,
        newCategories: summary.newCategories,
        newMajors: summary.newMajors,
        newPaymentMethods: summary.newPaymentMethods,
      };
    });
  });
}
