"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Trash2, Upload } from "lucide-react";
import { Badge, Button, Select, Textarea } from "@/components/ui";
import { KIND_META, KIND_ORDER } from "@/lib/category-kind";
import { api } from "@/lib/client-api";
import { normalizeDescription } from "@/lib/normalize";
import { parseSummaryOutline, type OutlineMajor } from "@/lib/summary-outline";
import type { CategoryKind } from "@/lib/db/types";
import type { MajorWithCategories } from "@/lib/view-types";

type BulkResult = {
  createdMajors: string[];
  existingMajors: string[];
  createdCategories: number;
  keptCategories: number;
  restoredCategories: number;
  kindMismatch: { name: string; current: CategoryKind; pasted: CategoryKind }[];
};

/**
 * まとめシートの項目一覧（大項目 / 中項目の 2 列）を貼り付けて、
 * 足りない大項目・中項目をまとめて作る。
 *
 * 貼り付けた内容はそのまま作らず、**必ず確認の表を挟む**。
 * 種別はブロック名から推測するが、純残高の計算に直結するため
 * 作る前に選び直せるようにしてある。
 */
export function BulkCategoryImport({ majors }: { majors: MajorWithCategories[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [rows, setRows] = useState<OutlineMajor[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function read() {
    const outline = parseSummaryOutline(text);
    setRows(outline.majors);
    setWarnings(outline.warnings);
    setResult(null);
    setError(null);
  }

  function update(index: number, patch: Partial<OutlineMajor>) {
    setRows((prev) =>
      prev ? prev.map((row, i) => (i === index ? { ...row, ...patch } : row)) : prev,
    );
  }

  async function create() {
    if (!rows || rows.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const data = await api<BulkResult>("/api/categories/bulk", {
        method: "POST",
        body: {
          majors: rows.map((row) => ({
            name: row.name,
            kind: row.kind,
            categories: row.categories,
          })),
        },
      });
      setResult(data);
      setRows(null);
      setText("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "作成に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  const totalCategories = rows?.reduce((n, row) => n + row.categories.length, 0) ?? 0;

  return (
    <div className="border-t border-border pt-4">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-1.5 text-sm font-medium"
      >
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        まとめの項目を貼り付けて一括作成
      </button>

      {!open ? (
        <p className="mt-1 pl-5 text-xs text-fg-muted">
          まとめシートの項目名の範囲を貼り付けると、足りない大項目・中項目をまとめて作ります。
        </p>
      ) : null}

      {open ? (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-fg-muted">
            まとめシートの項目名の範囲を、そのまま貼り付けてください（2 列の組が左右に並んでいても読めます）。
            <code className="mx-1 rounded bg-surface-2 px-1">★XX合計</code>
            の行を種別、
            <code className="mx-1 rounded bg-surface-2 px-1">--- 小計 ---</code>
            の行を大項目として読みます。
            <strong className="ml-1 font-medium text-fg">足すだけで、消したり書き換えたりはしません。</strong>
          </p>

          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="ここに貼り付け（タブ区切りの 2 列）"
            className="min-h-[120px] font-mono text-xs"
            spellCheck={false}
          />

          <div className="flex items-center gap-2">
            <Button onClick={read} disabled={text.trim() === ""}>
              読み込む
            </Button>
            {rows ? (
              <Button
                variant="primary"
                onClick={create}
                disabled={saving || rows.length === 0}
              >
                <Upload size={15} aria-hidden />
                {saving
                  ? "作成中…"
                  : `${rows.length} 大項目 / ${totalCategories} 中項目を作成`}
              </Button>
            ) : null}
          </div>

          {error ? <p role="alert" className="text-dns-16N-130 text-error-1">{error}</p> : null}

          {warnings.length > 0 ? (
            <div className="rounded-lg border border-living/40 bg-living/10 px-3 py-2">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                <AlertTriangle size={13} aria-hidden />
                確認してください
              </p>
              <ul className="space-y-0.5 text-xs text-fg-muted">
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {rows ? (
            <ul className="space-y-1.5">
              {rows.map((row, index) => (
                <PreviewRow
                  key={`${row.name}-${index}`}
                  row={row}
                  majors={majors}
                  onChange={(patch) => update(index, patch)}
                  onRemove={() =>
                    setRows((prev) => prev?.filter((_, i) => i !== index) ?? prev)
                  }
                />
              ))}
            </ul>
          ) : null}

          {result ? (
            <div className="space-y-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs">
              <p className="font-medium">
                大項目 {result.createdMajors.length} 件 / 中項目{" "}
                {result.createdCategories} 件を作成しました
              </p>
              {result.existingMajors.length > 0 ? (
                <p className="text-fg-muted">
                  既にあった大項目: {result.existingMajors.join("、")}
                </p>
              ) : null}
              {result.keptCategories > 0 ? (
                <p className="text-fg-muted">
                  既にあった中項目 {result.keptCategories} 件はそのままにしました
                </p>
              ) : null}
              {result.restoredCategories > 0 ? (
                <p className="text-fg-muted">
                  アーカイブ済みだった中項目 {result.restoredCategories} 件を戻しました
                </p>
              ) : null}
              {result.kindMismatch.map((item) => (
                <p key={item.name} className="text-living">
                  「{item.name}」の種別は {KIND_META[item.current].label} のままです
                  （貼り付けた内容は {KIND_META[item.pasted].label}）。
                  変えたい場合は上の一覧で切り替えてください。
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PreviewRow({
  row,
  majors,
  onChange,
  onRemove,
}: {
  row: OutlineMajor;
  majors: MajorWithCategories[];
  onChange: (patch: Partial<OutlineMajor>) => void;
  onRemove: () => void;
}) {
  const existing = majors.find(
    (major) => normalizeDescription(major.name) === normalizeDescription(row.name),
  );
  const known = new Set(
    existing?.categories.map((category) => normalizeDescription(category.name)) ?? [],
  );
  const added = row.categories.filter(
    (name) => !known.has(normalizeDescription(name)),
  );

  return (
    <li className="rounded-lg border border-border px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          className="h-7 w-40 rounded-md border border-border bg-surface px-2 text-xs outline-none focus:outline-2 focus:outline-offset-[-1px] focus:outline-accent"
          value={row.name}
          onChange={(e) => onChange({ name: e.target.value })}
          aria-label="大項目名"
        />
        <Select
          className="h-7 w-32 text-xs"
          value={row.kind}
          onChange={(e) => onChange({ kind: e.target.value as CategoryKind })}
          aria-label={`${row.name} の種別`}
          disabled={Boolean(existing)}
        >
          {KIND_ORDER.map((kind) => (
            <option key={kind} value={kind}>
              {KIND_META[kind].label}
            </option>
          ))}
        </Select>
        {existing ? (
          <Badge>既存</Badge>
        ) : (
          <Badge tone="blue">新規</Badge>
        )}
        {!row.kindResolved && !existing ? (
          <span className="text-xs text-living">種別を確認してください</span>
        ) : null}
        <span className="ml-auto text-xs text-fg-muted">
          中項目 {row.categories.length} 件
          {added.length !== row.categories.length ? `（新規 ${added.length}）` : ""}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="rounded p-1 text-fg-muted hover:text-expense"
          aria-label={`${row.name} を一覧から外す`}
        >
          <Trash2 size={12} />
        </button>
      </div>
      <p className="mt-1 text-xs text-fg-muted">{row.categories.join(" / ")}</p>
      {existing && existing.kind !== row.kind ? (
        <p className="mt-1 text-xs text-living">
          既にある大項目なので、種別は {KIND_META[existing.kind].label} のままです
        </p>
      ) : null}
    </li>
  );
}
