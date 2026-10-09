"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { AlertTriangle, Pencil, Plus, RefreshCw, Trash2, Undo2 } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Field, Input, Select } from "@/components/ui";
import { MonthPicker } from "@/components/month-picker";
import { PairEntryForm } from "@/components/pair/pair-entry-form";
import { PairTrendChart } from "@/components/pair/pair-trend";
import { CurrentMatching, HistoryMatching } from "@/components/pair/pair-matching";
import { OwnSpendingSummary, TogetherSpending } from "@/components/pair/pair-together";
import { api } from "@/lib/client-api";
import { cn, formatYen } from "@/lib/utils";
import type { PairRole } from "@/lib/db/types";
import type { PairEntryView, PairNames, PairPageData } from "@/lib/pair-view";

const TABS = [
  { id: "overview", label: "概要" },
  { id: "entries", label: "明細と精算" },
  { id: "events", label: "イベント別" },
  { id: "matching", label: "家計簿との照合" },
  { id: "together", label: "二人の時の出費" },
] as const;
/** 以前のタブの URL（?tab=）を今のタブに読み替える */
const OLD_TABS: Record<string, string> = { settlements: "entries", reconcile: "matching", history: "matching" };
type TabId = (typeof TABS)[number]["id"];

/** 「誰が誰にいくら」 */
function balanceText(balance: PairPageData["balance"], names: PairNames) {
  if (balance.count === 0) return "未精算はありません";
  if (!balance.payer || !balance.receiver) return "差額 0 円";
  return `${names[balance.payer]} → ${names[balance.receiver]}`;
}

/**
 * 「二人」ページの本体。LINE ボット（GAS）と同じスプレッドシートの二人の明細を、自分用に管理・確認する。
 * 登録・修正・精算はここからもでき、本体の家計簿にも LINE と同じ規則で書かれる（相手への LINE 通知は送らない）。
 */
export function PairDashboard({ data, today }: { data: PairPageData; today: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const requested = params.get("tab") ?? "overview";
  const initial = (OLD_TABS[requested] ?? requested) as TabId;
  const [tab, setTab] = useState<TabId>(TABS.some((t) => t.id === initial) ? initial : "overview");
  const [notice, setNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  function selectTab(next: TabId) {
    setTab(next);
    const query = new URLSearchParams(params.toString());
    query.set("tab", next);
    router.replace(`/pair?${query.toString()}`, { scroll: false });
  }

  const reconcileCount =
    data.reconcile.pending.length +
    data.match.duplicates.length +
    data.reconcile.errors.length +
    data.reconcile.householdMissing.length +
    (data.reconcile.account && data.reconcile.account.diff !== 0 ? 1 : 0);
  const matchingCount = reconcileCount + data.match.history.unique.length + data.match.history.ambiguous.length;

  return (
    <div className="space-y-4">
      {data.reconcile.missingTargets ? (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-yellow-800 bg-yellow-50 px-3 py-2 text-sm">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
          {data.reconcile.missingTargets}
        </p>
      ) : null}
      {notice ? (
        <p
          role="status"
          className={cn(
            "rounded-lg border px-3 py-2 text-sm",
            notice.tone === "ok" ? "border-green-800 bg-green-50" : "border-yellow-800 bg-yellow-50",
          )}
        >
          {notice.text}
        </p>
      ) : null}

      <div role="tablist" aria-label="二人のページの表示" className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => selectTab(t.id)}
            className={cn(
              "-mb-px border-b-4 px-3 py-2 text-sm font-bold",
              tab === t.id ? "border-key-900 text-key-900" : "border-transparent text-solid-gray-800 hover:bg-solid-gray-50",
            )}
          >
            {t.label}
            {t.id === "together" && data.together.counts.unknown > 0 ? (
              <Badge tone="yellow" className="ml-1.5">
                {data.together.counts.unknown}
              </Badge>
            ) : null}
            {t.id === "matching" && matchingCount > 0 ? (
              <Badge tone="yellow" className="ml-1.5">
                {matchingCount}
              </Badge>
            ) : null}
          </button>
        ))}
      </div>

      {tab === "overview" ? <Overview data={data} today={today} onNotice={setNotice} /> : null}
      {tab === "entries" ? (
        <>
          <Entries data={data} today={today} onNotice={setNotice} />
          <Settlements data={data} onNotice={setNotice} />
        </>
      ) : null}
      {tab === "events" ? <Events data={data} onNotice={setNotice} /> : null}
      {tab === "matching" ? (
        <>
          <Reconcile data={data} onNotice={setNotice} />
          <HistoryMatching data={data} onNotice={setNotice} />
        </>
      ) : null}
      {tab === "together" ? <TogetherSpending data={data} onNotice={setNotice} /> : null}
    </div>
  );
}

type NoticeSetter = (notice: { tone: "ok" | "warn"; text: string } | null) => void;

/* ------------------------------------------------------------------ */
/* 概要: 未精算・精算・月の集計・推移                                     */
/* ------------------------------------------------------------------ */

function Overview({ data, today, onNotice }: { data: PairPageData; today: string; onNotice: NoticeSetter }) {
  const { names, balance, month } = data;
  const [adding, setAdding] = useState(false);
  const router = useRouter();
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>未精算</CardTitle>
            <p className="mt-1 text-xs text-fg-muted">未精算の明細の差額。精算すると、明細に精算済みの印が付きます</p>
          </CardHeader>
          <CardBody className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-std-18B-160">{balanceText(balance, names)}</p>
              <p className={cn("tabular text-std-28B-150", balance.payer === "OWNER" && "text-expense")}>{formatYen(balance.amount)}</p>
            </div>
            <p className="text-xs text-fg-muted">未精算 {balance.count} 件</p>
            <SettleForm data={data} onNotice={onNotice} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>{month.key.replace("-", "/")} の二人の支出</CardTitle>
            <MonthPicker month={month.key} />
          </CardHeader>
          <CardBody className="space-y-3">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              <Stat label="合計" value={month.total} sub={`${month.count} 件`} />
              <Stat label={`${names.OWNER}の負担`} value={month.ownerShare} />
              <Stat label={`${names.PARTNER}の負担`} value={month.partnerShare} />
              <Stat label={`${names.OWNER}が払った`} value={month.paidByOwner} />
              <Stat label={`${names.PARTNER}が払った`} value={month.paidByPartner} />
            </dl>
            <CostTypeBars items={month.byCostType} total={month.total} />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>彼女まわりの自分の出費</CardTitle>
          <p className="mt-1 text-xs text-fg-muted">
            家計簿で自分の支出として数えている額（使途「彼女」）。割り勘の自分の負担と、割り勘にしない「自分だけ」の出費を分けて出します。
            区分は「二人の時の出費」で付けます
          </p>
        </CardHeader>
        <CardBody>
          <OwnSpendingSummary data={data} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>月別推移（12 か月）</CardTitle>
          <p className="mt-1 text-xs text-fg-muted">総額を{names.OWNER}の負担と{names.PARTNER}の負担に分けて積み上げます。精算済み・過去分の取込も含みます</p>
        </CardHeader>
        <CardBody>
          <PairTrendChart trend={data.trend} names={names} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>登録</CardTitle>
          {!adding ? (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus size={14} aria-hidden />
              二人の明細を登録
            </Button>
          ) : null}
        </CardHeader>
        {adding ? (
          <CardBody>
            <PairEntryForm
              entry={null}
              names={names}
              options={data.options}
              today={today}
              onCancel={() => setAdding(false)}
              onDone={(warning) => {
                setAdding(false);
                onNotice(warning ? { tone: "warn", text: `登録しましたが、家計簿には書けませんでした: ${warning}` } : { tone: "ok", text: "登録しました（家計簿にも反映しました）" });
                router.refresh();
              }}
            />
          </CardBody>
        ) : (
          <CardBody>
            <p className="text-xs text-fg-muted">
              ここで登録・修正しても{names.PARTNER}には LINE の通知は届きません（{names.PARTNER}は LINE のダッシュボードで見られます）。
            </p>
          </CardBody>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div>
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="tabular font-bold">
        {formatYen(value)}
        {sub ? <span className="ml-1 text-xs font-normal text-fg-muted">{sub}</span> : null}
      </dd>
    </div>
  );
}

/** 費目別の横棒（長さで比べる。数字も必ず添える） */
function CostTypeBars({ items, total }: { items: PairPageData["month"]["byCostType"]; total: number }) {
  if (items.length === 0) return <p className="text-sm text-fg-muted">この月の二人の明細はありません</p>;
  const max = Math.max(...items.map((i) => i.amount), 1);
  return (
    <ul className="space-y-1.5 text-sm" aria-label="費目別（総額）">
      {items.map((item) => (
        <li key={item.id || "none"} className="grid grid-cols-[6rem_1fr_auto] items-center gap-2">
          <span className="truncate text-xs">{item.name}</span>
          <span className="h-2.5 rounded-r-[4px] bg-[var(--pair-owner)]" style={{ width: `${Math.max(2, (item.amount / max) * 100)}%` }} aria-hidden />
          <span className="tabular text-xs">
            {formatYen(item.amount)}
            <span className="ml-1 text-fg-muted">{total > 0 ? `${Math.round((item.amount / total) * 100)}%` : ""}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** まとめて精算する。対象の明細を選べ、実際に渡した額に直せる */
function SettleForm({ data, onNotice }: { data: PairPageData; onNotice: NoticeSetter }) {
  const router = useRouter();
  const open = useMemo(() => data.entries.filter((e) => !e.settled), [data.entries]);
  const [openForm, setOpenForm] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [amount, setAmount] = useState("");
  const [methodId, setMethodId] = useState(data.options.settleMethodId ?? "");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { names } = data;

  const targets = open.filter((e) => !excluded.has(e.id));
  const net = targets.reduce((sum, e) => sum + (e.payer === "OWNER" ? e.partnerShare : -e.ownerShare), 0);
  const payer: PairRole = net < 0 ? "OWNER" : "PARTNER";

  if (open.length === 0) return null;
  if (!openForm) {
    return (
      <Button size="sm" variant="primary" onClick={() => setOpenForm(true)}>
        精算する
      </Button>
    );
  }
  return (
    <form
      className="space-y-3 rounded-lg border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        void api<{ warning: string | null }>("/api/pair/settlements", {
          method: "POST",
          body: {
            ids: targets.map((t) => t.id),
            amount: amount === "" ? null : Math.round(Number(amount)),
            methodId: methodId || null,
            memo: memo.trim() || null,
          },
        })
          .then((result) => {
            onNotice(
              result.warning
                ? { tone: "warn", text: `精算しましたが、家計簿には書けませんでした: ${result.warning}` }
                : { tone: "ok", text: `${targets.length} 件を精算しました` },
            );
            setOpenForm(false);
            router.refresh();
          })
          .catch((err: unknown) => setError(err instanceof Error ? err.message : "精算に失敗しました"))
          .finally(() => setBusy(false));
      }}
    >
      <fieldset>
        <legend className="mb-1 text-xs font-bold">精算する明細（外した明細は次回に回ります）</legend>
        <ul className="max-h-56 space-y-0.5 overflow-y-auto text-sm">
          {open.map((e) => (
            <li key={e.id}>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!excluded.has(e.id)}
                  onChange={(ev) => {
                    const next = new Set(excluded);
                    if (ev.target.checked) next.delete(e.id);
                    else next.add(e.id);
                    setExcluded(next);
                  }}
                />
                <span className="tabular text-xs text-fg-muted">{e.date.slice(5).replace("-", "/")}</span>
                <span className="truncate">{e.description}</span>
                <span className="tabular ml-auto text-xs">
                  {e.payer === "OWNER" ? `${names.PARTNER}の分 ${formatYen(e.partnerShare)}` : `${names.OWNER}の分 ${formatYen(e.ownerShare)}`}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <p className="text-sm">
        {targets.length} 件・{net === 0 ? "差額 0 円" : `${names[payer]} → ${names[payer === "OWNER" ? "PARTNER" : "OWNER"]}`}{" "}
        <span className="tabular font-bold">{formatYen(Math.abs(net))}</span>
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="実際に渡した額（空なら差額どおり）" className="w-48">
          <Input aria-label="実際に渡した額（空なら差額どおり）" type="number" min={0} inputMode="numeric" className="tabular text-right" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(Math.abs(net))} />
        </Field>
        <Field label={`${names.OWNER}の口座`} className="w-40">
          <Select aria-label={`${names.OWNER}の口座`} value={methodId} onChange={(e) => setMethodId(e.target.value)}>
            {data.options.methods.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="メモ（任意）" className="min-w-32 flex-1">
          <Input aria-label="メモ（任意）" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={200} />
        </Field>
      </div>
      {error ? <p role="alert" className="text-dns-16N-130 text-error-1">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={busy || targets.length === 0}>
          {busy ? "精算中..." : `${targets.length} 件を精算`}
        </Button>
        <Button type="button" size="sm" onClick={() => setOpenForm(false)} disabled={busy}>
          キャンセル
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* 明細                                                                */
/* ------------------------------------------------------------------ */

function syncBadge(e: PairEntryView) {
  if (e.householdMissing) return <Badge tone="red">家計簿の明細なし</Badge>;
  if (e.sync === "PENDING_IMPORT") return <Badge tone="yellow">取込待ち</Badge>;
  if (e.sync === "ERROR") return <Badge tone="red">家計簿に未反映</Badge>;
  return null;
}

function Entries({ data, today, onNotice }: { data: PairPageData; today: string; onNotice: NoticeSetter }) {
  const router = useRouter();
  const { names } = data;
  const [filters, setFilters] = useState({ month: "", status: "", payer: "", costTypeId: "", event: "", q: "" });
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof filters>) => setFilters((f) => ({ ...f, ...patch }));

  const months = useMemo(() => [...new Set(data.entries.map((e) => e.date.slice(0, 7)))].sort().reverse(), [data.entries]);
  const events = useMemo(() => [...new Set(data.entries.map((e) => e.event))].sort((a, b) => a.localeCompare(b, "ja")), [data.entries]);
  const q = filters.q.trim().normalize("NFKC").toLowerCase();
  const rows = data.entries.filter(
    (e) =>
      (!filters.month || e.date.startsWith(filters.month)) &&
      (!filters.status ||
        (filters.status === "open" && !e.settled) ||
        (filters.status === "settled" && e.settled && !e.history) ||
        (filters.status === "history" && e.history)) &&
      (!filters.payer || e.payer === filters.payer) &&
      (!filters.costTypeId || (filters.costTypeId === "none" ? !e.costTypeId : e.costTypeId === filters.costTypeId)) &&
      (!filters.event || e.event === filters.event) &&
      (!q || `${e.description} ${e.memo ?? ""}`.normalize("NFKC").toLowerCase().includes(q)),
  );
  const total = rows.reduce((s, e) => s + e.amount, 0);

  async function remove(entry: PairEntryView) {
    if (!window.confirm(`「${entry.description}」を消しますか？家計簿に書いた明細も消えます。`)) return;
    setError(null);
    try {
      await api(`/api/pair/entries/${entry.id}`, { method: "DELETE" });
      onNotice({ tone: "ok", text: "消しました" });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました");
    }
  }

  return (
    <Card>
      <CardBody className="space-y-3 pt-4">
        <div className="flex flex-wrap items-end gap-2" role="search" aria-label="二人の明細の絞り込み">
          <Field label="月" className="w-32">
            <Select aria-label="月" value={filters.month} onChange={(e) => set({ month: e.target.value })}>
              <option value="">すべて</option>
              {months.map((m) => (
                <option key={m} value={m}>
                  {m.replace("-", "/")}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="精算" className="w-36">
            <Select aria-label="精算" value={filters.status} onChange={(e) => set({ status: e.target.value })}>
              <option value="">すべて</option>
              <option value="open">未精算</option>
              <option value="settled">精算済み</option>
              <option value="history">過去分の取込</option>
            </Select>
          </Field>
          <Field label="払った人" className="w-32">
            <Select aria-label="払った人" value={filters.payer} onChange={(e) => set({ payer: e.target.value })}>
              <option value="">すべて</option>
              <option value="OWNER">{names.OWNER}</option>
              <option value="PARTNER">{names.PARTNER}</option>
            </Select>
          </Field>
          <Field label="費目" className="w-32">
            <Select aria-label="費目" value={filters.costTypeId} onChange={(e) => set({ costTypeId: e.target.value })}>
              <option value="">すべて</option>
              <option value="none">（費目なし）</option>
              {data.options.costTypes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="イベント" className="w-44">
            <Select aria-label="イベント" value={filters.event} onChange={(e) => set({ event: e.target.value })}>
              <option value="">すべて</option>
              {events.map((ev) => (
                <option key={ev} value={ev}>
                  {ev}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="検索" className="min-w-40 flex-1">
            <Input aria-label="検索" value={filters.q} onChange={(e) => set({ q: e.target.value })} placeholder="内容・メモ" />
          </Field>
        </div>
        <p className="text-xs text-fg-muted">
          {rows.length} 件 ・ 総額 <span className="tabular font-bold text-fg">{formatYen(total)}</span>
        </p>
        {error ? <p role="alert" className="text-dns-16N-130 text-error-1">{error}</p> : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <caption className="sr-only">二人の明細</caption>
            <thead className="text-xs text-fg-muted">
              <tr className="border-b border-border text-left">
                <th scope="col" className="py-1.5 pr-2 font-medium">日付</th>
                <th scope="col" className="px-2 py-1.5 font-medium">内容</th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">総額</th>
                <th scope="col" className="px-2 py-1.5 font-medium">払った人</th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">{names.OWNER}の負担</th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">{names.PARTNER}の負担</th>
                <th scope="col" className="px-2 py-1.5 font-medium">費目・中項目</th>
                <th scope="col" className="px-2 py-1.5 font-medium">家計簿</th>
                <th scope="col" className="w-16 py-1.5"><span className="sr-only">操作</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((e) =>
                editing === e.id ? (
                  <tr key={e.id}>
                    <td colSpan={9} className="py-3">
                      <PairEntryForm
                        entry={e}
                        names={names}
                        options={data.options}
                        today={today}
                        onCancel={() => setEditing(null)}
                        onDone={(warning) => {
                          setEditing(null);
                          onNotice(warning ? { tone: "warn", text: `直しましたが、家計簿には書けませんでした: ${warning}` } : { tone: "ok", text: "直しました（家計簿も書き直しました）" });
                          router.refresh();
                        }}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={e.id} className={cn(e.settled && "text-fg-muted")}>
                    <td className="tabular whitespace-nowrap py-1.5 pr-2">{e.date.replace(/-/g, "/")}</td>
                    <td className="px-2 py-1.5">
                      <span className="flex flex-wrap items-center gap-1">
                        {e.description}
                        {e.history ? <Badge>過去分</Badge> : e.settled ? <Badge tone="green">精算済み</Badge> : null}
                        {syncBadge(e)}
                      </span>
                      {e.memo ? <span className="block text-xs text-fg-muted">{e.memo}</span> : null}
                    </td>
                    <td className="tabular px-2 py-1.5 text-right">{formatYen(e.amount)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{names[e.payer]}</td>
                    <td className="tabular px-2 py-1.5 text-right">{formatYen(e.ownerShare)}</td>
                    <td className="tabular px-2 py-1.5 text-right">{formatYen(e.partnerShare)}</td>
                    <td className="px-2 py-1.5 text-xs">
                      {e.costTypeName ?? "—"}
                      {e.categoryName ? <span className="block text-fg-muted">{e.categoryName}</span> : null}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-xs">
                      {e.householdTxId && !e.householdMissing ? (
                        <Link className="link" href={`/transactions?id=${e.householdTxId}`}>
                          {e.sync === "LINKED" ? "取込明細" : "明細"}
                        </Link>
                      ) : e.history ? (
                        <span className="text-fg-muted" title="過去の支出は家計簿に既に入っているので書かない">—</span>
                      ) : e.sync === "NONE" ? (
                        <span className="text-fg-muted">書かない</span>
                      ) : null}
                    </td>
                    <td className="py-1.5 text-right">
                      {!e.settled ? (
                        <span className="inline-flex gap-0.5">
                          <button type="button" className="rounded p-1 text-fg-muted hover:text-fg" onClick={() => setEditing(e.id)} aria-label={`${e.description} を直す`}>
                            <Pencil size={14} />
                          </button>
                          <button type="button" className="rounded p-1 text-fg-muted hover:text-expense" onClick={() => void remove(e)} aria-label={`${e.description} を消す`}>
                            <Trash2 size={14} />
                          </button>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
        {rows.length === 0 ? <p className="py-4 text-center text-sm text-fg-muted">当てはまる明細はありません</p> : null}
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* 精算の履歴                                                          */
/* ------------------------------------------------------------------ */

function Settlements({ data, onNotice }: { data: PairPageData; onNotice: NoticeSetter }) {
  const router = useRouter();
  const { names } = data;
  const [error, setError] = useState<string | null>(null);
  async function undo(id: string) {
    if (!window.confirm("この精算を取り消しますか？明細は未精算に戻り、家計簿に書いた精算の明細は消えます。")) return;
    setError(null);
    try {
      await api(`/api/pair/settlements/${id}`, { method: "DELETE" });
      onNotice({ tone: "ok", text: "精算を取り消しました" });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "取り消しに失敗しました");
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>精算の履歴</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        {error ? <p role="alert" className="text-dns-16N-130 text-error-1">{error}</p> : null}
        {data.settlements.length === 0 ? (
          <p className="text-sm text-fg-muted">精算の記録はまだありません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <caption className="sr-only">精算の履歴</caption>
              <thead className="text-xs text-fg-muted">
                <tr className="border-b border-border text-left">
                  <th scope="col" className="py-1.5 pr-2 font-medium">日付</th>
                  <th scope="col" className="px-2 py-1.5 font-medium">向き</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">金額</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">件数</th>
                  <th scope="col" className="px-2 py-1.5 font-medium">口座・メモ</th>
                  <th scope="col" className="w-20 py-1.5"><span className="sr-only">操作</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.settlements.map((s) => (
                  <tr key={s.id} className={cn(s.canceled && "text-fg-muted line-through")}>
                    <td className="tabular whitespace-nowrap py-1.5 pr-2">{s.date.replace(/-/g, "/")}</td>
                    <td className="px-2 py-1.5">
                      {s.history ? (
                        <Badge>過去分の取込</Badge>
                      ) : (
                        `${names[s.payer]} → ${names[s.payer === "OWNER" ? "PARTNER" : "OWNER"]}`
                      )}
                      {s.canceled ? <Badge className="ml-1">取消</Badge> : null}
                    </td>
                    <td className="tabular px-2 py-1.5 text-right">{s.history ? "—" : formatYen(s.amount)}</td>
                    <td className="tabular px-2 py-1.5 text-right">{s.count}</td>
                    <td className="px-2 py-1.5 text-xs">
                      {s.methodName ?? ""}
                      {s.memo ? <span className="block text-fg-muted">{s.memo}</span> : null}
                    </td>
                    <td className="py-1.5 text-right">
                      {!s.canceled && !s.history ? (
                        <Button size="sm" variant="ghost" onClick={() => void undo(s.id)}>
                          <Undo2 size={14} aria-hidden />
                          取消
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-fg-muted">過去分の取込（割り勘アプリなど）の取り消しは、取り込んだ明細ごと消すため LINE ボットのダッシュボードで行います。</p>
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* イベント別                                                          */
/* ------------------------------------------------------------------ */

function Events({ data, onNotice }: { data: PairPageData; onNotice: NoticeSetter }) {
  const { names } = data;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  // 中項目が決まらない二人の明細を、メモ（過去分の取込ではイベント名が入っている）ごとにまとめる
  const unassigned = useMemo(() => {
    const groups = new Map<string, PairEntryView[]>();
    for (const e of data.entries) {
      if (e.eventSource !== "none") continue;
      const key = e.memo?.trim() || "（メモなし）";
      groups.set(key, [...(groups.get(key) ?? []), e]);
    }
    return [...groups].sort((a, b) => b[1].length - a[1].length);
  }, [data.entries]);
  const categories = data.options.categories.filter((c) => c.name !== data.options.defaultCategoryName);

  /** 選んだ中項目。まだ選んでいなければ、メモと同じ名前の中項目 */
  const chosen = (memo: string) => choice[memo] ?? categories.find((c) => c.name === memo)?.id ?? "";

  async function assign(memo: string, entries: PairEntryView[]) {
    const categoryId = chosen(memo);
    if (!categoryId) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/pair/entries/category", { method: "POST", body: { ids: entries.map((e) => e.id), categoryId } });
      const name = categories.find((c) => c.id === categoryId)?.name ?? "";
      onNotice({ tone: "ok", text: `メモ「${memo}」の ${entries.length} 件を中項目「${name}」にしました` });
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
          <CardTitle>イベント別（中項目ごと）</CardTitle>
          <p className="mt-1 text-xs text-fg-muted">
            イベントは中項目（大項目「パートナー」配下の旅行など）。二人の明細に中項目が無いときは、結び付けた家計簿の明細の中項目を使います。
            「自分だけ」は家計簿の割り勘にしない二人の時の出費（「二人の時の出費」で区分したもの）。精算済み・過去分も含みます
          </p>
        </CardHeader>
        <CardBody>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <caption className="sr-only">イベント別の二人の支出</caption>
              <thead className="text-xs text-fg-muted">
                <tr className="border-b border-border text-left">
                  <th scope="col" className="py-1.5 pr-2 font-medium">イベント（中項目）</th>
                  <th scope="col" className="px-2 py-1.5 font-medium">期間</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">二人の総額</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">{names.OWNER}の負担</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">{names.PARTNER}の負担</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">自分だけ</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">自分の出費</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.events.map((ev) => (
                  <tr key={ev.name} className={cn(ev.name === "（中項目なし）" && "text-fg-muted")}>
                    <td className="py-1.5 pr-2">
                      {ev.name}
                      <span className="ml-1 text-xs text-fg-muted">
                        {ev.count} 件{ev.soloCount ? ` ＋ ${ev.soloCount} 件` : ""}
                      </span>
                    </td>
                    <td className="tabular whitespace-nowrap px-2 py-1.5 text-xs">
                      {ev.from.replace(/-/g, "/")}
                      {ev.to !== ev.from
                        ? ` 〜 ${ev.to.slice(0, 4) === ev.from.slice(0, 4) ? ev.to.slice(5).replace("-", "/") : ev.to.replace(/-/g, "/")}`
                        : ""}
                    </td>
                    <td className="tabular px-2 py-1.5 text-right">{ev.count ? formatYen(ev.total) : "—"}</td>
                    <td className="tabular px-2 py-1.5 text-right">{ev.count ? formatYen(ev.ownerShare) : "—"}</td>
                    <td className="tabular px-2 py-1.5 text-right">{ev.count ? formatYen(ev.partnerShare) : "—"}</td>
                    <td className="tabular px-2 py-1.5 text-right">{ev.soloCount ? formatYen(ev.solo) : "—"}</td>
                    <td className="tabular px-2 py-1.5 text-right font-bold">{formatYen(ev.ownerShare + ev.solo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.events.length === 0 ? <p className="py-4 text-center text-sm text-fg-muted">二人の明細はまだありません</p> : null}
        </CardBody>
      </Card>

      {unassigned.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>中項目が決まっていない二人の明細</CardTitle>
            <p className="mt-1 text-xs text-fg-muted">
              メモ（過去分の取込ではイベント名）ごとにまとめています。中項目を選ぶと、まとめてそのイベントになります。
              未精算の明細は家計簿の明細も書き直し、精算済みの明細は家計簿の自分の負担の中項目も付け替えます（金額は変わりません）
            </p>
          </CardHeader>
          <CardBody className="space-y-2">
            {error ? <p role="alert" className="text-dns-16N-130 text-error-1">{error}</p> : null}
            <ul className="divide-y divide-border text-sm">
              {unassigned.map(([memo, entries]) => (
                <li key={memo} className="flex flex-wrap items-center gap-2 py-1.5">
                  <span className="font-bold">{memo}</span>
                  <span className="text-xs text-fg-muted">
                    {entries.length} 件 ・ {formatYen(entries.reduce((sum, e) => sum + e.amount, 0))}
                  </span>
                  <span className="ml-auto flex items-center gap-1">
                    <Select
                      aria-label={`メモ「${memo}」の中項目`}
                      className="h-8 w-44 text-xs"
                      value={chosen(memo)}
                      onChange={(e) => setChoice({ ...choice, [memo]: e.target.value })}
                    >
                      <option value="">中項目を選ぶ</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                    <Button
                      size="sm"
                      disabled={busy || !chosen(memo)}
                      onClick={() => void assign(memo, entries)}
                    >
                      まとめて付ける
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-fg-muted">
              合う中項目が無いときは「設定」→「カテゴリ」で大項目「パートナー」に中項目を足してください。
            </p>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 家計簿との突き合わせ                                                */
/* ------------------------------------------------------------------ */

function Reconcile({ data, onNotice }: { data: PairPageData; onNotice: NoticeSetter }) {
  const router = useRouter();
  const { reconcile, names } = data;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ linked: number; retried: number; pending: number; errors: number }>("/api/pair/reconcile", { method: "POST" });
      onNotice({ tone: "ok", text: `照合しました: カード明細と結び付けた ${r.linked} 件・書き直した ${r.retried} 件（取込待ち ${r.pending} 件・未反映 ${r.errors} 件）` });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "照合に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  const list = (title: string, hint: string, rows: PairEntryView[]) => (
    <section className="space-y-1">
      <h3 className="text-std-16B-170">
        {title} <span className="tabular text-sm font-normal text-fg-muted">{rows.length} 件</span>
      </h3>
      <p className="text-xs text-fg-muted">{hint}</p>
      {rows.length > 0 ? (
        <ul className="divide-y divide-border text-sm">
          {rows.map((e) => (
            <li key={e.id} className="flex flex-wrap gap-x-3 py-1">
              <span className="tabular text-fg-muted">{e.date.replace(/-/g, "/")}</span>
              <span>{e.description}</span>
              <span className="text-xs text-fg-muted">{e.methodName ?? names[e.payer] + "が払った"}</span>
              <span className="tabular ml-auto">{formatYen(e.amount)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>家計簿との突き合わせ</CardTitle>
        <Button size="sm" onClick={() => void run()} disabled={busy}>
          <RefreshCw size={14} aria-hidden />
          {busy ? "照合中..." : "今すぐ照合"}
        </Button>
      </CardHeader>
      <CardBody className="space-y-4">
        {error ? <p role="alert" className="text-dns-16N-130 text-error-1">{error}</p> : null}
        {reconcile.account ? (
          <section className="space-y-1">
            <h3 className="text-std-16B-170">口座「{reconcile.account.name}」の残高</h3>
            <dl className="grid grid-cols-3 gap-2 text-sm">
              <div>
                <dt className="text-xs text-fg-muted">口座残高</dt>
                <dd className="tabular font-bold">{formatYen(reconcile.account.balance)}</dd>
              </div>
              <div>
                <dt className="text-xs text-fg-muted">二人の明細から</dt>
                <dd className="tabular font-bold">{formatYen(reconcile.account.expected)}</dd>
              </div>
              <div>
                <dt className="text-xs text-fg-muted">ずれ</dt>
                <dd className={cn("tabular font-bold", reconcile.account.diff !== 0 && "text-expense")}>{formatYen(reconcile.account.diff)}</dd>
              </div>
            </dl>
            <p className="text-xs text-fg-muted">
              プラス = {names.PARTNER}に貸している。二人の明細からの値は、家計簿に書いた（取込待ち・未反映を除く）未精算の明細の差額
              （取込待ちのまま精算した明細があれば、そのぶんを引いた額）。
              ずれがあるときは、家計簿の明細を直接直した・消した、起点残高を入れた、などが考えられます
            </p>
          </section>
        ) : (
          <p className="text-sm text-fg-muted">決済手段「彼女精算」（残高を追う）が無いため、口座残高とは比べられません。</p>
        )}
        <CurrentMatching data={data} onNotice={onNotice} />
        {list("家計簿に書けなかった明細", "書き込み先（中項目・決済手段）が無かったなど。直してから「今すぐ照合」で書き直します", reconcile.errors)}
        {list("家計簿の明細が見つからない明細", "家計簿に書いたはずの明細が、明細画面やスプレッドシートで消されています。二人の明細を直す（保存し直す）と書き直されます", reconcile.householdMissing)}
      </CardBody>
    </Card>
  );
}
