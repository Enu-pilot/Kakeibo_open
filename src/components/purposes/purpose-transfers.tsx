"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Plus, Trash2 } from "lucide-react";
import { Button, Field, Input, Select } from "@/components/ui";
import { api } from "@/lib/client-api";
import { formatYen } from "@/lib/utils";
import type { PurposeView } from "@/lib/view-types";

export type PurposeTransferView = {
  id: string;
  date: string;
  fromName: string;
  toName: string;
  amount: number;
  memo: string | null;
};

/**
 * 使途の振替（個人 → 投資 30,000 など）を記録する。口座のお金は動かず、使途の残高だけが動く。
 * 給料を個人で受けてから投資・彼女のぶんへ回す、家族から受けた補助を生活費へ回す、といったときに使う。
 */
export function PurposeTransfers({
  purposes,
  transfers,
  today,
}: {
  purposes: PurposeView[];
  transfers: PurposeTransferView[];
  /** "YYYY-MM-DD"（日本時間の今日） */
  today: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    date: today,
    fromPurposeId: purposes[0]?.id ?? "",
    toPurposeId: purposes[1]?.id ?? "",
    amount: "",
    memo: "",
  });

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await action();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const amount = Number(form.amount);
          if (!(amount > 0)) {
            setError("金額を入力してください");
            return;
          }
          void run(async () => {
            await api("/api/purpose-transfers", {
              method: "POST",
              body: { ...form, amount, memo: form.memo.trim() || null },
            });
            setForm({ ...form, amount: "", memo: "" });
          });
        }}
      >
        <Field label="日付" className="w-40">
          <Input
            type="date"
            className="tabular"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            required
          />
        </Field>
        <Field label="振替元" className="w-32">
          <Select value={form.fromPurposeId} onChange={(e) => setForm({ ...form, fromPurposeId: e.target.value })}>
            {purposes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <ArrowRight size={18} className="mb-3 text-fg-muted" aria-hidden />
        <Field label="振替先" className="w-32">
          <Select value={form.toPurposeId} onChange={(e) => setForm({ ...form, toPurposeId: e.target.value })}>
            {purposes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="金額" className="w-36">
          <Input
            type="number"
            min={1}
            inputMode="numeric"
            className="tabular text-right"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            placeholder="30000"
            required
          />
        </Field>
        <Field label="メモ（任意）" className="min-w-40 flex-1">
          <Input value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} placeholder="例: 10月の積立" />
        </Field>
        <Button variant="primary" type="submit" disabled={busy || purposes.length < 2}>
          <Plus size={14} aria-hidden />
          振替を記録
        </Button>
      </form>

      {error ? <p role="alert" className="text-dns-16N-130 text-error-1">{error}</p> : null}

      {transfers.length === 0 ? (
        <p className="text-sm text-fg-muted">振替の記録はまだありません。</p>
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <caption className="sr-only">使途の振替の記録</caption>
            <thead className="text-xs text-fg-muted">
              <tr className="border-b border-border text-left">
                <th scope="col" className="py-1.5 pr-3 font-medium">日付</th>
                <th scope="col" className="px-2 py-1.5 font-medium">振替</th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">金額</th>
                <th scope="col" className="px-2 py-1.5 font-medium">メモ</th>
                <th scope="col" className="w-12 py-1.5"><span className="sr-only">操作</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {transfers.map((t) => (
                <tr key={t.id}>
                  <td className="tabular whitespace-nowrap py-1.5 pr-3">{t.date.replace(/-/g, "/")}</td>
                  <td className="px-2 py-1.5">
                    {t.fromName} → {t.toName}
                  </td>
                  <td className="tabular px-2 py-1.5 text-right">{formatYen(t.amount)}</td>
                  <td className="px-2 py-1.5 text-fg-muted">{t.memo ?? ""}</td>
                  <td className="py-1.5 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        if (!confirm(`${t.date.replace(/-/g, "/")} の振替（${t.fromName} → ${t.toName} ${formatYen(t.amount)}）を消します。よろしいですか？`)) return;
                        void run(() => api(`/api/purpose-transfers/${t.id}`, { method: "DELETE" }));
                      }}
                      aria-label={`${t.date} ${t.fromName} から ${t.toName} への振替を削除`}
                    >
                      <Trash2 size={13} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
