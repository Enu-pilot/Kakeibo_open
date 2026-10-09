"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Field, Input, Select, Badge } from "@/components/ui";
import { CategorySelect } from "@/components/transactions/category-select";
import { CostTypeSelect } from "@/components/transactions/cost-type-select";
import { api } from "@/lib/client-api";
import type { MatchType } from "@/lib/db/types";
import type { CostTypeView, MajorWithCategories } from "@/lib/view-types";

export type RuleView = {
  id: string;
  keyword: string;
  matchType: MatchType;
  priority: number;
  enabled: boolean;
  isLearned: boolean;
  /** 中項目を決めないルール（費目だけ）は null */
  categoryId: string | null;
  costTypeId: string | null;
};

const MATCH_LABEL: Record<MatchType, string> = {
  CONTAINS: "含む",
  STARTS_WITH: "で始まる",
  EXACT: "完全一致",
  REGEX: "正規表現",
};

const EMPTY_FORM = {
  keyword: "",
  matchType: "CONTAINS" as MatchType,
  categoryId: "",
  costTypeId: null,
  priority: 100,
};

export function RuleSettings({
  rules,
  majors,
  costTypes,
}: {
  rules: RuleView[];
  majors: MajorWithCategories[];
  costTypes: CostTypeView[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{
    keyword: string;
    matchType: MatchType;
    categoryId: string;
    costTypeId: string | null;
    priority: number;
  }>(EMPTY_FORM);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新に失敗しました");
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-std-20B-150 text-solid-gray-900">自動分類ルール</h2>
        <p className="mt-1 text-xs text-fg-muted">
          利用先がキーワードに当たると、中項目や費目を自動で決めます。
          中項目と費目は別々に判定するので、「セブン → 費目: 食費」のように費目だけのルールも作れます
          （中項目は使用先で決まり、費目は店名で決まる、が両立します）。
          優先度が小さいものから順に判定し、最初に当たったルールを使います。
          明細画面でカテゴリを直すと「学習」ルールが自動で作られます。
        </p>
      </div>

      {error ? <p role="alert" className="text-dns-16N-130 text-error-1">{error}</p> : null}

      <form
        className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!form.keyword.trim()) return;
          if (!form.categoryId && !form.costTypeId) {
            setError("中項目か費目のどちらかを選んでください");
            return;
          }
          void run(async () => {
            await api("/api/rules", {
              method: "POST",
              body: { ...form, categoryId: form.categoryId || null },
            });
            setForm(EMPTY_FORM);
          });
        }}
      >
        <Field label="キーワード" className="w-44">
          <Input
            value={form.keyword}
            onChange={(e) => setForm({ ...form, keyword: e.target.value })}
            placeholder="例: スーパー"
          />
        </Field>
        <Field label="判定" className="w-32">
          <Select
            value={form.matchType}
            onChange={(e) =>
              setForm({ ...form, matchType: e.target.value as MatchType })
            }
          >
            {(Object.keys(MATCH_LABEL) as MatchType[]).map((type) => (
              <option key={type} value={type}>
                {MATCH_LABEL[type]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="中項目（任意）" className="w-52">
          <CategorySelect
            majors={majors}
            value={form.categoryId}
            onChange={(categoryId) => setForm({ ...form, categoryId })}
            emptyLabel="決めない"
          />
        </Field>
        <Field label="費目（任意）" className="w-36">
          <CostTypeSelect
            costTypes={costTypes}
            value={form.costTypeId}
            onChange={(costTypeId) => setForm({ ...form, costTypeId })}
            emptyLabel="付けない"
          />
        </Field>
        <Field label="優先度" className="w-24" hint="小さいほど先">
          <Input
            type="number"
            min={0}
            max={999}
            className="tabular"
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
          />
        </Field>
        <Button size="sm" variant="primary" type="submit">
          <Plus size={14} />
          追加
        </Button>
      </form>

      <div className="relative overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[780px] text-sm">
          <thead className="bg-surface-2 text-xs text-fg-muted">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">キーワード</th>
              <th className="px-3 py-2 font-medium">判定</th>
              <th className="px-3 py-2 font-medium">中項目</th>
              <th className="px-3 py-2 font-medium">費目</th>
              <th className="px-3 py-2 font-medium">優先度</th>
              <th className="px-3 py-2 font-medium">有効</th>
              <th className="w-12 px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rules.map((rule) => (
              <tr key={rule.id} className={rule.enabled ? undefined : "opacity-50"}>
                <td className="px-3 py-1.5">
                  <span className="break-all">{rule.keyword}</span>
                  {rule.isLearned ? (
                    <Badge className="ml-1.5">
                      学習
                    </Badge>
                  ) : null}
                </td>
                <td className="px-3 py-1.5">
                  <Select
                    className="h-8 w-28"
                    defaultValue={rule.matchType}
                    onChange={(e) =>
                      run(() =>
                        api(`/api/rules/${rule.id}`, {
                          method: "PATCH",
                          body: { matchType: e.target.value },
                        }),
                      )
                    }
                    aria-label={`${rule.keyword} の判定方法`}
                  >
                    {(Object.keys(MATCH_LABEL) as MatchType[]).map((type) => (
                      <option key={type} value={type}>
                        {MATCH_LABEL[type]}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="px-3 py-1.5">
                  <CategorySelect
                    majors={majors}
                    value={rule.categoryId ?? ""}
                    onChange={(categoryId) =>
                      run(() =>
                        api(`/api/rules/${rule.id}`, {
                          method: "PATCH",
                          body: { categoryId: categoryId || null },
                        }),
                      )
                    }
                    className="h-8 w-44"
                    emptyLabel="-"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <CostTypeSelect
                    costTypes={costTypes}
                    value={rule.costTypeId}
                    onChange={(costTypeId) =>
                      run(() =>
                        api(`/api/rules/${rule.id}`, {
                          method: "PATCH",
                          body: { costTypeId },
                        }),
                      )
                    }
                    className="h-8 w-28"
                    emptyLabel="-"
                    ariaLabel={`${rule.keyword} の費目`}
                  />
                </td>
                <td className="px-3 py-1.5">
                  <Input
                    type="number"
                    min={0}
                    max={999}
                    className="tabular h-8 w-20"
                    defaultValue={rule.priority}
                    onBlur={(e) => {
                      const priority = Number(e.target.value);
                      if (priority !== rule.priority) {
                        void run(() =>
                          api(`/api/rules/${rule.id}`, {
                            method: "PATCH",
                            body: { priority },
                          }),
                        );
                      }
                    }}
                    aria-label={`${rule.keyword} の優先度`}
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="checkbox"
                    defaultChecked={rule.enabled}
                    onChange={(e) =>
                      run(() =>
                        api(`/api/rules/${rule.id}`, {
                          method: "PATCH",
                          body: { enabled: e.target.checked },
                        }),
                      )
                    }
                    aria-label={`${rule.keyword} を有効にする`}
                  />
                </td>
                <td className="px-3 py-1.5 text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      run(() => api(`/api/rules/${rule.id}`, { method: "DELETE" }))
                    }
                    aria-label={`${rule.keyword} のルールを削除`}
                  >
                    <Trash2 size={13} />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
