/**
 * 使途（個人・生活費・投資・彼女・家族…）ごとのお金の流れと残高。
 *
 * 口座残高が「いま口座にいくらあるか」なのに対し、使途の残高は「そのお金は誰（何）のぶんか」を表す。
 *
 *   使途の残高 = 起点残高
 *              ＋ その使途の収入（種別が個人収入の大項目の内訳）
 *              − その使途の支出（個人支出・生活費・投資の大項目の内訳）
 *              ＋ 振替で入ったぶん − 振替で出たぶん
 *
 * 使途は大項目に付ける。帳尻合わせ（チャージ・口座間の移動）は誰のお金も増減させないので数えない。
 * 内訳の金額は種別に対する向きの符号付き（払い戻しはマイナス）なので、足し算だけで差し引きが済む。
 * 起点日より前の明細・振替は「起点残高に含まれている」とみなして数えない（口座残高と同じ）。
 */
import type { Snapshot } from "@/lib/db/store";
import type { CategoryKind } from "@/lib/db/types";
import { byOrderThenName, categoryResolver, indexById } from "@/lib/db/queries";
import { isoDate, monthStart, toYearMonth } from "@/lib/aggregate-core";

/** 使途が付いていない大項目の内訳をまとめる行の id */
export const UNASSIGNED_PURPOSE = "none";

export type PurposeFlow = {
  income: number;
  expense: number;
  transferIn: number;
  transferOut: number;
};

export type PurposeBalance = {
  id: string;
  name: string;
  openingBalance: number;
  openingBalanceAt: string | null;
  /** 起点から今日までを足し引きした残高 */
  balance: number;
  /** 起点からの流れ（残高の内訳） */
  sinceOpening: PurposeFlow;
  /** 選んだ月の流れ */
  month: PurposeFlow;
};

export type PurposeTrendPoint = { month: string } & PurposeFlow & {
  /** 収入 − 支出 ＋ 振替の出入り（その月に残高がどれだけ増減したか） */
  net: number;
};

export type PurposeTrend = { id: string; name: string; points: PurposeTrendPoint[] };

/** 種別から、使途の収入・支出のどちらに数えるかを決める */
export function flowSide(kind: CategoryKind): "income" | "expense" | null {
  if (kind === "INCOME") return "income";
  if (kind === "ADJUSTMENT") return null;
  return "expense";
}

const emptyFlow = (): PurposeFlow => ({ income: 0, expense: 0, transferIn: 0, transferOut: 0 });
const round = (value: number) => Math.round(value * 100) / 100;
const netOf = (flow: PurposeFlow) => flow.income - flow.expense + flow.transferIn - flow.transferOut;

/** 使途の残高に効く内訳 1 件（帳尻合わせと、参照先の無い内訳は含めない） */
type PurposeEntry = {
  date: string;
  purposeId: string;
  side: "income" | "expense";
  amount: number;
  categoryId: string;
  categoryName: string;
  majorName: string;
};

function purposeEntries(db: Snapshot): PurposeEntry[] {
  const transactions = indexById(db.transactions);
  const resolve = categoryResolver(db);
  // アーカイブした使途・消えた使途の大項目は「未設定」にまとめる（表から黙って消えないように）
  const known = new Set(db.purposes.filter((p) => !p.archivedAt).map((p) => p.id));
  const entries: PurposeEntry[] = [];
  for (const split of db.splits) {
    const tx = transactions.get(split.transactionId);
    const found = resolve(split.categoryId);
    if (!tx || !found) continue;
    const side = flowSide(found.major.kind);
    if (!side) continue;
    const purposeId =
      found.major.purposeId && known.has(found.major.purposeId) ? found.major.purposeId : UNASSIGNED_PURPOSE;
    entries.push({
      date: tx.date,
      purposeId,
      side,
      amount: split.amount,
      categoryId: found.category.id,
      categoryName: found.category.name,
      majorName: found.major.name,
    });
  }
  return entries;
}

/** 表に出す使途（アーカイブ済みは除く。未設定に数えた内訳があれば「未設定」も足す） */
function listedPurposes(db: Snapshot, entries: PurposeEntry[]) {
  const purposes = db.purposes
    .filter((p) => !p.archivedAt)
    .sort(byOrderThenName)
    .map((p) => ({ id: p.id, name: p.name, openingBalance: p.openingBalance, openingBalanceAt: p.openingBalanceAt }));
  if (entries.some((e) => e.purposeId === UNASSIGNED_PURPOSE)) {
    purposes.push({ id: UNASSIGNED_PURPOSE, name: "未設定", openingBalance: 0, openingBalanceAt: null });
  }
  return purposes;
}

/**
 * 使途ごとの残高と、選んだ月（[from, to)）の流れ。
 * today より後の日付の明細・振替（予定として先に入れたもの）は残高に数えない。
 */
export function getPurposeBalances(db: Snapshot, from: Date, to: Date, today: string): PurposeBalance[] {
  const entries = purposeEntries(db);
  const [fromIso, toIso] = [isoDate(from), isoDate(to)];
  const rows = new Map(
    listedPurposes(db, entries).map((p) => [
      p.id,
      { ...p, balance: 0, sinceOpening: emptyFlow(), month: emptyFlow() } as PurposeBalance,
    ]),
  );

  const add = (purposeId: string, date: string, key: keyof PurposeFlow, amount: number) => {
    const row = rows.get(purposeId);
    if (!row) return;
    if (date >= fromIso && date < toIso) row.month[key] += amount;
    if (date > today) return;
    if (row.openingBalanceAt && date < row.openingBalanceAt) return;
    row.sinceOpening[key] += amount;
  };

  for (const entry of entries) add(entry.purposeId, entry.date, entry.side, entry.amount);
  for (const transfer of db.purposeTransfers) {
    // 振替元・振替先の両方が残っているときだけ数える（片側だけ動くと合計が合わなくなる）
    if (!rows.has(transfer.fromPurposeId) || !rows.has(transfer.toPurposeId)) continue;
    add(transfer.fromPurposeId, transfer.date, "transferOut", transfer.amount);
    add(transfer.toPurposeId, transfer.date, "transferIn", transfer.amount);
  }

  return [...rows.values()].map((row) => ({
    ...row,
    balance: round(row.openingBalance + netOf(row.sinceOpening)),
    sinceOpening: roundFlow(row.sinceOpening),
    month: roundFlow(row.month),
  }));
}

function roundFlow(flow: PurposeFlow): PurposeFlow {
  return {
    income: round(flow.income),
    expense: round(flow.expense),
    transferIn: round(flow.transferIn),
    transferOut: round(flow.transferOut),
  };
}

/** 直近 n か月の使途ごとの収入・支出・振替（データが無い月も 0 で埋める） */
export function getPurposeTrend(db: Snapshot, endYear: number, endMonth: number, months = 12): PurposeTrend[] {
  const entries = purposeEntries(db);
  const keys: string[] = [];
  for (let i = 0; i < months; i++) keys.push(toYearMonth(monthStart(endYear, endMonth - months + 1 + i)));
  const monthOf = (date: string) => date.slice(0, 7).replace("-", "/");

  const series = new Map(
    listedPurposes(db, entries).map((p) => [
      p.id,
      { id: p.id, name: p.name, byMonth: new Map(keys.map((k) => [k, emptyFlow()])) },
    ]),
  );
  const add = (purposeId: string, date: string, key: keyof PurposeFlow, amount: number) => {
    const flow = series.get(purposeId)?.byMonth.get(monthOf(date));
    if (flow) flow[key] += amount;
  };
  for (const entry of entries) add(entry.purposeId, entry.date, entry.side, entry.amount);
  for (const transfer of db.purposeTransfers) {
    if (!series.has(transfer.fromPurposeId) || !series.has(transfer.toPurposeId)) continue;
    add(transfer.fromPurposeId, transfer.date, "transferOut", transfer.amount);
    add(transfer.toPurposeId, transfer.date, "transferIn", transfer.amount);
  }

  return [...series.values()].map((s) => ({
    id: s.id,
    name: s.name,
    points: keys.map((month) => {
      const flow = roundFlow(s.byMonth.get(month)!);
      return { month, ...flow, net: round(netOf(flow)) };
    }),
  }));
}

/** 二重円グラフの 1 区分 */
export type RingItem = {
  key: string;
  name: string;
  /** 補足（大項目名・振替の相手など） */
  detail: string;
  value: number;
  /** 貯金との出し入れ（収入と支出の差を埋める区分） */
  savings?: true;
};

export type FlowRings = {
  /** 内側: 入ってきたお金の内訳（足りなければ「貯金から」を足す） */
  inner: RingItem[];
  /** 外側: 使ったお金の内訳（余れば「貯金へ」を足す） */
  outer: RingItem[];
  income: number;
  expense: number;
  /** 払い戻しが上回ってマイナスになった中項目（円には描けないので別に出す） */
  negatives: RingItem[];
};

/**
 * 選んだ期間の「入ってきたお金」と「使ったお金」を、中項目ごとに並べる（二重円グラフ用）。
 * purposeId を渡すとその使途だけ。振替はその使途にとっての入金・出金として並べる。
 * 全体（null）では振替は使途の間で打ち消し合うので数えない。
 * 2 つの輪の合計がそろうよう、差は「貯金から」「貯金へ」として足す。
 */
export function getFlowRings(db: Snapshot, from: Date, to: Date, purposeId: string | null): FlowRings {
  const [fromIso, toIso] = [isoDate(from), isoDate(to)];
  const names = new Map(db.purposes.map((p) => [p.id, p.name]));
  const inner = new Map<string, RingItem>();
  const outer = new Map<string, RingItem>();
  const bump = (map: Map<string, RingItem>, item: Omit<RingItem, "value">, amount: number) => {
    const current = map.get(item.key) ?? { ...item, value: 0 };
    current.value += amount;
    map.set(item.key, current);
  };

  for (const entry of purposeEntries(db)) {
    if (entry.date < fromIso || entry.date >= toIso) continue;
    if (purposeId && entry.purposeId !== purposeId) continue;
    bump(
      entry.side === "income" ? inner : outer,
      { key: entry.categoryId, name: entry.categoryName, detail: entry.majorName },
      entry.amount,
    );
  }
  if (purposeId) {
    for (const t of db.purposeTransfers) {
      if (t.date < fromIso || t.date >= toIso) continue;
      if (t.toPurposeId === purposeId) {
        const from = names.get(t.fromPurposeId) ?? "不明";
        bump(inner, { key: `transfer-in:${t.fromPurposeId}`, name: `${from}から振替`, detail: "使途の振替" }, t.amount);
      }
      if (t.fromPurposeId === purposeId) {
        const toName = names.get(t.toPurposeId) ?? "不明";
        bump(outer, { key: `transfer-out:${t.toPurposeId}`, name: `${toName}へ振替`, detail: "使途の振替" }, t.amount);
      }
    }
  }

  const split = (map: Map<string, RingItem>) => {
    const items = [...map.values()].map((item) => ({ ...item, value: round(item.value) }));
    return {
      positives: items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value),
      negatives: items.filter((i) => i.value < 0),
    };
  };
  const ins = split(inner);
  const outs = split(outer);
  // 合計（income・expense）は払い戻しで差し引きマイナスになった中項目も含めた本来の値。
  // 円はプラスの区分だけで描くので、2 つの輪をそろえる「貯金」の差はプラスの区分どうしで取る
  const income = round(ins.positives.reduce((s, i) => s + i.value, 0) + ins.negatives.reduce((s, i) => s + i.value, 0));
  const expense = round(outs.positives.reduce((s, i) => s + i.value, 0) + outs.negatives.reduce((s, i) => s + i.value, 0));

  const innerItems = [...ins.positives];
  const outerItems = [...outs.positives];
  const innerSum = innerItems.reduce((s, i) => s + i.value, 0);
  const outerSum = outerItems.reduce((s, i) => s + i.value, 0);
  const gap = round(outerSum - innerSum);
  if (gap > 0) innerItems.push({ key: "savings-out", name: "貯金から", detail: "入ってきたお金で足りないぶん", value: gap, savings: true });
  if (gap < 0) outerItems.push({ key: "savings-in", name: "貯金へ", detail: "使わずに残ったぶん", value: -gap, savings: true });

  return {
    inner: innerItems,
    outer: outerItems,
    income,
    expense,
    negatives: [...ins.negatives, ...outs.negatives],
  };
}
