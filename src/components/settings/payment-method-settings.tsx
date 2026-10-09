"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Field, Input, Select } from "@/components/ui";
import { api } from "@/lib/client-api";
import { formatYen } from "@/lib/utils";
import type { PaymentMethodView } from "@/lib/view-types";
import type { AccountBalance } from "@/lib/balances";

const KIND_LABEL: Record<string, string> = {
  CARD: "クレジットカード",
  EMONEY: "電子マネー",
  CASH: "現金",
  BANK: "銀行口座",
};

export function PaymentMethodSettings({
  paymentMethods,
  balances,
}: {
  paymentMethods: PaymentMethodView[];
  balances: AccountBalance[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", kind: "CARD" });
  const balanceById = new Map(balances.map((account) => [account.id, account]));

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新に失敗しました");
    }
  }

  function patch(id: string, body: Record<string, unknown>) {
    return run(() => api(`/api/payment-methods/${id}`, { method: "PATCH", body }));
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-std-20B-150 text-solid-gray-900">決済手段</h2>
        <p className="mt-1 text-xs text-fg-muted">
          カード名や電子マネーを登録しておくと、明細の絞り込みに使えます。
          既に使われている決済手段を削除した場合は、過去の明細を残すため非表示にします。
        </p>
        <p className="mt-1 text-xs text-fg-muted">
          「残高」を入にすると、起点残高に明細を足し引きした現在残高がダッシュボードに出ます。
          クレジットカードは残高ではなく利用額なので既定では追いません。
        </p>
      </div>

      {error ? <p role="alert" className="text-dns-16N-130 text-error-1">{error}</p> : null}

      <ul className="space-y-2">
        {paymentMethods.map((method) => {
          const balance = balanceById.get(method.id);
          return (
            <li
              key={method.id}
              className="rounded-lg border border-border px-2.5 py-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className="h-8 w-44"
                  defaultValue={method.name}
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== method.name) {
                      void patch(method.id, { name });
                    }
                  }}
                  aria-label={`${method.name} の名前`}
                />
                <Select
                  className="h-8 w-40"
                  defaultValue={method.kind}
                  onChange={(e) => patch(method.id, { kind: e.target.value })}
                  aria-label={`${method.name} の種別`}
                >
                  {Object.entries(KIND_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
                <label className="flex items-center gap-1.5 text-xs text-fg-muted">
                  <input
                    type="checkbox"
                    checked={method.trackBalance}
                    onChange={(e) =>
                      patch(method.id, { trackBalance: e.target.checked })
                    }
                  />
                  残高を追う
                </label>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() =>
                    run(() =>
                      api(`/api/payment-methods/${method.id}`, { method: "DELETE" }),
                    )
                  }
                  aria-label={`${method.name} を削除`}
                >
                  <Trash2 size={13} />
                </Button>
              </div>

              {method.trackBalance ? (
                <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-border pt-2">
                  <Field label="起点残高" className="w-32">
                    <Input
                      type="number"
                      className="tabular h-8 text-right"
                      defaultValue={method.openingBalance}
                      onBlur={(e) => {
                        const value = Number(e.target.value);
                        if (Number.isFinite(value) && value !== method.openingBalance) {
                          void patch(method.id, { openingBalance: value });
                        }
                      }}
                      aria-label={`${method.name} の起点残高`}
                    />
                  </Field>
                  <Field
                    label="起点日"
                    hint="この日以降の明細だけを足し引きします。空にすると全期間が対象です。"
                    className="w-44"
                  >
                    <Input
                      type="date"
                      className="tabular h-8"
                      defaultValue={method.openingBalanceAt ?? ""}
                      onBlur={(e) => {
                        const next = e.target.value || null;
                        if (next !== method.openingBalanceAt) {
                          void patch(method.id, { openingBalanceAt: next });
                        }
                      }}
                      aria-label={`${method.name} の起点日`}
                    />
                  </Field>
                  {balance ? (
                    <p className="pb-1 text-xs text-fg-muted">
                      現在残高{" "}
                      <span className="tabular font-medium text-fg">
                        {formatYen(balance.balance)}
                      </span>
                      {balance.unassignedTransfers > 0 ? (
                        <span className="ml-2">
                          （移動先が未設定の帳尻合わせ {balance.unassignedTransfers} 件は
                          残高に反映していません）
                        </span>
                      ) : null}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <form
        className="flex flex-wrap items-end gap-2 border-t border-border pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!form.name.trim()) return;
          void run(async () => {
            await api("/api/payment-methods", { method: "POST", body: form });
            setForm({ name: "", kind: "CARD" });
          });
        }}
      >
        <Field label="新しい決済手段" className="w-44">
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="例: 楽天カード"
          />
        </Field>
        <Field label="種別" className="w-40">
          <Select
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value })}
          >
            {Object.entries(KIND_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Button size="sm" variant="primary" type="submit">
          <Plus size={14} />
          追加
        </Button>
      </form>
    </div>
  );
}
