"use client";

import { useState } from "react";
import { Button, Field, Input, Select } from "@/components/ui";
import { KIND_META } from "@/lib/category-kind";
import type { CategoryKind } from "@/lib/db/types";
import type {
  MajorWithCategories,
  PaymentMethodView,
  PlanView,
} from "@/lib/view-types";

export type PlanInput = {
  name: string;
  categoryId: string;
  amount: number;
  day: number;
  paymentMethodId: string | null;
  transferToId: string | null;
  startMonth: string | null;
  endMonth: string | null;
  enabled: boolean;
  memo: string | null;
};

/** 予定の追加・変更フォーム */
export function PlanForm({
  plan,
  majors,
  paymentMethods,
  onSubmit,
  onCancel,
  onDelete,
}: {
  plan: PlanView | null;
  majors: MajorWithCategories[];
  paymentMethods: PaymentMethodView[];
  onSubmit: (input: PlanInput) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    name: plan?.name ?? "",
    categoryId: plan?.categoryId ?? "",
    amount: plan ? String(plan.amount) : "",
    day: plan ? String(plan.day) : "25",
    paymentMethodId: plan?.paymentMethodId ?? "",
    transferToId: plan?.transferToId ?? "",
    startMonth: plan?.startMonth ?? "",
    endMonth: plan?.endMonth ?? "",
    enabled: plan?.enabled ?? true,
    memo: plan?.memo ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kindById = new Map<string, CategoryKind>();
  for (const major of majors) {
    for (const category of major.categories) kindById.set(category.id, major.kind);
  }
  const kind = kindById.get(form.categoryId);
  const isTransfer = kind === "ADJUSTMENT";
  const set = (patch: Partial<typeof form>) => setForm((prev) => ({ ...prev, ...patch }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const amount = Number(form.amount);
    const day = Number(form.day);
    if (!form.name.trim()) return setError("名前を入力してください");
    if (!form.categoryId) return setError("中項目を選んでください");
    if (!(amount > 0)) return setError("金額は 1 以上で入力してください");
    if (!Number.isInteger(day) || day < 1 || day > 31) return setError("日は 1〜31 で入力してください");
    setBusy(true);
    try {
      await onSubmit({
        name: form.name.trim(),
        categoryId: form.categoryId,
        amount,
        day,
        paymentMethodId: form.paymentMethodId || null,
        transferToId: isTransfer ? form.transferToId || null : null,
        startMonth: form.startMonth || null,
        endMonth: form.endMonth || null,
        enabled: form.enabled,
        memo: form.memo.trim() || null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
      setBusy(false);
    }
  }

  const accountLabel =
    kind === "INCOME" ? "入金先" : isTransfer ? "移動元" : "支払い元";

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-lg border border-border bg-surface-2/40 p-3"
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="名前" className="sm:col-span-2 lg:col-span-1">
          <Input
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="給料・家賃・NISA 積立 など"
            autoFocus
          />
        </Field>
        <Field label="中項目" className="sm:col-span-2 lg:col-span-1">
          <Select
            value={form.categoryId}
            onChange={(e) => set({ categoryId: e.target.value })}
          >
            <option value="">選んでください</option>
            {majors.map((major) => (
              <optgroup
                key={major.id}
                label={`${major.name}（${KIND_META[major.kind].label}）`}
              >
                {major.categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Field label="金額（円）">
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            className="tabular text-right"
            value={form.amount}
            onChange={(e) => set({ amount: e.target.value })}
          />
        </Field>
        <Field label="毎月の日" hint="31 にすると月末">
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={31}
            className="tabular text-right"
            value={form.day}
            onChange={(e) => set({ day: e.target.value })}
          />
        </Field>
        <Field
          label={accountLabel}
          hint="口座を選ぶと、月末の残高見込みに反映します"
        >
          <Select
            value={form.paymentMethodId}
            onChange={(e) => set({ paymentMethodId: e.target.value })}
          >
            <option value="">指定しない</option>
            {paymentMethods.map((method) => (
              <option key={method.id} value={method.id}>
                {method.name}
              </option>
            ))}
          </Select>
        </Field>
        {isTransfer ? (
          <Field label="移動先">
            <Select
              value={form.transferToId}
              onChange={(e) => set({ transferToId: e.target.value })}
            >
              <option value="">指定しない</option>
              {paymentMethods
                .filter((method) => method.id !== form.paymentMethodId)
                .map((method) => (
                  <option key={method.id} value={method.id}>
                    {method.name}
                  </option>
                ))}
            </Select>
          </Field>
        ) : null}
        <Field label="開始月" hint="空なら最初から">
          <Input
            type="month"
            className="tabular"
            value={form.startMonth}
            onChange={(e) => set({ startMonth: e.target.value })}
          />
        </Field>
        <Field label="終了月" hint="空ならずっと">
          <Input
            type="month"
            className="tabular"
            value={form.endMonth}
            onChange={(e) => set({ endMonth: e.target.value })}
          />
        </Field>
        <Field label="メモ" className="sm:col-span-2">
          <Input value={form.memo} onChange={(e) => set({ memo: e.target.value })} />
        </Field>
      </div>

      <label className="flex items-center gap-1.5 text-xs text-fg-muted">
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => set({ enabled: e.target.checked })}
        />
        有効（外すと、消さずに一時的に止められます）
      </label>

      {error ? <p role="alert" className="text-dns-16N-130 text-error-1">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          {plan ? "保存" : "追加"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          キャンセル
        </Button>
        {onDelete ? (
          <Button
            type="button"
            size="sm"
            variant="danger"
            className="ml-auto"
            disabled={busy}
            onClick={async () => {
              if (!confirm(`「${form.name}」の予定を削除しますか？（明細は消えません）`)) return;
              setBusy(true);
              try {
                await onDelete();
              } catch (e) {
                setError(e instanceof Error ? e.message : "削除に失敗しました");
                setBusy(false);
              }
            }}
          >
            削除
          </Button>
        ) : null}
      </div>
    </form>
  );
}
