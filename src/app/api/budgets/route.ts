import { z } from "zod";
import { handle, badRequest } from "@/lib/api";
import { newId, now, withChanges } from "@/lib/db/store";

const schema = z.object({
  categoryId: z.string().min(1),
  /** "YYYY-MM" ならその月だけ、null なら毎月の既定 */
  month: z.string().regex(/^\d{4}-\d{2}$/).nullable(),
  /** null で予算を外す。0 は「使わない」という予算として有効 */
  amount: z.number().min(0).nullable(),
  /**
   * 毎月の既定を保存するとき、この月の上書きも一緒に外す（"YYYY-MM"）。
   * 上書きが残っていると、既定を変えてもその月の表示が変わらず分かりにくいため
   */
  clearOverride: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

/** 中項目の予算を設定する（同じ中項目・同じ月の行があれば書き換える） */
export async function PUT(request: Request) {
  return handle(async () => {
    const input = schema.parse(await request.json());
    return withChanges((tx, db) => {
      if (!db.categories.some((c) => c.id === input.categoryId)) {
        throw badRequest("中項目が見つかりません。画面を再読み込みしてください。");
      }
      if (input.clearOverride && input.month === null) {
        for (const b of db.budgets) {
          if (b.categoryId === input.categoryId && b.month === input.clearOverride) {
            tx.remove("budgets", b.id);
          }
        }
      }
      const existing = db.budgets.filter(
        (b) => b.categoryId === input.categoryId && b.month === input.month,
      );
      if (input.amount === null) {
        for (const b of existing) tx.remove("budgets", b.id);
        return { removed: existing.length };
      }
      const [first, ...extra] = existing;
      // スプレッドシートで同じ行を重ねて作ってしまっていた場合は、1 行にまとめる
      for (const b of extra) tx.remove("budgets", b.id);
      if (first) return tx.update("budgets", first.id, { amount: input.amount, updatedAt: now() });
      const timestamp = now();
      return tx.insert("budgets", {
        id: newId(),
        categoryId: input.categoryId,
        month: input.month,
        amount: input.amount,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });
  });
}
