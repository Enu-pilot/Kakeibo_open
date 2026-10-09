import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "kakeibo_session";
const SESSION_DAYS = 30;

/** 雛形の値のまま動かしてしまうのを防ぐ */
const TEMPLATE_PASSWORDS = new Set(["change-me", "replace-with-a-long-random-string"]);

/** 設定の不備。直し方をそのまま画面に出す */
export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigError";
  }
}

function secretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new AuthConfigError("AUTH_SECRET が未設定です。npm run setup:env を実行してください。");
  }
  // 短い鍵は総当たりでセッション Cookie を偽造され得る
  if (secret.length < 32 || TEMPLATE_PASSWORDS.has(secret)) {
    throw new AuthConfigError(
      "AUTH_SECRET が短すぎるか雛形の値のままです（32 文字以上必要）。" +
        "npm run setup:env を実行すると安全な値に作り直します。",
    );
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken() {
  return new SignJWT({ sub: "owner" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string | undefined) {
  if (!token) return false;
  try {
    await jwtVerify(token, secretKey());
    return true;
  } catch {
    return false;
  }
}

export const SESSION_MAX_AGE = SESSION_DAYS * 24 * 60 * 60;

/** ログインに使ってよいパスワードか。不備があれば直し方つきで投げる */
function expectedPassword() {
  const expected = process.env.APP_PASSWORD;
  if (!expected) {
    throw new AuthConfigError("APP_PASSWORD が未設定です。npm run setup:env を実行してください。");
  }
  if (TEMPLATE_PASSWORDS.has(expected) || expected.length < 8) {
    throw new AuthConfigError(
      "APP_PASSWORD が雛形の値のままか、短すぎます（8 文字以上必要）。" +
        ".env と .env.local の APP_PASSWORD を変えるか、npm run setup:env を実行してください。",
    );
  }
  return expected;
}

/** タイミング攻撃を避けたパスワード比較 */
export function passwordMatches(input: string) {
  const a = new TextEncoder().encode(input);
  const b = new TextEncoder().encode(expectedPassword());
  // 長さが違っても早期 return せず、常に同じ回数だけ比較する
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}
