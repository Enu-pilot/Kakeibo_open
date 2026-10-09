"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import { MoveButtons } from "@/components/settings/category-settings";
import { api } from "@/lib/client-api";
import type { MajorWithCategories, PurposeView } from "@/lib/view-types";

/**
 * 使途の管理。使途は大項目の上に立つ「お金の持ち主」の単位で、使途ごとに残高を持つ。
 * 起点残高と起点日は、口座残高と同じ考え方（この日の時点でこの使途に割り当てていたお金）。
 */
export function PurposeSettings({
  purposes,
  majors,
}: {
  purposes: PurposeView[];
  majors: MajorWithCategories[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新に失敗しました");
    }
  }

  const patch = (id: string, body: Record<string, unknown>) =>
    run(() => api(`/api/purposes/${id}`, { method: "PATCH", body }));

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= purposes.length) return;
    const next = [...purposes];
    [next[index], next[target]] = [next[target], next[index]];
    void run(() => api("/api/purposes/reorder", { method: "POST", body: { ids: next.map((p) => p.id) } }));
  }

  const majorsOf = (purposeId: string) => majors.filter((m) => m.purposeId === purposeId).map((m) => m.name);
  const unassigned = majors.filter((m) => !m.purposeId && m.kind !== "ADJUSTMENT").map((m) => m.name);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-std-20B-150 text-solid-gray-900">使途</h2>
        <p className="mt-1 text-xs text-fg-muted">
          個人・生活費・投資のような「そのお金は何のぶんか」の分け方です。大項目ごとに使途を決めると
          （「カテゴリ」タブ）、使途ごとに 起点残高 ＋ 収入 − 支出 ± 振替 の残高が出ます。
          使途の間でお金を回したときは <Link href="/purposes" className="link">使途</Link> 画面で振替を記録します。
        </p>
        <p className="mt-1 text-xs text-fg-muted">
          起点残高は、起点日の時点でその使途に割り当てていたお金です。起点日より前の明細と振替は数えません。
          帳尻合わせ（チャージ・口座間の移動）は誰のお金も増減させないので、使途の残高には効きません。
        </p>
      </div>

      {error ? <p role="alert" className="text-dns-16N-130 text-error-1">{error}</p> : null}

      <ul className="space-y-2">
        {purposes.map((purpose, index) => {
          const owned = majorsOf(purpose.id);
          return (
            <li key={purpose.id} className="rounded-lg border border-border px-2.5 py-2">
              <div className="flex flex-wrap items-end gap-2">
                <Field label="名前" className="w-36">
                  <Input
                    className="h-8"
                    defaultValue={purpose.name}
                    onBlur={(e) => {
                      const next = e.target.value.trim();
                      if (next && next !== purpose.name) void patch(purpose.id, { name: next });
                    }}
                    aria-label={`${purpose.name} の名前`}
                  />
                </Field>
                <Field label="起点残高" className="w-36">
                  <Input
                    type="number"
                    className="tabular h-8 text-right"
                    defaultValue={purpose.openingBalance}
                    onBlur={(e) => {
                      const value = Number(e.target.value);
                      if (Number.isFinite(value) && value !== purpose.openingBalance) {
                        void patch(purpose.id, { openingBalance: value });
                      }
                    }}
                    aria-label={`${purpose.name} の起点残高`}
                  />
                </Field>
                <Field label="起点日" className="w-44">
                  <Input
                    type="date"
                    className="tabular h-8"
                    defaultValue={purpose.openingBalanceAt ?? ""}
                    onBlur={(e) => {
                      const next = e.target.value || null;
                      if (next !== purpose.openingBalanceAt) void patch(purpose.id, { openingBalanceAt: next });
                    }}
                    aria-label={`${purpose.name} の起点日`}
                  />
                </Field>
                <div className="ml-auto flex items-center gap-1 pb-1">
                  <MoveButtons
                    label={purpose.name}
                    upDisabled={index === 0}
                    downDisabled={index === purposes.length - 1}
                    onUp={() => move(index, -1)}
                    onDown={() => move(index, 1)}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => run(() => api(`/api/purposes/${purpose.id}`, { method: "DELETE" }))}
                    aria-label={`${purpose.name} を削除`}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </div>
              <p className="mt-1.5 text-xs text-fg-muted">
                大項目: {owned.length > 0 ? owned.join("、") : "まだありません（「カテゴリ」タブで使途を選んでください）"}
              </p>
            </li>
          );
        })}
      </ul>

      {unassigned.length > 0 ? (
        <p className="text-xs text-fg-muted">
          使途が未設定の大項目: {unassigned.join("、")}（使途の残高では「未設定」にまとめて出します）
        </p>
      ) : null}

      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          void run(async () => {
            await api("/api/purposes", { method: "POST", body: { name } });
            setName("");
          });
        }}
      >
        <Input
          className="h-8 w-48"
          placeholder="使途を追加（例: 旅行積立）"
          aria-label="追加する使途の名前"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button size="sm" type="submit" aria-label="使途を追加">
          <Plus size={13} />
        </Button>
      </form>
    </div>
  );
}
