/**
 * スプレッドシートに保存する各表の型。
 *
 * 以前は Prisma がスキーマから生成していたものを、ここで手で持つ。
 * 日付は "YYYY-MM-DD"、日時は ISO 8601 の文字列で持つ。スプレッドシートとの
 * 往復でタイムゾーンによる日付ずれが起きないよう、Date には変換しない。
 */

/** 集計種別。大項目は必ずこのどれかに属し、純残高の計算に使われる。 */
export const CATEGORY_KINDS = ["INCOME", "EXPENSE", "LIVING", "INVESTMENT", "ADJUSTMENT"] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

/** 自動分類ルールのマッチ方式 */
export const MATCH_TYPES = ["CONTAINS", "STARTS_WITH", "EXACT", "REGEX"] as const;
export type MatchType = (typeof MATCH_TYPES)[number];

/**
 * 二人（パートナー）の時の明細の区分。アプリの中だけで使い、LINE ボットには見せない。
 *  SHARED: 割り勘にした（二人の明細に記録が無い過去の分など） / SOLO: 二人の時に自分だけで払った（割り勘にしない） /
 *  SETTLEMENT: 精算（送金・受け取り）の記録
 * 二人の明細に結び付いている明細は、区分が空でも割り勘として扱う。
 */
export const PAIR_TAGS = ["SHARED", "SOLO", "SETTLEMENT"] as const;
export type PairTag = (typeof PAIR_TAGS)[number];

/** 取引の入力経路 */
export const TRANSACTION_SOURCES = ["MANUAL", "CSV", "OCR", "SHEET"] as const;
export type TransactionSource = (typeof TRANSACTION_SOURCES)[number];

/** 大項目（収入・給料・支出・投資・帳尻合わせ・チャージ関連・生活費…ユーザー追加可） */
export type MajorCategory = {
  id: string;
  name: string;
  kind: CategoryKind;
  color: string;
  sortOrder: number;
  /** 初期投入の標準大項目。名前・並びは変更できるが削除は不可。 */
  isSystem: boolean;
  /** 使途（個人・生活費・投資…）。種別と合わせて、どの使途の収入・支出かを決める。null なら未設定 */
  purposeId: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * 使途（個人・生活費・投資・彼女・家族…）。大項目の上に立つ「お金の持ち主」の単位。
 * 口座残高とは別に、使途ごとの残高（起点残高 ＋ 収入 − 支出 ± 振替）を持つ。
 */
export type Purpose = {
  id: string;
  /** 一意 */
  name: string;
  sortOrder: number;
  /** 起点日の時点で、この使途に割り当てていたお金 */
  openingBalance: number;
  /** 起点残高の基準日。この日以降の明細・振替だけを足し引きする。null なら全期間 */
  openingBalanceAt: string | null;
  archivedAt: string | null;
  createdAt: string;
};

/**
 * 使途の振替（個人 → 投資 30,000 など）。口座のお金は動かず、使途の残高だけが動く。
 */
export type PurposeTransfer = {
  id: string;
  /** "YYYY-MM-DD" */
  date: string;
  fromPurposeId: string;
  toPurposeId: string;
  /** 正の金額 */
  amount: number;
  memo: string | null;
  createdAt: string;
};

/** 中項目（食費・日用品・給料 など） */
export type Category = {
  id: string;
  name: string;
  majorId: string;
  sortOrder: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** 決済手段（カード名・PayPay・現金・銀行口座など） */
export type PaymentMethod = {
  id: string;
  name: string;
  /** 表示上のグルーピング（CARD / EMONEY / CASH / BANK） */
  kind: string;
  sortOrder: number;
  /** 残高を追う対象か。クレジットカードは残高ではなく利用額なので既定は false。 */
  trackBalance: boolean;
  /** 残高の起点。この日の時点で口座にあった金額。 */
  openingBalance: number;
  /** 起点残高の基準日。この日以降の明細だけを足し引きする。null なら全期間。 */
  openingBalanceAt: string | null;
  archivedAt: string | null;
  createdAt: string;
};

/** 取引明細 */
export type Transaction = {
  id: string;
  /** 取引日 "YYYY-MM-DD" */
  date: string;
  /** 明細の総額。内訳の合計と一致する。払い戻しの明細はマイナスになる（符号の規則は内訳を参照） */
  amount: number;
  description: string;
  memo: string | null;
  paymentMethodId: string | null;
  /** 帳尻合わせ（チャージ・振替）の移動先。設定すると残高移動として数えられる。 */
  transferToId: string | null;
  source: TransactionSource;
  receiptUrl: string | null;
  /** 重複判定キー: sha256(日付 + 正規化した利用先 + 金額 + 決済手段) */
  dedupeHash: string;
  importBatchId: string | null;
  /** 二人の時の区分（空文字は未設定）。PAIR_TAGS を参照 */
  pairTag: PairTag | "";
  createdAt: string;
  updatedAt: string;
};

/** 明細の内訳。1 件の明細を大項目をまたいで分けるためのもの。分けない明細も 1 件持つ。 */
export type TransactionSplit = {
  id: string;
  transactionId: string;
  categoryId: string;
  /**
   * その大項目の種別にとって本来の向きならプラス、逆ならマイナス（signFor）。
   * 支出側なら出金がプラスで払い戻し・精算がマイナス、収入側なら入金がプラス。
   * 0 は持たない。同じ明細の内訳の合計が Transaction.amount と一致する。
   */
  amount: number;
  /** 表示順（0 が主たる内訳） */
  sortOrder: number;
  /**
   * 費目（食費・交通費・宿泊費…）。中項目（イベント）とは別の軸で、
   * 「旅行かつ食費」のようなクロス集計に使う。付けていない内訳は「未設定」として数える
   */
  costTypeId: string | null;
};

/**
 * 費目。大項目 > 中項目のツリーとは別の軸で、どの中項目の内訳にも付けられる。
 * ツリーの下にもう 1 段足すと、同じ「交通費」がイベントの数だけ複製されるため、別の軸にしている。
 * 1 つの内訳に付けられる費目は 1 つだけ（複数にすると費目別の合計が二重になる）。
 */
export type CostType = {
  id: string;
  /** 一意 */
  name: string;
  sortOrder: number;
  archivedAt: string | null;
  createdAt: string;
};

/**
 * 自動分類ルール（キーワード → 中項目 / 費目）。
 * 中項目だけ、費目だけ、両方、のどれでも持てる（どちらか一方は必須）。
 * 店名から中項目（イベント）は決まらないことが多いが、費目（セブン → 食費）は決まるため。
 */
export type Rule = {
  id: string;
  keyword: string;
  matchType: MatchType;
  categoryId: string | null;
  costTypeId: string | null;
  /** 小さいほど先に評価される */
  priority: number;
  /** 過去の手修正から自動生成されたルールかどうか */
  isLearned: boolean;
  enabled: boolean;
  hitCount: number;
  createdAt: string;
  updatedAt: string;
};

/** CSV 列マッピングのプリセット（カード会社ごとに保存して再利用） */
export type ImportPreset = {
  id: string;
  name: string;
  /** 文字コード: auto / UTF8 / SJIS */
  encoding: string;
  skipRows: number;
  /** 列マッピング定義（ColumnMapping 型） */
  mapping: Record<string, unknown>;
  defaultPaymentMethodId: string | null;
  createdAt: string;
  updatedAt: string;
};

/** インポート実行の単位。まとめて取り消せるようにする。 */
export type ImportBatch = {
  id: string;
  fileName: string;
  presetName: string | null;
  importedCount: number;
  skippedCount: number;
  createdAt: string;
};

/**
 * 中項目ごとの月の予算。
 * month が null の行は「毎月の既定」、"2026-09" の行はその月だけの上書き。
 * ある月の予算は、その月の行があればそれ、無ければ既定の行で決まる。
 */
export type Budget = {
  id: string;
  categoryId: string;
  /** "YYYY-MM"。null なら毎月の既定 */
  month: string | null;
  amount: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * 毎月決まった収入・支出の予定（給料・家賃・NISA 積立・通信費など）。
 * 実際の明細とは、同じ中項目・同じ月のうち金額がいちばん近いものと突き合わせる。
 * 賞与のような単発の予定は、開始月と終了月を同じ月にする。
 */
export type Plan = {
  id: string;
  name: string;
  categoryId: string;
  /** 正の絶対値。入金か支払いかは中項目の大項目で決まる（明細と同じ） */
  amount: number;
  /** 毎月の何日か。月末より大きい日（2 月の 30 日など）は月末日として扱う */
  day: number;
  /** どの口座から出る・どの口座に入るか。口座残高の見込みに使う */
  paymentMethodId: string | null;
  /** 帳尻合わせ（チャージ・振替）の予定の移動先 */
  transferToId: string | null;
  /** "YYYY-MM"。null なら期限なし */
  startMonth: string | null;
  endMonth: string | null;
  enabled: boolean;
  memo: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * 二人の家計簿 LINE（別リポジトリ（非公開）の GAS）と共有するタブ。
 * 見出し・値の形は GAS の gas/Config.js・gas/Shared.js と一字一句そろえる。
 */
export const PAIR_ROLES = ["OWNER", "PARTNER"] as const;
export type PairRole = (typeof PAIR_ROLES)[number];

/** 負担の割り方。割り勘 / 全額自分（オーナー） / 全額相手（パートナー） / 任意 */
export const SHARE_MODES = ["HALF", "ALL_OWNER", "ALL_PARTNER", "CUSTOM"] as const;
export type ShareMode = (typeof SHARE_MODES)[number];

/**
 * 本体の家計簿への反映。
 *  DONE: 本体の明細を書いた / LINKED: カード取込の明細の内訳を分けた /
 *  PENDING_IMPORT: カード明細の取込待ち / NONE: 本体に書くものが無い / ERROR: 書けなかった
 */
export const PAIR_SYNC = ["DONE", "LINKED", "PENDING_IMPORT", "NONE", "ERROR"] as const;
export type PairSync = (typeof PAIR_SYNC)[number];

/** 二人の明細（タブ「二人の明細」）。金額は総額、負担は 2 人の分の円（合計＝金額） */
export type PairEntry = {
  id: string;
  /** "YYYY-MM-DD" */
  date: string;
  description: string;
  amount: number;
  payer: PairRole;
  mode: ShareMode;
  ownerShare: number;
  partnerShare: number;
  costTypeId: string | null;
  /** 自分の負担を入れる本体の中項目（大項目「パートナー」配下）。null なら既定の「パートナー」 */
  categoryId: string | null;
  /** 自分が払ったときの本体の決済手段 */
  methodId: string | null;
  memo: string | null;
  /** 精算済みなら二人の精算の ID */
  settlementId: string | null;
  /** 空文字は未設定 */
  sync: PairSync | "";
  householdTxId: string | null;
  /** カード取込の明細の内訳を分けたとき、分ける前の中項目（元に戻す用） */
  originalCategoryId: string | null;
  createdBy: PairRole;
  createdAt: string;
  updatedAt: string;
  /** 論理削除。入っている行は無いものとして扱う */
  deletedAt: string | null;
};

/** 二人の精算（タブ「二人の精算」） */
export type PairSettlement = {
  id: string;
  date: string;
  /** お金を渡した人 */
  payer: PairRole;
  amount: number;
  count: number;
  methodId: string | null;
  /** 本体に書いた明細の ID（カンマ区切り） */
  householdTxIds: string | null;
  memo: string | null;
  createdBy: PairRole;
  canceledAt: string | null;
  createdAt: string;
  /** 空なら通常の精算。HISTORY は過去分の取込（金額 0、本体の明細なし） */
  kind: string | null;
};

/** LINE連携（タブ「LINE連携」）。id は LINE のユーザー ID。画面には出さず、表示名だけを使う */
export type LineUser = {
  id: string;
  role: string;
  displayName: string;
  registeredAt: string | null;
};

/** 表の名前と、その行の型の対応 */
export type Tables = {
  majors: MajorCategory;
  categories: Category;
  costTypes: CostType;
  paymentMethods: PaymentMethod;
  transactions: Transaction;
  splits: TransactionSplit;
  rules: Rule;
  presets: ImportPreset;
  batches: ImportBatch;
  budgets: Budget;
  plans: Plan;
  purposes: Purpose;
  purposeTransfers: PurposeTransfer;
  pairEntries: PairEntry;
  pairSettlements: PairSettlement;
  lineUsers: LineUser;
};

export type TableName = keyof Tables;
