import type { CategoryKind } from "@/lib/db/types";
import type {
  CategoryBreakdownItem,
  CrossTab,
  KindTotals,
  MonthlyPoint,
} from "@/lib/aggregate-core";
import type {
  BlockStat,
  ResolutionCounts,
  SheetRowIssue,
} from "@/lib/sheet-source";
import type { Reconciliation } from "@/lib/reconcile";

/** 画面で使うカテゴリツリー（API /api/categories の戻り値） */
export type MajorWithCategories = {
  id: string;
  name: string;
  kind: CategoryKind;
  color: string;
  sortOrder: number;
  isSystem: boolean;
  /** 使途。null なら未設定 */
  purposeId: string | null;
  categories: { id: string; name: string; sortOrder: number }[];
};

/** 使途（個人・生活費・投資…） */
export type PurposeView = {
  id: string;
  name: string;
  openingBalance: number;
  openingBalanceAt: string | null;
};

export type PaymentMethodView = {
  id: string;
  name: string;
  kind: string;
  /** 残高を追う対象か */
  trackBalance: boolean;
  /** 起点残高 */
  openingBalance: number;
  /** 起点残高の基準日（"2026-08-01"）。null なら全期間が対象。 */
  openingBalanceAt: string | null;
};

/** 費目（食費・交通費…）。中項目のツリーとは別の軸 */
export type CostTypeView = { id: string; name: string };

/** 明細の内訳 1 件（個人支出ぶん / 生活費ぶん など） */
export type SplitView = {
  id: string;
  categoryId: string;
  costTypeId: string | null;
  costType: { id: string; name: string } | null;
  amount: number;
  category: {
    id: string;
    name: string;
    major: { id: string; name: string; kind: CategoryKind; color: string };
  };
};

export type TransactionView = {
  id: string;
  date: string;
  /** 内訳の合計 */
  amount: number;
  description: string;
  memo: string | null;
  paymentMethodId: string | null;
  source: string;
  splits: SplitView[];
  paymentMethod: { id: string; name: string } | null;
  /** 帳尻合わせの移動先。設定されているとその明細は残高移動として数えられる。 */
  transferToId: string | null;
  transferTo: { id: string; name: string } | null;
};

/** 毎月の予定（給料・家賃など）の設定 */
export type PlanView = {
  id: string;
  name: string;
  categoryId: string;
  amount: number;
  /** 毎月の日（31 なら月末） */
  day: number;
  paymentMethodId: string | null;
  transferToId: string | null;
  startMonth: string | null;
  endMonth: string | null;
  enabled: boolean;
  memo: string | null;
  categoryName: string;
  majorName: string;
  kind: CategoryKind;
};

/** シート版ダッシュボード（/sheet）の API 応答 */
export type SheetAnalysis = {
  /** シート全体に対する注意（ブロック名の取り違えなど） */
  warnings: string[];
  blocks: BlockStat[];
  resolution: ResolutionCounts;
  issues: SheetRowIssue[];
  /** issues は先頭のみ返すため、総数は別に持つ */
  issueCount: number;
  /** データのある月（昇順、yyyy/MM） */
  months: string[];
  monthly: Record<
    string,
    { totals: KindTotals; breakdown: CategoryBreakdownItem[]; crossTab: CrossTab }
  >;
  trend: MonthlyPoint[];
  splitCount: number;
  /** DB との突合。シートに集計できる月が無ければ null */
  reconciliation: Reconciliation | null;
  /** 読み込んだ期間全体のクロス集計（中項目 × 費目） */
  crossTab: CrossTab;
};
