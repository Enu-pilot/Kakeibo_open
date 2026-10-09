"use client";

import { useState } from "react";
import { Button, Card, CardBody, Field, Input, Select } from "@/components/ui";
import {
  SplitEditor,
  splitTotal,
  type SplitDraft,
} from "@/components/transactions/split-editor";
import { TransferToField } from "@/components/transactions/transfer-to-field";
import { api } from "@/lib/client-api";
import { formatYen } from "@/lib/utils";
import { todayInTokyo } from "@/lib/today";
import type { CostTypeView, MajorWithCategories, PaymentMethodView } from "@/lib/view-types";

/** 支出・収入・チャージを 1 件手入力するフォーム */
export function NewTransactionForm({
  majors,
  costTypes,
  paymentMethods,
  onDone,
  onCancel,
}: {
  majors: MajorWithCategories[];
  costTypes: CostTypeView[];
  paymentMethods: PaymentMethodView[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    // UTC だと日本時間の 0〜9 時に前日になるため、日本時間の今日を入れる
    date: todayInTokyo(),
    description: "",
    paymentMethodId: "",
    transferToId: "",
    memo: "",
  });
  const [splits, setSplits] = useState<SplitDraft[]>([
    { categoryId: "", amount: "", costTypeId: null },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [allowDuplicate, setAllowDuplicate] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api("/api/transactions", {
        method: "POST",
        body: {
          date: form.date,
          description: form.description.trim(),
          splits: splits.map((split) => ({
            categoryId: split.categoryId,
            amount: Number(split.amount),
            costTypeId: split.costTypeId,
          })),
          paymentMethodId: form.paymentMethodId || null,
          transferToId: form.transferToId || null,
          memo: form.memo.trim() || null,
          allowDuplicate,
        },
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "登録に失敗しました");
      setPending(false);
    }
  }

  return (
    <Card>
      <CardBody className="pt-4">
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="日付">
              <Input
                type="date"
                className="tabular"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                required
              />
            </Field>
            <Field label="利用先 / 内容" className="lg:col-span-2">
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="例: スーパーマルエツ"
                required
              />
            </Field>
            <Field
              label="カテゴリと金額"
              hint="収入もチャージもここで選ぶ大項目で扱いが決まります。個人支出と生活費で分けたい買い物は「生活費と分ける」を押します。"
              className="lg:col-span-3"
            >
              <SplitEditor
                splits={splits}
                majors={majors}
                costTypes={costTypes}
                onChange={setSplits}
              />
            </Field>
            <Field label="決済手段">
              <Select
                value={form.paymentMethodId}
                onChange={(e) => setForm({ ...form, paymentMethodId: e.target.value })}
              >
                <option value="">未設定</option>
                {paymentMethods.map((method) => (
                  <option key={method.id} value={method.id}>
                    {method.name}
                  </option>
                ))}
              </Select>
              <TransferToField
                splits={splits}
                majors={majors}
                paymentMethods={paymentMethods}
                value={form.transferToId}
                sourceId={form.paymentMethodId}
                onChange={(transferToId) => setForm({ ...form, transferToId })}
                className="mt-1.5"
              />
            </Field>
            <Field label="メモ（任意）">
              <Input
                value={form.memo}
                onChange={(e) => setForm({ ...form, memo: e.target.value })}
              />
            </Field>
          </div>

          {error ? <p role="alert" className="text-dns-16N-130 text-error-1">{error}</p> : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" size="sm" disabled={pending}>
              {pending ? "登録中..." : `${formatYen(splitTotal(splits))} を登録`}
            </Button>
            <Button type="button" size="sm" onClick={onCancel} disabled={pending}>
              キャンセル
            </Button>
            <label className="flex items-center gap-1.5 text-xs text-fg-muted">
              <input
                type="checkbox"
                checked={allowDuplicate}
                onChange={(e) => setAllowDuplicate(e.target.checked)}
              />
              同じ内容が既にあっても登録する
            </label>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
