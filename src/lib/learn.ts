import { newId, now, type Changes, type Snapshot } from "@/lib/db/store";

/**
 * 手修正の内容をルールとして覚える。
 * 「スーパー〇〇 → 食費」と直したら、次回以降の同じ利用先を自動で食費にする。
 * 完全一致で覚えるため誤爆しない。部分一致に広げたい場合は設定画面で変更できる。
 */
export function learnFromCorrection(
  tx: Changes,
  db: Snapshot,
  description: string,
  categoryId: string,
) {
  const keyword = description.trim();
  if (!keyword) return;
  const existing = db.rules.find((r) => r.keyword === keyword && r.matchType === "EXACT");
  if (existing) {
    tx.update("rules", existing.id, { categoryId, enabled: true, updatedAt: now() });
    return;
  }
  const timestamp = now();
  tx.insert("rules", {
    id: newId(),
    keyword,
    matchType: "EXACT",
    categoryId,
    costTypeId: null,
    priority: 50, // 手で作った一般ルール(既定100)より先に効かせる
    isLearned: true,
    enabled: true,
    hitCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}
