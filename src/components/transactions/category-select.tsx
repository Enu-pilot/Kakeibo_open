"use client";

import { Select } from "@/components/ui";
import type { MajorWithCategories } from "@/lib/view-types";

/** 大項目でグルーピングした中項目セレクト */
export function CategorySelect({
  majors,
  value,
  onChange,
  className,
  id,
  emptyLabel = "カテゴリを選択",
}: {
  majors: MajorWithCategories[];
  value: string;
  onChange: (categoryId: string) => void;
  className?: string;
  id?: string;
  /** 未選択のときの表示（中項目を決めないルールなど、空が意味を持つ場面で変える） */
  emptyLabel?: string;
}) {
  return (
    <Select
      id={id}
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{emptyLabel}</option>
      {majors.map((major) => (
        <optgroup key={major.id} label={major.name}>
          {major.categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}
