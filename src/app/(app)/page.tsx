import Link from "next/link";
import { Suspense } from "react";
import { loadSnapshotForPage } from "@/lib/db/store";
import { SetupError } from "@/components/setup-error";
import { byDateDesc, makeTransactionViewer } from "@/lib/db/queries";
import {
  getCategoryBreakdown,
  getKindTotals,
  monthRange,
  netBalance,
} from "@/lib/aggregate";
import { getFlowRings, getPurposeBalances, getPurposeTrend } from "@/lib/purposes";
import { getAccountBalances } from "@/lib/balances";
import { KIND_META } from "@/lib/category-kind";
import { KIND_VAR } from "@/lib/chart-colors";
import { Card, CardBody, CardHeader, CardTitle, EmptyState, Button } from "@/components/ui";
import { StatTile } from "@/components/stat-tile";
import { MonthPicker } from "@/components/month-picker";
import { PurposeTrendChart } from "@/components/charts/purpose-trend";
import { FlowRingsChart } from "@/components/charts/flow-rings";
import { PurposeBalances } from "@/components/purposes/purpose-balances";
import { CategoryBars } from "@/components/charts/category-bars";
import { TransactionRow } from "@/components/transaction-row";
import { AccountBalances } from "@/components/account-balances";
import { BudgetGlance } from "@/components/budget/budget-glance";
import { getBudgetReport } from "@/lib/budget";
import { resolveMonthParam, todayInTokyo } from "@/lib/today";
import { pairBalanceSummary } from "@/lib/pair-view";
import { formatYen } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: PageProps<"/">) {
  const params = await searchParams;
  const { year, month, key } = resolveMonthParam(params.month);
  const { from, to } = monthRange(year, month);

  // 1 画面ぶんの集計を、スプレッドシートを 1 回読んだ結果から全部作る
  const loaded = await loadSnapshotForPage();
  if ("error" in loaded) return <SetupError message={loaded.error} />;
  const db = loaded.db;
  const totals = getKindTotals(db, from, to);
  const today = todayInTokyo();
  const purposeBalances = getPurposeBalances(db, from, to, today);
  const purposeTrend = getPurposeTrend(db, year, month, 12);
  // 二重円グラフは「全体」と使途ごとに用意して、画面で切り替える
  const ringViews = [
    { id: "all", name: "全体", rings: getFlowRings(db, from, to, null) },
    ...purposeBalances.map((p) => ({ id: p.id, name: p.name, rings: getFlowRings(db, from, to, p.id) })),
  ];
  const breakdown = getCategoryBreakdown(db, from, to, ["EXPENSE", "LIVING"]);
  const accounts = getAccountBalances(db);
  const pair = pairBalanceSummary(db);
  const totalCount = db.transactions.length;
  const toView = makeTransactionViewer(db);
  // 直近の登録は「登録した順」なので日付ではなく作成日時で並べる
  const recent = [...db.transactions]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || byDateDesc(a, b))
    .slice(0, 8)
    .map(toView);

  const net = netBalance(totals);
  // 予算も予定も無ければ、予実カードの代わりに登録の案内だけ出す
  const hasBudget = db.budgets.length > 0 || db.plans.length > 0;
  const budgetReport = hasBudget ? getBudgetReport(db, key, today) : null;
  const monthLabel = key.replace("-", "/");

  if (totalCount === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-std-28B-150 text-solid-gray-900">ダッシュボード</h1>
        <EmptyState
          title="まだ明細がありません"
          description="カードや PayPay の CSV を取り込むか、手入力で 1 件登録すると、ここに今月の収支・推移・内訳が表示されます。"
          action={
            <div className="mt-2 flex gap-2">
              <Link href="/import">
                <Button variant="primary" size="sm">
                  CSV を取り込む
                </Button>
              </Link>
              <Link href="/transactions">
                <Button size="sm">手入力する</Button>
              </Link>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-std-28B-150 text-solid-gray-900">ダッシュボード</h1>
        <Suspense fallback={null}>
          <MonthPicker month={key} />
        </Suspense>
      </div>

      <section
        aria-label="今月の収支サマリー"
        className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5"
      >
        <StatTile
          label={KIND_META.INCOME.label}
          value={totals.INCOME}
          color={KIND_VAR.INCOME}
        />
        <StatTile label={KIND_META.EXPENSE.label} value={totals.EXPENSE} color={KIND_VAR.EXPENSE} />
        <StatTile label="生活費" value={totals.LIVING} color={KIND_VAR.LIVING} />
        <StatTile
          label="投資"
          value={totals.INVESTMENT}
          color={KIND_VAR.INVESTMENT}
        />
        <StatTile
          label="純残高"
          value={net}
          hint="収入 − 支出 − 生活費 − 投資"
          emphasis
        />
      </section>

      {totals.ADJUSTMENT > 0 ? (
        <p className="text-xs text-fg-muted">
          このほか帳尻合わせ（チャージ・振替）が
          <span className="tabular mx-1 font-medium text-fg">
            {totals.ADJUSTMENT.toLocaleString("ja-JP")}円
          </span>
          あります。資産が口座間を移動するだけなので集計には含めていません。
        </p>
      ) : null}

      <BudgetGlance report={budgetReport} month={key} />

      <Card>
        <CardHeader className="flex flex-wrap items-baseline justify-between gap-x-3">
          <CardTitle>使途ごとの残高</CardTitle>
          <span className="text-xs text-fg-muted">
            残高は今日まで、収入・支出・振替は {monthLabel} の分 ・{" "}
            <Link href="/purposes" className="link">振替を記録する</Link>
          </span>
        </CardHeader>
        <CardBody>
          <PurposeBalances
            purposes={purposeBalances}
            monthLabel={monthLabel}
            accountTotal={accounts.length > 0 ? accounts.reduce((sum, a) => sum + a.balance, 0) : null}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>使途ごとの月別推移（直近 12 か月）</CardTitle>
          <p className="mt-1 text-xs text-fg-muted">
            使途ごとに、入ったお金と出たお金の釣り合いを見ます。縦軸の目盛りは使途ごとに違います。
          </p>
        </CardHeader>
        <CardBody>
          <PurposeTrendChart
            data={purposeTrend}
            balances={Object.fromEntries(purposeBalances.map((p) => [p.id, p.balance]))}
          />
        </CardBody>
      </Card>

      {pair ? (
        <Card>
          <CardBody className="flex flex-wrap items-baseline gap-x-4 gap-y-1 pt-4">
            <h2 className="text-std-16B-170">二人の未精算</h2>
            <p className="text-sm">
              {pair.balance.count === 0
                ? "未精算はありません"
                : pair.balance.payer && pair.balance.receiver
                  ? `${pair.names[pair.balance.payer]} → ${pair.names[pair.balance.receiver]}`
                  : "差額 0 円"}
              {pair.balance.count > 0 ? (
                <span className="tabular ml-2 font-bold">{formatYen(pair.balance.amount)}</span>
              ) : null}
              <span className="ml-2 text-xs text-fg-muted">{pair.balance.count} 件</span>
            </p>
            <Link href="/pair" className="link ml-auto text-xs">
              二人のページへ
            </Link>
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>お金の出入り（{monthLabel}）</CardTitle>
            <p className="mt-1 text-xs text-fg-muted">
              内側が入ってきたお金、外側が使ったお金（中項目ごと）。足りないぶんは「貯金から」、残ったぶんは「貯金へ」。
            </p>
          </CardHeader>
          <CardBody>
            <FlowRingsChart views={ringViews} />
          </CardBody>
        </Card>

        {accounts.length > 0 ? (
          <Card>
            <CardHeader className="flex items-baseline justify-between">
              <CardTitle>口座残高</CardTitle>
              <span className="text-xs text-fg-muted">
                チャージ・振替を口座間の移動として反映
              </span>
            </CardHeader>
            <CardBody>
              <AccountBalances accounts={accounts} />
            </CardBody>
          </Card>
        ) : null}

        {/* 横棒は長さで比較するため、カードが 3 枚になる月は幅いっぱいに広げる */}
        <Card className={accounts.length > 0 ? "lg:col-span-2" : undefined}>
          <CardHeader>
            <CardTitle>中項目の内訳（支出・生活費）</CardTitle>
          </CardHeader>
          <CardBody>
            <CategoryBars items={breakdown} month={key} />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex items-baseline justify-between">
          <CardTitle>直近の登録</CardTitle>
          <Link
            href="/transactions"
            className="text-xs link"
          >
            すべて見る
          </Link>
        </CardHeader>
        <CardBody className="px-0 pb-0">
          <ul className="divide-y divide-border border-t border-border">
            {recent.map((item) => (
              <TransactionRow
                key={item.id}
                transaction={{
                  id: item.id,
                  date: item.date,
                  description: item.description,
                  amount: item.amount,
                  splits: item.splits.map((split) => ({
                    categoryName: split.category.name,
                    majorName: split.category.major.name,
                    kind: split.category.major.kind,
                    amount: split.amount,
                  })),
                  paymentMethodName: item.paymentMethod?.name ?? null,
                }}
              />
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
