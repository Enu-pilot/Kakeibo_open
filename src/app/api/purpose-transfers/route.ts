import { z } from "zod";
import { handle, badRequest } from "@/lib/api";
import { loadSnapshot, newId, now, withChanges } from "@/lib/db/store";

/** 使途の振替の一覧（新しい順） */
export async function GET() {
  return handle(async () =>
    [...(await loadSnapshot()).purposeTransfers].sort(
      (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
    ),
  );
}

const createSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日付を選んでください"),
  fromPurposeId: z.string().min(1, "振替元を選んでください"),
  toPurposeId: z.string().min(1, "振替先を選んでください"),
  amount: z.number().finite().positive("金額は 1 円以上で入力してください"),
  memo: z.string().trim().max(200).nullable().optional(),
});

/** 使途の間でお金を回す（個人 → 投資 など）。口座の残高は変わらず、使途の残高だけが動く */
export async function POST(request: Request) {
  return handle(async () => {
    const input = createSchema.parse(await request.json());
    if (input.fromPurposeId === input.toPurposeId) throw badRequest("振替元と振替先が同じです");
    return withChanges((tx, db) => {
      const active = new Set(db.purposes.filter((p) => !p.archivedAt).map((p) => p.id));
      if (!active.has(input.fromPurposeId) || !active.has(input.toPurposeId)) {
        throw badRequest("使途が見つかりません。画面を再読み込みしてください。");
      }
      return tx.insert("purposeTransfers", {
        id: newId(),
        date: input.date,
        fromPurposeId: input.fromPurposeId,
        toPurposeId: input.toPurposeId,
        amount: Math.round(input.amount * 100) / 100,
        memo: input.memo || null,
        createdAt: now(),
      });
    });
  });
}
