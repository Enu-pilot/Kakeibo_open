"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { Button, Field, Input, Select } from "@/components/ui";
import { BulkCategoryImport } from "@/components/settings/bulk-category-import";
import { MajorMerge } from "@/components/settings/major-merge";
import { KIND_META, KIND_ORDER } from "@/lib/category-kind";
import { KIND_VAR } from "@/lib/chart-colors";
import { api } from "@/lib/client-api";
import type { CategoryKind } from "@/lib/db/types";
import type { MajorWithCategories, PurposeView } from "@/lib/view-types";

/** 並べ替えは隣と入れ替えるだけ。端なら null を返して何もしない。 */
function swap<T>(items: T[], index: number, delta: number): T[] | null {
  const target = index + delta;
  if (target < 0 || target >= items.length) return null;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function CategorySettings({
  majors,
  purposes,
}: {
  majors: MajorWithCategories[];
  purposes: PurposeView[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [newMajor, setNewMajor] = useState<{ name: string; kind: CategoryKind }>({
    name: "",
    kind: "EXPENSE",
  });
  const [newCategory, setNewCategory] = useState<Record<string, string>>({});

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新に失敗しました");
    }
  }

  /** 大項目の並べ替え。順序が途中で崩れないよう、全件の並びをまとめて送る。 */
  function moveMajor(index: number, delta: number) {
    const next = swap(majors, index, delta);
    if (!next) return;
    void run(() =>
      api("/api/majors/reorder", {
        method: "POST",
        body: { ids: next.map((major) => major.id) },
      }),
    );
  }

  function moveCategory(major: MajorWithCategories, index: number, delta: number) {
    const next = swap(major.categories, index, delta);
    if (!next) return;
    void run(() =>
      api("/api/categories/reorder", {
        method: "POST",
        body: { ids: next.map((category) => category.id) },
      }),
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-std-20B-150 text-solid-gray-900">大項目と中項目</h2>
        <p className="mt-1 text-xs text-fg-muted">
          大項目ごとに使途（個人・生活費…）を選ぶと、その大項目の収入・支出が使途の残高に効きます。
          大項目は自由に追加できます。ただし集計を成立させるため、必ず
          「種別」のどれかに紐づけます。純残高 = 収入 − 支出 − 生活費 − 投資 で、
          帳尻合わせは計算に含めません。
        </p>
        <p className="mt-1 text-xs text-fg-muted">
          中項目は大項目をまたいで移せます。並び順はまとめ表の行順・段順にそのまま出ます。
        </p>
      </div>

      {error ? <p role="alert" className="text-dns-16N-130 text-error-1">{error}</p> : null}

      <div className="space-y-3">
        {majors.map((major, majorIndex) => (
          <div key={major.id} className="rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="size-2.5 rounded-[3px]"
                style={{ background: KIND_VAR[major.kind] }}
                aria-hidden
              />
              <Input
                className="h-8 w-40"
                defaultValue={major.name}
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (name && name !== major.name) {
                    void run(() =>
                      api(`/api/majors/${major.id}`, {
                        method: "PATCH",
                        body: { name },
                      }),
                    );
                  }
                }}
                aria-label={`${major.name} の名前`}
              />
              <Select
                className="h-8 w-36"
                defaultValue={major.kind}
                onChange={(e) =>
                  run(() =>
                    api(`/api/majors/${major.id}`, {
                      method: "PATCH",
                      body: { kind: e.target.value },
                    }),
                  )
                }
                aria-label={`${major.name} の種別`}
              >
                {KIND_ORDER.map((kind) => (
                  <option key={kind} value={kind}>
                    {KIND_META[kind].label}
                  </option>
                ))}
              </Select>
              {major.kind !== "ADJUSTMENT" ? (
                <Select
                  className="h-8 w-32"
                  value={major.purposeId ?? ""}
                  onChange={(e) =>
                    run(() =>
                      api(`/api/majors/${major.id}`, {
                        method: "PATCH",
                        body: { purposeId: e.target.value || null },
                      }),
                    )
                  }
                  aria-label={`${major.name} の使途`}
                >
                  <option value="">使途: 未設定</option>
                  {purposes.map((purpose) => (
                    <option key={purpose.id} value={purpose.id}>
                      使途: {purpose.name}
                    </option>
                  ))}
                </Select>
              ) : null}
              <span className="text-xs text-fg-muted">
                {KIND_META[major.kind].description}
              </span>
              <div className="ml-auto flex items-center gap-1">
                <MoveButtons
                  label={major.name}
                  upDisabled={majorIndex === 0}
                  downDisabled={majorIndex === majors.length - 1}
                  onUp={() => moveMajor(majorIndex, -1)}
                  onDown={() => moveMajor(majorIndex, 1)}
                />
                {!major.isSystem ? (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() =>
                      run(() => api(`/api/majors/${major.id}`, { method: "DELETE" }))
                    }
                    aria-label={`${major.name} を削除`}
                  >
                    <Trash2 size={13} />
                  </Button>
                ) : null}
              </div>
            </div>

            <ul className="mt-2 space-y-1">
              {major.categories.map((category, index) => (
                <li
                  key={category.id}
                  className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1"
                >
                  <input
                    className="h-7 min-w-0 flex-1 bg-transparent text-xs outline-none"
                    defaultValue={category.name}
                    onBlur={(e) => {
                      const name = e.target.value.trim();
                      if (name && name !== category.name) {
                        void run(() =>
                          api(`/api/categories/${category.id}`, {
                            method: "PATCH",
                            body: { name },
                          }),
                        );
                      }
                    }}
                    aria-label={`${category.name} の名前`}
                  />
                  <Select
                    className="h-7 w-36 text-xs"
                    value={major.id}
                    onChange={(e) => {
                      const majorId = e.target.value;
                      if (majorId === major.id) return;
                      void run(() =>
                        api(`/api/categories/${category.id}`, {
                          method: "PATCH",
                          body: { majorId },
                        }),
                      );
                    }}
                    aria-label={`${category.name} の大項目`}
                  >
                    {majors.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </Select>
                  <MoveButtons
                    label={category.name}
                    upDisabled={index === 0}
                    downDisabled={index === major.categories.length - 1}
                    onUp={() => moveCategory(major, index, -1)}
                    onDown={() => moveCategory(major, index, 1)}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      run(() =>
                        api(`/api/categories/${category.id}`, { method: "DELETE" }),
                      )
                    }
                    className="rounded p-1 text-fg-muted hover:text-expense"
                    aria-label={`${category.name} を削除`}
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              ))}
            </ul>

            <form
              className="mt-2 flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                const name = (newCategory[major.id] ?? "").trim();
                if (!name) return;
                void run(async () => {
                  await api("/api/categories", {
                    method: "POST",
                    body: { name, majorId: major.id },
                  });
                  setNewCategory((prev) => ({ ...prev, [major.id]: "" }));
                });
              }}
            >
              <Input
                className="h-8 w-40"
                placeholder="中項目を追加"
                value={newCategory[major.id] ?? ""}
                onChange={(e) =>
                  setNewCategory((prev) => ({ ...prev, [major.id]: e.target.value }))
                }
              />
              <Button size="sm" type="submit">
                <Plus size={13} />
              </Button>
            </form>
          </div>
        ))}
      </div>

      <form
        className="flex flex-wrap items-end gap-2 border-t border-border pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!newMajor.name.trim()) return;
          void run(async () => {
            await api("/api/majors", { method: "POST", body: newMajor });
            setNewMajor({ name: "", kind: "EXPENSE" });
          });
        }}
      >
        <Field label="新しい大項目" className="w-44">
          <Input
            value={newMajor.name}
            onChange={(e) => setNewMajor({ ...newMajor, name: e.target.value })}
            placeholder="例: 事業経費"
          />
        </Field>
        <Field label="種別" className="w-40">
          <Select
            value={newMajor.kind}
            onChange={(e) =>
              setNewMajor({ ...newMajor, kind: e.target.value as CategoryKind })
            }
          >
            {KIND_ORDER.map((kind) => (
              <option key={kind} value={kind}>
                {KIND_META[kind].label}
              </option>
            ))}
          </Select>
        </Field>
        <Button size="sm" variant="primary" type="submit">
          <Plus size={14} />
          追加
        </Button>
      </form>

      <MajorMerge majors={majors} />
      <BulkCategoryImport majors={majors} />
    </div>
  );
}

/** 上へ / 下へ。端では押せないようにして、順序の端が分かるようにする。 */
export function MoveButtons({
  label,
  upDisabled,
  downDisabled,
  onUp,
  onDown,
}: {
  label: string;
  upDisabled: boolean;
  downDisabled: boolean;
  onUp: () => void;
  onDown: () => void;
}) {
  const className =
    "rounded p-1 text-fg-muted hover:bg-surface hover:text-fg " +
    "disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent";
  return (
    <span className="flex items-center">
      <button
        type="button"
        className={className}
        disabled={upDisabled}
        onClick={onUp}
        aria-label={`${label} を上へ`}
      >
        <ChevronUp size={13} />
      </button>
      <button
        type="button"
        className={className}
        disabled={downDisabled}
        onClick={onDown}
        aria-label={`${label} を下へ`}
      >
        <ChevronDown size={13} />
      </button>
    </span>
  );
}
