"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Field, Input, Select } from "@/components/ui";
import { api } from "@/lib/client-api";
import { cn, formatYen } from "@/lib/utils";
import type { PairTag } from "@/lib/db/types";
import type { PairPageData } from "@/lib/pair-view";
import type { TogetherClass, TogetherRow } from "@/lib/pair-together";

type NoticeSetter = (notice: { tone: "ok" | "warn"; text: string } | null) => void;

export const TOGETHER_LABEL: Record<TogetherClass, string> = {
  linked: "割り勘（二人の明細）",
  shared: "割り勘（記録なし）",
  solo: "自分だけ",
  settlement: "精算の記録",
  unknown: "未確認",
};

const CLASSES: TogetherClass[] = ["solo", "linked", "shared", "settlement", "unknown"];
const TONE: Record<TogetherClass, "gray" | "blue" | "green" | "yellow"> = {
  linked: "blue",
  shared: "blue",
  solo: "green",
  settlement: "gray",
  unknown: "yellow",
};
/** 区分の選択肢（二人の明細に結び付いている明細は選べない） */
const TAG_OPTIONS: { value: PairTag | ""; label: string }[] = [
  { value: "", label: "未確認" },
  { value: "SOLO", label: "自分だけ" },
  { value: "SHARED", label: "割り勘（記録なし）" },
  { value: "SETTLEMENT", label: "精算の記録" },
];

/**
 * 「二人の時の出費」タブ。使途「彼女」の大項目の家計簿の明細を、割り勘・自分だけ・精算の記録に分けて見る。
 * 区分は家計簿の「二人の区分」列にだけ入り、LINE ボット（相手のダッシュボード）には出ない。
 */
export function TogetherSpending({ data, onNotice }: { data: PairPageData; onNotice: NoticeSetter }) {
  const router = useRouter();
  const { together } = data;
  const [filter, setFilter] = useState<{ cls: TogetherClass | ""; month: string; q: string }>({
    cls: together.counts.unknown > 0 ? "unknown" : "",
    month: "",
    q: "",
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const months = useMemo(() => [...new Set(together.rows.map((r) => r.date.slice(0, 7)))].sort().reverse(), [together.rows]);
  const q = filter.q.trim().normalize("NFKC").toLowerCase();
  const rows = together.rows.filter(
    (r) =>
      (!filter.cls || r.cls === filter.cls) &&
      (!filter.month || r.date.startsWith(filter.month)) &&
      (!q || `${r.description} ${r.categoryName ?? ""}`.normalize("NFKC").toLowerCase().includes(q)),
  );
  const taggable = rows.filter((r) => r.cls !== "linked");
  const suggested = together.rows.filter((r) => r.looksLikeSettlement);
  const recent = together.months.slice(-12);

  async function setTag(ids: string[], tag: PairTag | null, done: string) {
    if (ids.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/pair/tags", { method: "POST", body: { ids, tag } });
      setSelected(new Set());
      onNotice({ tone: "ok", text: done });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>二人の時の出費</CardTitle>
          <p className="mt-1 text-xs text-fg-muted">
            使途「彼女」の大項目（{together.majors.join("・") || "なし"}）の家計簿の明細を、割り勘・自分だけ（割り勘にしない）・精算の記録に分けます。
            区分は家計簿の「明細」タブの「二人の区分」列にだけ入り、LINE のダッシュボードには出ません。金額は使途「彼女」の内訳の分です。
            ほかの大項目（以前の項目など）も入れたいときは、「設定」→「カテゴリ」でその大項目の使途を「彼女」にしてください
          </p>
        </CardHeader>
        <CardBody className="space-y-3">
          <OwnSpendingSummary data={data} />
          {recent.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-xs text-fg-muted">月ごとに見る（直近 12 か月）</summary>
              <div className="mt-1 overflow-x-auto">
                <table className="w-full min-w-[560px] text-xs">
                  <caption className="sr-only">二人の時の出費の月別</caption>
                  <thead className="text-fg-muted">
                    <tr className="border-b border-border text-left">
                      <th scope="col" className="py-1 pr-2 font-medium">月</th>
                      {CLASSES.map((c) => (
                        <th key={c} scope="col" className="px-2 py-1 text-right font-medium">
                          {TOGETHER_LABEL[c]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {recent.map((m) => (
                      <tr key={m.key}>
                        <td className="tabular py-1 pr-2">{m.key.replace("-", "/")}</td>
                        {CLASSES.map((c) => (
                          <td key={c} className="tabular px-2 py-1 text-right">
                            {m.totals[c] ? formatYen(m.totals[c]) : "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-3 pt-4">
          {suggested.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm">
              <span>未確認のうち、送金・受け取りらしい明細が {suggested.length} 件あります。</span>
              <Button size="sm" disabled={busy} onClick={() => void setTag(suggested.map((r) => r.id), "SETTLEMENT", `${suggested.length} 件を精算の記録にしました`)}>
                まとめて精算の記録にする
              </Button>
            </div>
          ) : null}

          <div className="flex flex-wrap items-end gap-2" role="search" aria-label="二人の時の出費の絞り込み">
            <Field label="区分" className="w-44">
              <Select aria-label="区分" value={filter.cls} onChange={(e) => setFilter({ ...filter, cls: e.target.value as TogetherClass | "" })}>
                <option value="">すべて</option>
                {CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {TOGETHER_LABEL[c]}（{together.counts[c]}）
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="月" className="w-32">
              <Select aria-label="月" value={filter.month} onChange={(e) => setFilter({ ...filter, month: e.target.value })}>
                <option value="">すべて</option>
                {months.map((m) => (
                  <option key={m} value={m}>
                    {m.replace("-", "/")}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="検索" className="min-w-40 flex-1">
              <Input aria-label="検索" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} placeholder="利用先・中項目" />
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-fg-muted">
              {rows.length} 件 ・ <span className="tabular font-bold text-fg">{formatYen(rows.reduce((s, r) => s + r.amount, 0))}</span>
              {selected.size > 0 ? ` ・ ${selected.size} 件を選択中` : ""}
            </span>
            {selected.size > 0 ? (
              <span className="flex flex-wrap gap-1">
                {TAG_OPTIONS.map((o) => (
                  <Button
                    key={o.value || "none"}
                    size="sm"
                    disabled={busy}
                    onClick={() => void setTag([...selected], o.value || null, `${selected.size} 件を「${o.label}」にしました`)}
                  >
                    {o.label}にする
                  </Button>
                ))}
              </span>
            ) : null}
          </div>
          {error ? <p role="alert" className="text-dns-16N-130 text-error-1">{error}</p> : null}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <caption className="sr-only">二人の時の出費の明細</caption>
              <thead className="text-xs text-fg-muted">
                <tr className="border-b border-border text-left">
                  <th scope="col" className="w-8 py-1.5">
                    <input
                      type="checkbox"
                      aria-label="表示中の明細をすべて選ぶ"
                      checked={taggable.length > 0 && taggable.every((r) => selected.has(r.id))}
                      onChange={(e) => setSelected(e.target.checked ? new Set(taggable.map((r) => r.id)) : new Set())}
                    />
                  </th>
                  <th scope="col" className="py-1.5 pr-2 font-medium">日付</th>
                  <th scope="col" className="px-2 py-1.5 font-medium">利用先</th>
                  <th scope="col" className="px-2 py-1.5 font-medium">中項目・決済手段</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">金額</th>
                  <th scope="col" className="px-2 py-1.5 font-medium">区分</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.slice(0, 500).map((r) => (
                  <Row
                    key={r.id}
                    row={r}
                    checked={selected.has(r.id)}
                    busy={busy}
                    onCheck={(on) => {
                      const next = new Set(selected);
                      if (on) next.add(r.id);
                      else next.delete(r.id);
                      setSelected(next);
                    }}
                    onTag={(tag, label) => void setTag([r.id], tag, `「${r.description}」を「${label}」にしました`)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 500 ? <p className="text-xs text-fg-muted">先頭の 500 件を出しています。月や区分で絞り込んでください。</p> : null}
          {rows.length === 0 ? <p className="py-4 text-center text-sm text-fg-muted">当てはまる明細はありません</p> : null}
        </CardBody>
      </Card>
    </div>
  );
}

function Row({
  row,
  checked,
  busy,
  onCheck,
  onTag,
}: {
  row: TogetherRow;
  checked: boolean;
  busy: boolean;
  onCheck: (on: boolean) => void;
  onTag: (tag: PairTag | null, label: string) => void;
}) {
  const linked = row.cls === "linked";
  return (
    <tr className={cn(row.cls === "settlement" && "text-fg-muted")}>
      <td className="py-1.5">
        {!linked ? <input type="checkbox" aria-label={`${row.description} を選ぶ`} checked={checked} onChange={(e) => onCheck(e.target.checked)} /> : null}
      </td>
      <td className="tabular whitespace-nowrap py-1.5 pr-2">{row.date.replace(/-/g, "/")}</td>
      <td className="px-2 py-1.5">
        <Link className="link" href={`/transactions?id=${row.id}`}>
          {row.description}
        </Link>
        {row.looksLikeSettlement ? <Badge className="ml-1">送金・受取？</Badge> : null}
      </td>
      <td className="px-2 py-1.5 text-xs">
        {row.categoryName ?? "—"}
        {row.methodName ? <span className="block text-fg-muted">{row.methodName}</span> : null}
      </td>
      <td className="tabular px-2 py-1.5 text-right">{formatYen(row.amount)}</td>
      <td className="px-2 py-1.5">
        {linked ? (
          <Badge tone={TONE.linked}>{TOGETHER_LABEL.linked}</Badge>
        ) : (
          <Select
            aria-label={`${row.description} の区分`}
            className="h-8 w-40 text-xs"
            value={row.tag}
            disabled={busy}
            onChange={(e) => {
              const option = TAG_OPTIONS.find((o) => o.value === e.target.value)!;
              onTag((option.value || null) as PairTag | null, option.label);
            }}
          >
            {TAG_OPTIONS.map((o) => (
              <option key={o.value || "none"} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        )}
      </td>
    </tr>
  );
}

/**
 * 彼女まわりの自分の出費のまとめ。
 *   自分の出費（＝ 使途「彼女」の支出）＝ 割り勘の自分の負担 ＋ 自分だけ ＋ 精算の記録 ＋ 未確認
 * 家計簿の明細の日付・金額で数える。参考に二人の明細（二人の総額・相手の負担）も並べる（こちらは二人の明細の日付）。
 */
export function OwnSpendingSummary({ data }: { data: PairPageData }) {
  const { together, month, allTime, names } = data;
  const monthTotals = together.months.find((m) => m.key === month.key)?.totals;
  const zero = { linked: 0, shared: 0, solo: 0, settlement: 0, unknown: 0 };
  const cols = [
    { label: `${month.key.replace("-", "/")}`, t: monthTotals ?? zero, pair: month },
    { label: "全期間", t: together.totals, pair: allTime },
  ];
  const rows: { label: string; value: (t: typeof zero) => number; strong?: boolean; hint?: string }[] = [
    { label: "割り勘の自分の負担", value: (t) => t.linked + t.shared, hint: "二人の明細に結び付いた分 ＋ 割り勘（記録なし）" },
    { label: "自分だけ", value: (t) => t.solo, hint: "割り勘にしない二人の時の出費" },
    { label: "精算の記録", value: (t) => t.settlement, hint: "以前の送金・受け取り、精算の差額" },
    { label: "未確認", value: (t) => t.unknown },
    { label: "合計（使途「彼女」の支出）", value: (t) => t.linked + t.shared + t.solo + t.settlement + t.unknown, strong: true },
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-sm">
        <caption className="sr-only">彼女まわりの自分の出費のまとめ</caption>
        <thead className="text-xs text-fg-muted">
          <tr className="border-b border-border text-left">
            <th scope="col" className="py-1.5 pr-2 font-medium">自分の出費（家計簿）</th>
            {cols.map((c) => (
              <th key={c.label} scope="col" className="px-2 py-1.5 text-right font-medium">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.label} className={cn(r.strong && "font-bold")}>
              <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                <span className={cn(r.strong && "font-bold")}>{r.label}</span>
                {r.hint ? <span className="block text-xs text-fg-muted">{r.hint}</span> : null}
              </th>
              {cols.map((c) => (
                <td key={c.label} className="tabular px-2 py-1.5 text-right">
                  {formatYen(r.value(c.t))}
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <th scope="row" className="pb-1 pr-2 pt-3 text-left text-xs font-bold text-fg-muted" colSpan={cols.length + 1}>
              参考: 二人の明細（二人の明細の日付で数える）
            </th>
          </tr>
          {[
            { label: "二人の総額", value: (p: typeof allTime) => p.total },
            { label: `${names.OWNER}の負担`, value: (p: typeof allTime) => p.ownerShare },
            { label: `${names.PARTNER}の負担`, value: (p: typeof allTime) => p.partnerShare },
          ].map((r) => (
            <tr key={r.label} className="text-fg-muted">
              <th scope="row" className="py-1 pr-2 text-left font-normal">
                {r.label}
              </th>
              {cols.map((c) => (
                <td key={c.label} className="tabular px-2 py-1 text-right">
                  {formatYen(r.value(c.pair))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
