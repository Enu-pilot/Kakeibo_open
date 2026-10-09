/**
 * スプレッドシートの整合性チェック（npm run sheets:check）。
 *
 * Postgres では外部キーと制約が防いでいた壊れ方を、スプレッドシートを手で直すと
 * 起こせてしまう。ここではそれを見つけて知らせるだけで、勝手には直さない
 * （どう直すのが正しいかは、消した理由によって変わるため）。
 */
import type { Snapshot } from "@/lib/db/store";
import { SCHEMA } from "@/lib/db/schema";
import { indexById, splitsByTransaction } from "@/lib/db/queries";

export type Issue = { tab: string; id: string; message: string };

export function checkIntegrity(db: Snapshot): Issue[] {
  const issues: Issue[] = [];
  const transactions = indexById(db.transactions);
  const categories = indexById(db.categories);
  const majors = indexById(db.majors);
  const methods = indexById(db.paymentMethods);
  const splits = splitsByTransaction(db);

  for (const split of db.splits) {
    if (!transactions.has(split.transactionId)) {
      issues.push({
        tab: SCHEMA.splits.title,
        id: split.id,
        message: `明細 ${split.transactionId} が見つかりません（明細の行だけ消した可能性があります）`,
      });
    }
    if (!categories.has(split.categoryId)) {
      issues.push({
        tab: SCHEMA.splits.title,
        id: split.id,
        message: `中項目 ${split.categoryId} が見つかりません。この内訳は集計に入りません`,
      });
    }
  }

  for (const category of db.categories) {
    if (!majors.has(category.majorId)) {
      issues.push({
        tab: SCHEMA.categories.title,
        id: category.id,
        message: `「${category.name}」の大項目 ${category.majorId} が見つかりません`,
      });
    }
  }

  for (const tx of db.transactions) {
    const own = splits.get(tx.id) ?? [];
    if (!tx.date) {
      issues.push({ tab: SCHEMA.transactions.title, id: tx.id, message: `「${tx.description}」の日付を読み取れません` });
    }
    if (own.length === 0) {
      issues.push({
        tab: SCHEMA.transactions.title,
        id: tx.id,
        message: `「${tx.description}」に内訳がありません。集計に入りません`,
      });
      continue;
    }
    const total = own.reduce((sum, s) => sum + Math.round(s.amount * 100), 0) / 100;
    if (Math.abs(total - tx.amount) >= 0.005) {
      issues.push({
        tab: SCHEMA.transactions.title,
        id: tx.id,
        message: `「${tx.description}」の金額 ${tx.amount} と内訳の合計 ${total} が一致しません（集計は内訳の合計を使います）`,
      });
    }
    for (const [key, label] of [
      ["paymentMethodId", "決済手段"],
      ["transferToId", "移動先"],
    ] as const) {
      const ref = tx[key];
      if (ref && !methods.has(ref)) {
        issues.push({
          tab: SCHEMA.transactions.title,
          id: tx.id,
          message: `「${tx.description}」の${label} ${ref} が見つかりません`,
        });
      }
    }
  }

  for (const budget of db.budgets) {
    if (!categories.has(budget.categoryId)) {
      issues.push({
        tab: SCHEMA.budgets.title,
        id: budget.id,
        message: `予算の中項目 ${budget.categoryId} が見つかりません`,
      });
    }
  }
  const budgetKeys = new Set<string>();
  for (const budget of db.budgets) {
    const key = `${budget.categoryId}|${budget.month ?? "毎月"}`;
    if (budgetKeys.has(key)) {
      issues.push({
        tab: SCHEMA.budgets.title,
        id: budget.id,
        message: `同じ中項目・同じ月（${budget.month ?? "毎月"}）の予算が複数あります。先の行だけが使われます`,
      });
    }
    budgetKeys.add(key);
  }

  for (const plan of db.plans) {
    if (!categories.has(plan.categoryId)) {
      issues.push({
        tab: SCHEMA.plans.title,
        id: plan.id,
        message: `予定「${plan.name}」の中項目 ${plan.categoryId} が見つかりません`,
      });
    }
    if (!(plan.day >= 1 && plan.day <= 31)) {
      issues.push({ tab: SCHEMA.plans.title, id: plan.id, message: `予定「${plan.name}」の日（${plan.day}）が 1〜31 ではありません` });
    }
    if (plan.startMonth && plan.endMonth && plan.startMonth > plan.endMonth) {
      issues.push({ tab: SCHEMA.plans.title, id: plan.id, message: `予定「${plan.name}」の開始月が終了月より後です` });
    }
    for (const [key, label] of [
      ["paymentMethodId", "決済手段"],
      ["transferToId", "移動先"],
    ] as const) {
      const ref = plan[key];
      if (ref && !methods.has(ref)) {
        issues.push({ tab: SCHEMA.plans.title, id: plan.id, message: `予定「${plan.name}」の${label} ${ref} が見つかりません` });
      }
    }
  }

  const costTypes = new Set(db.costTypes.map((c) => c.id));
  for (const rule of db.rules) {
    if (rule.categoryId && !categories.has(rule.categoryId)) {
      issues.push({
        tab: SCHEMA.rules.title,
        id: rule.id,
        message: `キーワード「${rule.keyword}」の中項目 ${rule.categoryId} が見つかりません`,
      });
    }
    if (rule.costTypeId && !costTypes.has(rule.costTypeId)) {
      issues.push({
        tab: SCHEMA.rules.title,
        id: rule.id,
        message: `キーワード「${rule.keyword}」の費目 ${rule.costTypeId} が見つかりません`,
      });
    }
    if (!rule.categoryId && !rule.costTypeId) {
      issues.push({
        tab: SCHEMA.rules.title,
        id: rule.id,
        message: `キーワード「${rule.keyword}」に中項目も費目もありません（どちらか一方が必要です）`,
      });
    }
  }
  for (const split of db.splits) {
    if (split.costTypeId && !costTypes.has(split.costTypeId)) {
      issues.push({
        tab: SCHEMA.splits.title,
        id: split.id,
        message: `内訳の費目 ${split.costTypeId} が見つかりません（クロス集計では「未設定」として数えます）`,
      });
    }
  }
  const costTypeNames = new Map<string, number>();
  for (const c of db.costTypes) costTypeNames.set(c.name, (costTypeNames.get(c.name) ?? 0) + 1);
  for (const [name, count] of costTypeNames) {
    if (count > 1) issues.push({ tab: SCHEMA.costTypes.title, id: name, message: `費目「${name}」が ${count} 行あります（名前は 1 つにしてください）` });
  }

  const purposes = new Set(db.purposes.map((p) => p.id));
  for (const major of db.majors) {
    if (major.purposeId && !purposes.has(major.purposeId)) {
      issues.push({
        tab: SCHEMA.majors.title,
        id: major.id,
        message: `大項目「${major.name}」の使途 ${major.purposeId} が見つかりません（使途の残高では「未設定」として数えます）`,
      });
    }
  }
  for (const transfer of db.purposeTransfers) {
    for (const [key, label] of [
      ["fromPurposeId", "振替元"],
      ["toPurposeId", "振替先"],
    ] as const) {
      if (!purposes.has(transfer[key])) {
        issues.push({
          tab: SCHEMA.purposeTransfers.title,
          id: transfer.id,
          message: `使途振替（${transfer.date}）の${label} ${transfer[key]} が見つかりません（残高に数えません）`,
        });
      }
    }
    if (!(transfer.amount > 0)) {
      issues.push({ tab: SCHEMA.purposeTransfers.title, id: transfer.id, message: `使途振替（${transfer.date}）の金額は正の数にしてください` });
    }
  }
  const purposeNames = new Map<string, number>();
  for (const p of db.purposes) purposeNames.set(p.name, (purposeNames.get(p.name) ?? 0) + 1);
  for (const [name, count] of purposeNames) {
    if (count > 1) issues.push({ tab: SCHEMA.purposes.title, id: name, message: `使途「${name}」が ${count} 行あります（名前は 1 つにしてください）` });
  }

  // 二人の明細（LINE ボットと共有）。GAS が足した列や「過去分の取込」タブは読まないので、ここでは数の食い違いだけを見る
  const settlements = indexById(db.pairSettlements);
  for (const entry of db.pairEntries) {
    if (entry.deletedAt) continue;
    const label = `二人の明細「${entry.description}」（${entry.date}）`;
    if (Math.round(entry.ownerShare + entry.partnerShare) !== Math.round(entry.amount)) {
      issues.push({ tab: SCHEMA.pairEntries.title, id: entry.id, message: `${label}のオーナー負担とパートナー負担の合計が金額と合いません` });
    }
    if (entry.settlementId && !settlements.has(entry.settlementId)) {
      issues.push({ tab: SCHEMA.pairEntries.title, id: entry.id, message: `${label}の精算 ${entry.settlementId} が見つかりません（精算済みとして扱います）` });
    }
    if ((entry.sync === "DONE" || entry.sync === "LINKED") && (!entry.householdTxId || !transactions.has(entry.householdTxId))) {
      issues.push({ tab: SCHEMA.pairEntries.title, id: entry.id, message: `${label}を書いた家計簿の明細が見つかりません（「二人」ページで直すと書き直されます）` });
    }
  }

  return issues;
}
