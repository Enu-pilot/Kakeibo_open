import { z } from "zod";
import { badRequest } from "@/lib/api";
import type { Snapshot } from "@/lib/db/store";

const month = z.string().regex(/^\d{4}-\d{2}$/, "月は YYYY-MM の形で入力してください");

/** 予定の入力（追加・変更で共通） */
export const planFields = {
  name: z.string().trim().min(1, "名前を入力してください"),
  categoryId: z.string().min(1, "中項目を選んでください"),
  amount: z.number().positive("金額は 1 以上で入力してください"),
  day: z.number().int().min(1).max(31),
  paymentMethodId: z.string().nullable(),
  transferToId: z.string().nullable(),
  startMonth: month.nullable(),
  endMonth: month.nullable(),
  enabled: z.boolean(),
  memo: z.string().trim().nullable(),
};

/** 参照先と期間の食い違いを弾く */
export function validatePlan(
  db: Snapshot,
  plan: {
    categoryId: string;
    paymentMethodId: string | null;
    transferToId: string | null;
    startMonth: string | null;
    endMonth: string | null;
  },
) {
  if (!db.categories.some((c) => c.id === plan.categoryId)) {
    throw badRequest("中項目が見つかりません。画面を再読み込みしてください。");
  }
  for (const id of [plan.paymentMethodId, plan.transferToId]) {
    if (id && !db.paymentMethods.some((m) => m.id === id)) {
      throw badRequest("決済手段が見つかりません。画面を再読み込みしてください。");
    }
  }
  if (plan.transferToId && plan.transferToId === plan.paymentMethodId) {
    throw badRequest("移動元と移動先が同じです。");
  }
  if (plan.startMonth && plan.endMonth && plan.startMonth > plan.endMonth) {
    throw badRequest("開始月が終了月より後になっています。");
  }
}
