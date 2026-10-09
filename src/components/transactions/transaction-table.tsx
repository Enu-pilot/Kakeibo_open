"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil, Trash2, Check, X } from "lucide-react";
import { Button, Input, Select } from "@/components/ui";
import { SplitEditor, splitTotal, type SplitDraft } from "@/components/transactions/split-editor";
import { TransferToField } from "@/components/transactions/transfer-to-field";
import { KIND_VAR } from "@/lib/chart-colors";
import { api } from "@/lib/client-api";
import { formatYen } from "@/lib/utils";
import type {
  CostTypeView,
  MajorWithCategories,
  PaymentMethodView,
  TransactionView,
} from "@/lib/view-types";

export function TransactionTable({
  transactions,
  majors,
  paymentMethods,
  costTypes,
}: {
  transactions: TransactionView[];
  majors: MajorWithCategories[];
  paymentMethods: PaymentMethodView[];
  costTypes: CostTypeView[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="relative overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-fg-muted">
            <th className="px-3 py-2 font-medium">日付</th>
            <th className="px-3 py-2 font-medium">利用先</th>
            <th className="px-3 py-2 font-medium">カテゴリ</th>
            <th className="px-3 py-2 font-medium">決済手段</th>
            <th className="px-3 py-2 text-right font-medium">金額</th>
            <th className="w-20 px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {transactions.map((transaction) =>
            editingId === transaction.id ? (
              <EditRow
                key={transaction.id}
                transaction={transaction}
                majors={majors}
                paymentMethods={paymentMethods}
                costTypes={costTypes}
                onClose={() => setEditingId(null)}
              />
            ) : (
              <ReadRow
                key={transaction.id}
                transaction={transaction}
                onEdit={() => setEditingId(transaction.id)}
              />
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

function ReadRow({
  transaction,
  onEdit,
}: {
  transaction: TransactionView;
  onEdit: () => void;
}) {
  return (
    <tr className="group hover:bg-surface-2">
      <td className="tabular whitespace-nowrap px-3 py-2 text-xs text-fg-muted">
        {transaction.date.replace(/-/g, "/")}
      </td>
      <td className="max-w-[22rem] px-3 py-2">
        <p className="truncate">{transaction.description}</p>
        {transaction.memo ? (
          <p className="truncate text-xs text-fg-muted">{transaction.memo}</p>
        ) : null}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-xs">
        <div className="flex flex-col gap-0.5">
          {transaction.splits.map((split) => (
            <span key={split.id} className="inline-flex items-center gap-1.5">
              <span
                className="size-2 rounded-[2px]"
                style={{ background: KIND_VAR[split.category.major.kind] }}
                aria-hidden
              />
              <span className="text-fg-muted">{split.category.major.name}</span>
              <span>/ {split.category.name}</span>
              {split.costType ? (
                <span className="rounded border border-border px-1 text-xs text-fg-muted">
                  {split.costType.name}
                </span>
              ) : null}
              {transaction.splits.length > 1 ? (
                <span className="tabular text-fg-muted">
                  {formatYen(split.amount)}
                </span>
              ) : null}
            </span>
          ))}
        </div>
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-xs text-fg-muted">
        {transaction.paymentMethod?.name ?? "-"}
        {transaction.transferTo ? (
          <span className="block">→ {transaction.transferTo.name}</span>
        ) : null}
      </td>
      <td className="tabular whitespace-nowrap px-3 py-2 text-right font-medium">
        {formatYen(transaction.amount)}
      </td>
      <td className="px-3 py-2 text-right">
        <Button
          size="sm"
          variant="ghost"
          onClick={onEdit}
          aria-label={`${transaction.description} を編集`}
        >
          <Pencil size={14} />
        </Button>
      </td>
    </tr>
  );
}

function EditRow({
  transaction,
  majors,
  paymentMethods,
  costTypes,
  onClose,
}: {
  transaction: TransactionView;
  majors: MajorWithCategories[];
  paymentMethods: PaymentMethodView[];
  costTypes: CostTypeView[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    date: transaction.date,
    description: transaction.description,
    paymentMethodId: transaction.paymentMethodId ?? "",
    transferToId: transaction.transferToId ?? "",
    memo: transaction.memo ?? "",
  });
  const [splits, setSplits] = useState<SplitDraft[]>(
    transaction.splits.map((split) => ({
      categoryId: split.categoryId,
      amount: String(split.amount),
      costTypeId: split.costTypeId,
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save() {
    setPending(true);
    setError(null);
    try {
      await api(`/api/transactions/${transaction.id}`, {
        method: "PATCH",
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
        },
      });
      onClose();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
      setPending(false);
    }
  }

  async function remove() {
    if (!confirm(`「${transaction.description}」を削除します。よろしいですか？`)) return;
    setPending(true);
    try {
      await api(`/api/transactions/${transaction.id}`, { method: "DELETE" });
      onClose();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました");
      setPending(false);
    }
  }

  return (
    <tr className="bg-surface-2/60">
      <td className="px-2 py-2 align-top">
        <Input
          type="date"
          className="tabular w-[8.5rem]"
          value={form.date}
          onChange={(e) => setForm({ ...form, date: e.target.value })}
        />
      </td>
      <td className="px-2 py-2 align-top">
        <Input
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          aria-label="利用先"
        />
        <Input
          className="mt-1"
          placeholder="メモ"
          value={form.memo}
          onChange={(e) => setForm({ ...form, memo: e.target.value })}
          aria-label="メモ"
        />
        {error ? <p role="alert" className="mt-1 text-dns-16N-130 text-error-1">{error}</p> : null}
      </td>
      <td className="px-2 py-2 align-top">
        <SplitEditor
          splits={splits}
          majors={majors}
          costTypes={costTypes}
          onChange={setSplits}
          compact
        />
        <p className="mt-1 text-xs text-fg-muted">
          {splits.length > 1
            ? "分割した明細は自動分類を学習しません"
            : "変更するとこの利用先を次回から自動分類します"}
        </p>
      </td>
      <td className="px-2 py-2 align-top">
        <Select
          className="h-8 w-32"
          value={form.paymentMethodId}
          onChange={(e) => setForm({ ...form, paymentMethodId: e.target.value })}
          aria-label="決済手段"
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
        />
      </td>
      <td className="tabular px-2 py-2 text-right align-top font-medium">
        {formatYen(splitTotal(splits))}
      </td>
      <td className="px-2 py-2 align-top">
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="primary" onClick={save} disabled={pending} aria-label="保存">
            <Check size={14} />
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose} disabled={pending} aria-label="キャンセル">
            <X size={14} />
          </Button>
          <Button size="sm" variant="danger" onClick={remove} disabled={pending} aria-label="削除">
            <Trash2 size={14} />
          </Button>
        </div>
      </td>
    </tr>
  );
}
