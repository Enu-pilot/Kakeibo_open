import { z } from "zod";
import { handle } from "@/lib/api";
import { loadSnapshot } from "@/lib/db/store";
import { classify, classifyCostType } from "@/lib/rules";

const schema = z.object({
  descriptions: z.array(z.string()).max(5000),
});

/**
 * 取込プレビュー用。利用先の一覧を受け取り、ルールで決まる中項目と費目を返す。
 * 中項目と費目は別々に判定する（費目だけのルールでも費目は付く）。
 */
export async function POST(request: Request) {
  return handle(async () => {
    const { descriptions } = schema.parse(await request.json());
    const db = await loadSnapshot();
    const rules = db.rules.filter((r) => r.enabled);

    const matches: Record<string, string | null> = {};
    const costTypes: Record<string, string | null> = {};
    for (const description of new Set(descriptions)) {
      matches[description] = classify(description, rules)?.categoryId ?? null;
      costTypes[description] = classifyCostType(description, rules);
    }
    return { matches, costTypes };
  });
}
