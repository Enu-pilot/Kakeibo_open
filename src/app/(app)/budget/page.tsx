import { Suspense } from "react";
import { loadSnapshotForPage } from "@/lib/db/store";
import { SetupError } from "@/components/setup-error";
import {
  activePaymentMethods,
  byOrderThenName,
  categoryResolver,
  majorsWithCategories,
  toPaymentMethodView,
} from "@/lib/db/queries";
import { getBudgetReport } from "@/lib/budget";
import { resolveMonthParam, todayInTokyo } from "@/lib/today";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { MonthPicker } from "@/components/month-picker";
import { BudgetSummary } from "@/components/budget/budget-summary";
import { PlanList } from "@/components/budget/plan-list";
import { BudgetTable } from "@/components/budget/budget-table";
import { AccountForecastList } from "@/components/budget/account-forecast";
import type { PlanView } from "@/lib/view-types";

export const dynamic = "force-dynamic";

export default async function BudgetPage({ searchParams }: PageProps<"/budget">) {
  const params = await searchParams;
  const { key, month } = resolveMonthParam(params.month);

  const loaded = await loadSnapshotForPage();
  if ("error" in loaded) return <SetupError message={loaded.error} />;
  const db = loaded.db;

  const report = getBudgetReport(db, key, todayInTokyo());
  const resolve = categoryResolver(db);
  const plans: PlanView[] = [...db.plans]
    .sort((a, b) => a.day - b.day || a.name.localeCompare(b.name, "ja"))
    .map((plan) => {
      const found = resolve(plan.categoryId);
      return {
        id: plan.id,
        name: plan.name,
        categoryId: plan.categoryId,
        amount: plan.amount,
        day: plan.day,
        paymentMethodId: plan.paymentMethodId,
        transferToId: plan.transferToId,
        startMonth: plan.startMonth,
        endMonth: plan.endMonth,
        enabled: plan.enabled,
        memo: plan.memo,
        categoryName: found?.category.name ?? "（不明な中項目）",
        majorName: found?.major.name ?? "不明",
        kind: found?.major.kind ?? "EXPENSE",
      };
    });
  const paymentMethods = activePaymentMethods(db).sort(byOrderThenName).map(toPaymentMethodView);
  const monthLabel = `${month}月`;
  const hasAccounts = report.accounts !== null && report.accounts.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-std-28B-150 text-solid-gray-900">予実</h1>
          <p className="text-xs text-fg-muted">
            予算と毎月の予定（給料・家賃など）を、明細の実績と突き合わせます。
          </p>
        </div>
        <Suspense fallback={null}>
          <MonthPicker month={key} />
        </Suspense>
      </div>

      <BudgetSummary report={report} />

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className={hasAccounts ? "lg:col-span-3" : "lg:col-span-5"}>
          <CardHeader className="flex items-baseline justify-between">
            <CardTitle>{monthLabel}の予定</CardTitle>
            <span className="hidden text-xs text-fg-muted sm:inline">
              同じ中項目の明細のうち、金額が近いものを実績とみなします
            </span>
          </CardHeader>
          <CardBody>
            <PlanList
              report={report}
              plans={plans}
              majors={majorsWithCategories(db)}
              paymentMethods={paymentMethods}
            />
          </CardBody>
        </Card>

        {hasAccounts && report.accounts ? (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>口座残高の見込み（{monthLabel}末）</CardTitle>
            </CardHeader>
            <CardBody>
              <AccountForecastList accounts={report.accounts} monthLabel={monthLabel} />
            </CardBody>
          </Card>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>予算と実績（中項目ごと）</CardTitle>
        </CardHeader>
        <CardBody>
          <BudgetTable report={report} majors={majorsWithCategories(db)} />
        </CardBody>
      </Card>
    </div>
  );
}
