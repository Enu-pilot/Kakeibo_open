import { loadSnapshotForPage } from "@/lib/db/store";
import { SetupError } from "@/components/setup-error";
import {
  activeCostTypes,
  activePaymentMethods,
  majorsWithCategories,
  makeTransactionViewer,
  toCostTypeView,
  toPaymentMethodView,
} from "@/lib/db/queries";
import { filterTransactions, parseFilters } from "@/lib/filters";
import { TransactionsView } from "@/components/transactions/transactions-view";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

export default async function TransactionsPage({ searchParams }: PageProps<"/transactions">) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") query.set(key, value);
  }

  const filters = parseFilters(query);
  const page = Math.max(1, Number(query.get("page") ?? 1));

  const loaded = await loadSnapshotForPage();
  if ("error" in loaded) return <SetupError message={loaded.error} />;
  const db = loaded.db;
  // 合計はカテゴリ条件に合う内訳だけを足す（分割した明細を中項目で絞ったとき、
  // 総額ではなくその内訳ぶんが出るようにするため）
  const { transactions, sum } = filterTransactions(db, filters);
  const toView = makeTransactionViewer(db);

  return (
    <TransactionsView
      transactions={transactions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(toView)}
      total={transactions.length}
      sum={sum}
      page={page}
      pageSize={PAGE_SIZE}
      majors={majorsWithCategories(db)}
      paymentMethods={activePaymentMethods(db).map(toPaymentMethodView)}
      costTypes={activeCostTypes(db).map(toCostTypeView)}
    />
  );
}
