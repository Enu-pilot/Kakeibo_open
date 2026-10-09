/**
 * 「二人」ページに渡すデータを組み立てる（サーバー側だけで使う）。
 * LINE のユーザー ID は画面に渡さない。呼び名は「LINE連携」タブの表示名を使う。
 */
import type { Snapshot } from "@/lib/db/store";
import type { PairEntry, PairRole, PairSync, ShareMode } from "@/lib/db/types";
import { getAccountBalances } from "@/lib/balances";
import { computeBalance, isOpen, owedToOwner, summarize, type PairBalance } from "@/lib/pair";
import { PAIR_SETTINGS, loadPairMaster, missingTargets } from "@/lib/pair-household";
import { buildMatchReport, type MatchReport } from "@/lib/pair-match";
import { buildTogether, partnerMajorIds, type TogetherData } from "@/lib/pair-together";
import { categoryResolver, splitsByTransaction } from "@/lib/db/queries";

export type PairNames = { OWNER: string; PARTNER: string };

export type PairEntryView = {
  id: string;
  date: string;
  description: string;
  amount: number;
  payer: PairRole;
  mode: ShareMode;
  ownerShare: number;
  partnerShare: number;
  costTypeId: string | null;
  costTypeName: string | null;
  /** 自分の負担を入れる中項目。null は既定（パートナー） */
  categoryId: string | null;
  categoryName: string | null;
  methodId: string | null;
  methodName: string | null;
  memo: string | null;
  /** 精算済み（過去分の取込を含む） */
  settled: boolean;
  /** 過去分の取込（割り勘アプリなど）で入った明細 */
  history: boolean;
  sync: PairSync | "";
  householdTxId: string | null;
  /** 家計簿反映が DONE / LINKED なのに、本体の明細が見つからない */
  householdMissing: boolean;
  createdBy: PairRole;
  /** イベント別の集計に使う中項目の名前（無ければ NO_EVENT） */
  event: string;
  /** event をどこから決めたか: 二人の明細の中項目 / 結び付けた家計簿の明細の中項目 / どちらも無い */
  eventSource: "category" | "linked" | "none";
};

/** イベント（中項目）が決まらない明細のまとめ先 */
export const NO_EVENT = "（中項目なし）";

export type PairSettlementView = {
  id: string;
  date: string;
  payer: PairRole;
  amount: number;
  count: number;
  methodName: string | null;
  memo: string | null;
  canceled: boolean;
  history: boolean;
  householdTxCount: number;
  createdBy: PairRole;
};

export type PairMonthSummary = {
  key: string;
  count: number;
  total: number;
  ownerShare: number;
  partnerShare: number;
  paidByOwner: number;
  paidByPartner: number;
  byCostType: { id: string; name: string; amount: number }[];
};

export type PairEventView = {
  /** 中項目の名前 */
  name: string;
  /** 二人の明細の件数・総額・それぞれの負担 */
  count: number;
  total: number;
  ownerShare: number;
  partnerShare: number;
  /** 家計簿の「自分だけ」（割り勘にしない二人の時の出費）の件数と金額 */
  soloCount: number;
  solo: number;
  from: string;
  to: string;
};

export type PairReconcile = {
  /** 本体の書き込み先（中項目・決済手段）が足りないときの説明 */
  missingTargets: string | null;
  pending: PairEntryView[];
  errors: PairEntryView[];
  householdMissing: PairEntryView[];
  /** 「彼女精算」の口座残高と、二人の明細から見た残高のずれ（口座が無い・残高を追っていなければ null） */
  account: { name: string; balance: number; expected: number; diff: number } | null;
};

export type PairPageData = {
  names: PairNames;
  /** LINE連携に相手がまだ登録されていない */
  partnerUnregistered: boolean;
  balance: PairBalance;
  month: PairMonthSummary;
  trend: { key: string; ownerShare: number; partnerShare: number; total: number }[];
  entries: PairEntryView[];
  settlements: PairSettlementView[];
  events: PairEventView[];
  reconcile: PairReconcile;
  /** 家計簿の明細との突き合わせ（重なり・カードの候補・過去分・二人の明細に無い明細） */
  match: MatchReport;
  /** 二人の明細の全期間の合計 */
  allTime: { count: number; total: number; ownerShare: number; partnerShare: number };
  /** 二人の時の出費（割り勘・自分だけ・精算の記録・未確認）。アプリの中だけで見る */
  together: TogetherData;
  options: {
    costTypes: { id: string; name: string }[];
    categories: { id: string; name: string }[];
    methods: { id: string; name: string; kind: string }[];
    defaultCategoryName: string;
    defaultMethodId: string | null;
    settleMethodId: string | null;
  };
};

const DONE_LIKE = new Set<string>(["DONE", "LINKED"]);

export function pairNames(db: Snapshot): PairNames & { partnerUnregistered: boolean } {
  const partner = db.lineUsers.find((u) => u.role === "PARTNER");
  return {
    OWNER: "自分",
    PARTNER: partner?.displayName.trim() || "相手",
    partnerUnregistered: !partner,
  };
}

function shiftMonth(key: string, delta: number) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

/** 月の初日と末日（日付は "YYYY-MM-DD" の文字列で比べるので、末日は 31 日として扱ってよい） */
function rangeOf(key: string) {
  return { from: `${key}-01`, to: `${key}-31` };
}

export function buildPairPage(db: Snapshot, monthKey: string, trendMonths = 12): PairPageData {
  const master = loadPairMaster(db);
  const { partnerUnregistered, ...names } = pairNames(db);
  const costTypeName = new Map(db.costTypes.map((c) => [c.id, c.name]));
  const categoryName = new Map(db.categories.map((c) => [c.id, c.name]));
  const methodName = new Map(db.paymentMethods.map((m) => [m.id, m.name]));
  const transactionIds = new Set(db.transactions.map((t) => t.id));
  const settlements = new Map(db.pairSettlements.map((s) => [s.id, s]));
  const live = db.pairEntries.filter((e) => !e.deletedAt);

  // イベント = 中項目。大項目と同じ名前の中項目（パートナー / パートナー のような既定）はイベントとみなさない
  const resolve = categoryResolver(db);
  const splitsOfTx = splitsByTransaction(db);
  const partnerMajors = partnerMajorIds(db);
  const eventName = (categoryId: string | null | undefined) => {
    const found = categoryId ? resolve(categoryId) : null;
    return found && found.category.name !== found.major.name ? found.category.name : null;
  };
  const linkedEvent = (txId: string | null) => {
    for (const split of txId ? (splitsOfTx.get(txId) ?? []) : []) {
      const found = resolve(split.categoryId);
      if (found && partnerMajors.has(found.major.id) && found.category.name !== found.major.name) return found.category.name;
    }
    return null;
  };

  const toView = (e: PairEntry): PairEntryView => {
    const settlement = e.settlementId ? settlements.get(e.settlementId) : undefined;
    const catName = e.categoryId ? (categoryName.get(e.categoryId) ?? "（不明な中項目）") : null;
    const own = eventName(e.categoryId);
    const linked = own ? null : linkedEvent(e.householdTxId);
    return {
      id: e.id,
      date: e.date,
      description: e.description,
      amount: e.amount,
      payer: e.payer,
      mode: e.mode,
      ownerShare: e.ownerShare,
      partnerShare: e.partnerShare,
      costTypeId: e.costTypeId,
      costTypeName: e.costTypeId ? (costTypeName.get(e.costTypeId) ?? "（不明な費目）") : null,
      categoryId: e.categoryId,
      categoryName: catName,
      methodId: e.methodId,
      methodName: e.methodId ? (methodName.get(e.methodId) ?? "（不明）") : null,
      memo: e.memo,
      settled: Boolean(e.settlementId),
      history: settlement?.kind === PAIR_SETTINGS.historyKind,
      sync: e.sync,
      householdTxId: e.householdTxId,
      householdMissing: DONE_LIKE.has(e.sync) && (!e.householdTxId || !transactionIds.has(e.householdTxId)),
      createdBy: e.createdBy,
      // 二人の明細の中項目、無ければ結び付けた家計簿の明細の中項目（過去分は家計簿側にしか無いことが多い）
      event: own ?? linked ?? NO_EVENT,
      eventSource: own ? "category" : linked ? "linked" : "none",
    };
  };
  const views = live
    .map(toView)
    .sort((a, b) => b.date.localeCompare(a.date) || a.description.localeCompare(b.description, "ja"));

  // 月の集計と推移
  const { from, to } = rangeOf(monthKey);
  const summary = summarize(live, from, to);
  const month: PairMonthSummary = {
    key: monthKey,
    count: summary.count,
    total: summary.total,
    ownerShare: summary.ownerShare,
    partnerShare: summary.partnerShare,
    paidByOwner: summary.paidByOwner,
    paidByPartner: summary.paidByPartner,
    byCostType: [...summary.byCostType]
      .map(([id, amount]) => ({ id, name: id ? (costTypeName.get(id) ?? "（不明な費目）") : "（費目なし）", amount }))
      .sort((a, b) => b.amount - a.amount),
  };
  const trend = Array.from({ length: trendMonths }, (_, i) => shiftMonth(monthKey, i - trendMonths + 1)).map((key) => {
    const r = rangeOf(key);
    const s = summarize(live, r.from, r.to);
    return { key, ownerShare: s.ownerShare, partnerShare: s.partnerShare, total: s.total };
  });

  // イベント別（中項目ごと）: 二人の明細と、家計簿の「自分だけ」の明細
  const together = buildTogether(db);
  const eventMap = new Map<string, PairEventView>();
  const eventOf = (name: string, date: string) => {
    const ev = eventMap.get(name) ?? { name, count: 0, total: 0, ownerShare: 0, partnerShare: 0, soloCount: 0, solo: 0, from: date, to: date };
    if (date < ev.from) ev.from = date;
    if (date > ev.to) ev.to = date;
    eventMap.set(name, ev);
    return ev;
  };
  for (const v of views) {
    const ev = eventOf(v.event, v.date);
    ev.count++;
    ev.total += v.amount;
    ev.ownerShare += v.ownerShare;
    ev.partnerShare += v.partnerShare;
  }
  for (const r of together.rows) {
    if (r.cls !== "solo") continue;
    const ev = eventOf(r.eventName ?? NO_EVENT, r.date);
    ev.soloCount++;
    ev.solo += r.amount;
  }
  const events = [...eventMap.values()].sort(
    (a, b) => Number(a.name === NO_EVENT) - Number(b.name === NO_EVENT) || b.to.localeCompare(a.to) || b.total - a.total,
  );
  const allTime = live.reduce(
    (acc, e) => ({ count: acc.count + 1, total: acc.total + e.amount, ownerShare: acc.ownerShare + e.ownerShare, partnerShare: acc.partnerShare + e.partnerShare }),
    { count: 0, total: 0, ownerShare: 0, partnerShare: 0 },
  );

  // 家計簿との突き合わせ
  let account: PairReconcile["account"] = null;
  if (master.partnerAccount?.trackBalance) {
    const found = getAccountBalances(db).find((a) => a.id === master.partnerAccount!.id);
    if (found) {
      // 口座に効くのは、本体に書いた（DONE / LINKED）明細と、精算で書いた口座間の移動。
      // 精算はその対象の差額を全部動かすので、まだ本体に書いていない（取込待ち・エラーの）明細を精算すると
      // そのぶんだけ先に口座が動く（カード明細を取り込んで照合すれば戻る）。過去分の取込は本体に何も書かない
      const historyIds = new Set(db.pairSettlements.filter((s) => s.kind === PAIR_SETTINGS.historyKind).map((s) => s.id));
      const expected = live.reduce((sum, e) => {
        const written = DONE_LIKE.has(e.sync);
        if (isOpen(e)) return written ? sum + owedToOwner(e) : sum;
        if (!written && e.settlementId && !historyIds.has(e.settlementId)) return sum - owedToOwner(e);
        return sum;
      }, 0);
      account = { name: found.name, balance: found.balance, expected, diff: Math.round((found.balance - expected) * 100) / 100 };
    }
  }
  const reconcile: PairReconcile = {
    missingTargets: missingTargets(master),
    pending: views.filter((v) => v.sync === "PENDING_IMPORT"),
    errors: views.filter((v) => v.sync === "ERROR"),
    householdMissing: views.filter((v) => v.householdMissing),
    account,
  };

  return {
    names,
    partnerUnregistered,
    balance: computeBalance(live),
    month,
    trend,
    entries: views,
    settlements: [...db.pairSettlements]
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
      .map((s) => ({
        id: s.id,
        date: s.date,
        payer: s.payer,
        amount: s.amount,
        count: s.count,
        methodName: s.methodId ? (methodName.get(s.methodId) ?? "（不明）") : null,
        memo: s.memo,
        canceled: Boolean(s.canceledAt),
        history: s.kind === PAIR_SETTINGS.historyKind,
        householdTxCount: (s.householdTxIds ?? "").split(",").filter(Boolean).length,
        createdBy: s.createdBy,
      })),
    events,
    reconcile,
    match: buildMatchReport(db),
    allTime,
    together,
    options: {
      costTypes: db.costTypes
        .filter((c) => !c.archivedAt)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((c) => ({ id: c.id, name: c.name })),
      categories: master.shareCategories.map((c) => ({ id: c.id, name: c.name })),
      methods: master.methods
        .filter((m) => m.id !== master.partnerAccount?.id)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ja"))
        .map((m) => ({ id: m.id, name: m.name, kind: m.kind })),
      defaultCategoryName: master.shareCategory?.name ?? PAIR_SETTINGS.shareCategory,
      defaultMethodId: master.ownerDefaultMethod?.id ?? null,
      settleMethodId: master.settleMethod?.id ?? null,
    },
  };
}

/** ダッシュボード用: 未精算の差額と呼び名だけ */
export function pairBalanceSummary(db: Snapshot) {
  const live = db.pairEntries.filter((e) => !e.deletedAt);
  if (live.length === 0) return null;
  const { partnerUnregistered: _unused, ...names } = pairNames(db);
  void _unused;
  return { names, balance: computeBalance(live) };
}
