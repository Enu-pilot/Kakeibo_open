import { Card, CardBody } from "@/components/ui";

/**
 * スプレッドシートに繋がらないときの表示。
 *
 * 本番ビルドの Next.js は、サーバー側で起きたエラーの文言を画面に出さない
 * （「Application error」だけになる）。共有し忘れ・API の無効化といった設定の問題は
 * 直し方の文言こそが必要なので、画面ごとに受け止めてこのコンポーネントで表示する。
 */
export function SetupError({ message }: { message: string }) {
  return (
    <Card role="alert" className="mx-auto max-w-2xl border-[3px] border-error-1">
      <CardBody className="space-y-3 pt-5">
        <h1 className="text-std-20B-150 text-error-1">スプレッドシートに接続できません</h1>
        <p className="whitespace-pre-wrap text-sm">{message}</p>
        <p className="text-xs text-fg-muted">
          ターミナルで <code className="rounded bg-solid-gray-50 px-1 font-mono">npm run sheets:check</code>{" "}
          を実行すると、どの段階で止まっているかを順に確認できます。直したらこの画面を再読み込みしてください。
        </p>
      </CardBody>
    </Card>
  );
}
