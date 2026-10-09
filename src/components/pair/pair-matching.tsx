"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Link2, Link2Off } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { api } from "@/lib/client-api";
import { cn, formatYen } from "@/lib/utils";
import type { MatchCandidate } from "@/lib/pair-match";
import type { PairEntryView, PairPageData } from "@/lib/pair-view";

type NoticeSetter = (notice: { tone: "ok" | "warn"; text: string } | null) => void;

const day = (d: string) => d.replace(/-/g, "/");

/** 家計簿の明細 1 件（候補）の表示 */
function CandidateLine({ c, showDiff = true }: { c: MatchCandidate; showDiff?: boolean }) {
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      <span className="tabular text-fg-muted">{day(c.date)}</span>
      {showDiff && c.dayDiff !== 0 ? (
        <span className="tabular text-xs text-fg-muted">（{c.dayDiff > 0 ? `${c.dayDiff} 日後` : `${-c.dayDiff} 日前`}）</span>
      ) : null}
      <Link className="link truncate" href={`/transactions?id=${c.id}`}>
        {c.description}
      </Link>
      <span className="text-xs text-fg-muted">
        {[c.methodName, c.categoryName].filter(Boolean).join(" ・ ")}
      </span>
      <span className="tabular">{formatYen(c.amount)}</span>
    </span>
  );
}

function EntryLine({ e, names }: { e: PairEntryView; names: PairPageData["names"] }) {
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      <span className="tabular text-fg-muted">{day(e.date)}</span>
      <span className="font-bold">{e.description}</span>
      {e.memo ? <span className="text-xs text-fg-muted">{e.memo}</span> : null}
      <span className="text-xs text-fg-muted">{e.methodName ?? `${names[e.payer]}が払った`}</span>
      <span className="tabular">{formatYen(e.amount)}</span>
    </span>
  );
}

/** 結び付け・外す・まとめて結び付ける の共通処理 */
function useActions(onNotice: NoticeSetter) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run(key: string, action: () => Promise<string>) {
    setBusy(key);
    setError(null);
    try {
      onNotice({ tone: "ok", text: await action() });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setBusy(null);
    }
  }
  const link = (entryId: string, transactionId: string, done: string) =>
    run(`${entryId}:${transactionId}`, async () => {
      const r = await api<{ warning?: string | null }>(`/api/pair/entries/${entryId}/link`, { method: "POST", body: { transactionId } });
      return r.warning ? `${done}（${r.warning}）` : done;
    });
  const unlink = (entryId: string, done: string) =>
    run(`${entryId}:unlink`, async () => {
      const r = await api<{ warning?: string | null }>(`/api/pair/entries/${entryId}/link`, { method: "DELETE" });
      return r.warning ? `${done}（${r.warning}）` : done;
    });
  return { busy, error, run, link, unlink };
}

/**
 * 「家計簿との突き合わせ」タブに足す区画: LINE で書いた明細と取込明細の重なり、カードの取込待ちの候補、
 * 家計簿にあって二人の明細に無い明細。
 */
export function CurrentMatching({ data, onNotice }: { data: PairPageData; onNotice: NoticeSetter }) {
  const { match, names } = data;
  const entries = useMemo(() => new Map(data.entries.map((e) => [e.id, e])), [data.entries]);
  const { busy, error, link } = useActions(onNotice);

  return (
    <div className="space-y-4">
      {error ? <p role="alert" className="text-dns-16N-130 text-error-1">{error}</p> : null}

      <section className="space-y-1">
        <h3 className="text-std-16B-170">
          取込明細と重なっている明細 <span className="tabular text-sm font-normal text-fg-muted">{match.duplicates.length} 件</span>
        </h3>
        <p className="text-xs text-fg-muted">
          LINE（またはこのページ）で登録して家計簿にも書いた明細と、同じ決済手段・同じ金額・日付の差 3 日以内の取込明細（CSV・シート）があります。
          「取込明細にまとめる」と、LINE で書いた明細を消し、取込明細を自分の負担と立替に分けます
        </p>
        {match.duplicates.length > 0 ? (
          <ul className="divide-y divide-border text-sm">
            {match.duplicates.map((d) => {
              const e = entries.get(d.entryId);
              if (!e) return null;
              return (
                <li key={d.entryId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <EntryLine e={e} names={names} />
                    <div className="flex items-baseline gap-1 pl-3 text-xs">
                      <span className="text-fg-muted">取込明細:</span>
                      <CandidateLine c={d.twin} />
                    </div>
                  </div>
                  <Button size="sm" onClick={() => void link(d.entryId, d.twin.id, `「${e.description}」を取込明細にまとめました`)} disabled={busy !== null}>
                    <Link2 size={14} aria-hidden />
                    取込明細にまとめる
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>

      <section className="space-y-1">
        <h3 className="text-std-16B-170">
          カード明細の取込待ち <span className="tabular text-sm font-normal text-fg-muted">{match.pending.length} 件</span>
        </h3>
        <p className="text-xs text-fg-muted">
          カード払いは、CSV 取込で入った明細（同じカード・同じ金額・日付の差 3 日以内でちょうど 1 件）の内訳を自動で分けます（「今すぐ照合」、LINE ボットも 1 時間ごと）。
          自動で決まらないときは、同じ金額で日付の差 14 日以内の明細から選べます
        </p>
        {match.pending.length > 0 ? (
          <ul className="divide-y divide-border text-sm">
            {match.pending.map((p) => {
              const e = entries.get(p.entryId);
              if (!e) return null;
              return (
                <li key={p.entryId} className="space-y-1 py-1.5">
                  <EntryLine e={e} names={names} />
                  {p.candidates.length === 0 ? (
                    <p className="pl-3 text-xs text-fg-muted">候補はまだありません（カード明細を取り込むと出ます）</p>
                  ) : (
                    <ul className="space-y-1 pl-3 text-xs">
                      {p.candidates.map((c) => (
                        <li key={c.id} className="flex flex-wrap items-center gap-2">
                          <CandidateLine c={c} />
                          {!c.sameMethod ? <Badge tone="yellow">決済手段が違う</Badge> : null}
                          <Button size="sm" variant="ghost" onClick={() => void link(p.entryId, c.id, `「${e.description}」をカード明細と結び付けました`)} disabled={busy !== null}>
                            <Link2 size={14} aria-hidden />
                            これと結び付ける
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>

      <p className="text-xs text-fg-muted">
        家計簿にあって二人の明細に無い明細（割り勘にしない二人の時の出費・精算の記録など）は「二人の時の出費」で区分できます。
      </p>
    </div>
  );
}

/**
 * 「過去分の照合」タブ。割り勘アプリなどから取り込んだ過去の明細が、家計簿のどの明細に当たるかを結び付ける。
 * 家計簿にはもう当時の明細が入っているので、どれかを覚えるだけで、家計簿の金額や内訳は変えない。
 */
export function HistoryMatching({ data, onNotice }: { data: PairPageData; onNotice: NoticeSetter }) {
  const { match, names } = data;
  const { history } = match;
  const entries = useMemo(() => new Map(data.entries.map((e) => [e.id, e])), [data.entries]);
  const { busy, error, run, link, unlink } = useActions(onNotice);
  const [showLinked, setShowLinked] = useState(false);
  const total = history.linked.length + history.unique.length + history.ambiguous.length + history.missing.length + history.partnerPaid;

  if (total === 0) {
    return (
      <Card>
        <CardBody className="pt-4">
          <p className="text-sm text-fg-muted">過去分の取込（割り勘アプリなどの記録）はありません。LINE ボットのダッシュボードから取り込めます。</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle>過去分の照合</CardTitle>
          <p className="mt-1 text-xs text-fg-muted">
            割り勘アプリなどから取り込んだ明細が、家計簿のどの明細に当たるかを結び付けます。家計簿の金額・内訳は変えません。
            同じ金額の明細を、二人の明細の日付の 150 日前〜30 日後から探します（予約は早めに払うことが多いため。7 日以内にあればそれだけ）
          </p>
        </div>
        {history.unique.length > 0 ? (
          <Button
            size="sm"
            variant="primary"
            disabled={busy !== null}
            onClick={() =>
              void run("auto", async () => {
                const r = await api<{ linked: number }>("/api/pair/history-match", { method: "POST" });
                return `候補が 1 つの ${r.linked} 件を結び付けました`;
              })
            }
          >
            <Link2 size={14} aria-hidden />
            候補が 1 つの {history.unique.length} 件を結び付ける
          </Button>
        ) : null}
      </CardHeader>
      <CardBody className="space-y-4">
        {error ? <p role="alert" className="text-dns-16N-130 text-error-1">{error}</p> : null}
        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
          {[
            ["結び付け済み", history.linked.length],
            ["候補が 1 つ", history.unique.length],
            ["候補が複数", history.ambiguous.length],
            ["見つからない", history.missing.length],
            [`${names.PARTNER}が払った`, history.partnerPaid],
          ].map(([label, n]) => (
            <div key={String(label)}>
              <dt className="text-xs text-fg-muted">{label}</dt>
              <dd className="tabular font-bold">{n} 件</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-fg-muted">
          {names.PARTNER}が払った明細は、自分の家計簿に対応する明細が無いので照合しません（自分の負担は、当時の精算で家計簿に入っています）。
        </p>

        {history.unique.length > 0 ? (
          <section className="space-y-1">
            <h3 className="text-std-16B-170">候補が 1 つ</h3>
            <ul className="divide-y divide-border text-sm">
              {history.unique.map(({ entryId, candidate }) => {
                const e = entries.get(entryId);
                if (!e) return null;
                return (
                  <li key={entryId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <EntryLine e={e} names={names} />
                      <div className="pl-3 text-xs">
                        <CandidateLine c={candidate} />
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => void link(entryId, candidate.id, `「${e.description}」を結び付けました`)} disabled={busy !== null}>
                      <Link2 size={14} aria-hidden />
                      結び付ける
                    </Button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {history.ambiguous.length > 0 ? (
          <section className="space-y-1">
            <h3 className="text-std-16B-170">候補が複数（選んでください）</h3>
            <ul className="divide-y divide-border text-sm">
              {history.ambiguous.map(({ entryId, candidates }) => {
                const e = entries.get(entryId);
                if (!e) return null;
                return (
                  <li key={entryId} className="space-y-1 py-1.5">
                    <EntryLine e={e} names={names} />
                    <ul className="space-y-1 pl-3 text-xs">
                      {candidates.map((c) => (
                        <li key={c.id} className="flex flex-wrap items-center gap-2">
                          <CandidateLine c={c} />
                          <Button size="sm" variant="ghost" onClick={() => void link(entryId, c.id, `「${e.description}」を結び付けました`)} disabled={busy !== null}>
                            <Link2 size={14} aria-hidden />
                            これ
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {history.missing.length > 0 ? (
          <section className="space-y-1">
            <h3 className="text-std-16B-170">見つからない（自分が払ったのに、同じ金額の明細が無い）</h3>
            <p className="text-xs text-fg-muted">
              現金で払って家計簿に入れていない、ポイントや IC カードで払った、金額が違う（端数・手数料）などが考えられます
            </p>
            <ul className="divide-y divide-border text-sm">
              {history.missing.map((entryId) => {
                const e = entries.get(entryId);
                return e ? (
                  <li key={entryId} className="py-1">
                    <EntryLine e={e} names={names} />
                  </li>
                ) : null;
              })}
            </ul>
          </section>
        ) : null}

        {history.linked.length > 0 ? (
          <section className="space-y-1">
            <h3 className="text-std-16B-170">
              <button type="button" className="flex items-center gap-1" onClick={() => setShowLinked(!showLinked)} aria-expanded={showLinked}>
                結び付け済み {history.linked.length} 件 <span className="text-xs font-normal text-fg-muted">{showLinked ? "（閉じる）" : "（開く）"}</span>
              </button>
            </h3>
            {showLinked ? (
              <ul className="divide-y divide-border text-sm">
                {history.linked.map(({ entryId, tx }) => {
                  const e = entries.get(entryId);
                  if (!e) return null;
                  return (
                    <li key={entryId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <EntryLine e={e} names={names} />
                        <div className={cn("pl-3 text-xs", !tx && "text-expense")}>
                          {tx ? <CandidateLine c={tx} /> : "結び付けた家計簿の明細が見つかりません（消された可能性があります）"}
                        </div>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => void unlink(entryId, `「${e.description}」の結び付けを外しました`)} disabled={busy !== null}>
                        <Link2Off size={14} aria-hidden />
                        外す
                      </Button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>
        ) : null}
      </CardBody>
    </Card>
  );
}

