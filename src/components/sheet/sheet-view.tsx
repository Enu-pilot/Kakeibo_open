"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ClipboardPaste, FileSpreadsheet } from "lucide-react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  Input,
  Select,
  Textarea,
} from "@/components/ui";
import { StatTile } from "@/components/stat-tile";
import { TrendChart } from "@/components/charts/trend-chart";
import { MajorPie } from "@/components/charts/breakdown-chart";
import { CategoryBars } from "@/components/charts/category-bars";
import { ReconcileView } from "@/components/sheet/reconcile-view";
import { SheetImport, type BillingSourceInput } from "@/components/sheet/sheet-import";
import { CrossTabTable } from "@/components/summary/cross-tab-table";
import { KIND_META } from "@/lib/category-kind";
import { KIND_VAR } from "@/lib/chart-colors";
import { netBalance, sumBreakdownByMajor } from "@/lib/aggregate-core";
import { api } from "@/lib/client-api";
import { cn, formatNumber } from "@/lib/utils";
import type { MajorWithCategories, SheetAnalysis } from "@/lib/view-types";

type Mode = "sheet" | "paste";

/**
 * スプレッドシート（請求YYYY）を読んで、そのまま集計を見る画面。
 *
 * 読むだけでは何も書き込まない。カテゴリの定義と自動分類ルールはアプリのものを使うため、
 * 同じシートを取り込んだ場合と同じ数字になり、アプリのデータとの突合もできる。
 * 確かめたうえで「アプリに取り込む」から、明細をアプリのデータに取り込める。
 *
 * 読み方は 2 つ。接続を設定していればスプレッドシートを直接、
 * していなければコピー&貼り付けで読む。
 */
export function SheetView({
  sheetsConfigured,
  defaultSpreadsheetId,
  majors,
}: {
  sheetsConfigured: boolean;
  defaultSpreadsheetId: string;
  majors: MajorWithCategories[];
}) {
  const [mode, setMode] = useState<Mode>(sheetsConfigured ? "sheet" : "paste");
  const [spreadsheetId, setSpreadsheetId] = useState(defaultSpreadsheetId);
  const [range, setRange] = useState(`請求${new Date().getFullYear()}`);
  const [text, setText] = useState("");
  const [result, setResult] = useState<SheetAnalysis | null>(null);
  /** 最後に読み込みに成功したときの読み先（取り込みはこれを使う） */
  const [analyzedSource, setAnalyzedSource] = useState<BillingSourceInput | null>(null);
  const [month, setMonth] = useState("");
  /** クロス集計を「選んだ月」で見るか「読み込んだ期間全体」で見るか */
  const [crossScope, setCrossScope] = useState<"month" | "all">("all");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function analyze() {
    setLoading(true);
    setError(null);
    try {
      const source: BillingSourceInput =
        mode === "sheet" ? { sheet: { spreadsheetId, range } } : { text };
      const data = await api<SheetAnalysis>("/api/sheet/analyze", { method: "POST", body: source });
      setResult(data);
      setAnalyzedSource(source);
      setMonth(data.months[data.months.length - 1] ?? "");
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  const current = useMemo(() => {
    if (!result || !month) return null;
    return result.monthly[month] ?? null;
  }, [result, month]);

  const totals = current?.totals;
  const net = totals ? netBalance(totals) : 0;
  const byMajor = sumBreakdownByMajor(current?.breakdown ?? []);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>請求シートを読む</CardTitle>
          <div role="tablist" className="mt-3 flex border-b border-solid-gray-420">
            <ModeTab active={mode === "sheet"} onClick={() => setMode("sheet")}>
              <FileSpreadsheet size={13} aria-hidden />
              スプレッドシートから
            </ModeTab>
            <ModeTab active={mode === "paste"} onClick={() => setMode("paste")}>
              <ClipboardPaste size={13} aria-hidden />
              貼り付け
            </ModeTab>
          </div>
        </CardHeader>
        <CardBody className="space-y-3">
          {mode === "sheet" ? (
            sheetsConfigured ? (
              <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
                <Field
                  label="スプレッドシート ID"
                  hint="URL の /d/ と /edit の間の文字列。環境変数 BILLING_SHEET_ID が既定値になります"
                >
                  <Input
                    value={spreadsheetId}
                    onChange={(e) => setSpreadsheetId(extractId(e.target.value))}
                    placeholder="URL ごと貼り付けても構いません"
                    spellCheck={false}
                  />
                </Field>
                <Field label="シート名" hint="範囲を絞るなら 請求2026!A1:DA2000 の形でも可">
                  <Input
                    value={range}
                    onChange={(e) => setRange(e.target.value)}
                    spellCheck={false}
                  />
                </Field>
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-fg-muted">
                サービスアカウントの鍵がまだ設定されていません。README の「初回セットアップ」で鍵を設定し、
                請求シートをサービスアカウントのアドレスに「閲覧者」として共有すると、ここから直接読めます。
                それまでは「貼り付け」を使ってください。
              </p>
            )
          ) : (
            <>
              <p className="text-xs text-fg-muted">
                スプレッドシートの「請求YYYY」を、1 行目のカード名とヘッダー行を含めて範囲選択し、
                コピーしてそのまま貼り付けてください。カードごとのブロックは自動で切り分けます。
              </p>
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="ここに貼り付け（タブ区切り）"
                className="min-h-[140px] font-mono text-xs"
                spellCheck={false}
              />
            </>
          )}
          <p className="text-xs text-fg-muted">
            この画面は読み取り専用で、読んだ内容はアプリにも保存されません。
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              onClick={analyze}
              disabled={
                loading ||
                (mode === "paste"
                  ? text.trim() === ""
                  : !sheetsConfigured || range.trim() === "")
              }
            >
              {loading ? "読み込み中…" : "読み込む"}
            </Button>
            {result || text ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setText("");
                  setResult(null);
                  setError(null);
                }}
              >
                クリア
              </Button>
            ) : null}
          </div>
          {error ? <p role="alert" className="text-dns-16N-130 text-error-1">{error}</p> : null}
        </CardBody>
      </Card>

      {!result ? (
        <EmptyState
          title="まだ読み込んでいません"
          description="「読み込む」を押すと、カードごとのブロックを検出して集計し、アプリの数字と突き合わせます。"
        />
      ) : null}

      {result ? (
        <>
          {result.warnings.length > 0 ? (
            <div className="rounded-xl border border-living/40 bg-living/10 px-3.5 py-3">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                <AlertTriangle size={14} aria-hidden />
                確認してください
              </p>
              <ul className="space-y-0.5 text-xs text-fg-muted">
                {result.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>検出したブロック</CardTitle>
              <p className="text-xs text-fg-muted">
                {result.blocks.length} ブロック / 集計対象 {formatNumber(result.splitCount)} 件
              </p>
            </CardHeader>
            <CardBody className="relative overflow-x-auto">
              <table className="w-full min-w-[520px] text-xs">
                <thead className="text-fg-muted">
                  <tr className="border-b border-border">
                    <th className="py-1.5 text-left font-medium">決済手段</th>
                    <th className="py-1.5 text-right font-medium">行数</th>
                    <th className="py-1.5 text-right font-medium">集計に入った数</th>
                    <th className="py-1.5 text-left font-medium">期間</th>
                  </tr>
                </thead>
                <tbody>
                  {result.blocks.map((block) => (
                    <tr key={block.name} className="border-b border-border/60">
                      <td className="py-1.5">
                        {block.name}
                        {block.issues.length > 0 ? (
                          <span className="ml-1.5 text-living">
                            {block.issues.join(" / ")}
                          </span>
                        ) : null}
                      </td>
                      <td className="tabular py-1.5 text-right">
                        {formatNumber(block.rows)}
                      </td>
                      <td className="tabular py-1.5 text-right">
                        {formatNumber(block.used)}
                      </td>
                      <td className="py-1.5 text-fg-muted">
                        {block.firstDate
                          ? `${block.firstDate} 〜 ${block.lastDate}`
                          : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardBody>
          </Card>

          {result.months.length === 0 ? (
            <EmptyState
              title="集計できる明細がありませんでした"
              description="日付・金額が読み取れる行が 1 件もありません。貼り付けた範囲にヘッダー行が含まれているか確認してください。"
            />
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Select
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="w-32"
                >
                  {[...result.months].reverse().map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-fg-muted">
                  シートから読んだ数字です（アプリには保存していません）
                </p>
              </div>

              {totals ? (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
                  <StatTile
                    label={KIND_META.INCOME.label}
                    value={totals.INCOME}
                    color={KIND_VAR.INCOME}
                  />
                  <StatTile
                    label={KIND_META.EXPENSE.label}
                    value={totals.EXPENSE}
                    color={KIND_VAR.EXPENSE}
                  />
                  <StatTile
                    label="生活費"
                    value={totals.LIVING}
                    color={KIND_VAR.LIVING}
                  />
                  <StatTile
                    label="投資"
                    value={totals.INVESTMENT}
                    color={KIND_VAR.INVESTMENT}
                  />
                  <StatTile label="純残高" value={net} emphasis />
                </div>
              ) : null}

              <Card>
                <CardHeader>
                  <CardTitle>推移</CardTitle>
                </CardHeader>
                <CardBody>
                  <TrendChart data={result.trend} />
                </CardBody>
              </Card>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>大項目ごとの支出</CardTitle>
                    <p className="text-xs text-fg-muted">個人支出・生活費を大項目ごとに合計した金額</p>
                  </CardHeader>
                  <CardBody>
                    <MajorPie data={byMajor} />
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>中項目の内訳</CardTitle>
                  </CardHeader>
                  <CardBody>
                    <CategoryBars
                      items={current?.breakdown ?? []}
                      month={month}
                      linkToTransactions={false}
                    />
                  </CardBody>
                </Card>
              </div>
            </>
          )}

          {result.months.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>クロス集計（中項目 × 費目）</CardTitle>
                <div className="mt-2 flex items-center gap-1">
                  <ModeTab active={crossScope === "all"} onClick={() => setCrossScope("all")}>
                    読み込んだ期間全体
                  </ModeTab>
                  <ModeTab active={crossScope === "month"} onClick={() => setCrossScope("month")}>
                    {month || "選んだ月"}
                  </ModeTab>
                </div>
                <p className="mt-1 text-xs text-fg-muted">
                  費目は、ブロックに「費目」列があればその値を、無ければ店名から自動分類ルールで付けています。
                </p>
              </CardHeader>
              <CardBody>
                <CrossTabTable
                  data={
                    crossScope === "all" || !current ? result.crossTab : current.crossTab
                  }
                />
              </CardBody>
            </Card>
          ) : null}

          {result.reconciliation ? (
            <ReconcileView data={result.reconciliation} />
          ) : null}

          {analyzedSource ? (
            <SheetImport source={analyzedSource} majors={majors} months={result.months} />
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>中項目の決め方</CardTitle>
              <p className="text-xs text-fg-muted">
                シートには中項目名しか無いため、大項目と種別は設定のカテゴリから引いています。
              </p>
            </CardHeader>
            <CardBody className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
              <StatCount label="使用先がそのまま一致" value={result.resolution.byUsage} />
              <StatCount label="分類ルールで決定" value={result.resolution.byRule} />
              <StatCount label="未分類に寄せた" value={result.resolution.byFallback} />
              <StatCount label="決められず除外" value={result.resolution.unresolved} />
              <StatCount label="使用先なし（集計しない）" value={result.resolution.noUsage} />
            </CardBody>
            {result.resolution.netted > 0 || result.resolution.inflowToIncome > 0 ? (
              <div className="space-y-0.5 px-4 pb-4 text-xs text-fg-muted">
                {result.resolution.inflowToIncome > 0 ? (
                  <p>
                    銀行・現金の入金と電子マネーの受け取り{" "}
                    {formatNumber(result.resolution.inflowToIncome)} 件は、
                    同じ名前の個人収入の中項目（無ければ「収入内訳」）に収入として入れています。
                  </p>
                ) : null}
                {result.resolution.netted > 0 ? (
                  <p>
                    カードの返金・電子マネーのチャージなど {formatNumber(result.resolution.netted)}{" "}
                    件は、その中項目から差し引いて集計しています。
                  </p>
                ) : null}
              </div>
            ) : null}
          </Card>

          {result.issues.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>読み取れなかった行</CardTitle>
                <p className="text-xs text-fg-muted">
                  {formatNumber(result.issueCount)} 件
                  {result.issueCount > result.issues.length
                    ? `（先頭 ${result.issues.length} 件を表示）`
                    : ""}
                </p>
              </CardHeader>
              <CardBody className="relative overflow-x-auto">
                <table className="w-full min-w-[520px] text-xs">
                  <thead className="text-fg-muted">
                    <tr className="border-b border-border">
                      <th className="py-1.5 text-left font-medium">ブロック</th>
                      <th className="py-1.5 text-right font-medium">行</th>
                      <th className="py-1.5 text-left font-medium">内容</th>
                      <th className="py-1.5 text-left font-medium">理由</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.issues.map((issue, i) => (
                      <tr
                        key={`${issue.block}-${issue.row}-${i}`}
                        className="border-b border-border/60"
                      >
                        <td className="py-1.5">{issue.block}</td>
                        <td className="tabular py-1.5 text-right">{issue.row}</td>
                        <td className="py-1.5">{issue.description || "-"}</td>
                        <td className="py-1.5 text-fg-muted">{issue.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function StatCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-3.5 py-3">
      <p className="mb-1 text-xs text-fg-muted">{label}</p>
      <p className="tabular text-xl font-semibold">{formatNumber(value)}</p>
    </div>
  );
}

/** URL ごと貼られても ID だけを取り出す（/d/<ID>/edit の形） */
function extractId(value: string) {
  const match = value.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : value.trim();
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "-mb-px flex min-h-11 items-center gap-1.5 border-b-4 px-3 text-dns-16B-130 focus-inset",
        active
          ? "border-key-900 text-key-1000"
          : "border-transparent text-solid-gray-800 hover:border-solid-gray-900 hover:bg-solid-gray-50",
      )}
    >
      {children}
    </button>
  );
}
