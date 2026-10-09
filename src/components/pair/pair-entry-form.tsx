"use client";

import { useState } from "react";
import { Button, Field, Input, Select } from "@/components/ui";
import { api } from "@/lib/client-api";
import { formatYen } from "@/lib/utils";
import { computeShares } from "@/lib/pair";
import type { PairRole, ShareMode } from "@/lib/db/types";
import type { PairEntryView, PairNames, PairPageData } from "@/lib/pair-view";

type Draft = {
  date: string;
  description: string;
  amount: string;
  payer: PairRole;
  mode: ShareMode;
  ownerShare: string;
  costTypeId: string;
  categoryId: string;
  methodId: string;
  memo: string;
};

function draftOf(entry: PairEntryView | null, today: string, options: PairPageData["options"]): Draft {
  if (!entry) {
    return {
      date: today,
      description: "",
      amount: "",
      payer: "OWNER",
      mode: "HALF",
      ownerShare: "",
      costTypeId: "",
      categoryId: "",
      methodId: options.defaultMethodId ?? "",
      memo: "",
    };
  }
  return {
    date: entry.date,
    description: entry.description,
    amount: String(entry.amount),
    payer: entry.payer,
    mode: entry.mode,
    ownerShare: String(entry.ownerShare),
    costTypeId: entry.costTypeId ?? "",
    categoryId: entry.categoryId ?? "",
    methodId: entry.methodId ?? options.defaultMethodId ?? "",
    memo: entry.memo ?? "",
  };
}

/**
 * 二人の明細を 1 件登録・修正するフォーム。使った総額を入れ、払った人と負担の割り方を選ぶ。
 * 保存すると本体の家計簿（明細・内訳）にも、LINE ボットと同じ規則で書かれる。
 */
export function PairEntryForm({
  entry,
  names,
  options,
  today,
  onDone,
  onCancel,
}: {
  /** 修正するときの明細。null なら新規 */
  entry: PairEntryView | null;
  names: PairNames;
  options: PairPageData["options"];
  today: string;
  onDone: (warning: string | null) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(entry, today, options));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const amount = Math.round(Number(draft.amount));
  const validAmount = amount > 0;
  const custom = draft.mode === "CUSTOM" ? { ownerShare: Number(draft.ownerShare || 0) } : null;
  const shares = validAmount ? computeShares(amount, draft.payer, draft.mode, custom) : null;
  const method = options.methods.find((m) => m.id === draft.methodId);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!validAmount) {
      setError("金額を入れてください");
      return;
    }
    setBusy(true);
    setError(null);
    const body = {
      date: draft.date,
      description: draft.description.trim(),
      amount,
      payer: draft.payer,
      mode: draft.mode,
      ownerShare: draft.mode === "CUSTOM" ? Math.round(Number(draft.ownerShare || 0)) : null,
      costTypeId: draft.costTypeId || null,
      categoryId: draft.categoryId || null,
      methodId: draft.payer === "OWNER" ? draft.methodId || null : null,
      memo: draft.memo.trim() || null,
    };
    try {
      const result = await api<{ warning: string | null }>(entry ? `/api/pair/entries/${entry.id}` : "/api/pair/entries", {
        method: entry ? "PATCH" : "POST",
        body,
      });
      onDone(result.warning);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3" aria-label={entry ? "二人の明細を直す" : "二人の明細を登録"}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="日付">
          <Input aria-label="日付" type="date" className="tabular" value={draft.date} onChange={(e) => set({ date: e.target.value })} required />
        </Field>
        <Field label="内容" className="lg:col-span-2">
          <Input aria-label="内容" value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder="例: ランチ" maxLength={100} required />
        </Field>
        <Field label="金額（総額）">
          <Input
            aria-label="金額（総額）"
            type="number"
            min={1}
            inputMode="numeric"
            className="tabular text-right"
            value={draft.amount}
            onChange={(e) => set({ amount: e.target.value })}
            placeholder="3000"
            required
          />
        </Field>
        <Field label="払った人">
          <Select aria-label="払った人" value={draft.payer} onChange={(e) => set({ payer: e.target.value as PairRole })}>
            <option value="OWNER">{names.OWNER}</option>
            <option value="PARTNER">{names.PARTNER}</option>
          </Select>
        </Field>
        <Field label="負担">
          <Select
            aria-label="負担"
            value={draft.mode}
            onChange={(e) => {
              const mode = e.target.value as ShareMode;
              set({ mode, ownerShare: mode === "CUSTOM" && shares ? String(shares.ownerShare) : draft.ownerShare });
            }}
          >
            <option value="HALF">割り勘</option>
            <option value="ALL_OWNER">全額{names.OWNER}</option>
            <option value="ALL_PARTNER">全額{names.PARTNER}</option>
            <option value="CUSTOM">金額を指定</option>
          </Select>
        </Field>
        {draft.mode === "CUSTOM" ? (
          <Field label={`${names.OWNER}の負担`}>
            <Input
              aria-label={`${names.OWNER}の負担`}
              type="number"
              min={0}
              max={validAmount ? amount : undefined}
              inputMode="numeric"
              className="tabular text-right"
              value={draft.ownerShare}
              onChange={(e) => set({ ownerShare: e.target.value })}
            />
          </Field>
        ) : null}
        {draft.payer === "OWNER" ? (
          <Field
            label="決済手段"
            hint={method?.kind === "CARD" ? "カード払いは本体に書かず、CSV 取込で入った明細の内訳を分けます（照合）" : undefined}
          >
            <Select value={draft.methodId} onChange={(e) => set({ methodId: e.target.value })}>
              {options.methods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="費目">
          <Select aria-label="費目" value={draft.costTypeId} onChange={(e) => set({ costTypeId: e.target.value })}>
            <option value="">{entry ? "なし" : "内容から自動"}</option>
            {options.costTypes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="中項目（自分の負担の入れ先）">
          <Select aria-label="中項目（自分の負担の入れ先）" value={draft.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
            <option value="">{options.defaultCategoryName}（既定）</option>
            {options.categories
              .filter((c) => c.name !== options.defaultCategoryName)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="メモ（任意）" className="sm:col-span-2">
          <Input aria-label="メモ（任意）" value={draft.memo} onChange={(e) => set({ memo: e.target.value })} maxLength={200} />
        </Field>
      </div>

      {shares ? (
        <p className="text-sm" aria-live="polite">
          {names.OWNER}の負担 <span className="tabular font-bold">{formatYen(shares.ownerShare)}</span>
          {" ・ "}
          {names.PARTNER}の負担 <span className="tabular font-bold">{formatYen(shares.partnerShare)}</span>
          <span className="text-xs text-fg-muted">（割り勘の端数は払った人が持ちます）</span>
        </p>
      ) : null}
      {error ? <p role="alert" className="text-dns-16N-130 text-error-1">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          {busy ? "保存中..." : entry ? "直す" : "登録"}
        </Button>
        <Button type="button" size="sm" onClick={onCancel} disabled={busy}>
          キャンセル
        </Button>
      </div>
    </form>
  );
}
