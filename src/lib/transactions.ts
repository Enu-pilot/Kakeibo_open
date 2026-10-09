import { buildDedupeHash } from "@/lib/dedupe";
import { newId, now, type Changes, type Snapshot } from "@/lib/db/store";
import type { Transaction, TransactionSource } from "@/lib/db/types";

/** 明細の内訳 1 件ぶん */
export type SplitInput = {
  categoryId: string;
  amount: number;
  /** 費目（任意）。付けない内訳はクロス集計で「未設定」になる */
  costTypeId?: string | null;
};

export type TransactionInput = {
  /** "YYYY-MM-DD" */
  date: string;
  description: string;
  memo?: string | null;
  /** 内訳。1 件でも複数でもよい。合計が明細の総額になる。 */
  splits: SplitInput[];
  paymentMethodId?: string | null;
  /** 帳尻合わせの移動先。残高計算だけに効き、集計には影響しない。 */
  transferToId?: string | null;
  source?: TransactionSource;
  receiptUrl?: string | null;
  importBatchId?: string | null;
};

/** 端数の丸め違いで合計が合わなくならないよう、金額は銭単位の整数で扱う */
export function sumSplits(splits: SplitInput[]) {
  return splits.reduce((total, split) => total + Math.round(split.amount * 100), 0) / 100;
}

/**
 * 内訳の妥当性を確認する。
 * 合計金額は内訳の合計として決まるため、ここを通らない明細は保存させない。
 */
export function validateSplits(splits: SplitInput[]) {
  if (splits.length === 0) return "内訳が空です。カテゴリと金額を 1 件以上入力してください。";
  if (splits.some((split) => !split.categoryId)) return "カテゴリが未選択の内訳があります。";
  // 払い戻しはマイナスで持つので符号は問わない。0 円の内訳だけは意味が無いので弾く。
  if (splits.some((split) => !Number.isFinite(split.amount) || split.amount === 0))
    return "内訳の金額を入力してください（払い戻しはマイナスで入力します）。";
  if (sumSplits(splits) === 0)
    return "内訳の合計が 0 円です。0 円の明細は登録できません。";
  return null;
}

/**
 * 内訳が指す中項目・費目がスプレッドシートにあるかを確かめる。無ければその理由を返す。
 * 画面を開いたあとに別の場所で消された場合に、壊れた参照を書き込まないため。
 */
export function checkSplitRefs(db: Snapshot, splits: SplitInput[]) {
  const categories = new Set(db.categories.map((c) => c.id));
  if (splits.some((s) => !categories.has(s.categoryId))) {
    return "存在しない中項目が含まれています。画面を再読み込みしてください。";
  }
  const costTypes = new Set(db.costTypes.map((c) => c.id));
  if (splits.some((s) => s.costTypeId && !costTypes.has(s.costTypeId))) {
    return "存在しない費目が含まれています。画面を再読み込みしてください。";
  }
  return null;
}

/**
 * 登録済みの重複判定キーの集合。
 * CSV 取込のように 1 回で何件も登録するときは、これを 1 度だけ作って使い回す
 * （同じ CSV の中で重複している 2 行も、2 行目を重複として扱えるようにするため）。
 */
export function dedupeIndex(db: Snapshot) {
  return new Set(db.transactions.map((t) => t.dedupeHash));
}

/**
 * 明細を 1 件登録する（内訳も一緒に）。
 * 重複判定キーが衝突した場合、allowDuplicate なら連番を振って別明細として登録し、
 * そうでなければ null を返す（＝スキップ）。
 */
export function createTransaction(
  tx: Changes,
  db: Snapshot,
  input: TransactionInput,
  options: { allowDuplicate?: boolean; hashes?: Set<string> } = {},
): Transaction | null {
  const hashes = options.hashes ?? dedupeIndex(db);
  const amount = sumSplits(input.splits);

  for (let occurrence = 0; occurrence < 50; occurrence++) {
    const dedupeHash = buildDedupeHash({
      date: input.date,
      description: input.description,
      amount,
      paymentMethodId: input.paymentMethodId,
      occurrence,
    });
    if (hashes.has(dedupeHash)) {
      if (!options.allowDuplicate) return null;
      continue; // 連番を進めて空きを探す
    }
    hashes.add(dedupeHash);

    const timestamp = now();
    const created = tx.insert("transactions", {
      id: newId(),
      date: input.date,
      amount,
      description: input.description,
      memo: input.memo ?? null,
      paymentMethodId: input.paymentMethodId ?? null,
      transferToId: input.transferToId ?? null,
      source: input.source ?? "MANUAL",
      receiptUrl: input.receiptUrl ?? null,
      dedupeHash,
      importBatchId: input.importBatchId ?? null,
      pairTag: "",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    input.splits.forEach((split, index) => {
      tx.insert("splits", {
        id: newId(),
        transactionId: created.id,
        categoryId: split.categoryId,
        amount: split.amount,
        sortOrder: index,
        costTypeId: split.costTypeId ?? null,
      });
    });
    return created;
  }
  return null;
}

/** 更新時に日付・金額・利用先が変わったら重複キーを振り直す */
export function recomputeDedupeHash(
  db: Snapshot,
  transactionId: string,
  next: { date: string; description: string; amount: number; paymentMethodId?: string | null },
) {
  const owner = new Map(db.transactions.map((t) => [t.dedupeHash, t.id]));
  for (let occurrence = 0; occurrence < 50; occurrence++) {
    const dedupeHash = buildDedupeHash({ ...next, occurrence });
    const existing = owner.get(dedupeHash);
    if (!existing || existing === transactionId) return dedupeHash;
  }
  throw new Error("重複キーを採番できませんでした");
}

/** 明細を内訳ごと削除する */
export function deleteTransaction(tx: Changes, db: Snapshot, transactionId: string) {
  for (const split of db.splits.filter((s) => s.transactionId === transactionId)) {
    tx.remove("splits", split.id);
  }
  tx.remove("transactions", transactionId);
}
