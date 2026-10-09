import { z } from "zod";
import { handle, badRequest } from "@/lib/api";
import { loadSnapshot, newId, now, withChanges } from "@/lib/db/store";
import { categoryResolver } from "@/lib/db/queries";
import { MATCH_TYPES } from "@/lib/db/types";

export async function GET() {
  return handle(async () => {
    const db = await loadSnapshot();
    const resolve = categoryResolver(db);
    const costTypes = new Map(db.costTypes.map((c) => [c.id, c]));
    return [...db.rules]
      .sort((a, b) => a.priority - b.priority || a.keyword.localeCompare(b.keyword, "ja"))
      .map((rule) => {
        const found = rule.categoryId ? resolve(rule.categoryId) : null;
        return {
          ...rule,
          categoryName: rule.categoryId ? (found?.category.name ?? "（不明な中項目）") : null,
          majorName: rule.categoryId ? (found?.major.name ?? "不明") : null,
          costTypeName: rule.costTypeId ? (costTypes.get(rule.costTypeId)?.name ?? "（不明な費目）") : null,
        };
      });
  });
}

const createSchema = z.object({
  keyword: z.string().trim().min(1, "キーワードを入力してください"),
  matchType: z.enum(MATCH_TYPES).default("CONTAINS"),
  /** 中項目・費目のどちらか一方は必須（両方でもよい） */
  categoryId: z.string().min(1).nullable().optional(),
  costTypeId: z.string().min(1).nullable().optional(),
  priority: z.number().int().min(0).max(999).default(100),
});

export async function POST(request: Request) {
  return handle(async () => {
    const input = createSchema.parse(await request.json());
    if (!input.categoryId && !input.costTypeId) {
      throw badRequest("振り分け先の中項目か費目を選んでください");
    }
    if (input.matchType === "REGEX") {
      try {
        new RegExp(input.keyword);
      } catch {
        throw badRequest("正規表現として解釈できません");
      }
    }
    return withChanges((tx, db) => {
      if (db.rules.some((r) => r.keyword === input.keyword && r.matchType === input.matchType)) {
        throw badRequest("同じキーワード・マッチ方式のルールが既にあります");
      }
      if (input.categoryId && !db.categories.some((c) => c.id === input.categoryId)) {
        throw badRequest("中項目が見つかりません。画面を再読み込みしてください。");
      }
      if (input.costTypeId && !db.costTypes.some((c) => c.id === input.costTypeId)) {
        throw badRequest("費目が見つかりません。画面を再読み込みしてください。");
      }
      const timestamp = now();
      return tx.insert("rules", {
        id: newId(),
        keyword: input.keyword,
        matchType: input.matchType,
        categoryId: input.categoryId ?? null,
        costTypeId: input.costTypeId ?? null,
        priority: input.priority,
        isLearned: false,
        enabled: true,
        hitCount: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });
  });
}
