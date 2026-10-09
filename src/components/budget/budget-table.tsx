"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Button, Input, Select } from "@/components/ui";
import { api } from "@/lib/client-api";
import { KIND_META } from "@/lib/category-kind";
import { KIND_VAR } from "@/lib/chart-colors";
import { cn, formatNumber, formatYen } from "@/lib/utils";
import type { BudgetReport, BudgetRow } from "@/lib/budget";
import type { CategoryKind } from "@/lib/db/types";
import type { MajorWithCategories } from "@/lib/view-types";

type Scope = "default" | "month";

/**
 * 中項目ごとの予算と実績。
 * 予算はその場で「毎月」または「この月だけ」として設定できる。
 */
export function BudgetTable({
  report,
  majors,
}: {
  report: BudgetReport;
  majors: MajorWithCategories[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const monthLabel = `${Number(report.month.slice(5))}月`;

  async function saveBudget(body: {
    categoryId: string;
    month: string | null;
    amount: number | null;
    clearOverride?: string;
  }) {
    setError(null);
    try {
      await api("/api/budgets", { method: "PUT", body });
      setEditing(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    }
  }

  const budgeted = new Set(
    report.sections.flatMap((s) => s.rows.filter((r) => r.budget !== null).map((r) => r.categoryId)),
  );

  return (
    <div className="space-y-3">
      {error ? <p role="alert" className="text-dns-16N-130 text-error-1">{error}</p> : null}

      {report.sections.length === 0 ? (
        <p className="text-xs text-fg-muted">
          この月は予算も実績もまだありません。下の「予算を追加」から、食費・日用品など中項目ごとの月の予算を決められます。
        </p>
      ) : (
        <div className="relative overflow-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-xs text-fg-muted">
                <th className="px-3 py-2 text-left font-medium">項目</th>
                <th className="px-3 py-2 text-right font-medium">予算</th>
                <th className="px-3 py-2 text-right font-medium">予定</th>
                <th className="px-3 py-2 text-right font-medium">実績</th>
                <th className="px-3 py-2 text-right font-medium">残り・差</th>
                <th className="w-32 px-3 py-2 text-left font-medium">
                  <span className="sr-only">進み具合</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {report.sections.map((section) => (
                <Fragment key={section.majorId}>
                  <tr className="border-t border-border bg-surface-2/50 font-medium">
                    <th className="px-3 py-2 text-left">
                      <span className="flex items-center gap-1.5">
                        <span
                          className="size-2 rounded-[2px]"
                          style={{ background: KIND_VAR[section.kind] }}
                          aria-hidden
                        />
                        {section.majorName}
                        <span className="text-xs font-normal text-fg-muted">
                          {KIND_META[section.kind].label}
                        </span>
                      </span>
                    </th>
                    <td colSpan={2} className="tabular px-3 py-2 text-right text-xs font-normal text-fg-muted">
                      予 {formatNumber(section.target)}
                    </td>
                    <td className="tabular px-3 py-2 text-right">{formatNumber(section.actual)}</td>
                    <td colSpan={2} />
                  </tr>
                  {section.rows.map((row) => (
                    <Fragment key={row.categoryId}>
                      <Row
                        row={row}
                        kind={section.kind}
                        month={report.month}
                        monthLabel={monthLabel}
                        past={report.phase === "past"}
                        onEdit={() => setEditing(editing === row.categoryId ? null : row.categoryId)}
                      />
                      {editing === row.categoryId ? (
                        <tr className="border-t border-border bg-surface-2/40">
                          <td colSpan={6} className="px-3 py-2">
                            <BudgetEditor
                              row={row}
                              month={report.month}
                              monthLabel={monthLabel}
                              onSave={saveBudget}
                              onCancel={() => setEditing(null)}
                            />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-fg-muted">
        予算が無い中項目は、予定の合計を「予」として比べます。残り・差は、支出系が「予 − 実績」（マイナスは使いすぎ）、
        収入が「実績 − 予」（プラスは予定より多い）です。
        {report.unbudgetedSpending > 0 ? (
          <>
            {" "}このほか、予算も予定も無い中項目への支出が
            <span className="tabular mx-1 font-medium text-fg">{formatYen(report.unbudgetedSpending)}</span>
            あります。
          </>
        ) : null}
      </p>

      <AddBudget
        majors={majors}
        budgeted={budgeted}
        month={report.month}
        monthLabel={monthLabel}
        onSave={saveBudget}
      />
    </div>
  );
}

function Row({
  row,
  kind,
  month,
  monthLabel,
  past,
  onEdit,
}: {
  row: BudgetRow;
  kind: CategoryKind;
  month: string;
  monthLabel: string;
  past: boolean;
  onEdit: () => void;
}) {
  const income = kind === "INCOME";
  const ratio = row.target ? row.actual / row.target : null;
  return (
    <tr className="border-t border-border hover:bg-surface-2">
      <td className="px-3 py-1.5 pl-7 text-left">{row.categoryName}</td>
      <td className="tabular px-3 py-1.5 text-right">
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center gap-1 rounded px-1 hover:bg-surface-2 hover:text-accent"
          aria-label={`${row.categoryName} の予算を編集`}
        >
          {row.budget === null ? (
            <span className="text-fg-muted">未設定</span>
          ) : (
            formatNumber(row.budget)
          )}
          {row.budgetSource === "month" ? (
            <span className="text-xs text-fg-muted">（{monthLabel}だけ）</span>
          ) : null}
          <Pencil size={11} className="text-fg-muted" aria-hidden />
        </button>
      </td>
      <td className="tabular px-3 py-1.5 text-right text-fg-muted">{formatNumber(row.planned)}</td>
      <td className="tabular px-3 py-1.5 text-right">
        {row.actual === 0 ? (
          "-"
        ) : (
          <Link
            href={`/transactions?month=${month}&categoryId=${row.categoryId}`}
            className="hover:text-accent hover:underline"
          >
            {formatNumber(row.actual)}
          </Link>
        )}
      </td>
      <td
        className={cn(
          "tabular px-3 py-1.5 text-right",
          // 収入が予に届かないのは、月の途中なら給料日前というだけなので、過ぎた月だけ赤くする
          row.difference !== null && row.difference < 0 && (row.over || (income && past)) && "text-expense",
        )}
      >
        {row.difference === null
          ? "-"
          : row.difference === 0
            ? "0"
            : `${row.difference > 0 && income ? "+" : ""}${new Intl.NumberFormat("ja-JP").format(row.difference)}`}
      </td>
      <td className="px-3 py-1.5">
        {ratio !== null ? <Progress ratio={ratio} over={row.over} income={income} /> : null}
      </td>
    </tr>
  );
}

/** 予に対する実績の割合。色だけに頼らず、％も文字で出す */
function Progress({ ratio, over, income }: { ratio: number; over: boolean; income: boolean }) {
  const pct = Math.round(ratio * 100);
  const color = income
    ? "bg-income"
    : over
      ? "bg-expense"
      : ratio >= 0.8
        ? "bg-living"
        : "bg-accent";
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className="tabular w-9 text-right text-xs text-fg-muted">{pct}%</span>
    </div>
  );
}

function ScopePicker({
  scope,
  onChange,
  monthLabel,
  name,
}: {
  scope: Scope;
  onChange: (scope: Scope) => void;
  monthLabel: string;
  name: string;
}) {
  return (
    <div className="flex items-center gap-3 text-xs">
      <label className="flex items-center gap-1">
        <input type="radio" name={name} checked={scope === "default"} onChange={() => onChange("default")} />
        毎月
      </label>
      <label className="flex items-center gap-1">
        <input type="radio" name={name} checked={scope === "month"} onChange={() => onChange("month")} />
        {monthLabel}だけ
      </label>
    </div>
  );
}

type SaveBudget = (body: {
  categoryId: string;
  month: string | null;
  amount: number | null;
  clearOverride?: string;
}) => Promise<void>;

function BudgetEditor({
  row,
  month,
  monthLabel,
  onSave,
  onCancel,
}: {
  row: BudgetRow;
  month: string;
  monthLabel: string;
  onSave: SaveBudget;
  onCancel: () => void;
}) {
  const [scope, setScope] = useState<Scope>(row.budgetSource === "month" ? "month" : "default");
  const [amount, setAmount] = useState(row.budget === null ? "" : String(row.budget));
  const [busy, setBusy] = useState(false);

  async function run(body: Parameters<SaveBudget>[0]) {
    setBusy(true);
    await onSave(body);
    setBusy(false);
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    const value = Number(amount);
    if (amount.trim() === "" || !Number.isFinite(value) || value < 0) return;
    void run(
      scope === "month"
        ? { categoryId: row.categoryId, month, amount: value }
        : { categoryId: row.categoryId, month: null, amount: value, clearOverride: month },
    );
  }

  return (
    <form onSubmit={save} className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-fg-muted">{row.categoryName} の予算</span>
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        className="tabular h-8 w-32 text-right"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        aria-label={`${row.categoryName} の予算（円）`}
        autoFocus
      />
      <ScopePicker scope={scope} onChange={setScope} monthLabel={monthLabel} name={`scope-${row.categoryId}`} />
      <Button type="submit" size="sm" variant="primary" disabled={busy}>
        保存
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
        キャンセル
      </Button>
      {row.budgetSource === "month" ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="ml-auto text-xs"
          disabled={busy}
          onClick={() => run({ categoryId: row.categoryId, month, amount: null })}
          title={row.defaultBudget === null ? undefined : `毎月の ${formatYen(row.defaultBudget)} に戻ります`}
        >
          {monthLabel}の上書きを外す
        </Button>
      ) : row.budgetSource === "default" ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="ml-auto text-xs"
          disabled={busy}
          onClick={() => {
            if (confirm(`${row.categoryName} の毎月の予算を外しますか？`)) {
              void run({ categoryId: row.categoryId, month: null, amount: null });
            }
          }}
        >
          毎月の予算を外す
        </Button>
      ) : null}
      {row.budgetSource === "month" && row.defaultBudget !== null ? (
        <p className="w-full text-xs text-fg-muted">
          毎月の予算は {formatYen(row.defaultBudget)} です。「毎月」で保存すると、{monthLabel}の上書きは外れます。
        </p>
      ) : null}
    </form>
  );
}

function AddBudget({
  majors,
  budgeted,
  month,
  monthLabel,
  onSave,
}: {
  majors: MajorWithCategories[];
  budgeted: Set<string>;
  month: string;
  monthLabel: string;
  onSave: SaveBudget;
}) {
  const [open, setOpen] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [scope, setScope] = useState<Scope>("default");
  const [busy, setBusy] = useState(false);

  // 帳尻合わせは集計に入らないので、予算の対象にしない
  const choices = majors
    .filter((major) => major.kind !== "ADJUSTMENT")
    .map((major) => ({
      ...major,
      categories: major.categories.filter((c) => !budgeted.has(c.id)),
    }))
    .filter((major) => major.categories.length > 0);

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus size={14} />
        予算を追加
      </Button>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = Number(amount);
    if (!categoryId || amount.trim() === "" || !Number.isFinite(value) || value < 0) return;
    setBusy(true);
    await onSave({ categoryId, month: scope === "month" ? month : null, amount: value });
    setBusy(false);
    setCategoryId("");
    setAmount("");
    setOpen(false);
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2/40 p-2.5"
    >
      <Select
        className="h-8 w-52"
        value={categoryId}
        onChange={(e) => setCategoryId(e.target.value)}
        aria-label="予算を決める中項目"
      >
        <option value="">中項目を選ぶ</option>
        {choices.map((major) => (
          <optgroup key={major.id} label={`${major.name}（${KIND_META[major.kind].label}）`}>
            {major.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        placeholder="金額"
        className="tabular h-8 w-32 text-right"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        aria-label="予算（円）"
      />
      <ScopePicker scope={scope} onChange={setScope} monthLabel={monthLabel} name="scope-new" />
      <Button type="submit" size="sm" variant="primary" disabled={busy || !categoryId || amount === ""}>
        追加
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
        キャンセル
      </Button>
    </form>
  );
}
