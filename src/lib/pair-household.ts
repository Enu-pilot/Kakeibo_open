/**
 * 二人の明細の登録・修正・削除・精算と、本体の家計簿（明細・内訳）への書き方。
 *
 * LINE ボット（別リポジトリ（非公開）の GAS）と同じスプレッドシートに、同じ規則で書く。
 * 規則は GAS の gas/Household.js・gas/Service.js と同じにする（変えるときは GAS 側も同じように変えること）。
 *
 * | 二人の明細                  | 本体の明細（決済手段 → 移動先）          | 本体の内訳                        |
 * |-----------------------------|------------------------------------------|-----------------------------------|
 * | 自分が払った・割り勘 3,000  | 3,000（自分の決済手段 → 彼女精算）       | パートナー 1,500 ＋ 彼女立替 1,500 |
 * | 自分が払った・全額相手      | 3,000（自分の決済手段 → 彼女精算）       | 彼女立替 3,000                    |
 * | 自分が払った・全額自分      | 3,000（自分の決済手段）                  | パートナー 3,000                  |
 * | 相手が払った・割り勘 3,000  | 1,500（彼女精算）利用先「内容（彼女払い）」 | パートナー 1,500                  |
 * | 相手が払った・全額相手      | 書かない                                 | —                                 |
 * | 精算: 相手 → 自分           | 金額（彼女精算 → 受取口座）              | 彼女立替                          |
 * | 精算: 自分 → 相手           | 金額（自分の口座 → 彼女精算）            | 彼女立替                          |
 * | 精算額を直した差            | 差額（彼女精算）利用先「精算の差額」     | パートナー（差額）                |
 *
 * カード払い（決済手段の種別が CARD）は本体に書かず、CSV 取込で入った明細の内訳を分ける（照合）。
 *
 * GAS と違って、1 つの操作は 1 回の batchUpdate で書く（二人の明細と本体の明細が片方だけ書かれることが無い）。
 * GAS のスクリプトロックには参加しないので、LINE とアプリでまったく同時に書くと行番号がずれ得る。
 */
import { badRequest } from "@/lib/api";
import { newId, now, type Changes, type Snapshot } from "@/lib/db/store";
import type {
  Category,
  PairEntry,
  PairRole,
  PairSettlement,
  PaymentMethod,
  ShareMode,
  Transaction,
  TransactionSplit,
} from "@/lib/db/types";
import { classifyCostType } from "@/lib/rules";
import { normalizeDescription } from "@/lib/normalize";
import { createTransaction, deleteTransaction } from "@/lib/transactions";
import { todayInTokyo } from "@/lib/today";
import {
  PAIR_MAX_AMOUNT,
  canonicalMode,
  computeBalance,
  computeShares,
  dayDiff,
  isOpen,
  type CustomShare,
} from "@/lib/pair";

/** 本体に書くときの名前（GAS のスクリプトプロパティの既定値と同じ） */
export const PAIR_SETTINGS = {
  /** 自分の負担を入れる大項目・中項目 */
  shareMajor: "パートナー",
  shareCategory: "パートナー",
  /** 自分の負担を入れる使途（突き合わせで「彼女のぶんの家計簿の明細」を探す範囲） */
  sharePurpose: "彼女",
  /** 立て替えを入れる大項目・中項目（帳尻合わせ） */
  advanceMajor: "立替",
  advanceCategory: "彼女立替",
  /** 貸し借りを表す口座。プラス = 彼女に貸している */
  partnerAccount: "彼女精算",
  /** 自分が払ったときの既定の決済手段と、精算で使う口座 */
  ownerDefaultMethod: "現金",
  settleMethod: "PayPay",
  /** カード払いの照合で、取込明細の日付が何日ずれてよいか */
  reconcileDays: 3,
  /** 過去分の取込の精算の種別 */
  historyKind: "HISTORY",
};

export type PairMaster = {
  shareCategory: Category | null;
  advanceCategory: Category | null;
  partnerAccount: PaymentMethod | null;
  ownerDefaultMethod: PaymentMethod | null;
  settleMethod: PaymentMethod | null;
  /** 自分の負担を入れられる中項目（大項目「パートナー」配下） */
  shareCategories: Category[];
  methods: PaymentMethod[];
};

export function loadPairMaster(db: Snapshot): PairMaster {
  const liveMajor = (name: string) => db.majors.find((m) => m.name === name && !m.archivedAt) ?? null;
  const findCategory = (majorName: string, name: string) => {
    const major = liveMajor(majorName);
    if (!major) return null;
    return db.categories.find((c) => c.majorId === major.id && c.name === name && !c.archivedAt) ?? null;
  };
  const methods = db.paymentMethods.filter((m) => !m.archivedAt);
  const method = (name: string) => methods.find((m) => m.name === name) ?? null;
  const shareMajor = liveMajor(PAIR_SETTINGS.shareMajor);
  return {
    shareCategory: findCategory(PAIR_SETTINGS.shareMajor, PAIR_SETTINGS.shareCategory),
    advanceCategory: findCategory(PAIR_SETTINGS.advanceMajor, PAIR_SETTINGS.advanceCategory),
    partnerAccount: method(PAIR_SETTINGS.partnerAccount),
    ownerDefaultMethod: method(PAIR_SETTINGS.ownerDefaultMethod),
    settleMethod: method(PAIR_SETTINGS.settleMethod),
    shareCategories: shareMajor
      ? db.categories
          .filter((c) => c.majorId === shareMajor.id && !c.archivedAt)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ja"))
      : [],
    methods,
  };
}

/** 本体の書き込み先が揃っているか。揃っていなければ足りないものの説明 */
export function missingTargets(master: PairMaster): string | null {
  const lacking: string[] = [];
  if (!master.shareCategory) lacking.push(`中項目「${PAIR_SETTINGS.shareMajor} / ${PAIR_SETTINGS.shareCategory}」`);
  if (!master.advanceCategory) lacking.push(`中項目「${PAIR_SETTINGS.advanceMajor} / ${PAIR_SETTINGS.advanceCategory}」`);
  if (!master.partnerAccount) lacking.push(`決済手段「${PAIR_SETTINGS.partnerAccount}」`);
  return lacking.length > 0
    ? `本体の書き込み先（${lacking.join("・")}）が見つかりません。LINE ボットの GAS で setup を実行すると作られます`
    : null;
}

type PlanSplit = { categoryId: string; amount: number; costTypeId: string | null };
type HouseholdPlan = {
  date: string;
  description: string;
  paymentMethodId: string | null;
  transferToId: string | null;
  splits: PlanSplit[];
};

/** 本体に書く明細の形を決める（ファイル冒頭の表）。書くものが無ければ null。書き込み先が無ければ例外 */
function planHouseholdTx(entry: PairEntry, master: PairMaster): HouseholdPlan | null {
  const missing = missingTargets(master);
  if (missing) throw new Error(missing);
  const shareCategoryId = entry.categoryId || master.shareCategory!.id;
  const advanceId = master.advanceCategory!.id;
  const accountId = master.partnerAccount!.id;
  const costTypeId = entry.costTypeId || null;
  if (entry.payer === "OWNER") {
    const splits: PlanSplit[] = [];
    if (entry.ownerShare) splits.push({ categoryId: shareCategoryId, amount: entry.ownerShare, costTypeId });
    if (entry.partnerShare) splits.push({ categoryId: advanceId, amount: entry.partnerShare, costTypeId });
    return {
      date: entry.date,
      description: entry.description,
      paymentMethodId: entry.methodId || master.ownerDefaultMethod?.id || null,
      transferToId: entry.partnerShare ? accountId : null,
      splits,
    };
  }
  if (!entry.ownerShare) return null;
  return {
    date: entry.date,
    description: `${entry.description}（${PAIR_SETTINGS.partnerAccount.replace(/精算$/, "")}払い）`,
    paymentMethodId: accountId,
    transferToId: null,
    splits: [{ categoryId: shareCategoryId, amount: entry.ownerShare, costTypeId }],
  };
}

/** 明細と内訳を 1 件書く（重複判定キーは連番を振って必ず書く。GAS と同じ） */
function appendHouseholdTx(tx: Changes, db: Snapshot, plan: HouseholdPlan, memo: string): string {
  const amount = plan.splits.reduce((sum, s) => sum + s.amount, 0);
  if (!amount) throw new Error("合計 0 円の明細は本体に書けません");
  const created = createTransaction(
    tx,
    db,
    {
      date: plan.date,
      description: plan.description,
      memo,
      paymentMethodId: plan.paymentMethodId,
      transferToId: plan.transferToId,
      source: "MANUAL",
      splits: plan.splits,
    },
    { allowDuplicate: true },
  );
  if (!created) throw new Error("本体の明細を書けませんでした");
  return created.id;
}

function methodKind(master: PairMaster, methodId: string | null) {
  return master.methods.find((m) => m.id === methodId)?.kind ?? "";
}

function splitsOf(db: Snapshot, transactionId: string): TransactionSplit[] {
  return db.splits.filter((s) => s.transactionId === transactionId).sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * 二人の明細を本体に反映し、反映の状態を entry に書き込む（二人の明細の行の保存は呼び出し側）。
 * 本体に書けなくても例外にはせず ERROR にし、理由を返す（GAS 決定 L12）。
 */
function syncEntry(tx: Changes, db: Snapshot, entry: PairEntry, master: PairMaster): string | null {
  entry.householdTxId = null;
  entry.originalCategoryId = null;
  try {
    const plan = planHouseholdTx(entry, master);
    if (!plan) {
      entry.sync = "NONE";
      return null;
    }
    // カード払いは CSV 取込で入ってくるので、ここでは書かずに照合を待つ（GAS 決定 L10）
    if (entry.payer === "OWNER" && methodKind(master, plan.paymentMethodId) === "CARD") {
      entry.sync = entry.partnerShare ? "PENDING_IMPORT" : "NONE";
      if (entry.sync === "PENDING_IMPORT") reconcileEntries(tx, db, [entry], master);
      return null;
    }
    entry.householdTxId = appendHouseholdTx(tx, db, plan, `二人の明細 ${entry.id}`);
    entry.sync = "DONE";
    return null;
  } catch (error) {
    entry.sync = "ERROR";
    return error instanceof Error ? error.message : String(error);
  }
}

/** 本体に書いた分を取り消す。カード明細の内訳を分けたものは、内訳を 1 件に戻す（GAS 決定 L11） */
function unsyncEntry(tx: Changes, db: Snapshot, entry: PairEntry) {
  const householdTx = entry.householdTxId ? db.transactions.find((t) => t.id === entry.householdTxId) : undefined;
  if (entry.sync === "DONE" && householdTx) {
    deleteTransaction(tx, db, householdTx.id);
  } else if (entry.sync === "LINKED" && householdTx) {
    const old = splitsOf(db, householdTx.id);
    const costTypeId = old[0]?.costTypeId ?? null;
    const categoryId = entry.originalCategoryId || old[0]?.categoryId;
    if (categoryId) {
      for (const split of old) tx.remove("splits", split.id);
      tx.insert("splits", {
        id: newId(),
        transactionId: householdTx.id,
        categoryId,
        amount: householdTx.amount,
        sortOrder: 0,
        costTypeId,
      });
      tx.update("transactions", householdTx.id, { transferToId: null, updatedAt: now() });
    }
  }
  entry.householdTxId = null;
  entry.originalCategoryId = null;
  entry.sync = "";
}

/**
 * 取込待ちのカード払いを、本体の取込明細と突き合わせて内訳を分ける（GAS 決定 L10）。
 * 同じ決済手段・同じ金額・日付の差が 3 日以内・内訳が 1 件・ほかの二人の明細に使われていない明細が
 * ちょうど 1 件のときだけ分ける。突き合わせた entry は sync / householdTxId / originalCategoryId が変わる。
 */
function reconcileEntries(tx: Changes, db: Snapshot, entries: PairEntry[], master: PairMaster): number {
  const pending = entries.filter((e) => e.sync === "PENDING_IMPORT" && !e.deletedAt);
  if (pending.length === 0) return 0;
  // 照合し直す明細自身が前に使っていた本体の明細は、もう一度使えるようにする
  const pendingIds = new Set(pending.map((e) => e.id));
  const used = new Set(
    db.pairEntries
      .filter((e) => !e.deletedAt && !pendingIds.has(e.id))
      .map((e) => e.householdTxId)
      .filter((id): id is string => Boolean(id)),
  );
  let linked = 0;
  for (const entry of pending) {
    const candidates = db.transactions.filter(
      (t) =>
        !used.has(t.id) &&
        (t.paymentMethodId ?? "") === (entry.methodId ?? "") &&
        Math.round(t.amount) === Math.round(entry.amount) &&
        Math.abs(dayDiff(t.date, entry.date)) <= PAIR_SETTINGS.reconcileDays &&
        splitsOf(db, t.id).length === 1,
    );
    if (candidates.length !== 1) continue;
    let plan: HouseholdPlan | null;
    try {
      plan = planHouseholdTx(entry, master);
    } catch {
      continue;
    }
    if (!plan) continue;
    splitImported(tx, db, entry, candidates[0], plan);
    used.add(candidates[0].id);
    linked++;
  }
  return linked;
}

/**
 * 取込で入った本体の明細（内訳 1 件）を、二人の明細の形（自分の負担 ＋ 立替）に分けて結び付ける。
 * entry は LINKED になり、分ける前の中項目を覚えておく（外すときに戻す）。
 */
function splitImported(tx: Changes, db: Snapshot, entry: PairEntry, target: Transaction, plan: HouseholdPlan) {
  const original = splitsOf(db, target.id)[0];
  tx.remove("splits", original.id);
  plan.splits.forEach((s, i) =>
    tx.insert("splits", {
      id: newId(),
      transactionId: target.id,
      categoryId: s.categoryId,
      amount: s.amount,
      sortOrder: i,
      // 取込で付いた費目があれば、二人の明細で費目を選んでいない限りそれを残す
      costTypeId: s.costTypeId || original.costTypeId || null,
    }),
  );
  tx.update("transactions", target.id, { transferToId: plan.transferToId, updatedAt: now() });
  entry.sync = "LINKED";
  entry.householdTxId = target.id;
  entry.originalCategoryId = original.categoryId;
}

/* ------------------------------------------------------------------ */
/* 入力                                                                */
/* ------------------------------------------------------------------ */

export type PairEntryInput = {
  date?: string;
  description?: string;
  amount?: number;
  payer?: PairRole;
  mode?: ShareMode;
  /** mode が CUSTOM のとき。自分（オーナー）の負担の円 */
  ownerShare?: number | null;
  /** 空・null なら利用先から推定する（新規のとき） */
  costTypeId?: string | null;
  /** 自分の負担を入れる中項目（大項目「パートナー」配下）。null なら既定 */
  categoryId?: string | null;
  /** 自分が払ったときの決済手段。null なら既定（現金） */
  methodId?: string | null;
  memo?: string | null;
};

/** 入力を確かめて、負担を割った明細の形にする（GAS の normalizeInput_ と同じ） */
function applyInput(base: Partial<PairEntry>, input: PairEntryInput, db: Snapshot, master: PairMaster) {
  const e: Partial<PairEntry> = { ...base };
  if (input.date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(Date.parse(`${input.date}T00:00:00Z`))) {
      throw badRequest(`日付が読めません: ${input.date}`);
    }
    e.date = input.date;
  }
  if (input.description !== undefined) {
    const d = input.description.trim();
    if (!d) throw badRequest("内容を入れてください");
    e.description = d.slice(0, 100);
  }
  if (input.amount !== undefined) {
    const a = Math.round(input.amount);
    if (!(a > 0 && a < PAIR_MAX_AMOUNT)) throw badRequest("金額は 1 円以上・1 億円未満で入れてください");
    e.amount = a;
  }
  if (input.payer !== undefined) e.payer = input.payer;
  if (input.costTypeId !== undefined) {
    const id = input.costTypeId || null;
    if (id && !db.costTypes.some((c) => c.id === id && !c.archivedAt)) throw badRequest("費目が見つかりません");
    e.costTypeId = id;
  }
  if (input.memo !== undefined) e.memo = (input.memo ?? "").trim().slice(0, 200) || null;
  if (input.categoryId !== undefined) {
    const id = input.categoryId || null;
    if (id && !master.shareCategories.some((c) => c.id === id)) throw badRequest("中項目が見つかりません");
    e.categoryId = id;
  }
  if (input.methodId !== undefined) {
    const id = input.methodId || null;
    if (id && !master.methods.some((m) => m.id === id)) throw badRequest("決済手段が見つかりません");
    e.methodId = id;
  }
  if (!e.date || !e.description || !e.amount || !e.payer) throw badRequest("日付・内容・金額・払った人は必須です");
  if (e.payer === "PARTNER") e.methodId = null;
  else if (!e.methodId) e.methodId = master.ownerDefaultMethod?.id ?? null;

  // 負担。指定が無ければ今の割り方を保つ（任意なら、自分の負担額を保つ）
  const mode: ShareMode = input.mode ?? e.mode ?? "HALF";
  let custom: CustomShare | null = null;
  if (mode === "CUSTOM") {
    const owner = input.ownerShare ?? e.ownerShare ?? 0;
    if (!(owner >= 0) || owner > e.amount) throw badRequest(`自分の負担は 0〜${e.amount} 円で入れてください`);
    custom = { ownerShare: owner };
  }
  const shares = computeShares(e.amount, e.payer, mode, custom);
  e.ownerShare = shares.ownerShare;
  e.partnerShare = shares.partnerShare;
  e.mode = canonicalMode(e.amount, e.payer, e.ownerShare);
  return e as PairEntry;
}

/** 本体の分類ルールで費目を推定する。ルールに無ければ、内容に費目の名前が入っていればそれにする */
function guessCostType(db: Snapshot, description: string): string | null {
  const live = new Set(db.costTypes.filter((c) => !c.archivedAt).map((c) => c.id));
  const hit = classifyCostType(
    description,
    db.rules.filter((r) => r.costTypeId && live.has(r.costTypeId)),
  );
  if (hit) return hit;
  const text = normalizeDescription(description);
  const byName = db.costTypes
    .filter((c) => !c.archivedAt)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .find((c) => text.includes(normalizeDescription(c.name)));
  return byName?.id ?? null;
}

/* ------------------------------------------------------------------ */
/* 操作（すべて withChanges の中で呼ぶ）                                */
/* ------------------------------------------------------------------ */

/** 二人の明細の行に書く列（id 以外） */
function entryPatch(entry: PairEntry): Partial<PairEntry> {
  const { id: _id, ...rest } = entry;
  void _id;
  return rest;
}

export type PairWriteResult = { entry: PairEntry; warning: string | null };

export function createPairEntry(tx: Changes, db: Snapshot, input: PairEntryInput): PairWriteResult {
  const master = loadPairMaster(db);
  const entry = applyInput({ categoryId: null, memo: null }, input, db, master);
  if (!input.costTypeId) entry.costTypeId = guessCostType(db, entry.description);
  const timestamp = now();
  Object.assign(entry, {
    id: newId(),
    categoryId: entry.categoryId ?? null,
    memo: entry.memo ?? null,
    settlementId: null,
    createdBy: "OWNER",
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  } satisfies Partial<PairEntry>);
  const warning = syncEntry(tx, db, entry, master);
  tx.insert("pairEntries", entry);
  return { entry, warning };
}

function findOpenEntry(db: Snapshot, id: string): PairEntry {
  const entry = db.pairEntries.find((e) => e.id === id && !e.deletedAt);
  if (!entry) throw badRequest("明細が見つかりません（削除済みかもしれません）。画面を再読み込みしてください");
  if (entry.settlementId) throw badRequest("精算済みの明細は直せません。先に精算を取り消してください");
  return entry;
}

export function updatePairEntry(tx: Changes, db: Snapshot, id: string, input: PairEntryInput): PairWriteResult {
  const master = loadPairMaster(db);
  const current = findOpenEntry(db, id);
  const next = applyInput({ ...current }, input, db, master);
  unsyncEntry(tx, db, next);
  next.updatedAt = now();
  const warning = syncEntry(tx, db, next, master);
  tx.update("pairEntries", id, entryPatch(next));
  return { entry: next, warning };
}

export function deletePairEntry(tx: Changes, db: Snapshot, id: string): PairEntry {
  const entry = { ...findOpenEntry(db, id) };
  unsyncEntry(tx, db, entry);
  entry.deletedAt = now();
  entry.updatedAt = entry.deletedAt;
  tx.update("pairEntries", id, entryPatch(entry));
  return entry;
}

export type SettleInput = {
  /** 対象の明細。省くと未精算の全件 */
  ids?: string[];
  /** 実際に渡した額。省くと差額どおり */
  amount?: number | null;
  /** 精算に使った自分の口座。省くと PayPay */
  methodId?: string | null;
  memo?: string | null;
};

/** まとめて精算する（GAS 決定 L8）。精算額を直した差は本体に「精算の差額」として残す */
export function settlePair(tx: Changes, db: Snapshot, input: SettleInput) {
  const master = loadPairMaster(db);
  let targets = db.pairEntries.filter(isOpen);
  if (input.ids) {
    const wanted = new Set(input.ids);
    targets = targets.filter((e) => wanted.has(e.id));
  }
  if (targets.length === 0) throw badRequest("精算する明細がありません");
  const balance = computeBalance(targets);
  const amount = input.amount === undefined || input.amount === null ? balance.amount : Math.round(input.amount);
  if (!(amount >= 0)) throw badRequest("精算額が不正です");
  const payer: PairRole = balance.payer ?? "PARTNER";
  if (input.methodId && !master.methods.some((m) => m.id === input.methodId)) throw badRequest("決済手段が見つかりません");

  const settlement: PairSettlement = {
    id: newId(),
    date: todayInTokyo(),
    payer,
    amount,
    count: targets.length,
    methodId: input.methodId || master.settleMethod?.id || null,
    householdTxIds: null,
    memo: (input.memo ?? "").trim().slice(0, 200) || null,
    createdBy: "OWNER",
    canceledAt: null,
    createdAt: now(),
    kind: null,
  };

  let warning: string | null = null;
  try {
    settlement.householdTxIds = writeSettlement(tx, db, settlement, balance.net, master).join(",") || null;
  } catch (error) {
    warning = error instanceof Error ? error.message : String(error);
  }
  tx.insert("pairSettlements", settlement);
  const timestamp = now();
  for (const entry of targets) tx.update("pairEntries", entry.id, { settlementId: settlement.id, updatedAt: timestamp });
  return { settlement, balance, warning };
}

/** 精算を本体に書く。返り値は本体の明細 ID */
function writeSettlement(tx: Changes, db: Snapshot, s: PairSettlement, net: number, master: PairMaster): string[] {
  const missing = missingTargets(master);
  if (missing) throw new Error(missing);
  const advanceId = master.advanceCategory!.id;
  const accountId = master.partnerAccount!.id;
  const shareId = master.shareCategory!.id;
  const memo = `二人の精算 ${s.id}`;
  const ids: string[] = [];
  if (s.amount > 0) {
    const fromPartner = s.payer === "PARTNER";
    ids.push(
      appendHouseholdTx(
        tx,
        db,
        {
          date: s.date,
          description: `精算（${fromPartner ? "受取" : "支払"}）`,
          paymentMethodId: fromPartner ? accountId : s.methodId,
          transferToId: fromPartner ? s.methodId : accountId,
          splits: [{ categoryId: advanceId, amount: s.amount, costTypeId: null }],
        },
        memo,
      ),
    );
  }
  // 精算後も「彼女精算」に残る差（まけた・多めに払った）は、自分の負担として片付ける
  const residual = net - (s.payer === "PARTNER" ? s.amount : -s.amount);
  if (residual) {
    ids.push(
      appendHouseholdTx(
        tx,
        db,
        {
          date: s.date,
          description: "精算の差額",
          paymentMethodId: accountId,
          transferToId: null,
          splits: [{ categoryId: shareId, amount: residual, costTypeId: null }],
        },
        memo,
      ),
    );
  }
  return ids;
}

/** 精算を取り消す。明細は未精算に戻り、本体に書いた精算の明細は消える。過去分の取込は GAS で取り消す */
export function undoPairSettlement(tx: Changes, db: Snapshot, id: string) {
  const s = db.pairSettlements.find((x) => x.id === id && !x.canceledAt);
  if (!s) throw badRequest("精算が見つかりません（取り消し済みかもしれません）");
  if (s.kind === PAIR_SETTINGS.historyKind) {
    throw badRequest("過去分の取込は、取り込んだ明細ごと消す必要があるため LINE ボットの GAS（ダッシュボード）で取り消してください");
  }
  for (const txId of (s.householdTxIds ?? "").split(",").filter(Boolean)) {
    if (db.transactions.some((t) => t.id === txId)) deleteTransaction(tx, db, txId);
  }
  const timestamp = now();
  tx.update("pairSettlements", id, { canceledAt: timestamp });
  for (const entry of db.pairEntries.filter((e) => e.settlementId === id)) {
    tx.update("pairEntries", entry.id, { settlementId: null, updatedAt: timestamp });
  }
  return s;
}

/** 取込待ちのカード払いをまとめて照合し、本体に書けなかった明細を書き直す */
export function reconcilePair(tx: Changes, db: Snapshot) {
  const master = loadPairMaster(db);
  const live = db.pairEntries.filter((e) => !e.deletedAt).map((e) => ({ ...e }));
  const changed = new Set<PairEntry>();
  let retried = 0;
  for (const entry of live.filter((e) => e.sync === "ERROR")) {
    syncEntry(tx, db, entry, master);
    if (entry.sync !== "ERROR") {
      retried++;
      changed.add(entry);
    }
  }
  const pending = live.filter((e) => e.sync === "PENDING_IMPORT");
  const linked = reconcileEntries(tx, db, pending, master);
  for (const entry of pending) if (entry.sync === "LINKED") changed.add(entry);
  const timestamp = now();
  for (const entry of changed) {
    tx.update("pairEntries", entry.id, {
      sync: entry.sync,
      householdTxId: entry.householdTxId,
      originalCategoryId: entry.originalCategoryId,
      updatedAt: timestamp,
    });
  }
  return {
    linked,
    retried,
    pending: live.filter((e) => e.sync === "PENDING_IMPORT").length,
    errors: live.filter((e) => e.sync === "ERROR").length,
  };
}

/* ------------------------------------------------------------------ */
/* 家計簿の明細との結び付け（突き合わせ）                              */
/* ------------------------------------------------------------------ */

/** 過去分の取込（割り勘アプリなど）で入った明細か */
export function isHistoryEntry(db: Snapshot, entry: Pick<PairEntry, "settlementId">) {
  if (!entry.settlementId) return false;
  return db.pairSettlements.some((s) => s.id === entry.settlementId && s.kind === PAIR_SETTINGS.historyKind);
}

/** ほかの（削除されていない）二人の明細が使っている本体の明細 */
export function usedHouseholdTxIds(db: Snapshot, exceptEntryId?: string) {
  return new Set(
    db.pairEntries
      .filter((e) => !e.deletedAt && e.id !== exceptEntryId)
      .map((e) => e.householdTxId)
      .filter((id): id is string => Boolean(id)),
  );
}

/**
 * 二人の明細を、指定した本体の明細に結び付ける。
 *  - 過去分の取込: 家計簿の明細はもう入っているので、どの明細かを覚えるだけ（本体は書き換えない）
 *  - それ以外（自分が払った明細）: 取込で入った明細を自分の負担と立替に分けて LINKED にする。
 *    LINE で登録して本体にも書いた明細（DONE）は、その明細を消す（取込の明細と二重にならないように）
 */
export function linkPairEntry(tx: Changes, db: Snapshot, entryId: string, transactionId: string) {
  const master = loadPairMaster(db);
  const current = db.pairEntries.find((e) => e.id === entryId && !e.deletedAt);
  if (!current) throw badRequest("明細が見つかりません（削除済みかもしれません）。画面を再読み込みしてください");
  const target = db.transactions.find((t) => t.id === transactionId);
  if (!target) throw badRequest("家計簿の明細が見つかりません。画面を再読み込みしてください");
  if (current.householdTxId === transactionId) throw badRequest("すでにこの明細に結び付いています");
  if (usedHouseholdTxIds(db, entryId).has(transactionId)) throw badRequest("この家計簿の明細は、ほかの二人の明細に結び付いています");
  const entry = { ...current };

  if (isHistoryEntry(db, entry)) {
    tx.update("pairEntries", entry.id, { householdTxId: transactionId, updatedAt: now() });
    return { entry: { ...entry, householdTxId: transactionId } };
  }

  if (entry.payer !== "OWNER") throw badRequest("相手が払った明細は、取込の明細とは結び付けません");
  if (Math.round(target.amount) !== Math.round(entry.amount)) {
    throw badRequest(`金額が違います（二人の明細 ${entry.amount} 円 / 家計簿 ${target.amount} 円）。先に二人の明細の金額を直してください`);
  }
  if ((target.memo ?? "").startsWith("二人の")) throw badRequest("LINE・このページで書いた明細とは結び付けられません");
  if (splitsOf(db, target.id).length !== 1) throw badRequest("内訳が 1 件の明細だけ結び付けられます（分けた内訳を 1 つに戻してから）");
  const plan = planHouseholdTx(entry, master);
  if (!plan) throw badRequest("この明細は家計簿に書くものがありません");
  unsyncEntry(tx, db, entry);
  splitImported(tx, db, entry, target, plan);
  entry.updatedAt = now();
  tx.update("pairEntries", entry.id, entryPatch(entry));
  return { entry };
}

/**
 * 結び付けを外す。過去分の取込は覚えていた明細を忘れるだけ。
 * それ以外は取込の明細の内訳を 1 件に戻し、カード払いなら取込待ちに、それ以外なら本体に書き直す。
 */
export function unlinkPairEntry(tx: Changes, db: Snapshot, entryId: string) {
  const master = loadPairMaster(db);
  const current = db.pairEntries.find((e) => e.id === entryId && !e.deletedAt);
  if (!current) throw badRequest("明細が見つかりません（削除済みかもしれません）");
  const entry = { ...current };
  if (isHistoryEntry(db, entry)) {
    tx.update("pairEntries", entry.id, { householdTxId: null, updatedAt: now() });
    return { entry: { ...entry, householdTxId: null }, warning: null };
  }
  if (entry.sync !== "LINKED") throw badRequest("取込の明細に結び付いていません");
  unsyncEntry(tx, db, entry);
  let warning: string | null = null;
  if (entry.payer === "OWNER" && methodKind(master, entry.methodId) === "CARD") {
    // すぐに照合し直すと同じ明細に戻ってしまうので、取込待ちにだけしておく
    entry.sync = entry.partnerShare ? "PENDING_IMPORT" : "NONE";
  } else {
    warning = syncEntry(tx, db, entry, master);
  }
  entry.updatedAt = now();
  tx.update("pairEntries", entry.id, entryPatch(entry));
  return { entry, warning };
}

/**
 * 二人の明細の中項目（イベント）をまとめて付ける。中項目は大項目「パートナー」配下（null は既定）。
 *  - 未精算: 修正と同じ（家計簿の明細も書き直す）
 *  - 過去分の取込: 二人の明細の中項目だけを変える（家計簿には書いていない）
 *  - 精算済み: 家計簿に書いた自分の負担の内訳の中項目も付け替える（金額は変えない）
 */
export function setPairEntriesCategory(tx: Changes, db: Snapshot, ids: string[], categoryId: string | null) {
  const master = loadPairMaster(db);
  if (categoryId && !master.shareCategories.some((c) => c.id === categoryId)) throw badRequest("中項目が見つかりません");
  const defaultId = master.shareCategory?.id ?? null;
  let updated = 0;
  for (const id of new Set(ids)) {
    const entry = db.pairEntries.find((e) => e.id === id && !e.deletedAt);
    if (!entry) throw badRequest("明細が見つかりません。画面を再読み込みしてください");
    if ((entry.categoryId ?? null) === categoryId) continue;
    if (isOpen(entry)) {
      updatePairEntry(tx, db, id, { categoryId });
    } else {
      if (!isHistoryEntry(db, entry) && (entry.sync === "DONE" || entry.sync === "LINKED") && entry.householdTxId) {
        const from = entry.categoryId || defaultId;
        const to = categoryId || defaultId;
        if (from && to) {
          for (const split of splitsOf(db, entry.householdTxId).filter((s) => s.categoryId === from)) {
            tx.update("splits", split.id, { categoryId: to });
          }
        }
      }
      tx.update("pairEntries", id, { categoryId, updatedAt: now() });
    }
    updated++;
  }
  return { updated };
}
