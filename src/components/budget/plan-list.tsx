"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { PlanForm, type PlanInput } from "@/components/budget/plan-form";
import { api } from "@/lib/client-api";
import { KIND_META } from "@/lib/category-kind";
import { KIND_VAR } from "@/lib/chart-colors";
import { formatYen } from "@/lib/utils";
import type { BudgetReport, PlanOccurrence } from "@/lib/budget";
import type {
  MajorWithCategories,
  PaymentMethodView,
  PlanView,
} from "@/lib/view-types";

/**
 * その月の予定の一覧。明細と突き合わせた結果（済・予定・期日超過）を出し、
 * その場で予定そのもの（毎月の設定）を追加・変更できる。
 */
export function PlanList({
  report,
  plans,
  majors,
  paymentMethods,
}: {
  report: BudgetReport;
  plans: PlanView[];
  majors: MajorWithCategories[];
  paymentMethods: PaymentMethodView[];
}) {
  const router = useRouter();
  /** "new" = 追加フォーム、それ以外は編集中の予定 id */
  const [editing, setEditing] = useState<string | null>(null);
  const [showOthers, setShowOthers] = useState(false);
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const occurring = new Set(report.plans.map((occ) => occ.planId));
  const others = plans.filter((plan) => !occurring.has(plan.id));

  async function save(id: string | null, input: PlanInput) {
    if (id) await api(`/api/plans/${id}`, { method: "PATCH", body: input });
    else await api("/api/plans", { method: "POST", body: input });
    setEditing(null);
    router.refresh();
  }

  async function remove(id: string) {
    await api(`/api/plans/${id}`, { method: "DELETE" });
    setEditing(null);
    router.refresh();
  }

  function form(plan: PlanView | null) {
    return (
      <PlanForm
        key={plan?.id ?? "new"}
        plan={plan}
        majors={majors}
        paymentMethods={paymentMethods}
        onSubmit={(input) => save(plan?.id ?? null, input)}
        onCancel={() => setEditing(null)}
        onDelete={plan ? () => remove(plan.id) : undefined}
      />
    );
  }

  return (
    <div className="space-y-3">
      {report.plans.length === 0 && editing !== "new" ? (
        <p className="text-xs text-fg-muted">
          この月の予定はありません。給料日・家賃・カードの引き落とし・積立など、毎月決まって動くお金を登録すると、
          明細と自動で突き合わせて「済」「まだ」を出し、月末の見込みに反映します。
        </p>
      ) : null}

      {report.plans.length > 0 ? (
        <ul className="divide-y divide-border border-y border-border">
          {report.plans.map((occ) => {
            const plan = planById.get(occ.planId);
            return (
              <li key={occ.planId} className="py-2">
                <OccurrenceRow
                  occ={occ}
                  phase={report.phase}
                  onEdit={() => setEditing(editing === occ.planId ? null : occ.planId)}
                />
                {editing === occ.planId && plan ? <div className="mt-2">{form(plan)}</div> : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {editing === "new" ? (
        form(null)
      ) : (
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus size={14} />
          予定を追加
        </Button>
      )}

      {others.length > 0 ? (
        <div className="border-t border-border pt-2">
          <button
            type="button"
            className="text-xs text-fg-muted hover:text-fg"
            onClick={() => setShowOthers((v) => !v)}
            aria-expanded={showOthers}
          >
            {showOthers ? "▾" : "▸"} この月には無い予定（停止中・期間外）{others.length} 件
          </button>
          {showOthers ? (
            <ul className="mt-2 space-y-1.5">
              {others.map((plan) => (
                <li key={plan.id}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
                    <span className="text-fg">{plan.name}</span>
                    <span className="text-xs">
                      {plan.majorName} / {plan.categoryName} ・ 毎月 {plan.day === 31 ? "月末" : `${plan.day} 日`}
                      {plan.startMonth || plan.endMonth
                        ? ` ・ ${plan.startMonth?.replace("-", "/") ?? ""}〜${plan.endMonth?.replace("-", "/") ?? ""}`
                        : ""}
                    </span>
                    {!plan.enabled ? <Badge>停止中</Badge> : null}
                    <span className="tabular ml-auto">{formatYen(plan.amount)}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing(editing === plan.id ? null : plan.id)}
                      aria-label={`${plan.name} を編集`}
                    >
                      <Pencil size={13} />
                    </Button>
                  </div>
                  {editing === plan.id ? <div className="mt-2">{form(plan)}</div> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function OccurrenceRow({
  occ,
  phase,
  onEdit,
}: {
  occ: PlanOccurrence;
  phase: BudgetReport["phase"];
  onEdit: () => void;
}) {
  const sign = occ.kind === "INCOME" ? "+" : occ.kind === "ADJUSTMENT" ? "" : "−";
  return (
    <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[2.75rem_minmax(0,1fr)_auto_auto]">
      <span className="tabular text-xs text-fg-muted">
        {Number(occ.date.slice(5, 7))}/{Number(occ.date.slice(8))}
      </span>
      <div className="min-w-0">
        <p className="flex min-w-0 items-center gap-1.5 text-sm">
          <span
            className="size-2 shrink-0 rounded-[2px]"
            style={{ background: KIND_VAR[occ.kind] }}
            aria-hidden
          />
          <span className="truncate">{occ.name}</span>
          <StatusBadge status={occ.status} phase={phase} />
        </p>
        <p className="text-xs text-fg-muted [overflow-wrap:anywhere]">
          {occ.majorName} / {occ.categoryName}（{KIND_META[occ.kind].label}）
          {occ.actual ? (
            <>
              {" ・ "}
              <Link
                href={`/transactions?month=${occ.actual.date.slice(0, 7)}&categoryId=${occ.categoryId}`}
                className="link"
              >
                {occ.actual.date.slice(5).replace("-", "/")} {occ.actual.description}
              </Link>
            </>
          ) : null}
        </p>
      </div>
      <div className="col-span-2 col-start-2 row-start-2 text-right sm:col-span-1 sm:col-start-3 sm:row-start-1">
        <p className="tabular text-sm font-bold">
          {sign}
          {formatYen(occ.actual ? occ.actual.amount : occ.planned)}
        </p>
        {occ.actual && occ.difference ? (
          <p className="tabular text-xs text-fg-muted">
            予定 {formatYen(occ.planned)}（{formatYen(occ.difference, { sign: true })}）
          </p>
        ) : !occ.actual ? (
          <p className="text-xs text-fg-muted">予定額</p>
        ) : null}
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={onEdit}
        aria-label={`${occ.name} を編集`}
        className="col-start-3 row-start-1 sm:col-start-4"
      >
        <Pencil size={14} />
      </Button>
    </div>
  );
}

function StatusBadge({
  status,
  phase,
}: {
  status: PlanOccurrence["status"];
  phase: BudgetReport["phase"];
}) {
  if (status === "done") {
    return <Badge tone="green">済</Badge>;
  }
  if (status === "late") {
    return (
      <Badge
        tone="red"
        title="予定日を過ぎていますが、同じ中項目の明細が見つかりません。取込がまだか、別の中項目に分類されていないか確認してください。"
      >
        {phase === "past" ? "明細なし" : "期日超過"}
      </Badge>
    );
  }
  return <Badge>まだ</Badge>;
}
