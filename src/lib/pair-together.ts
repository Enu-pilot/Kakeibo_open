/**
 * 二人の時の出費（アプリの中だけで見る）。
 *
 * 使途「彼女」の大項目（と大項目「パートナー」）の家計簿の明細を、次のどれかに分ける。
 *  - 割り勘（二人の明細）: 二人の明細に結び付いている（LINE で登録した・照合した・過去分を結び付けた）
 *  - 割り勘（記録なし）: 割り勘にしたが二人の明細には無い（区分 SHARED）
 *  - 自分だけ: 二人の時に自分だけで払った、割り勘にしない出費（区分 SOLO）
 *  - 精算の記録: 相手との送金・受け取り（区分 SETTLEMENT、またはこのアプリ・LINE が書いた精算の差額）
 *  - 未確認: まだ区分していない
 * 区分は家計簿の「明細」タブの「二人の区分」列に入る。LINE ボットは二人の明細しか読まないので、相手には見えない。
 * 金額はその明細のうち使途「彼女」の大項目の内訳だけを数える（自分の支出として数えている額）。
 */
import type { Snapshot } from "@/lib/db/store";
import type { PairTag } from "@/lib/db/types";
import { categoryResolver, indexById, splitsByTransaction } from "@/lib/db/queries";
import { PAIR_SETTINGS, usedHouseholdTxIds } from "@/lib/pair-household";

export type TogetherClass = "linked" | "shared" | "solo" | "settlement" | "unknown";

export type TogetherRow = {
  id: string;
  date: string;
  description: string;
  /** 使途「彼女」の大項目の内訳の合計 */
  amount: number;
  methodName: string | null;
  categoryName: string | null;
  /** イベント別に使う中項目（大項目と同じ名前の既定の中項目は null） */
  eventName: string | null;
  cls: TogetherClass;
  tag: PairTag | "";
  /** 未確認のうち、送金・受け取りらしいもの */
  looksLikeSettlement: boolean;
};

export type TogetherData = {
  /** 対象にした大項目の名前 */
  majors: string[];
  rows: TogetherRow[];
  /** 月ごとの区分別の合計（新しい月が後ろ） */
  months: { key: string; totals: Record<TogetherClass, number> }[];
  totals: Record<TogetherClass, number>;
  counts: Record<TogetherClass, number>;
};

const SETTLEMENT_WORDS = /送金|受取|受け取り|精算|ことら/;

const zero = (): Record<TogetherClass, number> => ({ linked: 0, shared: 0, solo: 0, settlement: 0, unknown: 0 });

/** 使途「彼女」の大項目（と大項目「パートナー」） */
export function partnerMajorIds(db: Snapshot) {
  const purpose = db.purposes.find((p) => p.name === PAIR_SETTINGS.sharePurpose && !p.archivedAt);
  return new Set(
    db.majors
      .filter((m) => !m.archivedAt && (m.name === PAIR_SETTINGS.shareMajor || (purpose && m.purposeId === purpose.id)))
      .map((m) => m.id),
  );
}

export function buildTogether(db: Snapshot): TogetherData {
  const majorIds = partnerMajorIds(db);
  const resolve = categoryResolver(db);
  const splits = splitsByTransaction(db);
  const methods = indexById(db.paymentMethods);
  const used = usedHouseholdTxIds(db);

  const rows: TogetherRow[] = [];
  for (const t of db.transactions) {
    const own = (splits.get(t.id) ?? []).filter((s) => {
      const found = resolve(s.categoryId);
      return found && majorIds.has(found.major.id);
    });
    if (own.length === 0) continue;
    const memo = t.memo ?? "";
    let cls: TogetherClass;
    if (used.has(t.id) || memo.startsWith("二人の明細")) cls = "linked";
    else if (memo.startsWith("二人の精算")) cls = "settlement";
    else if (t.pairTag === "SHARED") cls = "shared";
    else if (t.pairTag === "SOLO") cls = "solo";
    else if (t.pairTag === "SETTLEMENT") cls = "settlement";
    else cls = "unknown";
    const names = [...new Set(own.map((s) => resolve(s.categoryId)?.category.name).filter((n): n is string => Boolean(n)))];
    const event = own
      .map((s) => resolve(s.categoryId))
      .find((f) => f && f.category.name !== f.major.name)?.category.name ?? null;
    rows.push({
      id: t.id,
      date: t.date,
      description: t.description,
      amount: Math.round(own.reduce((sum, s) => sum + s.amount, 0) * 100) / 100,
      methodName: t.paymentMethodId ? (methods.get(t.paymentMethodId)?.name ?? null) : null,
      categoryName: names.join("・") || null,
      eventName: event,
      cls,
      tag: t.pairTag,
      looksLikeSettlement: cls === "unknown" && SETTLEMENT_WORDS.test(t.description),
    });
  }
  rows.sort((a, b) => b.date.localeCompare(a.date) || a.description.localeCompare(b.description, "ja"));

  const totals = zero();
  const counts = zero();
  const byMonth = new Map<string, Record<TogetherClass, number>>();
  for (const r of rows) {
    totals[r.cls] += r.amount;
    counts[r.cls]++;
    const key = r.date.slice(0, 7);
    const m = byMonth.get(key) ?? zero();
    m[r.cls] += r.amount;
    byMonth.set(key, m);
  }
  return {
    majors: db.majors.filter((m) => majorIds.has(m.id)).map((m) => m.name),
    rows,
    months: [...byMonth].sort(([a], [b]) => a.localeCompare(b)).map(([key, t]) => ({ key, totals: t })),
    totals,
    counts,
  };
}
