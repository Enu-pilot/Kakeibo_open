import { z } from "zod";
import { handle, badRequest } from "@/lib/api";
import { loadSnapshot, withChanges } from "@/lib/db/store";
import { makeTransactionViewer } from "@/lib/db/queries";
import { checkSplitRefs, createTransaction, validateSplits } from "@/lib/transactions";
import { filterTransactions, parseFilters } from "@/lib/filters";

export async function GET(request: Request) {
  return handle(async () => {
    const url = new URL(request.url);
    const filters = parseFilters(url.searchParams);
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const pageSize = Math.min(
      500,
      Math.max(1, Number(url.searchParams.get("pageSize") ?? 50)),
    );

    const db = await loadSnapshot();
    // 合計はカテゴリ条件に合う「内訳」だけを足す（filterTransactions 参照）
    const { transactions, sum } = filterTransactions(db, filters);
    const toView = makeTransactionViewer(db);

    return {
      items: transactions.slice((page - 1) * pageSize, page * pageSize).map(toView),
      total: transactions.length,
      page,
      pageSize,
      sum,
    };
  });
}

const splitSchema = z.object({
  categoryId: z.string().min(1),
  amount: z.number().refine((value) => value !== 0, "金額が 0 円です"),
  costTypeId: z.string().min(1).nullable().optional(),
});

const createSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日付を選んでください"),
  description: z.string().trim().min(1, "利用先を入力してください"),
  memo: z.string().trim().optional().nullable(),
  splits: z.array(splitSchema).min(1, "内訳を 1 件以上入力してください"),
  paymentMethodId: z.string().nullable().optional(),
  /** 帳尻合わせ（チャージ・振替）の移動先。残高移動として数えたいときに指定する。 */
  transferToId: z.string().nullable().optional(),
  allowDuplicate: z.boolean().optional(),
});

export async function POST(request: Request) {
  return handle(async () => {
    const input = createSchema.parse(await request.json());

    const invalid = validateSplits(input.splits);
    if (invalid) throw badRequest(invalid);

    const created = await withChanges((tx, db) => {
      const broken = checkSplitRefs(db, input.splits);
      if (broken) throw badRequest(broken);
      return createTransaction(
        tx,
        db,
        {
          date: input.date,
          description: input.description,
          memo: input.memo ?? null,
          splits: input.splits,
          paymentMethodId: input.paymentMethodId ?? null,
          transferToId: input.transferToId ?? null,
          source: "MANUAL",
        },
        { allowDuplicate: input.allowDuplicate },
      );
    });
    if (!created) {
      throw badRequest(
        "同じ日付・利用先・金額の明細が既に登録されています。重複を許可して登録することもできます。",
      );
    }
    return created;
  });
}
