"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button, Card, CardBody, EmptyState } from "@/components/ui";
import { FilterBar } from "@/components/transactions/filter-bar";
import { TransactionTable } from "@/components/transactions/transaction-table";
import { NewTransactionForm } from "@/components/transactions/new-transaction-form";
import { formatYen } from "@/lib/utils";
import type {
  CostTypeView,
  MajorWithCategories,
  PaymentMethodView,
  TransactionView,
} from "@/lib/view-types";

export function TransactionsView({
  transactions,
  total,
  sum,
  page,
  pageSize,
  majors,
  paymentMethods,
  costTypes,
}: {
  transactions: TransactionView[];
  total: number;
  sum: number;
  page: number;
  pageSize: number;
  majors: MajorWithCategories[];
  paymentMethods: PaymentMethodView[];
  costTypes: CostTypeView[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [adding, setAdding] = useState(false);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  function pageHref(next: number) {
    const query = new URLSearchParams(params.toString());
    query.set("page", String(next));
    return `/transactions?${query.toString()}`;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-std-28B-150 text-solid-gray-900">明細</h1>
        <Button variant="primary" size="sm" onClick={() => setAdding((v) => !v)}>
          <Plus size={15} />
          手入力で追加
        </Button>
      </div>

      {adding ? (
        <NewTransactionForm
          majors={majors}
          costTypes={costTypes}
          paymentMethods={paymentMethods}
          onDone={() => {
            setAdding(false);
            router.refresh();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : null}

      <Card>
        <CardBody className="pt-4">
          <FilterBar majors={majors} paymentMethods={paymentMethods} costTypes={costTypes} />
        </CardBody>
      </Card>

      <div className="flex flex-wrap items-baseline gap-3 text-xs text-fg-muted">
        <span>
          {total.toLocaleString("ja-JP")} 件
          {pageCount > 1 ? `（${page} / ${pageCount} ページ）` : ""}
        </span>
        <span>
          絞り込み合計
          <span className="tabular ml-1 font-medium text-fg">{formatYen(sum)}</span>
        </span>
        <span className="text-xs">
          ※ 払い戻しは差し引いた合計です。収入と支出が混ざった条件では意味が薄いので、
          種別で絞って見てください（純残高は「まとめ」で見られます）。
        </span>
      </div>

      {transactions.length === 0 ? (
        <EmptyState
          title="条件に合う明細がありません"
          description="絞り込み条件を変えるか、CSV を取り込んでください。"
          action={
            <Link href="/import" className="mt-2">
              <Button size="sm">CSV を取り込む</Button>
            </Link>
          }
        />
      ) : (
        <TransactionTable
          transactions={transactions}
          majors={majors}
          costTypes={costTypes}
          paymentMethods={paymentMethods}
        />
      )}

      {pageCount > 1 ? (
        <div className="flex items-center justify-center gap-2 text-sm">
          {page > 1 ? (
            <Link href={pageHref(page - 1)}>
              <Button size="sm">前へ</Button>
            </Link>
          ) : null}
          <span className="tabular text-xs text-fg-muted">
            {page} / {pageCount}
          </span>
          {page < pageCount ? (
            <Link href={pageHref(page + 1)}>
              <Button size="sm">次へ</Button>
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
