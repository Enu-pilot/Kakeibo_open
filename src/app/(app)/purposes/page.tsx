import Link from "next/link";
import { loadSnapshotForPage } from "@/lib/db/store";
import { SetupError } from "@/components/setup-error";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { activePurposes } from "@/lib/db/queries";
import { getAccountBalances } from "@/lib/balances";
import { monthRange } from "@/lib/aggregate";
import { getPurposeBalances } from "@/lib/purposes";
import { thisMonthInTokyo, todayInTokyo } from "@/lib/today";
import { PurposeBalances } from "@/components/purposes/purpose-balances";
import { PurposeTransfers } from "@/components/purposes/purpose-transfers";

export const dynamic = "force-dynamic";

/** 振替の記録を何件まで並べるか */
const MAX_TRANSFERS = 100;

export default async function PurposesPage() {
  const loaded = await loadSnapshotForPage();
  if ("error" in loaded) return <SetupError message={loaded.error} />;
  const db = loaded.db;
  const today = todayInTokyo();
  const { year, month, key } = thisMonthInTokyo();
  const { from, to } = monthRange(year, month);
  const balances = getPurposeBalances(db, from, to, today);
  const accounts = getAccountBalances(db);
  const purposes = activePurposes(db);
  const names = new Map(db.purposes.map((p) => [p.id, p.name]));
  const transfers = [...db.purposeTransfers]
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_TRANSFERS)
    .map((t) => ({
      id: t.id,
      date: t.date,
      fromName: names.get(t.fromPurposeId) ?? "（不明）",
      toName: names.get(t.toPurposeId) ?? "（不明）",
      amount: t.amount,
      memo: t.memo,
    }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-std-28B-150 text-solid-gray-900">使途</h1>
        <p className="text-xs text-fg-muted">
          口座残高とは別に、「そのお金は何のぶんか」ごとの残高を出します。
          残高 = 起点残高 ＋ 収入 − 支出 ± 振替。起点残高と、大項目ごとの使途は{" "}
          <Link href="/settings" className="link">設定</Link> で決めます。
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>使途ごとの残高</CardTitle>
        </CardHeader>
        <CardBody>
          <PurposeBalances
            purposes={balances}
            monthLabel={key.replace("-", "/")}
            accountTotal={accounts.length > 0 ? accounts.reduce((sum, a) => sum + a.balance, 0) : null}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>使途の振替</CardTitle>
          <p className="mt-1 text-xs text-fg-muted">
            給料を「個人」で受けてから「投資」「彼女」へ回す、家族から受けた補助を「生活費」へ回す、のように
            使途の間でお金を動かしたときに記録します。口座の残高は変わりません。
          </p>
        </CardHeader>
        <CardBody>
          <PurposeTransfers purposes={purposes} transfers={transfers} today={today} />
        </CardBody>
      </Card>
    </div>
  );
}
