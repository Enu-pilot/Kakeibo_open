"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button, Card, CardBody, CardHeader, CardTitle, Field, Select } from "@/components/ui";
import { api } from "@/lib/client-api";
import { KIND_META } from "@/lib/category-kind";
import type { SheetImportSummary } from "@/lib/sheet-import";
import type { MajorWithCategories } from "@/lib/view-types";

export type BillingSourceInput =
  | { text: string }
  | { sheet: { spreadsheetId: string; range: string } };

type ImportResult = {
  imported: number;
  alreadyInApp: number;
  newCategories: string[];
  newMajors: string[];
  newPaymentMethods: string[];
};

/**
 * 読み込んだ請求シートを、アプリのデータに取り込む。
 * まず書き込まずに見込み（何件入るか・何を新しく作るか）を出し、確かめてから取り込む。
 */
export function SheetImport({
  source,
  majors,
  months,
}: {
  /** 「読み込む」で読んだときの読み先。入力欄をあとで書き換えても、こちらは変わらない */
  source: BillingSourceInput;
  majors: MajorWithCategories[];
  /** シートに出てくる月（"2026/01" の形） */
  months: string[];
}) {
  const router = useRouter();
  const choices = majors.filter((m) => m.kind !== "ADJUSTMENT");
  const [fromMonth, setFromMonth] = useState("");
  const [toMonth, setToMonth] = useState("");
  const [createMissing, setCreateMissing] = useState(true);
  const [majorId, setMajorId] = useState(
    choices.find((m) => m.kind === "EXPENSE")?.id ?? choices[0]?.id ?? "",
  );
  const [result, setResult] = useState<ImportResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** 見込みは条件ごとに持つ。条件が変わったら、出し直すまで前の見込みは見せない */
  const [estimate, setEstimate] = useState<{ key: string; summary?: SheetImportSummary; error?: string } | null>(null);

  const body = (dryRun: boolean) => ({
    source,
    options: {
      fromMonth: fromMonth || null,
      toMonth: toMonth || null,
      createMissingCategories: createMissing,
      newCategoryMajorId: createMissing ? majorId || null : null,
    },
    dryRun,
  });

  // 読み先・条件・取り込み結果が変わったら、見込みを出し直す
  const estimateKey = JSON.stringify([body(true), result?.imported ?? null]);
  useEffect(() => {
    let cancelled = false;
    api<SheetImportSummary>("/api/sheet/import", { method: "POST", body: JSON.parse(estimateKey)[0] })
      .then((summary) => {
        if (!cancelled) setEstimate({ key: estimateKey, summary });
      })
      .catch((e) => {
        if (!cancelled) setEstimate({ key: estimateKey, error: e instanceof Error ? e.message : "見込みを出せませんでした" });
      });
    return () => {
      cancelled = true;
    };
  }, [estimateKey]);
  const current = estimate?.key === estimateKey ? estimate : null;
  const preview = current?.summary ?? null;
  const error = runError ?? current?.error ?? null;

  async function run() {
    if (!preview || preview.toImport === 0) return;
    if (!confirm(`${preview.toImport.toLocaleString("ja-JP")} 件の明細をアプリに取り込みます。よろしいですか？`)) return;
    setBusy(true);
    setRunError(null);
    try {
      const done = await api<ImportResult>("/api/sheet/import", { method: "POST", body: body(false) });
      setResult(done);
      router.refresh();
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "取り込みに失敗しました");
    } finally {
      setBusy(false);
    }
  }

  const monthOptions = months.map((m) => m.replace("/", "-"));

  return (
    <Card>
      <CardHeader>
        <CardTitle>アプリに取り込む</CardTitle>
        <p className="mt-1 text-xs text-fg-muted">
          読み込んだ請求シートの明細を、アプリのデータ（スプレッドシート）に書き込みます。
          使用先の無い行（カードの引き落としなど）は、二重に数えないよう取り込みません。
          入金は決済手段の種類で扱いを決めます（銀行・現金・電子マネーの受け取りは収入、カードの返金やチャージは支出から差し引き）。
          何度取り込んでも、取り込み済みの明細は増えません。
        </p>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="この月から" hint="空なら最初から">
            <Select value={fromMonth} onChange={(e) => setFromMonth(e.target.value)}>
              <option value="">最初から</option>
              {monthOptions.map((m) => (
                <option key={m} value={m}>
                  {m.replace("-", "/")}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="この月まで" hint="空なら最後まで">
            <Select value={toMonth} onChange={(e) => setToMonth(e.target.value)}>
              <option value="">最後まで</option>
              {monthOptions.map((m) => (
                <option key={m} value={m}>
                  {m.replace("-", "/")}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="使用先に当たる中項目が無いとき"
            hint={createMissing ? "使用先の名前で中項目を作ります" : "自動分類ルール、決まらなければ「未分類」にします"}
            className="sm:col-span-2"
          >
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={createMissing} onChange={(e) => setCreateMissing(e.target.checked)} />
                中項目を作る
              </label>
              {createMissing ? (
                <Select
                  className="w-auto min-w-48"
                  value={majorId}
                  onChange={(e) => setMajorId(e.target.value)}
                  aria-label="新しい中項目を入れる大項目"
                >
                  {choices.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}（{KIND_META[m.kind].label}）
                    </option>
                  ))}
                </Select>
              ) : null}
            </div>
          </Field>
        </div>

        {error ? (
          <p role="alert" className="text-dns-16N-130 text-error-1">
            {error}
          </p>
        ) : null}

        {result ? (
          <div role="status" className="rounded-xl border-[3px] border-success-1 bg-white px-4 py-3 text-sm">
            <p className="font-bold text-success-2">
              {result.imported.toLocaleString("ja-JP")} 件を取り込みました
            </p>
            <p className="text-fg-muted">
              取り込み済みで飛ばした行: {result.alreadyInApp.toLocaleString("ja-JP")} 件
              {result.newCategories.length > 0 ? ` ・ 作った中項目: ${result.newCategories.length} 件` : ""}
              {result.newPaymentMethods.length > 0 ? ` ・ 作った決済手段: ${result.newPaymentMethods.join("、")}` : ""}
            </p>
            <p className="mt-1 text-fg-muted">
              取り消すときは <Link href="/import" className="link">取込</Link> 画面の「最近の取り込み」から消せます。
              口座残高を合わせるには、<Link href="/settings" className="link">設定</Link> の決済手段で起点残高と起点日を入れてください。
            </p>
          </div>
        ) : null}

        {preview ? (
          <div className="space-y-3">
            <dl className="grid gap-2 sm:grid-cols-4">
              <Stat label="取り込む" value={preview.toImport} strong />
              <Stat label="取り込み済み" value={preview.alreadyInApp} />
              <Stat label="使用先なし（取り込まない）" value={preview.noUsage} />
              <Stat label="読めない行" value={preview.unreadable} />
            </dl>
            {preview.guessed > 0 ? (
              <p className="text-xs text-fg-muted">
                うち {preview.guessed.toLocaleString("ja-JP")} 件は、使用先がそのまま中項目にならず、自動分類ルールか「未分類」で決めます。
              </p>
            ) : null}
            {preview.inflowToIncome + preview.netted > 0 ? (
              <p className="text-xs text-fg-muted">
                入金のうち {preview.inflowToIncome.toLocaleString("ja-JP")} 件は収入として、
                {preview.netted.toLocaleString("ja-JP")} 件は支出から差し引いて取り込みます。
              </p>
            ) : null}
            {preview.newMajors.length > 0 ? (
              <p className="text-sm">
                収入の受け皿として新しく作る大項目: <span className="font-bold">{preview.newMajors.join("、")}</span>
              </p>
            ) : null}
            {preview.newPaymentMethods.length > 0 ? (
              <p className="text-sm">
                新しく作る決済手段: <span className="font-bold">{preview.newPaymentMethods.join("、")}</span>
              </p>
            ) : null}
            {preview.newCategories.length > 0 ? (
              <details className="text-sm">
                <summary className="cursor-pointer">
                  新しく作る中項目: <span className="font-bold">{preview.newCategories.length} 件</span>
                </summary>
                <p className="mt-1 text-xs text-fg-muted">{preview.newCategories.join("、")}</p>
              </details>
            ) : null}
            {preview.months.length > 0 ? (
              <p className="text-xs text-fg-muted">
                月ごとの件数: {preview.months.map((m) => `${m.month.replace("-", "/")} ${m.count}`).join("・")}
              </p>
            ) : null}
            <Button variant="primary" onClick={run} disabled={busy || preview.toImport === 0}>
              <Download size={16} aria-hidden />
              {busy
                ? "取り込んでいます…"
                : preview.toImport === 0
                  ? "取り込む明細はありません"
                  : `${preview.toImport.toLocaleString("ja-JP")} 件を取り込む`}
            </Button>
          </div>
        ) : !error ? (
          <p className="text-sm text-fg-muted">取り込める件数を数えています…</p>
        ) : null}
      </CardBody>
    </Card>
  );
}

function Stat({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="rounded-lg border border-solid-gray-420 px-3 py-2">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className={strong ? "tabular text-xl font-bold text-key-1000" : "tabular text-lg font-bold"}>
        {value.toLocaleString("ja-JP")} 件
      </dd>
    </div>
  );
}
