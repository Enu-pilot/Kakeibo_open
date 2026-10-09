import { z } from "zod";
import { PAIR_ROLES, SHARE_MODES } from "@/lib/db/types";

/** 二人の明細の入力。登録ではすべて必須（費目・中項目・決済手段・メモは任意）、修正では送ったものだけ変える */
export const pairEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日付を選んでください"),
  description: z.string().trim().min(1, "内容を入れてください").max(100),
  amount: z.number().int("金額は円単位で入れてください").positive("金額は 1 円以上で入れてください"),
  payer: z.enum(PAIR_ROLES),
  mode: z.enum(SHARE_MODES),
  ownerShare: z.number().int().min(0).nullable().optional(),
  costTypeId: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  methodId: z.string().nullable().optional(),
  memo: z.string().max(200).nullable().optional(),
});
