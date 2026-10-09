"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";
import { api } from "@/lib/client-api";

export function PresetSettings({ presets }: { presets: { id: string; name: string }[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  if (presets.length === 0) {
    return (
      <EmptyState
        title="保存されたプリセットはありません"
        description="CSV 取込画面で列の対応づけを行い、「プリセットとして保存」するとここに並びます。カード会社ごとに 1 つ作っておくと次回から選ぶだけで取り込めます。"
      />
    );
  }

  async function remove(id: string, name: string) {
    if (!confirm(`プリセット「${name}」を削除します。よろしいですか？`)) return;
    setError(null);
    try {
      await api(`/api/import/presets/${id}`, { method: "DELETE" });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました");
    }
  }

  return (
    <div className="space-y-3">
      <h2 className="text-std-20B-150 text-solid-gray-900">取込プリセット</h2>
      {error ? <p role="alert" className="text-dns-16N-130 text-error-1">{error}</p> : null}
      <ul className="divide-y divide-border rounded-lg border border-border">
        {presets.map((preset) => (
          <li key={preset.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span className="flex-1">{preset.name}</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => remove(preset.id, preset.name)}
              aria-label={`${preset.name} を削除`}
            >
              <Trash2 size={13} />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
