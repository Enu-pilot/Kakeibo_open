/**
 * 二人の明細と、家計簿（本体）の明細の突き合わせ。
 *
 *  1. 重なり: LINE で登録して本体にも書いた明細（DONE）と、同じ支払いが CSV 取込で入った明細。
 *     PayPay・銀行のようにカード以外でも取り込む決済手段では、同じ支払いが 2 件になる
 *  2. カードの取込待ち: 自動の照合（同じカード・同じ金額・日付の差 3 日以内でちょうど 1 件）で決まらなかったもの
 *  3. 過去分の取込: 割り勘アプリなどの記録。家計簿には当時の明細（カード・予約サイトなど）が入っているので、
 *     どれに当たるかを探す。旅行の予約は数か月前に払うことが多く、割り勘アプリの日付は旅行の日なので、
 *     日付は前に 150 日・後に 30 日まで見る（7 日以内に同じ金額があれば、そちらだけを候補にする）
 * 家計簿にあって二人の明細に無い明細（割り勘にしない二人の時の出費など）は pair-together.ts で区分する。
 */
import type { Changes, Snapshot } from "@/lib/db/store";
import type { PairEntry, Transaction } from "@/lib/db/types";
import { categoryResolver, indexById, splitsByTransaction } from "@/lib/db/queries";
import { foldForMatch } from "@/lib/rules";
import { dayDiff } from "@/lib/pair";
import { PAIR_SETTINGS, isHistoryEntry, linkPairEntry, loadPairMaster, usedHouseholdTxIds } from "@/lib/pair-household";

/** 重なりとみなす日付の差 */
const DUPLICATE_DAYS = PAIR_SETTINGS.reconcileDays;
/** カードの取込待ちで、手で選ぶ候補を探す日付の差 */
const PENDING_DAYS = 14;
/** 過去分: 近い候補（これがあれば遠い候補は出さない）と、探す範囲（家計簿の日付 − 二人の明細の日付） */
const HISTORY_NEAR_DAYS = 7;
const HISTORY_FROM = -150;
const HISTORY_TO = 30;

export type MatchCandidate = {
  id: string;
  date: string;
  description: string;
  amount: number;
  methodName: string | null;
  categoryName: string | null;
  /** 家計簿の日付 − 二人の明細の日付 */
  dayDiff: number;
  /** 利用先と内容の似ている度合い（0〜1） */
  similarity: number;
  sameMethod: boolean;
};

type Tx = Transaction;

/** 文字の 2 文字組の重なり（Dice 係数）。店名の表記ゆれは foldForMatch で吸収してから比べる */
export function similarity(a: string, b: string) {
  const grams = (s: string) => {
    const t = foldForMatch(s).replace(/[0-9０-９()（）［］\[\]〔〕・/／\-ー*＊.,、。!！?？]/g, "");
    const out = new Map<string, number>();
    for (let i = 0; i < t.length - 1; i++) {
      const g = t.slice(i, i + 2);
      out.set(g, (out.get(g) ?? 0) + 1);
    }
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  let common = 0;
  let total = 0;
  for (const n of ga.values()) total += n;
  for (const n of gb.values()) total += n;
  for (const [g, n] of ga) common += Math.min(n, gb.get(g) ?? 0);
  return total === 0 ? 0 : Math.round(((2 * common) / total) * 100) / 100;
}

export type MatchReport = {
  /** LINE で書いた明細と、同じ支払いの取込明細が両方ある */
  duplicates: { entryId: string; ownTxId: string | null; twin: MatchCandidate }[];
  /** カードの取込待ちで、手で選べる候補 */
  pending: { entryId: string; candidates: MatchCandidate[] }[];
  history: {
    /** 結び付け済み（家計簿明細ID を覚えている） */
    linked: { entryId: string; tx: MatchCandidate | null }[];
    /** 候補が 1 件だけ（まとめて結び付けられる） */
    unique: { entryId: string; candidate: MatchCandidate }[];
    /** 候補が 2 件以上（選ぶ） */
    ambiguous: { entryId: string; candidates: MatchCandidate[] }[];
    /** 自分が払ったのに、同じ金額の明細が見つからない */
    missing: string[];
    /** 相手が払った明細（家計簿に対応する明細が無いので突き合わせない） */
    partnerPaid: number;
  };
};

export function buildMatchReport(db: Snapshot): MatchReport {
  const master = loadPairMaster(db);
  const resolve = categoryResolver(db);
  const splits = splitsByTransaction(db);
  const methods = indexById(db.paymentMethods);
  const live = db.pairEntries.filter((e) => !e.deletedAt);
  const used = usedHouseholdTxIds(db);
  const txById = indexById(db.transactions);
  const accountId = master.partnerAccount?.id ?? null;

  const categoryOf = (t: Tx) => {
    const own = splits.get(t.id) ?? [];
    const names = [...new Set(own.map((s) => resolve(s.categoryId)?.category.name).filter(Boolean))];
    return names.length > 0 ? names.join("・") : null;
  };
  const toCandidate = (t: Tx, entry: PairEntry | null): MatchCandidate => ({
    id: t.id,
    date: t.date,
    description: t.description,
    amount: t.amount,
    methodName: t.paymentMethodId ? (methods.get(t.paymentMethodId)?.name ?? null) : null,
    categoryName: categoryOf(t),
    dayDiff: entry ? dayDiff(t.date, entry.date) : 0,
    similarity: entry ? similarity(t.description, entry.description) : 0,
    sameMethod: Boolean(entry?.methodId) && t.paymentMethodId === entry?.methodId,
  });
  const byRank = (a: MatchCandidate, b: MatchCandidate) =>
    Number(b.sameMethod) - Number(a.sameMethod) || b.similarity - a.similarity || Math.abs(a.dayDiff) - Math.abs(b.dayDiff);

  // 突き合わせの相手になれる本体の明細: LINE・このページで書いたもの、彼女精算の口座のもの、
  // 支出（個人支出・生活費）の内訳が無いもの（チャージ・収入）は除く
  const eligible = db.transactions.filter((t) => {
    if ((t.memo ?? "").startsWith("二人の")) return false;
    if (accountId && (t.paymentMethodId === accountId || t.transferToId === accountId)) return false;
    return (splits.get(t.id) ?? []).some((s) => {
      const kind = resolve(s.categoryId)?.major.kind;
      return kind === "EXPENSE" || kind === "LIVING";
    });
  });
  const byAmount = new Map<number, Tx[]>();
  for (const t of eligible) {
    const key = Math.round(t.amount);
    byAmount.set(key, [...(byAmount.get(key) ?? []), t]);
  }
  const sameAmount = (amount: number) => byAmount.get(Math.round(amount)) ?? [];

  // 1. 重なり
  const duplicates: MatchReport["duplicates"] = [];
  for (const entry of live) {
    if (entry.sync !== "DONE" || entry.payer !== "OWNER" || !entry.methodId) continue;
    const twins = sameAmount(entry.amount).filter(
      (t) =>
        !used.has(t.id) &&
        t.paymentMethodId === entry.methodId &&
        (t.source === "CSV" || t.source === "SHEET") &&
        Math.abs(dayDiff(t.date, entry.date)) <= DUPLICATE_DAYS &&
        (splits.get(t.id) ?? []).length === 1,
    );
    if (twins.length === 0) continue;
    const best = twins.map((t) => toCandidate(t, entry)).sort(byRank)[0];
    duplicates.push({ entryId: entry.id, ownTxId: entry.householdTxId, twin: best });
  }

  // 2. カードの取込待ち
  const pending: MatchReport["pending"] = live
    .filter((e) => e.sync === "PENDING_IMPORT")
    .map((entry) => ({
      entryId: entry.id,
      candidates: sameAmount(entry.amount)
        .filter((t) => !used.has(t.id) && Math.abs(dayDiff(t.date, entry.date)) <= PENDING_DAYS && (splits.get(t.id) ?? []).length === 1)
        .map((t) => toCandidate(t, entry))
        .sort(byRank)
        .slice(0, 5),
    }));

  // 3. 過去分の取込
  const history: MatchReport["history"] = { linked: [], unique: [], ambiguous: [], missing: [], partnerPaid: 0 };
  const historyEntries = live.filter((e) => isHistoryEntry(db, e));
  const proposals = new Map<string, MatchCandidate[]>();
  for (const entry of historyEntries) {
    if (entry.householdTxId) {
      const t = txById.get(entry.householdTxId);
      history.linked.push({ entryId: entry.id, tx: t ? toCandidate(t, entry) : null });
      continue;
    }
    if (entry.payer !== "OWNER") {
      history.partnerPaid++;
      continue;
    }
    const inRange = sameAmount(entry.amount)
      .filter((t) => !used.has(t.id))
      .map((t) => toCandidate(t, entry))
      .filter((c) => c.dayDiff >= HISTORY_FROM && c.dayDiff <= HISTORY_TO);
    const near = inRange.filter((c) => Math.abs(c.dayDiff) <= HISTORY_NEAR_DAYS);
    proposals.set(entry.id, (near.length > 0 ? near : inRange).sort(byRank));
  }
  // 同じ明細が 2 つの二人の明細の唯一の候補になっていたら、どちらも選んでもらう
  const claimedBy = new Map<string, number>();
  for (const list of proposals.values()) if (list.length === 1) claimedBy.set(list[0].id, (claimedBy.get(list[0].id) ?? 0) + 1);
  for (const [entryId, list] of proposals) {
    if (list.length === 0) history.missing.push(entryId);
    else if (list.length === 1 && claimedBy.get(list[0].id) === 1) history.unique.push({ entryId, candidate: list[0] });
    else history.ambiguous.push({ entryId, candidates: list.slice(0, 6) });
  }

  return { duplicates, pending, history };
}

/** 過去分の取込のうち、候補が 1 件だけのものをまとめて結び付ける（家計簿明細ID を覚えるだけ。本体は書き換えない） */
export function autoLinkHistory(tx: Changes, db: Snapshot) {
  const { history } = buildMatchReport(db);
  for (const { entryId, candidate } of history.unique) linkPairEntry(tx, db, entryId, candidate.id);
  return { linked: history.unique.length };
}
