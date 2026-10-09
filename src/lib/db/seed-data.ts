/**
 * 初期データ（npm run db:seed で投入する）。
 * 公開用のサンプル構成（実データの構成は含まない）。
 * 既にある大項目・中項目・決済手段・ルールは消さず、無いものだけを足す。
 */
import type { CategoryKind, MatchType } from "@/lib/db/types";

/**
 * 標準の大項目と中項目。名前・並びは画面から変更でき、ユーザー追加も自由。
 *
 * 公開用のサンプル構成（一般的な名前）。自分のスプレッドシートで好きな名前に変えてよい。
 * 種別（個人収入・個人支出・投資・帳尻合わせ・生活費）の下に大項目、その下に中項目（イベント名や用途）が並ぶ。
 * 並び順は まとめ のブロック順（個人収入 → 個人支出 → 投資 → 帳尻合わせ → 生活費）。
 *
 * 個人収入の「交通費支給（インターン）」は、支出側「インターン」と同じ名前の中項目を持つ。
 * 入金は同じ名前の収入側の中項目へ入る（src/lib/import-routing.ts）ので、
 * インターンの交通費精算がそのイベントの収入として並ぶ。
 */
export const MAJORS: {
  name: string;
  kind: CategoryKind;
  color: string;
  /** 使途（PURPOSES の名前）。帳尻合わせは使途の残高に効かないので持たない */
  purpose?: string;
  categories: string[];
}[] = [
  { name: "給料", purpose: "個人", kind: "INCOME", color: "#197a4b", categories: ["本業", "アルバイト", "副業"] },
  { name: "旅費補助", purpose: "個人", kind: "INCOME", color: "#197a4b", categories: ["旅費補助"] },
  {
    name: "交通費支給（インターン）",
    purpose: "個人",
    kind: "INCOME",
    color: "#197a4b",
    categories: ["夏のインターン", "冬のインターン"],
  },
  {
    name: "家族",
    purpose: "家族",
    kind: "INCOME",
    color: "#197a4b",
    categories: ["家族立替", "帰省費用", "生活費補助", "家賃"],
  },
  {
    name: "インターン",
    purpose: "個人",
    kind: "EXPENSE",
    color: "#ce0000",
    categories: ["夏のインターン", "冬のインターン"],
  },
  { name: "バイト", purpose: "個人", kind: "EXPENSE", color: "#ce0000", categories: ["通勤交通費"] },
  {
    name: "旅行",
    purpose: "個人",
    kind: "EXPENSE",
    color: "#ce0000",
    categories: ["夏の旅行", "冬の旅行", "一人旅"],
  },
  {
    name: "日常",
    purpose: "個人",
    kind: "EXPENSE",
    color: "#ce0000",
    categories: ["ガジェット", "サブスク", "ポイ活", "勉強", "日常"],
  },
  {
    name: "遊び",
    purpose: "個人",
    kind: "EXPENSE",
    color: "#ce0000",
    categories: ["ランニング", "イベント", "カフェ"],
  },
  {
    name: "パートナー",
    purpose: "彼女",
    kind: "EXPENSE",
    color: "#ce0000",
    categories: ["旅行", "記念日", "パートナー"],
  },
  { name: "投資", purpose: "投資", kind: "INVESTMENT", color: "#8843e1", categories: ["証券口座", "投資"] },
  {
    name: "チャージ関連",
    kind: "ADJUSTMENT",
    color: "#767676",
    categories: ["交通系ICチャージ", "電子マネーチャージ"],
  },
  {
    name: "帳尻合わせ",
    kind: "ADJUSTMENT",
    color: "#767676",
    categories: ["入出金が重なるもの"],
  },
  {
    name: "生活費",
    purpose: "生活費",
    kind: "LIVING",
    color: "#a58000",
    categories: ["家賃・光熱費", "通信費", "食費", "日用品", "Amazon建て替え", "生活費"],
  },
];

/**
 * 使途。大項目の上に立つ「お金の持ち主」の単位で、使途ごとに残高（起点 ＋ 収入 − 支出 ± 振替）を持つ。
 * 並び順がダッシュボードの並びになる。
 */
export const PURPOSES = ["個人", "生活費", "投資", "彼女", "家族"];

/**
 * 費目。大項目 > 中項目とは別の軸で、クロス集計の列になる（並び順がそのまま列の順）。
 */
export const COST_TYPES = ["食費", "食費（遊び）", "交通費", "宿泊費", "衣服", "日用品", "趣味"];

/**
 * 決済手段。請求シートのブロック名と同じ名前にしておくと、シートを読むときに
 * 種類（入金を収入にするか差し引くか）が登録どおりに決まる（src/lib/inflow.ts）。
 * 残高は口座・現金・電子マネーだけ追い、カードは利用額なので追わない（設定画面で変更できる）。
 */
export const PAYMENT_METHODS: { name: string; kind: string }[] = [
  { name: "メインカード", kind: "CARD" },
  { name: "サブカード", kind: "CARD" },
  { name: "PayPay", kind: "EMONEY" },
  { name: "銀行口座", kind: "BANK" },
  { name: "現金", kind: "CASH" },
  { name: "交通系IC", kind: "EMONEY" },
];

/**
 * 初期ルール。中項目は使用先で決まることが多いので、主に費目を店名から付ける。
 * 中項目（major/category）と費目（costType）のどちらか、または両方を持つ。
 *
 * 使用先がいつも同じ店・引き落としだけに中項目を付けている
 * （旅行先の店のように使用先がイベントごとに変わるものは、費目だけにする）。人とのやりとり（送金・受取）は入れない。
 * 照合は全角・半角・大文字小文字・空白を無視する（src/lib/normalize.ts）。priority は小さいほど先に評価する。
 */
export const RULES: {
  keyword: string;
  matchType: MatchType;
  major?: string;
  category?: string;
  costType?: string;
  priority: number;
}[] = [
  // ---- 中項目まで決まるもの（毎月の引き落とし・決まった使い道）
  { keyword: "給料振込", matchType: "STARTS_WITH", major: "給料", category: "本業", priority: 20 },
  { keyword: "証券", matchType: "CONTAINS", major: "投資", category: "証券口座", priority: 25 },
  { keyword: "NISA", matchType: "CONTAINS", major: "投資", category: "投資", priority: 25 },
  { keyword: "PayPayポイント運用", matchType: "CONTAINS", major: "日常", category: "ポイ活", priority: 25 },
  { keyword: "ポイント、残高の獲得", matchType: "CONTAINS", major: "日常", category: "ポイ活", priority: 25 },
  { keyword: "期間限定ポイントの期限切れ", matchType: "CONTAINS", major: "日常", category: "ポイ活", priority: 25 },
  { keyword: "PayPay チャージ", matchType: "CONTAINS", major: "日常", category: "ポイ活", priority: 25 },
  { keyword: "キャンペーン", matchType: "CONTAINS", major: "日常", category: "ポイ活", priority: 40 },
  { keyword: "利息", matchType: "CONTAINS", major: "日常", category: "ポイ活", priority: 40 },
  { keyword: "電気", matchType: "CONTAINS", major: "生活費", category: "家賃・光熱費", priority: 30 },
  { keyword: "ガス", matchType: "CONTAINS", major: "生活費", category: "家賃・光熱費", priority: 30 },
  { keyword: "水道", matchType: "CONTAINS", major: "生活費", category: "家賃・光熱費", priority: 30 },
  { keyword: "docomo", matchType: "CONTAINS", major: "生活費", category: "通信費", priority: 30 },
  { keyword: "ソフトバンク", matchType: "CONTAINS", major: "生活費", category: "通信費", priority: 30 },
  { keyword: "J:COM", matchType: "CONTAINS", major: "生活費", category: "通信費", priority: 30 },
  { keyword: "SPOTIFY", matchType: "CONTAINS", major: "日常", category: "サブスク", priority: 30 },
  { keyword: "Netflix", matchType: "CONTAINS", major: "日常", category: "サブスク", priority: 30 },
  { keyword: "APPLE COM BILL", matchType: "CONTAINS", major: "日常", category: "サブスク", priority: 30 },
  { keyword: "AMAZON.CO.JP", matchType: "CONTAINS", major: "生活費", category: "Amazon建て替え", priority: 40 },
  { keyword: "プライム会費", matchType: "CONTAINS", major: "生活費", category: "Amazon建て替え", priority: 40 },
  { keyword: "モバイルICOCA チャージ", matchType: "CONTAINS", major: "チャージ関連", category: "交通系ICチャージ", priority: 30 },
  { keyword: "モバイルSuica チャージ", matchType: "CONTAINS", major: "チャージ関連", category: "交通系ICチャージ", priority: 30 },
  // 交通系 IC 側に出る「カードからの入金」。カード側のチャージと同じお金なので帳尻合わせ
  { keyword: "モバイル クレ", matchType: "CONTAINS", major: "帳尻合わせ", category: "入出金が重なるもの", priority: 30 },
  { keyword: "からチャージ", matchType: "CONTAINS", major: "チャージ関連", category: "電子マネーチャージ", priority: 30 },
  { keyword: "RTK ペイペイ", matchType: "CONTAINS", major: "チャージ関連", category: "電子マネーチャージ", priority: 30 },

  // ---- 費目だけ（中項目は使用先で決まる）
  // 食費: スーパー・コンビニ・チェーンの食事
  { keyword: "スーパー", matchType: "CONTAINS", costType: "食費", priority: 70 },
  { keyword: "セブン", matchType: "CONTAINS", costType: "食費", priority: 70 },
  { keyword: "フアミリ―マ―ト", matchType: "CONTAINS", costType: "食費", priority: 70 },
  { keyword: "大学生協", matchType: "CONTAINS", costType: "食費", priority: 70 },
  { keyword: "松屋", matchType: "STARTS_WITH", costType: "食費", priority: 70 },
  { keyword: "松のや", matchType: "CONTAINS", costType: "食費", priority: 70 },
  { keyword: "すき家", matchType: "CONTAINS", costType: "食費", priority: 70 },
  { keyword: "なか卯", matchType: "CONTAINS", costType: "食費", priority: 70 },
  { keyword: "吉野家", matchType: "CONTAINS", costType: "食費", priority: 70 },
  { keyword: "日高屋", matchType: "CONTAINS", costType: "食費", priority: 70 },
  { keyword: "かつや", matchType: "STARTS_WITH", costType: "食費", priority: 70 },
  { keyword: "やよい軒", matchType: "CONTAINS", costType: "食費", priority: 70 },
  { keyword: "サイゼリヤ", matchType: "CONTAINS", costType: "食費", priority: 70 },
  { keyword: "マクドナルド", matchType: "CONTAINS", costType: "食費", priority: 70 },
  { keyword: "ほっともっと", matchType: "CONTAINS", costType: "食費", priority: 70 },
  { keyword: "hottomotto", matchType: "CONTAINS", costType: "食費", priority: 70 },
  // 交通費: 鉄道・バス・飛行機・高速道路・カーシェア。IC カードの乗車記録（「駅 → 駅」「出場」）も
  { keyword: "ＪＲ", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "新幹線", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "バス", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "入場/出場", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "乗車", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "→", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "出場", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "鉄道", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "電鉄", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "近鉄", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "地下鉄", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "モノレール", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "交通利用", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "フェリー", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "えきねっと", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "EXサービス", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "スマートEX", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "VIPライナー", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "MaaS", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "ジョルダン", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "^(ＪＡＬ|JAL)\\s*[０-９0-9]", matchType: "REGEX", costType: "交通費", priority: 70 },
  { keyword: "ANA", matchType: "STARTS_WITH", costType: "交通費", priority: 70 },
  { keyword: "スカイマーク", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "ソラシド", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "AIRDO", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "フジドリームエアラインズ", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "ジェットスター", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "JETSTAR", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "ETC", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "料金徴収所", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "タイムズカー", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "駐車場", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  // 宿泊費: ホテル・宿泊予約サイト
  { keyword: "ホテル", matchType: "CONTAINS", costType: "宿泊費", priority: 70 },
  { keyword: "HOTEL", matchType: "CONTAINS", costType: "宿泊費", priority: 70 },
  { keyword: "旅館", matchType: "CONTAINS", costType: "宿泊費", priority: 70 },
  { keyword: "楽天トラベル", matchType: "CONTAINS", costType: "宿泊費", priority: 70 },
  { keyword: "一休", matchType: "CONTAINS", costType: "宿泊費", priority: 70 },
  { keyword: "じゃらん", matchType: "CONTAINS", costType: "宿泊費", priority: 70 },
  { keyword: "BOOKING", matchType: "CONTAINS", costType: "宿泊費", priority: 70 },
  { keyword: "ブッキング", matchType: "CONTAINS", costType: "宿泊費", priority: 70 },
  { keyword: "ブツキング", matchType: "CONTAINS", costType: "宿泊費", priority: 70 },
  { keyword: "AIRBNB", matchType: "CONTAINS", costType: "宿泊費", priority: 70 },
  { keyword: "triplaホテル", matchType: "CONTAINS", costType: "宿泊費", priority: 70 },
  // ---- 食費: コンビニ各社・スーパー。駅名（地下鉄・ＪＲ…）と並んで出ることが多いので交通費より先に効かせる
  { keyword: "セブン-イレブン", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "セブンイレブン", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "7-ELEVEN", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "SEVEN-ELEVEN", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "ファミマ", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "FamilyMart", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "フアミリーマート", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "LAWSON", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "ミニストップ", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "MINISTOP", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "デイリーヤマザキ", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "ヤマザキデイリー", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "NEWDAYS", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "セコマ", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "アンスリー", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "PLUSTA", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "キヨスク", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "KIOSK", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "ベルマート", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "西友", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "SEIYU", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "イトーヨーカドー", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "ヨーカドー", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "成城石井", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "阪急オアシス", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "平和堂", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "生協", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "いなげや", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "ヤオコー", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "ロピア", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "オオゼキ", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "東急ストア", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "京王ストア", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "東光ストア", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "小田急OX", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "ピーコック", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "マルナカ", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "ハローデイ", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "アピタ", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "ピアゴ", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "ヨークベニマル", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "ヨークマート", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "ベイシア", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "コノミヤ", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "デイリーカナート", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "KOHYO", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "AEON", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "ザ・ビッグ", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "ラ・ムー", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "食品館", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "激安市場", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "スーパーマーケット", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "マルエツ", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "まいばすけっと", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "セイコーマート", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "ファミリーマート", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "ローソン", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "イズミヤ", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "マックスバリュ", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "リウボウストア", matchType: "CONTAINS", costType: "食費", priority: 60 },
  { keyword: "コープ", matchType: "STARTS_WITH", costType: "食費", priority: 60 },
  { keyword: "COOP", matchType: "STARTS_WITH", costType: "食費", priority: 60 },
  { keyword: "CO-OP", matchType: "STARTS_WITH", costType: "食費", priority: 60 },
  { keyword: "サミット", matchType: "STARTS_WITH", costType: "食費", priority: 60 },
  { keyword: "ベルク", matchType: "STARTS_WITH", costType: "食費", priority: 60 },
  { keyword: "バロー", matchType: "STARTS_WITH", costType: "食費", priority: 60 },
  { keyword: "光洋", matchType: "STARTS_WITH", costType: "食費", priority: 60 },
  { keyword: "カスミ", matchType: "STARTS_WITH", costType: "食費", priority: 60 },
  { keyword: "トライアル", matchType: "STARTS_WITH", costType: "食費", priority: 60 },
  { keyword: "ポプラ", matchType: "STARTS_WITH", costType: "食費", priority: 60 },
  { keyword: "アークス", matchType: "STARTS_WITH", costType: "食費", priority: 60 },
  { keyword: "ラルズ", matchType: "STARTS_WITH", costType: "食費", priority: 60 },
  { keyword: "サンディ", matchType: "STARTS_WITH", costType: "食費", priority: 60 },
  { keyword: "イオン", matchType: "STARTS_WITH", costType: "食費", priority: 60 },
  { keyword: "ライフ", matchType: "STARTS_WITH", costType: "食費", priority: 60 },
  { keyword: "万代", matchType: "STARTS_WITH", costType: "食費", priority: 60 },
  { keyword: "ダイエー", matchType: "STARTS_WITH", costType: "食費", priority: 60 },
  { keyword: "オーケー", matchType: "STARTS_WITH", costType: "食費", priority: 60 },
  { keyword: "フジ", matchType: "EXACT", costType: "食費", priority: 60 },
  // ---- 宿泊費: 「スーパー」より先に効かせる（「スーパーホテル」が食費にならないように）
  { keyword: "宿泊", matchType: "CONTAINS", costType: "宿泊費", priority: 55 },
  { keyword: "スーパーホテル", matchType: "CONTAINS", costType: "宿泊費", priority: 55 },
  { keyword: "アパホテル", matchType: "CONTAINS", costType: "宿泊費", priority: 55 },
  { keyword: "APAホテル", matchType: "CONTAINS", costType: "宿泊費", priority: 55 },
  { keyword: "APA HOTEL", matchType: "CONTAINS", costType: "宿泊費", priority: 55 },
  { keyword: "東横イン", matchType: "CONTAINS", costType: "宿泊費", priority: 55 },
  { keyword: "東横INN", matchType: "CONTAINS", costType: "宿泊費", priority: 55 },
  { keyword: "ルートイン", matchType: "CONTAINS", costType: "宿泊費", priority: 55 },
  { keyword: "ドーミーイン", matchType: "CONTAINS", costType: "宿泊費", priority: 55 },
  { keyword: "リッチモンドホテル", matchType: "CONTAINS", costType: "宿泊費", priority: 55 },
  { keyword: "ダイワロイネット", matchType: "CONTAINS", costType: "宿泊費", priority: 55 },
  { keyword: "ヴィアイン", matchType: "CONTAINS", costType: "宿泊費", priority: 55 },
  { keyword: "ファーストキャビン", matchType: "CONTAINS", costType: "宿泊費", priority: 55 },
  { keyword: "ナインアワーズ", matchType: "CONTAINS", costType: "宿泊費", priority: 55 },
  { keyword: "民宿", matchType: "CONTAINS", costType: "宿泊費", priority: 55 },
  { keyword: "ゲストハウス", matchType: "CONTAINS", costType: "宿泊費", priority: 55 },
  { keyword: "GUEST HOUS", matchType: "CONTAINS", costType: "宿泊費", priority: 55 },
  { keyword: "ホステル", matchType: "CONTAINS", costType: "宿泊費", priority: 55 },
  { keyword: "カプセルホテル", matchType: "CONTAINS", costType: "宿泊費", priority: 55 },
  // ---- 交通費: タクシー・レンタカー・鉄道・バス・船・航空・ガソリン・駐車場。百貨店と同じ名前（阪急・東急…）は入れない
  { keyword: "タクシー", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "TAXI", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "DiDi", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "S.RIDE", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "カーシェア", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "RENT A CAR", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "RENTACAR", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "レンタカ", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "テツドウ", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "デンテツ", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "ジエイアール", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "電車", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "東京メトロ", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "大阪メトロ", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "OSAKA METRO", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "都営", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "交通局", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "市交", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "市電", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "広電", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "交通株式会社", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "一畑交通", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "相鉄", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "名鉄", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "西鉄", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "江ノ電", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "東武インターネット", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "トブチケ", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "西武鉄道", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "スルット", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "WILLER", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "ウィラー", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "高速バス", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "汽船", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "ロープウェイ", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "HELLO CYCLING", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "PEACH AVIATION", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "ピーチアビエーション", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "ZIPAIR", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "スターフライヤー", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "STARFLYER", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "IBEX", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "CATHAY", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "ATAC", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "ジェットフォイル", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "切符", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "きっぷ", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "ENEOS", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "エネオス", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "出光", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "イデミツ", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "アポロステーション", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "コスモ石油", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "ガソリン", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "パーキング", matchType: "CONTAINS", costType: "交通費", priority: 70 },
  { keyword: "タイムズ", matchType: "STARTS_WITH", costType: "交通費", priority: 70 },
  // 衣服
  { keyword: "ユニクロ", matchType: "CONTAINS", costType: "衣服", priority: 70 },
  { keyword: "ワークマン", matchType: "CONTAINS", costType: "衣服", priority: 70 },
  { keyword: "AOKI", matchType: "STARTS_WITH", costType: "衣服", priority: 70 },
  { keyword: "ZARA", matchType: "STARTS_WITH", costType: "衣服", priority: 70 },
  { keyword: "ラルフローレン", matchType: "CONTAINS", costType: "衣服", priority: 70 },
  // 日用品: ドラッグストア・100 円ショップ・家具
  { keyword: "薬局", matchType: "CONTAINS", costType: "日用品", priority: 70 },
  { keyword: "ドラッグ", matchType: "CONTAINS", costType: "日用品", priority: 70 },
  { keyword: "ココカラファイン", matchType: "CONTAINS", costType: "日用品", priority: 70 },
  { keyword: "マツモトキヨシ", matchType: "CONTAINS", costType: "日用品", priority: 70 },
  { keyword: "ウエルシア", matchType: "CONTAINS", costType: "日用品", priority: 70 },
  { keyword: "キリン堂", matchType: "CONTAINS", costType: "日用品", priority: 70 },
  { keyword: "セリア", matchType: "CONTAINS", costType: "日用品", priority: 70 },
  { keyword: "ダイソー", matchType: "CONTAINS", costType: "日用品", priority: 70 },
  { keyword: "ニトリ", matchType: "CONTAINS", costType: "日用品", priority: 70 },
  { keyword: "イケア", matchType: "CONTAINS", costType: "日用品", priority: 70 },
  { keyword: "メイクマン", matchType: "CONTAINS", costType: "日用品", priority: 70 },
  // 趣味: 大会のエントリー・遊びの予約
  { keyword: "RUNNET", matchType: "CONTAINS", costType: "趣味", priority: 70 },
  { keyword: "アソビュー", matchType: "CONTAINS", costType: "趣味", priority: 70 },
];
