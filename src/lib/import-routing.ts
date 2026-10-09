import type { CategoryKind } from "@/lib/db/types";
import { normalizeDescription } from "@/lib/normalize";
import type { MajorWithCategories } from "@/lib/view-types";

/**
 * 取込で、行をどの中項目へ入れるかを決める補助。シート画面（sheet-source）と同じ考え方で、
 * 同じ名前の中項目が支出側と収入側の両方にあるときは、お金の向きで選び分ける。
 * 画面（取込ウィザード）からも使うので、サーバー専用のものには依存しない。
 */

export type CategoryEntry = {
  id: string;
  name: string;
  majorId: string;
  majorName: string;
  kind: CategoryKind;
};

export function buildCategoryIndex(majors: MajorWithCategories[]) {
  const byName = new Map<string, CategoryEntry[]>();
  const byId = new Map<string, CategoryEntry>();
  for (const major of majors) {
    for (const category of major.categories) {
      const entry: CategoryEntry = {
        id: category.id,
        name: category.name,
        majorId: major.id,
        majorName: major.name,
        kind: major.kind,
      };
      byId.set(entry.id, entry);
      const key = normalizeDescription(category.name);
      const list = byName.get(key);
      if (list) list.push(entry);
      else byName.set(key, [entry]);
    }
  }
  const majorsByName = new Map(majors.map((m) => [normalizeDescription(m.name), m]));
  return { byName, byId, majorsByName };
}

export type CategoryIndex = ReturnType<typeof buildCategoryIndex>;

/**
 * 同名の候補から、お金の向きに合うものを選ぶ。
 *   収入として数える入金: 収入側 → 資産の移動（投資・帳尻合わせ）。どちらも無ければ選ばない
 *   それ以外: 収入以外 → それも無ければ何でも
 */
export function pickByDirection<T extends { kind: CategoryKind }>(
  candidates: T[] | undefined,
  toIncome: boolean,
): T | undefined {
  if (!candidates || candidates.length === 0) return undefined;
  if (toIncome) {
    return (
      candidates.find((c) => c.kind === "INCOME") ??
      candidates.find((c) => c.kind === "ADJUSTMENT" || c.kind === "INVESTMENT")
    );
  }
  return candidates.find((c) => c.kind !== "INCOME") ?? candidates[0];
}

export type IncomeTarget =
  /** 既にある中項目に入れる */
  | { type: "existing"; categoryId: string }
  /** この大項目の下に、この名前の中項目を作って（あれば使って）入れる */
  | { type: "ensure"; majorId: string; name: string }
  /** 受け皿の大項目（収入内訳）の下に作る。大項目が無ければ作る */
  | { type: "fallback"; name: string };

/**
 * 収入として数える入金の行き先を決める。
 *   1. 割り当て済みの中項目が収入側ならそのまま
 *   2. 同じ名前の収入側（無ければ資産の移動）の中項目
 *   3. 名前が大項目と同じ（使用先「給料」）なら、その大項目の同名の中項目
 *   4. どれも無ければ受け皿（収入内訳）の下に同じ名前で
 */
export function resolveIncomeTarget(
  name: string,
  assignedCategoryId: string | undefined,
  index: CategoryIndex,
): IncomeTarget {
  const assigned = assignedCategoryId ? index.byId.get(assignedCategoryId) : undefined;
  if (assigned?.kind === "INCOME") return { type: "existing", categoryId: assigned.id };

  const key = normalizeDescription(name);
  const picked = pickByDirection(index.byName.get(key), true);
  if (picked) return { type: "existing", categoryId: picked.id };

  const major = index.majorsByName.get(key);
  if (major) return { type: "ensure", majorId: major.id, name };

  return { type: "fallback", name };
}

/**
 * 入金を「差し引き」として扱う行の行き先。収入側の中項目が割り当たっていたら、
 * 同じ名前の収入以外の中項目に付け替える（収入側にしか無ければそのまま）。
 * 「収入」から「差し引き」に手で切り替えた行が、収入側に残らないようにするため。
 */
export function resolveNettingTarget(
  name: string,
  assignedCategoryId: string | undefined,
  index: CategoryIndex,
): string | undefined {
  const assigned = assignedCategoryId ? index.byId.get(assignedCategoryId) : undefined;
  if (assigned && assigned.kind !== "INCOME") return assigned.id;
  const picked = pickByDirection(index.byName.get(normalizeDescription(name)), false);
  return picked && picked.kind !== "INCOME" ? picked.id : assignedCategoryId;
}
