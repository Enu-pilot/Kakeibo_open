import { z } from "zod";
import { handle, notFound, badRequest } from "@/lib/api";
import { newId, now, withChanges } from "@/lib/db/store";
import { makeTransactionViewer } from "@/lib/db/queries";
import {
  checkSplitRefs,
  deleteTransaction,
  recomputeDedupeHash,
  sumSplits,
  validateSplits,
} from "@/lib/transactions";
import { learnFromCorrection } from "@/lib/learn";

const splitSchema = z.object({
  categoryId: z.string().min(1),
  amount: z.number().refine((value) => value !== 0, "金額が 0 円です"),
  costTypeId: z.string().min(1).nullable().optional(),
});

const patchSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  description: z.string().trim().min(1).optional(),
  memo: z.string().trim().nullable().optional(),
  /** 渡されたときは内訳をまるごと置き換える */
  splits: z.array(splitSchema).min(1).optional(),
  paymentMethodId: z.string().nullable().optional(),
  /** 帳尻合わせ（チャージ・振替）の移動先 */
  transferToId: z.string().nullable().optional(),
  /** カテゴリ変更をルールとして学習するか（既定: する） */
  learn: z.boolean().optional(),
});

export async function PATCH(request: Request, ctx: RouteContext<"/api/transactions/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const input = patchSchema.parse(await request.json());

    if (input.splits) {
      const invalid = validateSplits(input.splits);
      if (invalid) throw badRequest(invalid);
    }

    return withChanges((tx, db) => {
      const current = db.transactions.find((t) => t.id === id);
      if (!current) throw notFound("明細が見つかりません");
      const broken = input.splits ? checkSplitRefs(db, input.splits) : null;
      if (broken) throw badRequest(broken);
      const currentSplits = db.splits
        .filter((s) => s.transactionId === id)
        .sort((a, b) => a.sortOrder - b.sortOrder);

      const next = {
        date: input.date ?? current.date,
        description: input.description ?? current.description,
        amount: input.splits ? sumSplits(input.splits) : current.amount,
        paymentMethodId:
          input.paymentMethodId !== undefined ? input.paymentMethodId : current.paymentMethodId,
      };

      const identityChanged =
        next.date !== current.date ||
        next.amount !== current.amount ||
        next.description !== current.description ||
        next.paymentMethodId !== current.paymentMethodId;

      // 内訳は差分更新せず、渡された内容で置き換える。
      // 件数が増減するため、1 件ずつ突き合わせるより単純で取りこぼしがない。
      if (input.splits) {
        for (const split of currentSplits) tx.remove("splits", split.id);
        input.splits.forEach((split, index) => {
          tx.insert("splits", {
            id: newId(),
            transactionId: id,
            categoryId: split.categoryId,
            amount: split.amount,
            sortOrder: index,
            costTypeId: split.costTypeId ?? null,
          });
        });
      }

      tx.update("transactions", id, {
        ...next,
        memo: input.memo !== undefined ? input.memo : current.memo,
        ...(input.transferToId !== undefined ? { transferToId: input.transferToId } : {}),
        ...(identityChanged ? { dedupeHash: recomputeDedupeHash(db, id, next) } : {}),
        updatedAt: now(),
      });

      // 主たる内訳のカテゴリを手で直したら、その利用先を次回から自動分類できるよう覚える。
      // 分割した明細は「どちらを覚えるか」が決まらないため学習しない。
      const before = currentSplits[0]?.categoryId;
      const after = input.splits?.[0]?.categoryId;
      if (
        input.splits?.length === 1 &&
        currentSplits.length === 1 &&
        after &&
        after !== before &&
        input.learn !== false
      ) {
        learnFromCorrection(tx, db, next.description, after);
      }

      const updated = db.transactions.find((t) => t.id === id)!;
      return makeTransactionViewer(db)(updated);
    });
  });
}

export async function DELETE(_: Request, ctx: RouteContext<"/api/transactions/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    await withChanges((tx, db) => {
      if (!db.transactions.some((t) => t.id === id)) throw notFound("明細が見つかりません");
      deleteTransaction(tx, db, id);
    });
    return { deleted: true };
  });
}
