"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { MoveButtons } from "@/components/settings/category-settings";
import { api } from "@/lib/client-api";
import type { CostTypeView } from "@/lib/view-types";

/**
 * 費目の管理。費目は大項目 > 中項目のツリーとは別の軸で、
 * 「旅行かつ食費」「マラソンかつ交通費」のようなクロス集計の列になる。
 * 並び順がそのままクロス集計の列の順になる。
 */
export function CostTypeSettings({ costTypes }: { costTypes: CostTypeView[] }) {
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

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= costTypes.length) return;
    const next = [...costTypes];
    [next[index], next[target]] = [next[target], next[index]];
    void run(() =>
      api("/api/cost-types/reorder", {
        method: "POST",
        body: { ids: next.map((costType) => costType.id) },
      }),
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-std-20B-150 text-solid-gray-900">費目</h2>
        <p className="mt-1 text-xs text-fg-muted">
          食費・交通費・宿泊費のような、お金の種類です。大項目・中項目とは別に、明細の内訳ごとに 1 つ付けられます。
          「まとめ」のクロス集計で、中項目（旅行・マラソンなど）× 費目 の表になります。
          並び順はクロス集計の列の順です。自動分類ルールで、店名から自動で付けることもできます。
        </p>
        <p className="mt-1 text-xs text-fg-muted">
          明細で使っている費目は、削除しても過去の集計が崩れないよう、隠すだけにします。
        </p>
      </div>

      {error ? <p role="alert" className="text-dns-16N-130 text-error-1">{error}</p> : null}

      {costTypes.length === 0 ? (
        <p className="text-sm text-fg-muted">費目はまだありません。</p>
      ) : (
        <ul className="max-w-xl space-y-1">
          {costTypes.map((costType, index) => (
            <li
              key={costType.id}
              className="flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1"
            >
              <input
                className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none"
                defaultValue={costType.name}
                onBlur={(e) => {
                  const next = e.target.value.trim();
                  if (next && next !== costType.name) {
                    void run(() =>
                      api(`/api/cost-types/${costType.id}`, {
                        method: "PATCH",
                        body: { name: next },
                      }),
                    );
                  }
                }}
                aria-label={`${costType.name} の名前`}
              />
              <MoveButtons
                label={costType.name}
                upDisabled={index === 0}
                downDisabled={index === costTypes.length - 1}
                onUp={() => move(index, -1)}
                onDown={() => move(index, 1)}
              />
              <button
                type="button"
                className="rounded p-1 text-fg-muted hover:text-expense"
                onClick={() =>
                  run(() => api(`/api/cost-types/${costType.id}`, { method: "DELETE" }))
                }
                aria-label={`${costType.name} を削除`}
              >
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          void run(async () => {
            await api("/api/cost-types", { method: "POST", body: { name } });
            setName("");
          });
        }}
      >
        <Input
          className="h-8 w-48"
          placeholder="費目を追加（例: 入場料）"
          aria-label="追加する費目の名前"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button size="sm" type="submit" aria-label="費目を追加">
          <Plus size={13} />
        </Button>
      </form>
    </div>
  );
}
