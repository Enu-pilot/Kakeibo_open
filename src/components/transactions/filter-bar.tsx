"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { Button, Input, Select } from "@/components/ui";
import { KIND_META, KIND_ORDER } from "@/lib/category-kind";
import type {
  CostTypeView,
  MajorWithCategories,
  PaymentMethodView,
} from "@/lib/view-types";

/** 絞り込みは URL に持たせる。ブックマークや戻るがそのまま効くようにするため。 */
export function FilterBar({
  majors,
  paymentMethods,
  costTypes,
}: {
  majors: MajorWithCategories[];
  paymentMethods: PaymentMethodView[];
  costTypes: CostTypeView[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [keyword, setKeyword] = useState(params.get("q") ?? "");

  const selectedMajorId = params.get("majorId") ?? "";
  const categories =
    majors.find((major) => major.id === selectedMajorId)?.categories ??
    majors.flatMap((major) =>
      major.categories.map((category) => ({
        ...category,
        name: `${major.name} / ${category.name}`,
      })),
    );

  function update(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete("page"); // 条件を変えたら 1 ページ目に戻す
    startTransition(() => router.push(`/transactions?${next.toString()}`));
  }

  const hasFilter = [...params.keys()].some((key) => key !== "page");

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <label className="mb-1 block text-xs text-fg-muted">年月</label>
        <Input
          type="month"
          className="tabular w-[9.5rem]"
          value={params.get("month") ?? ""}
          onChange={(e) => update({ month: e.target.value || undefined, year: undefined })}
        />
      </div>

      <div>
        <label className="mb-1 block text-xs text-fg-muted">大項目</label>
        <Select
          className="w-36"
          value={selectedMajorId}
          onChange={(e) =>
            update({ majorId: e.target.value || undefined, categoryId: undefined })
          }
        >
          <option value="">すべて</option>
          {majors.map((major) => (
            <option key={major.id} value={major.id}>
              {major.name}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <label className="mb-1 block text-xs text-fg-muted">中項目</label>
        <Select
          className="w-44"
          value={params.get("categoryId") ?? ""}
          onChange={(e) => update({ categoryId: e.target.value || undefined })}
        >
          <option value="">すべて</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <label className="mb-1 block text-xs text-fg-muted">種別</label>
        <Select
          className="w-32"
          value={params.get("kind") ?? ""}
          onChange={(e) => update({ kind: e.target.value || undefined })}
        >
          <option value="">すべて</option>
          {KIND_ORDER.map((kind) => (
            <option key={kind} value={kind}>
              {KIND_META[kind].label}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <label className="mb-1 block text-xs text-fg-muted">決済手段</label>
        <Select
          className="w-36"
          value={params.get("paymentMethodId") ?? ""}
          onChange={(e) => update({ paymentMethodId: e.target.value || undefined })}
        >
          <option value="">すべて</option>
          {paymentMethods.map((method) => (
            <option key={method.id} value={method.id}>
              {method.name}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <label className="mb-1 block text-xs text-fg-muted">費目</label>
        <Select
          className="w-32"
          value={params.get("costTypeId") ?? ""}
          onChange={(e) => update({ costTypeId: e.target.value || undefined })}
        >
          <option value="">すべて</option>
          <option value="none">未設定</option>
          {costTypes.map((costType) => (
            <option key={costType.id} value={costType.id}>
              {costType.name}
            </option>
          ))}
        </Select>
      </div>

      <form
        className="flex items-end gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: keyword || undefined });
        }}
      >
        <div>
          <label className="mb-1 block text-xs text-fg-muted">検索</label>
          <Input
            className="w-44"
            placeholder="利用先・メモ"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
        <Button type="submit" size="sm" aria-label="検索">
          <Search size={15} />
        </Button>
      </form>

      {hasFilter ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setKeyword("");
            startTransition(() => router.push("/transactions"));
          }}
        >
          <X size={14} />
          条件クリア
        </Button>
      ) : null}

      {pending ? <span className="text-xs text-fg-muted">更新中...</span> : null}
    </div>
  );
}
