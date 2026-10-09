"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button, Field, Select } from "@/components/ui";
import { api } from "@/lib/client-api";
import type { MergePlan } from "@/lib/merge-majors";
import type { MajorWithCategories } from "@/lib/view-types";

/**
 * 大項目をまとめる。まとめ元の中項目を、まとめ先の同じ名前の中項目へ付け替える
 * （まとめ元の大項目と同じ名前の中項目は、まとめ先の大項目と同じ名前の中項目へ）。実行前に何がどこへ移るかを確かめる。
 */
export function MajorMerge({ majors }: { majors: MajorWithCategories[] }) {
  const router = useRouter();
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [plan, setPlan] = useState<MergePlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const source = majors.find((m) => m.id === sourceId);

  async function call(dryRun: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api<MergePlan>(`/api/majors/${sourceId}/merge`, { method: "POST", body: { targetMajorId: targetId, dryRun } });
      if (dryRun) setPlan(result);
      else {
        setPlan(null);
        setSourceId("");
        setTargetId("");
        setMessage({ ok: true, text: `「${result.source.name}」を「${result.target.name}」にまとめました（内訳 ${result.counts.splits} 件を付け替え）` });
        router.refresh();
      }
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "まとめられませんでした" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-2 rounded-lg border border-border p-3" aria-label="大項目をまとめる">
      <h3 className="text-std-16B-170">大項目をまとめる</h3>
      <p className="text-xs text-fg-muted">
        まとめ元の中項目を、まとめ先の同じ名前の中項目へ移します（まとめ元の大項目と同じ名前の中項目は、まとめ先の大項目と同じ名前の中項目へ。
        無い名前はまとめ先に作ります）。明細の内訳・予算・予定・分類ルールも付け替え、まとめ元はアーカイブします。金額は変わりません。
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="まとめ元" className="w-44">
          <Select aria-label="まとめ元" value={sourceId} onChange={(e) => { setSourceId(e.target.value); setPlan(null); }}>
            <option value="">選ぶ</option>
            {majors.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <ArrowRight size={18} className="mb-3 text-fg-muted" aria-hidden />
        <Field label="まとめ先" className="w-44">
          <Select aria-label="まとめ先" value={targetId} onChange={(e) => { setTargetId(e.target.value); setPlan(null); }}>
            <option value="">選ぶ</option>
            {majors
              .filter((m) => m.id !== sourceId && (!source || m.kind === source.kind))
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </Select>
        </Field>
        <Button size="sm" onClick={() => void call(true)} disabled={busy || !sourceId || !targetId}>
          何が移るかを見る
        </Button>
      </div>
      {plan ? (
        <div className="space-y-2 text-sm">
          <ul className="space-y-0.5">
            {plan.moves.map((m) => (
              <li key={m.fromId} className="flex flex-wrap gap-x-2">
                <span>{plan.source.name} / {m.fromName}</span>
                <span aria-hidden>→</span>
                <span className="font-bold">{plan.target.name} / {m.toName}</span>
                {m.create ? <span className="text-xs text-fg-muted">（新しく作る）</span> : null}
              </li>
            ))}
          </ul>
          <p className="text-xs text-fg-muted">
            付け替え: 内訳 {plan.counts.splits} 件・予算 {plan.counts.budgets} 件・予定 {plan.counts.plans} 件・分類ルール {plan.counts.rules} 件・二人の明細 {plan.counts.pairEntries} 件。
            「{plan.source.name}」はアーカイブします。
          </p>
          <Button size="sm" variant="primary" onClick={() => void call(false)} disabled={busy}>
            {busy ? "まとめています..." : `「${plan.source.name}」を「${plan.target.name}」にまとめる`}
          </Button>
        </div>
      ) : null}
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-sm" : "text-dns-16N-130 text-error-1"}>
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
