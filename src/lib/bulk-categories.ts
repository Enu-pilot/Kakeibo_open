import type { CategoryKind } from "@/lib/db/types";
import { normalizeDescription } from "@/lib/normalize";

/**
 * まとめシートの項目一覧から大項目・中項目をまとめて作る処理の本体。
 *
 * **足すだけで、消しも書き換えもしない。** 何度実行しても結果が変わらない。
 * データの置き場ではなく必要な操作だけを受け取るので、単体でも動きを確かめられる。
 */

export type BulkMajorInput = {
  name: string;
  kind: CategoryKind;
  categories: string[];
};

export type BulkResult = {
  createdMajors: string[];
  existingMajors: string[];
  createdCategories: number;
  /** 既にあってそのままにした中項目の数 */
  keptCategories: number;
  restoredCategories: number;
  /** 既にある大項目で、貼り付けた種別と食い違ったもの（変更はしない） */
  kindMismatch: { name: string; current: CategoryKind; pasted: CategoryKind }[];
};

type MajorRow = { id: string; name: string; kind: CategoryKind; sortOrder: number };
type CategoryRow = {
  id: string;
  majorId: string;
  name: string;
  sortOrder: number;
  archivedAt: string | Date | null;
};

/** この処理が必要とする操作だけを並べたもの（書き込みは withChanges の中で積む） */
export type BulkStore = {
  listMajors: () => Promise<MajorRow[]>;
  createMajor: (data: {
    name: string;
    kind: CategoryKind;
    sortOrder: number;
  }) => Promise<{ id: string; name: string }>;
  listCategories: (majorIds: string[]) => Promise<CategoryRow[]>;
  createCategories: (
    data: { name: string; majorId: string; sortOrder: number }[],
  ) => Promise<unknown>;
  restoreCategories: (ids: string[]) => Promise<unknown>;
};

export async function applyBulkCategories(
  store: BulkStore,
  majors: BulkMajorInput[],
): Promise<BulkResult> {
  const existingMajors = await store.listMajors();
  const majorByName = new Map(
    existingMajors.map((major) => [normalizeDescription(major.name), major.id]),
  );
  const majorRowByName = new Map(
    existingMajors.map((major) => [normalizeDescription(major.name), major]),
  );
  let nextMajorOrder =
    Math.max(-1, ...existingMajors.map((major) => major.sortOrder)) + 1;

  const resolved: { id: string; categories: string[] }[] = [];
  const createdMajors: string[] = [];
  const existingMajorNames: string[] = [];
  const kindMismatch: BulkResult["kindMismatch"] = [];

  for (const input of majors) {
    const nameKey = normalizeDescription(input.name);
    const foundId = majorByName.get(nameKey);
    if (foundId) {
      const found = majorRowByName.get(nameKey)!;
      existingMajorNames.push(found.name);
      // 既にある大項目の種別は変えない。過去の集計の意味が変わってしまうため。
      if (found.kind !== input.kind) {
        kindMismatch.push({
          name: found.name,
          current: found.kind,
          pasted: input.kind,
        });
      }
      resolved.push({ id: foundId, categories: input.categories });
      continue;
    }
    const created = await store.createMajor({
      name: input.name,
      kind: input.kind,
      sortOrder: nextMajorOrder,
    });
    nextMajorOrder += 1;
    majorByName.set(nameKey, created.id);
    majorRowByName.set(nameKey, {
      id: created.id,
      name: created.name,
      kind: input.kind,
      sortOrder: nextMajorOrder - 1,
    });
    createdMajors.push(created.name);
    resolved.push({ id: created.id, categories: input.categories });
  }

  const majorIds = [...new Set(resolved.map((entry) => entry.id))];
  const existingCategories =
    majorIds.length > 0 ? await store.listCategories(majorIds) : [];

  const key = (majorId: string, name: string) =>
    `${majorId}\u0000${normalizeDescription(name)}`;
  const existingByKey = new Map(
    existingCategories.map((category) => [
      key(category.majorId, category.name),
      category,
    ]),
  );
  /** 貼り付けた中に同じ名前が 2 度出てきても 1 件だけ作るための控え */
  const taken = new Set(existingByKey.keys());

  const lastOrder = new Map<string, number>();
  for (const category of existingCategories) {
    lastOrder.set(
      category.majorId,
      Math.max(lastOrder.get(category.majorId) ?? -1, category.sortOrder),
    );
  }

  const toCreate: { name: string; majorId: string; sortOrder: number }[] = [];
  const toRestore: string[] = [];
  let keptCategories = 0;

  for (const entry of resolved) {
    for (const name of entry.categories) {
      const entryKey = key(entry.id, name);
      const found = existingByKey.get(entryKey);
      if (found) {
        keptCategories += 1;
        // 使用中で消されてアーカイブされていたものは、名前が戻ってきたので復活させる
        if (found.archivedAt) toRestore.push(found.id);
        continue;
      }
      if (taken.has(entryKey)) continue;
      taken.add(entryKey);
      const order = (lastOrder.get(entry.id) ?? -1) + 1;
      lastOrder.set(entry.id, order);
      toCreate.push({ name, majorId: entry.id, sortOrder: order });
    }
  }

  if (toCreate.length > 0) await store.createCategories(toCreate);
  if (toRestore.length > 0) await store.restoreCategories(toRestore);

  return {
    createdMajors,
    existingMajors: existingMajorNames,
    createdCategories: toCreate.length,
    keptCategories,
    restoredCategories: toRestore.length,
    kindMismatch,
  };
}
