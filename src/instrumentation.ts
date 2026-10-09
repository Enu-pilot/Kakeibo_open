/**
 * サーバーの起動時に 1 回だけ呼ばれる（Next.js の instrumentation）。
 * ここでスプレッドシートを全件読み込んでおき、最初の画面から待たずに表示できるようにする。
 * register が終わるまでサーバーはリクエストを受け付けないので、起動した時点で読み込みは済んでいる。
 */
export async function register() {
  // ビルド中や Edge 実行環境では読まない（鍵やネットワークが無いことがある）
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { preloadSnapshot } = await import("@/lib/db/preload");
  await preloadSnapshot();
}
