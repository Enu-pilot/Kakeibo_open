/**
 * 二人の明細（パートナーとの支出）の計算規則。
 *
 * 登録・精算は LINE ボット（別リポジトリ（非公開）の GAS）とこのアプリの両方から行う。
 * どちらで操作しても同じ結果になるよう、ここの規則は GAS の gas/Shared.js と同じにする
 * （負担の割り方・端数・未精算の差額・月の集計）。変えるときは GAS 側も同じように変えること。
 *
 * シートにも画面にも触らない純粋な関数だけを置く。
 */
import type { PairEntry, PairRole, ShareMode } from "@/lib/db/types";

/** 1 億円未満（桁違いの入力で家計簿の集計を壊さないため。GAS と同じ） */
export const PAIR_MAX_AMOUNT = 100_000_000;

export function otherRole(role: PairRole): PairRole {
  return role === "OWNER" ? "PARTNER" : "OWNER";
}

/** 任意の負担。どちらか片方の円を指定し、残りがもう片方になる */
export type CustomShare = { ownerShare?: number | null; partnerShare?: number | null };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * 負担を割る。割り勘で割り切れない 1 円は払った側が持つ（GAS 決定 L6）。
 */
export function computeShares(
  amount: number,
  payer: PairRole,
  mode: ShareMode,
  custom?: CustomShare | null,
): { ownerShare: number; partnerShare: number } {
  amount = Math.round(amount);
  if (mode === "ALL_OWNER") return { ownerShare: amount, partnerShare: 0 };
  if (mode === "ALL_PARTNER") return { ownerShare: 0, partnerShare: amount };
  if (mode === "CUSTOM" && custom) {
    if (custom.ownerShare !== undefined && custom.ownerShare !== null) {
      const owner = clamp(Math.round(custom.ownerShare), 0, amount);
      return { ownerShare: owner, partnerShare: amount - owner };
    }
    if (custom.partnerShare !== undefined && custom.partnerShare !== null) {
      const partner = clamp(Math.round(custom.partnerShare), 0, amount);
      return { ownerShare: amount - partner, partnerShare: partner };
    }
  }
  const half = Math.floor(amount / 2);
  const rest = amount - half;
  return payer === "OWNER" ? { ownerShare: rest, partnerShare: half } : { ownerShare: half, partnerShare: rest };
}

/** 割った結果から負担の割り方を決め直す（任意で指定した結果が割り勘や全額と同じなら、そちらにそろえる） */
export function canonicalMode(amount: number, payer: PairRole, ownerShare: number): ShareMode {
  if (ownerShare === amount) return "ALL_OWNER";
  if (ownerShare === 0) return "ALL_PARTNER";
  if (computeShares(amount, payer, "HALF").ownerShare === ownerShare) return "HALF";
  return "CUSTOM";
}

/** 未精算で、削除されていない明細か */
export function isOpen(entry: Pick<PairEntry, "deletedAt" | "settlementId">) {
  return !entry.deletedAt && !entry.settlementId;
}

/** その明細で、パートナーがオーナーに返すべき額（マイナスならオーナーが返す） */
export function owedToOwner(entry: Pick<PairEntry, "payer" | "ownerShare" | "partnerShare">) {
  return entry.payer === "OWNER" ? entry.partnerShare : -entry.ownerShare;
}

export type PairBalance = {
  /** プラス = パートナーがオーナーへ払う、マイナス = オーナーがパートナーへ払う */
  net: number;
  count: number;
  /** 払う人（差額 0 なら null） */
  payer: PairRole | null;
  receiver: PairRole | null;
  amount: number;
};

/** 未精算の差額（GAS 決定 L7）。未精算・未削除の明細だけを数える */
export function computeBalance(entries: PairEntry[]): PairBalance {
  let net = 0;
  let count = 0;
  for (const entry of entries) {
    if (!isOpen(entry)) continue;
    count++;
    net += owedToOwner(entry);
  }
  return {
    net,
    count,
    payer: net > 0 ? "PARTNER" : net < 0 ? "OWNER" : null,
    receiver: net > 0 ? "OWNER" : net < 0 ? "PARTNER" : null,
    amount: Math.abs(net),
  };
}

export type PairSummary = {
  count: number;
  /** 総額の合計 */
  total: number;
  ownerShare: number;
  partnerShare: number;
  paidByOwner: number;
  paidByPartner: number;
  /** 費目 ID（"" は未設定）→ 総額 */
  byCostType: Map<string, number>;
};

/**
 * 期間の集計（GAS の monthSummary_ と同じ数え方）。削除されていない明細のうち日付が [from, to] のもの。
 * 精算済み・過去分の取込も含む。費目別は総額で数える。
 */
export function summarize(entries: PairEntry[], from: string, to: string): PairSummary {
  const out: PairSummary = {
    count: 0,
    total: 0,
    ownerShare: 0,
    partnerShare: 0,
    paidByOwner: 0,
    paidByPartner: 0,
    byCostType: new Map(),
  };
  for (const entry of entries) {
    if (entry.deletedAt || entry.date < from || entry.date > to) continue;
    out.count++;
    out.total += entry.amount;
    out.ownerShare += entry.ownerShare;
    out.partnerShare += entry.partnerShare;
    if (entry.payer === "OWNER") out.paidByOwner += entry.amount;
    else out.paidByPartner += entry.amount;
    const key = entry.costTypeId ?? "";
    out.byCostType.set(key, (out.byCostType.get(key) ?? 0) + entry.amount);
  }
  return out;
}

/** "2026-10-08" と "2026-10-05" の差（日） */
export function dayDiff(a: string, b: string) {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}
