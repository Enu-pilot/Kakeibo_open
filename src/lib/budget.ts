/**
 * 予実（予算・予定と実績の比較）と、月末の見込み。
 *
 * 用語:
 *  - 予算: 中項目ごとの月の上限・目安。毎月の既定と、特定の月だけの上書きを持てる
 *  - 予定: 「毎月◯日に◯円」の 1 回ぶんの入金・支払い（給料・家賃・NISA 積立など）
 *  - 予（目標）: その月・その中項目の予算。予算が無ければ予定の合計。
 *    同じ中項目に予算と予定の両方があっても二重には数えない
 *
 * 予定と明細の突き合わせ:
 *   同じ中項目・同じ月の内訳のうち、金額がいちばん近いものを実績とみなす（同じくらいなら日付が近いもの）。
 *   1 つの内訳は 1 つの予定にしか使わない。docomo と Netflix のように同じ中項目の予定が
 *   複数あっても、それぞれに対応づけられる。
 *
 * 見込み（楽観的にならないように決めている）:
 *  - 支出・生活費・投資 = 実績 ＋ まだ来ていない予定 ＋ 予算の残り（予算は使い切る前提）
 *  - 収入             = 実績 ＋ まだ来ていない予定（収入の予算は目標であって確約ではない）
 *  - 口座残高          = 今の残高 ± まだ来ていない予定（予算はどの口座から出るか決まらないので含めない）
 */
import type { CategoryKind, Plan } from "@/lib/db/types";
import type { Snapshot } from "@/lib/db/store";
import { byOrderThenName, categoryResolver, indexById } from "@/lib/db/queries";
import { emptyKindTotals, netBalance, type KindTotals } from "@/lib/aggregate";
import { getAccountBalances } from "@/lib/balances";

export type PlanStatus = "done" | "pending" | "late";

export type PlanOccurrence = {
  planId: string;
  name: string;
  /** その月の予定日 "YYYY-MM-DD"（月末より大きい日は月末日） */
  date: string;
  categoryId: string;
  categoryName: string;
  majorName: string;
  kind: CategoryKind;
  planned: number;
  paymentMethodId: string | null;
  transferToId: string | null;
  memo: string | null;
  /** 突き合わせた明細。まだ来ていなければ null */
  actual: { transactionId: string; description: string; date: string; amount: number } | null;
  /** 実績 − 予定（来ていなければ null） */
  difference: number | null;
  status: PlanStatus;
};

export type BudgetRow = {
  categoryId: string;
  categoryName: string;
  /** その月に効いている予算 */
  budget: number | null;
  /** その予算が「この月だけ」の上書きか「毎月」の既定か */
  budgetSource: "month" | "default" | null;
  /** 毎月の既定（編集画面用） */
  defaultBudget: number | null;
  /** その月の予定の合計 */
  planned: number;
  /** 予（予算、無ければ予定の合計）。どちらも無ければ null */
  target: number | null;
  actual: number;
  /**
   * 支出系: 予 − 実績（残り。マイナスは使いすぎ）
   * 収入:   実績 − 予（プラスは予定より多い）
   */
  difference: number | null;
  over: boolean;
};

export type BudgetSection = {
  majorId: string;
  majorName: string;
  kind: CategoryKind;
  color: string;
  rows: BudgetRow[];
  target: number;
  actual: number;
};

export type AccountForecast = {
  id: string;
  name: string;
  kind: string;
  /** 今の残高 */
  current: number;
  /** その月の月末の見込み */
  forecast: number;
  /** 見込みに効いている、まだ来ていない予定 */
  pending: { name: string; date: string; amount: number }[];
};

export type BudgetReport = {
  /** "YYYY-MM" */
  month: string;
  /** 日本時間の今日 */
  today: string;
  /** 過ぎた月・今月・先の月 */
  phase: "past" | "current" | "future";
  plans: PlanOccurrence[];
  sections: BudgetSection[];
  target: KindTotals;
  actual: KindTotals;
  forecast: KindTotals;
  net: { target: number; actual: number; forecast: number };
  /**
   * 支出系中項目の「予（予算、無ければ予定）」のうち、まだ使っていない額の合計。
   * 月末までにあといくら出ていく見込みか、の目安になる
   */
  remainingBudget: number;
  /** 予算を超えた中項目の数 */
  overCount: number;
  /** 予算も予定も無い支出系の実績（予算外の支出） */
  unbudgetedSpending: number;
  /** 過ぎた月は null */
  accounts: AccountForecast[] | null;
};

const SPENDING: CategoryKind[] = ["EXPENSE", "LIVING", "INVESTMENT"];
const isSpending = (kind: CategoryKind) => SPENDING.includes(kind);

/** "2026-09" の月末日 */
function lastDay(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function addMonths(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** その月に効いている予算（月の上書き → 毎月の既定 の順） */
export function effectiveBudget(db: Snapshot, categoryId: string, month: string) {
  const own = db.budgets.filter((b) => b.categoryId === categoryId);
  const monthly = own.find((b) => b.month === month);
  const byDefault = own.find((b) => b.month === null);
  if (monthly) return { amount: monthly.amount, source: "month" as const, defaultAmount: byDefault?.amount ?? null };
  if (byDefault) return { amount: byDefault.amount, source: "default" as const, defaultAmount: byDefault.amount };
  return { amount: null, source: null, defaultAmount: null };
}

/** その月に発生する予定か */
export function planAppliesTo(plan: Plan, month: string) {
  if (!plan.enabled) return false;
  if (plan.startMonth && month < plan.startMonth) return false;
  if (plan.endMonth && month > plan.endMonth) return false;
  return true;
}

function planDate(plan: Plan, month: string) {
  const day = Math.min(Math.max(1, plan.day || 1), lastDay(month));
  return `${month}-${String(day).padStart(2, "0")}`;
}

/**
 * ある月の予定を展開し、明細と突き合わせる。
 * 中項目が見つからない予定（手で消した場合など）は種別が決まらないので出さない。
 */
export function plansForMonth(db: Snapshot, month: string, today: string): PlanOccurrence[] {
  const resolve = categoryResolver(db);
  const transactions = indexById(db.transactions);

  // 突き合わせの候補: その月の内訳を中項目ごとに
  const candidates = new Map<string, { transactionId: string; description: string; date: string; amount: number }[]>();
  for (const split of db.splits) {
    const tx = transactions.get(split.transactionId);
    if (!tx || tx.date.slice(0, 7) !== month) continue;
    const list = candidates.get(split.categoryId) ?? [];
    list.push({ transactionId: tx.id, description: tx.description, date: tx.date, amount: split.amount });
    candidates.set(split.categoryId, list);
  }

  const occurrences: PlanOccurrence[] = [];
  for (const plan of db.plans) {
    if (!planAppliesTo(plan, month)) continue;
    const found = resolve(plan.categoryId);
    if (!found) continue;
    occurrences.push({
      planId: plan.id,
      name: plan.name,
      date: planDate(plan, month),
      categoryId: plan.categoryId,
      categoryName: found.category.name,
      majorName: found.major.name,
      kind: found.major.kind,
      planned: plan.amount,
      paymentMethodId: plan.paymentMethodId,
      transferToId: plan.transferToId,
      memo: plan.memo,
      actual: null,
      difference: null,
      status: "pending",
    });
  }

  // 金額の大きい予定から先に、いちばん近い明細を取る
  const byAmount = [...occurrences].sort((a, b) => b.planned - a.planned);
  for (const occ of byAmount) {
    const pool = candidates.get(occ.categoryId);
    if (!pool || pool.length === 0) continue;
    let best = 0;
    const dayDiff = (d: string) => Math.abs(Date.parse(d) - Date.parse(occ.date));
    for (let i = 1; i < pool.length; i++) {
      const a = Math.abs(pool[i].amount - occ.planned);
      const b = Math.abs(pool[best].amount - occ.planned);
      if (a < b || (a === b && dayDiff(pool[i].date) < dayDiff(pool[best].date))) best = i;
    }
    const [match] = pool.splice(best, 1);
    occ.actual = match;
    occ.difference = Math.round((match.amount - occ.planned) * 100) / 100;
    occ.status = "done";
  }

  for (const occ of occurrences) {
    if (occ.status !== "done" && occ.date < today) occ.status = "late";
  }
  return occurrences.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, "ja"));
}

/** 口座残高への効き方（入金 +、支払い −、移動は移動元 − ・移動先 +） */
function balanceEffects(occ: PlanOccurrence): [string, number][] {
  const effects: [string, number][] = [];
  if (occ.kind === "ADJUSTMENT") {
    // 移動先の無い帳尻合わせは、明細と同じく残高に効かせない
    if (occ.paymentMethodId && occ.transferToId) {
      effects.push([occ.paymentMethodId, -occ.planned], [occ.transferToId, occ.planned]);
    }
    return effects;
  }
  if (occ.paymentMethodId) {
    effects.push([occ.paymentMethodId, occ.kind === "INCOME" ? occ.planned : -occ.planned]);
  }
  return effects;
}

export function getBudgetReport(db: Snapshot, month: string, today: string): BudgetReport {
  const currentMonth = today.slice(0, 7);
  const phase = month < currentMonth ? "past" : month > currentMonth ? "future" : "current";
  const plans = plansForMonth(db, month, today);

  // 中項目ごとの実績
  const resolve = categoryResolver(db);
  const transactions = indexById(db.transactions);
  const actualByCategory = new Map<string, number>();
  for (const split of db.splits) {
    const tx = transactions.get(split.transactionId);
    if (!tx || tx.date.slice(0, 7) !== month || !resolve(split.categoryId)) continue;
    actualByCategory.set(split.categoryId, (actualByCategory.get(split.categoryId) ?? 0) + split.amount);
  }

  const plannedByCategory = new Map<string, number>();
  const unmatchedByCategory = new Map<string, number>();
  for (const occ of plans) {
    plannedByCategory.set(occ.categoryId, (plannedByCategory.get(occ.categoryId) ?? 0) + occ.planned);
    if (!occ.actual) {
      unmatchedByCategory.set(occ.categoryId, (unmatchedByCategory.get(occ.categoryId) ?? 0) + occ.planned);
    }
  }

  const target = emptyKindTotals();
  const actual = emptyKindTotals();
  const forecast = emptyKindTotals();
  let remainingBudget = 0;
  let overCount = 0;
  let unbudgetedSpending = 0;

  const sections: BudgetSection[] = [];
  for (const major of db.majors.filter((m) => !m.archivedAt).sort(byOrderThenName)) {
    const rows: BudgetRow[] = [];
    for (const category of db.categories.filter((c) => c.majorId === major.id).sort(byOrderThenName)) {
      const budget = effectiveBudget(db, category.id, month);
      const planned = plannedByCategory.get(category.id) ?? 0;
      const spent = round(actualByCategory.get(category.id) ?? 0);
      const rowTarget = budget.amount ?? (planned > 0 ? planned : null);
      // 予も実績も無い中項目は出さない。アーカイブ済みの中項目は、その月に実績があるときだけ出す
      // （過去の月を正しく見せるため。予算が残っていても、使わなくなった中項目は出さない）
      if (rowTarget === null && spent === 0) continue;
      if (category.archivedAt && spent === 0) continue;

      const spending = isSpending(major.kind);
      const difference =
        rowTarget === null ? null : round(spending ? rowTarget - spent : spent - rowTarget);
      const over = spending && rowTarget !== null && spent > rowTarget;
      rows.push({
        categoryId: category.id,
        categoryName: category.name,
        budget: budget.amount,
        budgetSource: budget.source,
        defaultBudget: budget.defaultAmount,
        planned: round(planned),
        target: rowTarget,
        actual: spent,
        difference,
        over,
      });

      target[major.kind] += rowTarget ?? 0;
      actual[major.kind] += spent;
      if (spending && rowTarget !== null) remainingBudget += Math.max(0, rowTarget - spent);
      if (over) overCount++;
      if (spending && rowTarget === null) unbudgetedSpending += spent;

      // 見込み
      if (phase === "past") {
        forecast[major.kind] += spent;
      } else {
        const unmatched = unmatchedByCategory.get(category.id) ?? 0;
        // 予算があれば、予定ぶんを除いた残りも使い切る前提で見込む（支出系のみ）
        const rest = spending && budget.amount !== null ? Math.max(0, budget.amount - spent - unmatched) : 0;
        forecast[major.kind] += spent + unmatched + rest;
      }
    }
    if (rows.length === 0) continue;
    sections.push({
      majorId: major.id,
      majorName: major.name,
      kind: major.kind,
      color: major.color,
      rows,
      target: round(rows.reduce((s, r) => s + (r.target ?? 0), 0)),
      actual: round(rows.reduce((s, r) => s + r.actual, 0)),
    });
  }

  return {
    month,
    today,
    phase,
    plans,
    sections,
    target: roundTotals(target),
    actual: roundTotals(actual),
    forecast: roundTotals(forecast),
    net: {
      target: round(netBalance(target)),
      actual: round(netBalance(actual)),
      forecast: round(netBalance(forecast)),
    },
    remainingBudget: round(remainingBudget),
    overCount,
    unbudgetedSpending: round(unbudgetedSpending),
    accounts: phase === "past" ? null : accountForecasts(db, month, today),
  };
}

/**
 * 口座ごとの月末の見込み。
 * 今月なら「今の残高 ± 今月まだ来ていない予定」、先の月ならその月末までに来る予定をすべて足し引きする。
 */
function accountForecasts(db: Snapshot, month: string, today: string): AccountForecast[] {
  const accounts = getAccountBalances(db).map((a) => ({
    id: a.id,
    name: a.name,
    kind: a.kind,
    current: a.balance,
    forecast: a.balance,
    pending: [] as AccountForecast["pending"],
  }));
  const byId = new Map(accounts.map((a) => [a.id, a]));

  for (let m = today.slice(0, 7); m <= month; m = addMonths(m, 1)) {
    for (const occ of plansForMonth(db, m, today)) {
      if (occ.actual) continue;
      for (const [accountId, amount] of balanceEffects(occ)) {
        const account = byId.get(accountId);
        if (!account) continue;
        account.forecast = round(account.forecast + amount);
        account.pending.push({ name: occ.name, date: occ.date, amount });
      }
    }
  }
  return accounts;
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

function roundTotals(t: KindTotals): KindTotals {
  return {
    INCOME: round(t.INCOME),
    EXPENSE: round(t.EXPENSE),
    LIVING: round(t.LIVING),
    INVESTMENT: round(t.INVESTMENT),
    ADJUSTMENT: round(t.ADJUSTMENT),
  };
}
