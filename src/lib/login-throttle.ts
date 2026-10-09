/**
 * ログイン試行の回数制限。
 *
 * 利用者は 1 人なので、接続元ごとではなくアプリ全体で数える
 * （Codespaces の転送越しでは接続元がどれも同じに見えるため、接続元で分けても意味が無い）。
 *
 * 失敗が 5 回続くと一定時間ログインを受け付けない。失敗を重ねるたびに待ち時間を倍にし、
 * 最大 15 分にする。成功すれば数え直す。
 *
 * アプリはインターネットに公開しない前提だが、万一ポートの公開範囲を誤って開いた場合の
 * 多重の防御として入れている。
 */

const FREE_ATTEMPTS = 5;
const BASE_LOCK_MS = 30_000;
const MAX_LOCK_MS = 15 * 60_000;

type State = { failures: number; lockedUntil: number };
const store = globalThis as unknown as { __kakeiboLogin?: State };
function state(): State {
  return (store.__kakeiboLogin ??= { failures: 0, lockedUntil: 0 });
}

/** 締め出し中なら残り秒数、そうでなければ 0 */
export function lockedSeconds(now = Date.now()) {
  const s = state();
  return s.lockedUntil > now ? Math.ceil((s.lockedUntil - now) / 1000) : 0;
}

export function recordFailure(now = Date.now()) {
  const s = state();
  s.failures += 1;
  if (s.failures >= FREE_ATTEMPTS) {
    const exponent = s.failures - FREE_ATTEMPTS;
    s.lockedUntil = now + Math.min(BASE_LOCK_MS * 2 ** exponent, MAX_LOCK_MS);
  }
}

export function recordSuccess() {
  store.__kakeiboLogin = { failures: 0, lockedUntil: 0 };
}
