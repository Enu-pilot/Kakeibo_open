/**
 * 大項目を別の大項目にまとめる（例: 以前の大項目の中項目を、今の大項目へ）。
 *
 * まとめ元の中項目は、まとめ先の同じ名前の中項目へ移す。まとめ元の大項目と同じ名前の中項目（その大項目の「その他」）は、
 * まとめ先の大項目と同じ名前の中項目へ移す。まとめ先に無い名前の中項目は、まとめ先に作る。
 * 内訳・予算・予定・分類ルール・二人の明細が指す中項目をすべて付け替え、まとめ元の中項目と大項目はアーカイブする（消さない）。
 * 金額は変えないので、集計は大項目の行が入れ替わるだけ（種別が同じ大項目どうしに限る）。
 */
import { badRequest } from "@/lib/api";
import { newId, now, type Changes, type Snapshot } from "@/lib/db/store";
import type { Category } from "@/lib/db/types";

export type MergeMove = { fromId: string; fromName: string; toId: string | null; toName: string; create: boolean };

export type MergePlan = {
  source: { id: string; name: string };
  target: { id: string; name: string };
  moves: MergeMove[];
  counts: { splits: number; budgets: number; plans: number; rules: number; pairEntries: number };
};

function liveMajor(db: Snapshot, id: string) {
  const major = db.majors.find((m) => m.id === id && !m.archivedAt);
  if (!major) throw badRequest("大項目が見つかりません。画面を再読み込みしてください");
  return major;
}

export function planMerge(db: Snapshot, sourceId: string, targetId: string): MergePlan {
  if (sourceId === targetId) throw badRequest("まとめ元とまとめ先が同じです");
  const source = liveMajor(db, sourceId);
  const target = liveMajor(db, targetId);
  if (source.kind !== target.kind) {
    throw badRequest("種別の違う大項目はまとめられません（金額の符号の意味が変わるため）");
  }
  const targetCategories = db.categories.filter((c) => c.majorId === target.id);
  const byName = (name: string) =>
    targetCategories.find((c) => c.name === name && !c.archivedAt) ?? targetCategories.find((c) => c.name === name);
  const moves: MergeMove[] = db.categories
    .filter((c) => c.majorId === source.id)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => {
      const toName = c.name === source.name && !byName(c.name) ? target.name : c.name;
      const to = byName(toName);
      return { fromId: c.id, fromName: c.name, toId: to?.id ?? null, toName, create: !to };
    });
  const from = new Set(moves.map((m) => m.fromId));
  return {
    source: { id: source.id, name: source.name },
    target: { id: target.id, name: target.name },
    moves,
    counts: {
      splits: db.splits.filter((s) => from.has(s.categoryId)).length,
      budgets: db.budgets.filter((b) => from.has(b.categoryId)).length,
      plans: db.plans.filter((p) => from.has(p.categoryId)).length,
      rules: db.rules.filter((r) => r.categoryId && from.has(r.categoryId)).length,
      pairEntries: db.pairEntries.filter(
        (e) => (e.categoryId && from.has(e.categoryId)) || (e.originalCategoryId && from.has(e.originalCategoryId)),
      ).length,
    },
  };
}

export function applyMerge(tx: Changes, db: Snapshot, sourceId: string, targetId: string): MergePlan {
  const plan = planMerge(db, sourceId, targetId);
  const timestamp = now();
  let order = Math.max(-1, ...db.categories.filter((c) => c.majorId === targetId).map((c) => c.sortOrder));
  const created = new Map<string, Category>();
  const dest = new Map<string, string>();
  for (const move of plan.moves) {
    let toId = move.toId ?? created.get(move.toName)?.id;
    if (!toId) {
      const category = tx.insert("categories", {
        id: newId(),
        name: move.toName,
        majorId: targetId,
        sortOrder: ++order,
        archivedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      created.set(move.toName, category);
      toId = category.id;
    }
    // アーカイブ済みの同名の中項目へ移すときは、使えるように戻す
    const to = db.categories.find((c) => c.id === toId);
    if (to?.archivedAt) tx.update("categories", toId, { archivedAt: null, updatedAt: timestamp });
    dest.set(move.fromId, toId);
  }

  for (const split of db.splits) {
    const to = dest.get(split.categoryId);
    if (to) tx.update("splits", split.id, { categoryId: to });
  }
  for (const budget of [...db.budgets]) {
    const to = dest.get(budget.categoryId);
    if (!to) continue;
    // まとめ先に同じ月の予算があれば足し合わせる（予算は中項目 × 月で 1 つ）
    const existing = db.budgets.find((b) => b.categoryId === to && b.month === budget.month && b.id !== budget.id);
    if (existing) {
      tx.update("budgets", existing.id, { amount: existing.amount + budget.amount, updatedAt: timestamp });
      tx.remove("budgets", budget.id);
    } else {
      tx.update("budgets", budget.id, { categoryId: to, updatedAt: timestamp });
    }
  }
  for (const p of db.plans) {
    const to = dest.get(p.categoryId);
    if (to) tx.update("plans", p.id, { categoryId: to, updatedAt: timestamp });
  }
  for (const rule of db.rules) {
    const to = rule.categoryId ? dest.get(rule.categoryId) : undefined;
    if (to) tx.update("rules", rule.id, { categoryId: to, updatedAt: timestamp });
  }
  for (const entry of db.pairEntries) {
    const patch: { categoryId?: string; originalCategoryId?: string } = {};
    if (entry.categoryId && dest.has(entry.categoryId)) patch.categoryId = dest.get(entry.categoryId);
    if (entry.originalCategoryId && dest.has(entry.originalCategoryId)) patch.originalCategoryId = dest.get(entry.originalCategoryId);
    if (Object.keys(patch).length > 0) tx.update("pairEntries", entry.id, patch);
  }

  for (const move of plan.moves) {
    const from = db.categories.find((c) => c.id === move.fromId);
    if (from && !from.archivedAt) tx.update("categories", move.fromId, { archivedAt: timestamp, updatedAt: timestamp });
  }
  tx.update("majors", sourceId, { archivedAt: timestamp, updatedAt: timestamp });
  return plan;
}
